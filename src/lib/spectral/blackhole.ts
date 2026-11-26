// 从 ~/dev/creght-tpl/spectral-lab/src 原样拷来，改引擎时在那边改完再拷过来，别只改这里。
import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { FULLSCREEN_VERT, QUALITY, makeFinishPass, type Fx, type Pointer, type Quality } from './common'

/**
 * 黑洞：全屏片元着色器里对每个像素积分一条被引力弯曲的光线
 * （史瓦西度规的常用近似：a = -1.5 h² x / r⁵，rs = 1），
 * 光线每次穿过 y=0 平面就取一次吸积盘颜色。盘在黑洞背后的部分被弯到
 * 阴影上方成拱，下方那圈细环是盘底面的二次像，都是积分自然出来的。
 */
const FRAG = /* glsl */ `
precision highp float;
uniform vec2 uRes;
uniform float uTime, uRoll, uTanFov, uPeriod, uSeed, uGain, uSat, uDuoMix;
uniform vec3 uDuo;
uniform vec3 uCamPos;
uniform mat3 uCamMat;
varying vec2 vUv;

const float RIN = 2.3;
const float ROUT = 11.5;

float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float noise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x),
                 mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x),
                 mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float fbm(vec3 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 4; i++) { s += a * noise(p); p = p * 2.03 + 11.7; a *= 0.5; }
  return s;
}

// 原图里出现的几种颜色，循环取：橙、黄、青、蓝、红
vec3 spectral(float h) {
  h = fract(h) * 5.0;
  float i = floor(h), f = smoothstep(0.0, 1.0, fract(h));
  vec3 c0 = vec3(1.5, 0.5, 0.06), c1 = vec3(1.35, 0.8, 0.08), c2 = vec3(0.1, 1.0, 0.85),
       c3 = vec3(0.15, 0.3, 1.5), c4 = vec3(1.45, 0.12, 0.1);
  vec3 a = i < 1.0 ? c0 : i < 2.0 ? c1 : i < 3.0 ? c4 : i < 4.0 ? c2 : c3;
  vec3 b = i < 1.0 ? c1 : i < 2.0 ? c4 : i < 3.0 ? c2 : i < 4.0 ? c3 : c0;
  return mix(a, b, f);
}

// 丝带：沿圆周拉长的噪声过阈值，得到一条条边缘清楚的白带，带与带之间是黑的。
// soft 控制边缘软硬，离中心远的地方调软，当景深用（比后期模糊干净，没有颗粒）。
// 输出：band 丝带亮度；pal 这条丝带的颜色；colored 0=白芯 1=带色
void ribbons(float r, float a, float seed, float soft, float thr,
             out float band, out vec3 pal, out float colored) {
  vec2 cs = vec2(cos(a), sin(a));
  float rw = r + 1.7 * (noise(vec3(r * 0.5, cs * 1.9) + seed + 5.0) - 0.5)
             + 0.45 * (noise(vec3(r * 1.5, cs * 3.8) + seed + 9.0) - 0.5);
  float n = noise(vec3(rw * 3.3, cs * 0.75) + seed) * 0.5
          + noise(vec3(rw * 9.0, cs * 1.1) + seed + 19.0) * 0.36
          + noise(vec3(rw * 19.0, cs * 1.3) + seed + 43.0) * 0.14;
  band = smoothstep(thr - soft, thr + soft, n);
  float fine = noise(vec3(rw * 21.0, cs * 1.2) + seed + 31.0);
  band *= mix(1.0, 0.7 + 0.4 * fine, 1.0 - smoothstep(0.05, 0.3, soft));
  // 丝带芯是白的；两侧一段带色，噪声更高的"脊"上也整条上色
  float core = smoothstep(thr + 0.02, thr + 0.07, n);
  float crest = smoothstep(thr + 0.12, thr + 0.15, n);
  colored = max(1.0 - core, crest);
  // 色相只跟一层很低频的噪声走：一条丝带一个颜色。跟着 n 走的话，
  // 几个像素宽的线里色相就转了半圈，平均下来只剩粉彩
  pal = spectral(noise(vec3(rw * 1.6, cs * 0.6) + seed + 77.0) * 4.0 + crest * 0.3);
}

vec4 disk(vec3 p, vec3 v, float under, float flat_) {
  float r = length(p.xz);
  if (r < RIN || r > ROUT) return vec4(0.0);
  // 绕过黑洞一圈再回来的高阶像压得极细，会断成点，直接不要
  if (flat_ > 0.5 && under < 0.5) return vec4(0.0);
  float u = (r - RIN) / (ROUT - RIN);
  float phi = atan(p.z, p.x);
  float om = 2.4 * pow(r, -1.5);
  float soft = mix(0.03, 0.26, smoothstep(3.8, 8.5, r));
  // 内圈阈值低：几乎铺满白，只剩几道细缝；越往外阈值越高，散成一根根细丝
  float thr = mix(0.41, 0.63, smoothstep(RIN + 0.4, 6.2, r));

  // 每单位丝带亮度的增益：径向衰减 × 多普勒
  float dens = smoothstep(0.0, 0.02, u) * smoothstep(0.95, 0.35, u);
  float G = dens * (0.34 + 4.2 * pow(1.0 - u, 3.0));
  // 盘的底面只留靠内缘的一圈：物理上黑洞下方会有一道和上拱对称的宽带，
  // 参考图里只有一圈细环，这里照参考图取舍
  G *= mix(1.0, smoothstep(RIN + 0.5, RIN, r) * 0.45, under);
  // 朝向相机的近半边外圈压暗：原图里盘线下方很快就黑了
  G *= mix(1.0, 0.45, smoothstep(0.0, 0.5, p.z / r) * smoothstep(3.5, 7.0, r) * (1.0 - under));
  // 相对论多普勒：朝向观察者转来的一侧更亮
  float beta = 0.5 * sqrt(RIN / r);
  vec3 vel = vec3(-p.z, 0.0, p.x) / r * beta;
  float D = sqrt(1.0 - beta * beta) / (1.0 - dot(vel, -v));
  G *= pow(D, 2.3);

  // 开普勒差速转动会把纹理越拧越细，用两相交替淡入淡出让它无限循环。
  // 两相各自上色再混：先混噪声再上色的话，颜色会被平均成一片粉彩
  float ta = fract(uTime / uPeriod), tb = fract(uTime / uPeriod + 0.5);
  float wa = smoothstep(0.15, 0.85, 1.0 - abs(2.0 * ta - 1.0));
  float outer = smoothstep(4.0, 8.5, r) * 0.7;
  vec3 c = vec3(0.0);
  float s = 0.0;
  for (int k = 0; k < 2; k++) {
    float w = k == 0 ? wa : 1.0 - wa;
    if (w < 0.004) continue;
    float band, colored; vec3 pal;
    ribbons(r, phi - om * (k == 0 ? ta : tb) * uPeriod, (k == 0 ? 0.0 : 57.0) + uSeed, soft, thr, band, pal, colored);
    colored = max(colored, outer);
    // 带色的部分亮度封顶：太亮会被色调映射冲成白
    c += w * band * mix(vec3(G), pal * min(G, 1.45), colored);
    s += w * band;
  }
  vec3 tint = mix(vec3(1.25, 0.9, 0.6), vec3(0.97, 1.0, 1.05), smoothstep(0.6, 1.4, D));
  c *= mix(vec3(1.0), tint, smoothstep(3.0, 8.0, r));
  c = mix(c, vec3(1.3, 0.75, 0.3) * G * 0.6, under);
  float I = G * mix(s, 0.6, under);

  // 迎面转来的一侧垫一层不带丝带的白，对应参考图右下那片过曝
  float glow = dens * 1.6 * smoothstep(1.02, 1.28, D) * pow(1.0 - u, 2.5) * (1.0 - under);
  c += vec3(glow);
  I += glow;
  // 远离观察者的那一端：一块虚掉的橙黄
  float far = exp(-pow((r - 6.9) / 1.7, 2.0)) * smoothstep(0.8, 0.99, -p.x / r) * (1.0 - under);
  float hot = smoothstep(0.93, 1.0, -p.x / r) * exp(-pow((r - 6.9) / 1.0, 2.0));
  c += mix(vec3(1.6, 0.45, 0.06), vec3(1.7, 1.25, 0.25), hot) * far * dens * (0.5 + 0.5 * s) * (1.6 + 2.5 * hot);
  // 迎面那一端：白色楔形后面拖一段虚化的彩虹
  float tail = exp(-pow((r - 7.8) / 2.3, 2.0)) * smoothstep(1.03, 1.2, D) * (1.0 - under);
  // 沿半径分成几道色带：内侧黄，往外蓝紫，最外一圈橙红
  vec3 rainbow = spectral(0.25 + (r - 5.5) * 0.19);
  c += rainbow * tail * dens * (0.45 + 0.55 * s) * 1.0;
  I += tail * 0.1 + far * 0.15;
  return vec4(c, clamp(I * 1.6, 0.0, 1.0));
}

void main() {
  vec2 uv = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0) * 2.0;
  float cr = cos(uRoll), sr = sin(uRoll);
  uv = mat2(cr, -sr, sr, cr) * uv;

  vec3 p = uCamPos;
  vec3 v = normalize(uCamMat * vec3(uv * uTanFov, -1.0));
  vec3 h = cross(p, v);
  float h2 = dot(h, h);

  vec3 col = vec3(0.0);
  float tr = 1.0;
  int hits = 0;
  float minR = 1e3;
  for (int i = 0; i < STEPS; i++) {
    float r2 = dot(p, p);
    if (r2 < 1.0) break;
    if (r2 > 900.0 && dot(p, v) > 0.0) break;
    float r = sqrt(r2);
    minR = min(minR, r);
    float dt = clamp(mix(0.025, 0.06, smoothstep(2.0, 7.0, r)) * r, 0.02, 0.8) * DT_SCALE;
    v += -1.5 * h2 * p / (r2 * r2 * r) * dt;
    vec3 p2 = p + v * dt;
    if (p.y * p2.y < 0.0 && hits < 2) {
      hits++;
      vec3 hp = mix(p, p2, p.y / (p.y - p2.y));
      vec4 d = disk(hp, normalize(v), step(0.0, v.y * uCamPos.y), float(hits > 1));
      // 贴着光子球绕过来的光线只会留下一圈断断续续的细线，淡掉
      d *= smoothstep(1.6, 1.9, minR);
      col += tr * d.rgb;
      tr *= 1.0 - d.a;
      if (tr < 0.01) break;
    }
    p = p2;
  }
  // 压住极亮值，免得泛光把阴影内部染灰
  // 配色：先按 uSat 收饱和度，再按 uDuoMix 往单色调（亮度 × uDuo）靠
  float lum = dot(col, vec3(0.3, 0.55, 0.15));
  col = mix(vec3(lum), col, uSat);
  col = mix(col, lum * uDuo, uDuoMix) * uGain;
  gl_FragColor = vec4(min(col, vec3(5.0)), 1.0);
}
`

