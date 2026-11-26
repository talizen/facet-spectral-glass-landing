// 从 ~/dev/creght-tpl/spectral-lab/src 原样拷来，改引擎时在那边改完再拷过来，别只改这里。
import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { QUALITY, makeFinishPass, type Fx, type Pointer, type Quality } from './common'
import { ENV } from './prism'

/**
 * 三棱镜分光：一束白光射进玻璃三棱镜，出来散成彩虹。
 * 光路是真算的：每帧在棱镜截面里对每个波长做一次二维折射（进、出，必要时全反射），
 * 再把这些线段画成发光的细带。棱镜一转，彩虹跟着摆。
 */

const R = 2.5 // 截面外接圆半径
const HZ = 2.4 // 棱镜半长
const RAYS = 30
const MAX_QUADS = 4 + RAYS * 5

const PRISM_VERT = /* glsl */ `
varying vec3 vP, vCam;
varying mat3 vRot;
void main() {
  vP = position;
  vRot = mat3(modelMatrix);
  vCam = transpose(vRot) * (cameraPosition - modelMatrix[3].xyz);
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
}
`

const PRISM_FRAG = /* glsl */ `
precision highp float;
uniform float uR, uHz, uEdge;
varying vec3 vP, vCam;
varying mat3 vRot;
${ENV}
void main() {
  // 到三个侧面和两个端面的距离：最小的是当前所在的面，第二小的是到最近棱边的距离
  float ri = uR * 0.5;
  vec2 n0 = vec2(0.8660254, -0.5), n1 = vec2(0.0, 1.0), n2 = vec2(-0.8660254, -0.5);
  float d0 = ri - dot(vP.xy, n0), d1 = ri - dot(vP.xy, n1), d2 = ri - dot(vP.xy, n2), dz = uHz - abs(vP.z);
  vec3 n = vec3(n0, 0.0);
  float m = d0;
  if (d1 < m) { m = d1; n = vec3(n1, 0.0); }
  if (d2 < m) { m = d2; n = vec3(n2, 0.0); }
  if (dz < m) { m = dz; n = vec3(0.0, 0.0, sign(vP.z)); }
  float a = min(d0, d1), b = max(d0, d1), c = min(d2, dz), e = max(d2, dz);
  float bd = min(max(a, c), min(b, e));
  float edge = 1.0 - smoothstep(0.0, uEdge, bd);

  if (!gl_FrontFacing) {
    gl_FragColor = vec4(vec3(0.82, 0.9, 1.0) * edge * 0.5, 0.0);
    return;
  }
  vec3 rd = normalize(vP - vCam);
  float F = 0.04 + 0.96 * pow(1.0 - max(dot(-rd, n), 0.0), 5.0);
  float grain = fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453);
  vec3 col = vec3(0.006, 0.009, 0.018);
  col += envSoft(vRot * reflect(rd, n)) * (0.04 + 0.96 * F) * (0.7 + 0.6 * grain);
  col += envStrips(vRot * reflect(rd, n)) * F * 1.2;
  float bw = uEdge * 3.6;
  float bevel = 1.0 - smoothstep(bw - 0.006, bw, bd);
  float inner = 1.0 - smoothstep(0.0, 0.012, abs(bd - bw));
  col += vec3(0.92, 0.96, 1.0) * (edge * 2.1 + bevel * 0.05 + inner * 0.5);
  gl_FragColor = vec4(col, 0.5);
}
`

const BEAM_VERT = /* glsl */ `
attribute float aV;
varying float vV;
varying vec3 vColor;
void main() {
  vV = aV;
  vColor = color;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`
const BEAM_FRAG = /* glsl */ `
precision highp float;
varying float vV;
varying vec3 vColor;
void main() {
  gl_FragColor = vec4(vColor * exp(-vV * vV * 3.0), 1.0);
}
`

type V2 = [number, number]
const dot2 = (a: V2, b: V2) => a[0] * b[0] + a[1] * b[1]

/** 二维折射，n 是迎着入射光的法线；全反射返回 null */
function refract2(d: V2, n: V2, eta: number): V2 | null {
  const c = dot2(n, d)
  const k = 1 - eta * eta * (1 - c * c)
  if (k < 0) return null
  const s = eta * c + Math.sqrt(k)
  return [eta * d[0] - s * n[0], eta * d[1] - s * n[1]]
}

/** 射线和三角形三条边求交，返回最近的一条：{t, 外法线} */
function hitEdge(o: V2, d: V2, tri: V2[], wantEntering: boolean) {
  let best: { t: number; n: V2 } | null = null
  for (let k = 0; k < 3; k++) {
    const a = tri[k]
    const b = tri[(k + 1) % 3]
    const ex = b[0] - a[0]
    const ey = b[1] - a[1]
    // 外法线：垂直于边，背离原点（三角形中心在原点）
    let n: V2 = [ey, -ex]
    const nl = Math.hypot(n[0], n[1])
    n = [n[0] / nl, n[1] / nl]
    if (dot2(n, a) < 0) n = [-n[0], -n[1]]
    const facing = dot2(d, n)
    if (wantEntering ? facing >= 0 : facing <= 0) continue
    const den = d[0] * ey - d[1] * ex
    if (Math.abs(den) < 1e-9) continue
    const t = ((a[0] - o[0]) * ey - (a[1] - o[1]) * ex) / den
    const s = ((a[0] - o[0]) * d[1] - (a[1] - o[1]) * d[0]) / den
    if (t > 1e-4 && s >= 0 && s <= 1 && (!best || t < best.t)) best = { t, n }
  }
  return best
}