/** 黑洞的配色：sat 是保留多少原本的彩虹色，duo / mix 是往哪个单色调靠、靠多少 */
export const HOLE_PALETTES = {
  spectrum: { sat: 1, duo: [1, 1, 1], mix: 0 },
  ember: { sat: 1, duo: [1.7, 0.72, 0.22], mix: 0.78 },
  ice: { sat: 1, duo: [0.3, 0.78, 1.95], mix: 0.9 },
  violet: { sat: 1, duo: [1.25, 0.5, 1.75], mix: 0.78 },
  gold: { sat: 1, duo: [1.55, 1.12, 0.4], mix: 0.82 },
  mono: { sat: 0, duo: [1, 1, 1], mix: 0 },
} satisfies Record<string, { sat: number; duo: [number, number, number]; mix: number }>
export type HolePaletteName = keyof typeof HOLE_PALETTES

export interface HoleOptions {
  quality: Quality
  palette: HolePaletteName
  /** 俯视角（度）：越小越接近侧视，盘越扁 */
  tilt: number
  /** 画面内的倾斜角（度） */
  roll: number
  /** 远近：1 = 默认，越大黑洞越大 */
  zoom: number
  /** 亮度倍率 */
  glow: number
  /** 边缘彩边的强度倍率 */
  dispersion: number
  /** 换一套盘面纹理 */
  seed: number
  /** 循环周期（秒）。0 = 不循环（盘面本身每 26 秒重复一次） */
  loop: number
}
export const HOLE_DEFAULTS: HoleOptions = {
  quality: 'high',
  palette: 'spectrum',
  tilt: 7.5,
  roll: -38,
  zoom: 1,
  glow: 1,
  dispersion: 1,
  seed: 0,
  loop: 0,
}