/** 一条光线穿过棱镜：返回路径上的点（入射点、内部折点…、出射点）和出射方向 */
function traceRay(o: V2, d: V2, tri: V2[], ior: number) {
  const hit = hitEdge(o, d, tri, true)
  if (!hit) return null
  let p: V2 = [o[0] + d[0] * hit.t, o[1] + d[1] * hit.t]
  const entryN = hit.n
  let dir = refract2(d, [hit.n[0], hit.n[1]], 1 / ior)!
  const pts: V2[] = [p]
  for (let bounce = 0; bounce < 4; bounce++) {
    const h = hitEdge(p, dir, tri, false)
    if (!h) return null
    p = [p[0] + dir[0] * h.t, p[1] + dir[1] * h.t]
    pts.push(p)
    const out = refract2(dir, [-h.n[0], -h.n[1]], ior)
    if (out) return { pts, out, entryN }
    const c = dot2(dir, h.n)
    dir = [dir[0] - 2 * c * h.n[0], dir[1] - 2 * c * h.n[1]]
  }
  return null
}

const spectrumRGB = (t: number) =>
  [3, 2, 1].map((k) => Math.min(Math.max(1.5 - Math.abs(4 * t - k), 0), 1)) as [number, number, number]

export function createBeam(renderer: THREE.WebGLRenderer, quality: Quality = 'high'): Fx {
  const Q = QUALITY[quality]
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x000000)
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100)

  // —— 棱镜 ——
  const prismGeo = new THREE.CylinderGeometry(R, R, HZ * 2, 3, 1)
  prismGeo.rotateX(Math.PI / 2) // 轴转到 z；截面顶点落在 -90°、30°、150°
  const prismMat = new THREE.ShaderMaterial({
    uniforms: { uR: { value: R }, uHz: { value: HZ }, uEdge: { value: 0.03 } },
    vertexShader: PRISM_VERT,
    fragmentShader: PRISM_FRAG,
    side: THREE.DoubleSide,
    transparent: true,
    premultipliedAlpha: true,
    depthWrite: false,
  })
  const prism = new THREE.Mesh(prismGeo, prismMat)
  scene.add(prism)

  // —— 光束：一堆细长的四边形，叠加发光 ——
  const pos = new Float32Array(MAX_QUADS * 18)
  const col = new Float32Array(MAX_QUADS * 18)
  const av = new Float32Array(MAX_QUADS * 6)
  const beamGeo = new THREE.BufferGeometry()
  beamGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage))
  beamGeo.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage))
  beamGeo.setAttribute('aV', new THREE.BufferAttribute(av, 1))
  const beamMat = new THREE.ShaderMaterial({
    vertexShader: BEAM_VERT,
    fragmentShader: BEAM_FRAG,
    vertexColors: true,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
  const beam = new THREE.Mesh(beamGeo, beamMat)
  beam.frustumCulled = false
  beam.renderOrder = 2
  scene.add(beam)

  let quads = 0
  function seg(p0: V2, p1: V2, w0: number, w1: number, c0: number[], c1: number[]) {
    if (quads >= MAX_QUADS) return
    const dx = p1[0] - p0[0]
    const dy = p1[1] - p0[1]
    const l = Math.hypot(dx, dy) || 1
    const nx = -dy / l
    const ny = dx / l
    // 两个三角形：(p0-, p0+, p1+) (p0-, p1+, p1-)
    const vs: [V2, number, number, number[]][] = [
      [p0, -1, w0, c0], [p0, 1, w0, c0], [p1, 1, w1, c1],
      [p0, -1, w0, c0], [p1, 1, w1, c1], [p1, -1, w1, c1],
    ]
    for (let k = 0; k < 6; k++) {
      const [p, sgn, w, c] = vs[k]
      const i = quads * 6 + k
      pos[i * 3] = p[0] + nx * w * sgn
      pos[i * 3 + 1] = p[1] + ny * w * sgn
      pos[i * 3 + 2] = 0
      col[i * 3] = c[0]
      col[i * 3 + 1] = c[1]
      col[i * 3 + 2] = c[2]
      av[i] = sgn
    }
    quads++
  }

  const composer = new EffectComposer(renderer)
  composer.addPass(new RenderPass(scene, camera))
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.3, 0.6, 0.75)
  if (Q.bloom) composer.addPass(bloom)
  const finish = makeFinishPass({ dispersion: 0.004, exposure: 1.0 })
  composer.addPass(finish)

  const eased = { x: 0, y: 0 }
  let camDist = 20
  const scale = (c: number[], k: number) => [c[0] * k, c[1] * k, c[2] * k]

  return {
    render(time: number, pointer: Pointer) {
      eased.x += (pointer.x - eased.x) * 0.05
      eased.y += (pointer.y - eased.y) * 0.05

      // 尖朝上，再慢慢来回摆；鼠标左右也能拨
      const phi = Math.PI + Math.sin(time * 0.3) * 0.2 + eased.x * 0.35
      prism.rotation.z = phi
      const tri = [-90, 30, 150].map((deg) => {
        const a = (deg * Math.PI) / 180 + phi
        return [Math.cos(a) * R, Math.sin(a) * R] as V2
      })

      // 入射白光：从左下斜着往上打在左侧面上
      const ang = (12 * Math.PI) / 180
      const d: V2 = [Math.cos(ang), Math.sin(ang)]
      const target: V2 = [-0.95, -0.15]
      const o: V2 = [target[0] - d[0] * 14, target[1] - d[1] * 14]
      const intro = Math.min(Math.max(time / 1.6, 0), 1)

      quads = 0
      const white = [2.4, 2.4, 2.4]
      const mid = traceRay(o, d, tri, 1.5)
      if (!mid) {
        // 没打中棱镜：白光直接穿过去
        seg(o, [o[0] + d[0] * 30 * intro, o[1] + d[1] * 30 * intro], 0.09, 0.09, [0, 0, 0], white)
      } else {
        const entry = mid.pts[0]
        seg(o, entry, 0.09, 0.09, [0, 0, 0], white)
        // 入射面上的一点反射光
        const c = dot2(d, mid.entryN)
        const refl: V2 = [d[0] - 2 * c * mid.entryN[0], d[1] - 2 * c * mid.entryN[1]]
        seg(entry, [entry[0] + refl[0] * 9, entry[1] + refl[1] * 9], 0.07, 0.2, scale(white, 0.05), [0, 0, 0])

        // 各波长：折射率拉得比真实玻璃开很多，彩虹才够宽
        const L = 17 * intro
        const k = 1.1 / (0.375 * RAYS)
        const outs: { p: V2; dir: V2; c: number[] }[] = []
        for (let i = 0; i < RAYS; i++) {
          const t = (i + 0.5) / RAYS
          const r = traceRay(o, d, tri, 1.43 + 0.12 * (1 - t))
          if (!r) continue
          const cRay = scale(spectrumRGB(t), k)
          for (let j = 0; j + 1 < r.pts.length; j++) seg(r.pts[j], r.pts[j + 1], 0.08, 0.1, cRay, cRay)
          outs.push({ p: r.pts[r.pts.length - 1], dir: r.out, c: cRay })
        }
        if (outs.length > 1) {
          const a0 = Math.atan2(outs[0].dir[1], outs[0].dir[0])
          const a1 = Math.atan2(outs[outs.length - 1].dir[1], outs[outs.length - 1].dir[0])
          // 远端宽度按相邻两条的间距给，免得散开后露出一根根的条纹
          // 真实玻璃分出来的角度很窄，这里以中间那条为准把夹角放大，彩虹才铺得开
          const SPREAD = 2.4
          const am = (a0 + a1) / 2
          const w1 = Math.max(0.1, (Math.abs(a1 - a0) * SPREAD * L * 3.0) / outs.length)
          for (const r of outs) {
            const a = am + (Math.atan2(r.dir[1], r.dir[0]) - am) * SPREAD
            seg(r.p, [r.p[0] + Math.cos(a) * L, r.p[1] + Math.sin(a) * L], 0.1, w1, r.c, scale(r.c, 0.6))
          }
        }
      }
      // 没用到的四边形收成零面积
      pos.fill(0, quads * 18)
      beamGeo.attributes.position.needsUpdate = true
      beamGeo.attributes.color.needsUpdate = true
      beamGeo.attributes.aV.needsUpdate = true

      // 斜着看，棱镜是一根有长度的玻璃柱，光在它中间那一片平面里走
      camera.position.set(-6.5 + eased.x * 3, 4.5 - eased.y * 2.5, camDist)
      camera.lookAt(1.2, -0.3, 0)

      finish.uniforms.uTime.value = time
      composer.render()
    },
    resize(width: number, height: number, pixelRatio?: number) {
      const aspect = width / height
      const pr = pixelRatio ?? Math.min(window.devicePixelRatio, Q.pr)
      camera.aspect = aspect
      camDist = 20 / Math.min(aspect, 1)
      camera.updateProjectionMatrix()
      composer.setPixelRatio(pr)
      composer.setSize(width, height)
      finish.uniforms.uAspect.value = aspect
    },
    dispose() {
      composer.dispose()
      prismGeo.dispose()
      prismMat.dispose()
      beamGeo.dispose()
      beamMat.dispose()
      bloom.dispose()
      finish.material.dispose()
    },
  }
}