export function createBlackHole(renderer: THREE.WebGLRenderer, options: Partial<HoleOptions> = {}): Fx {
  let opts = { ...HOLE_DEFAULTS, ...options }
  const Q = QUALITY[opts.quality]
  const uniforms = {
    uRes: { value: new THREE.Vector2(1, 1) },
    uTime: { value: 0 },
    uRoll: { value: 0 },
    uTanFov: { value: Math.tan(THREE.MathUtils.degToRad(21)) },
    uCamPos: { value: new THREE.Vector3() },
    uCamMat: { value: new THREE.Matrix3() },
    uPeriod: { value: 26 },
    uSeed: { value: 0 },
    uGain: { value: 1 },
    uSat: { value: 1 },
    uDuoMix: { value: 0 },
    uDuo: { value: new THREE.Vector3(1, 1, 1) },
  }
  const trace = new ShaderPass(
    new THREE.ShaderMaterial({ uniforms, defines: { STEPS: Q.steps, DT_SCALE: Q.dt.toFixed(2) }, vertexShader: FULLSCREEN_VERT, fragmentShader: FRAG, depthTest: false, depthWrite: false }),
  )
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.07, 0.3, 0.97)
  const finish = makeFinishPass({ dispersion: -0.028, exposure: 1.0, blur: 0.006 })

  const composer = new EffectComposer(renderer)
  composer.addPass(trace)
  if (Q.bloom) composer.addPass(bloom)
  composer.addPass(finish)

  // 这些都只是 uniform，改了不用重建
  function apply() {
    const pal = HOLE_PALETTES[opts.palette] ?? HOLE_PALETTES.spectrum
    uniforms.uPeriod.value = opts.loop || 26
    uniforms.uSeed.value = opts.seed * 3.71
    uniforms.uGain.value = opts.glow
    uniforms.uSat.value = pal.sat
    uniforms.uDuoMix.value = pal.mix
    uniforms.uDuo.value.set(pal.duo[0], pal.duo[1], pal.duo[2])
    finish.uniforms.uDisp.value = -0.028 * opts.dispersion
  }
  apply()

  const eased = { x: 0, y: 0 }
  const right = new THREE.Vector3()
  const up = new THREE.Vector3()
  const back = new THREE.Vector3()
  const m4 = new THREE.Matrix4()
  let aspect = 1

  return {
    render(time: number, pointer: Pointer) {
      eased.x += (pointer.x - eased.x) * 0.05
      eased.y += (pointer.y - eased.y) * 0.05

      // 镜头轻微起伏；循环模式下周期对齐到循环长度
      const sway = opts.loop ? Math.sin((Math.PI * 2 * time) / opts.loop) : Math.sin(time * 0.17)
      const incl = THREE.MathUtils.degToRad(Math.max(opts.tilt + eased.y * 5 + sway * 1.2, 0.5))
      const dist = (aspect < 1 ? (23.5 / Math.max(aspect, 0.5)) * 0.8 : 23.5) / opts.zoom
      uniforms.uCamPos.value.set(0, Math.sin(incl) * dist, Math.cos(incl) * dist)
      back.copy(uniforms.uCamPos.value).normalize()
      right.set(1, 0, 0)
      up.crossVectors(back, right)
      m4.makeBasis(right, up, back)
      uniforms.uCamMat.value.setFromMatrix4(m4)
      uniforms.uRoll.value = THREE.MathUtils.degToRad(opts.roll + eased.x * 5)
      uniforms.uTime.value = time
      finish.uniforms.uTime.value = time
      composer.render()
    },
    resize(width: number, height: number, pixelRatio?: number) {
      aspect = width / height
      const pr = pixelRatio ?? Math.min(window.devicePixelRatio, Q.pr)
      composer.setPixelRatio(pr)
      composer.setSize(width, height)
      uniforms.uRes.value.set(width * pr, height * pr)
      finish.uniforms.uAspect.value = aspect
    },
    tune(patch) {
      opts = { ...opts, ...(patch as Partial<HoleOptions>) }
      apply()
    },
    dispose() {
      composer.dispose()
      trace.material.dispose()
      bloom.dispose()
      finish.material.dispose()
    },
  }
}
