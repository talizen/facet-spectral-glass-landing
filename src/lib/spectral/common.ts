// 从 ~/dev/creght-tpl/spectral-lab/src 原样拷来，改引擎时在那边改完再拷过来，别只改这里。
import * as THREE from 'three'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'

export interface Pointer {
  x: number
  y: number
}

export type Quality = 'high' | 'medium' | 'low'

/** 画质档：渲染倍率上限、每像素的波长采样数、要不要泛光、要不要给球单独渲一帧折射 */
export const QUALITY: Record<Quality, { pr: number; samples: number; bloom: boolean; prepass: boolean; steps: number; dt: number }> = {
  high: { pr: 1.5, samples: 10, bloom: true, prepass: true, steps: 300, dt: 1 },
  medium: { pr: 1, samples: 6, bloom: true, prepass: true, steps: 220, dt: 1.35 },
  low: { pr: 0.75, samples: 4, bloom: false, prepass: false, steps: 160, dt: 1.9 },
}

export interface Fx {
  render(time: number, pointer: Pointer): void
  /** pixelRatio 不传时按设备像素比和画质档自己算；导出固定分辨率时传 1 */
  resize(width: number, height: number, pixelRatio?: number): void
  /** 不重建就能改的参数（拖滑杆时用）。没有这个方法的效果一律重建 */
  tune?(patch: Record<string, unknown>): void
  dispose(): void
}

/** t∈[0,1] → 这一"波长"在 RGB 上的权重。t 小偏蓝，t 大偏红。 */
export const SPECTRUM = /* glsl */ `
vec3 spectrum(float t) {
  return clamp(1.5 - abs(4.0 * t - vec3(3.0, 2.0, 1.0)), 0.0, 1.0);
}
`

export const FULLSCREEN_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

/**
 * 收尾：以画面某点为中心做径向色散（把画面按波长缩放不同比例再合成），
 * 然后色调映射 + gamma + 颗粒。
 */
export function makeFinishPass(opts: { dispersion: number; exposure: number; grain?: number; blur?: number }) {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      tDiffuse: { value: null },
      uCenter: { value: new THREE.Vector2(0.5, 0.5) },
      uDisp: { value: opts.dispersion },
      uExposure: { value: opts.exposure },
      uGrain: { value: opts.grain ?? 0.025 },
      uBlur: { value: opts.blur ?? 0 },
      uAspect: { value: 1 },
      uTime: { value: 0 },
    },
    vertexShader: FULLSCREEN_VERT,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse;
      uniform vec2 uCenter;
      uniform float uDisp, uExposure, uGrain, uAspect, uTime, uBlur;
      varying vec2 vUv;
      ${SPECTRUM}
      vec3 aces(vec3 x) {
        return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
      }
      float hash(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
      }
      void main() {
        vec2 d = vUv - uCenter;
        float dist = length(d * vec2(uAspect, 1.0));
        float amt = uDisp * (0.3 + 1.7 * dist);
        vec3 acc = vec3(0.0), ws = vec3(0.0);
        for (int i = 0; i < 28; i++) {
          float t = (float(i) + 0.5) / 28.0;
          vec3 w = spectrum(t);
          // 离中心越远越虚：同一组采样顺便按黄金角螺旋散开，当作景深
          float ang = float(i) * 2.39996 + hash(gl_FragCoord.xy) * 6.2832;
          vec2 bo = vec2(cos(ang) / uAspect, sin(ang)) * sqrt(t) * uBlur * dist * dist;
          acc += w * texture2D(tDiffuse, uCenter + d * (1.0 + amt * (t - 0.5)) + bo).rgb;
          ws += w;
        }
        vec3 c = aces(acc / ws * uExposure);
        c = pow(c, vec3(1.0 / 2.2));
        c += (hash(gl_FragCoord.xy + fract(uTime) * 91.7) - 0.5) * uGrain;
        gl_FragColor = vec4(c, 1.0);
      }
    `,
    depthTest: false,
    depthWrite: false,
  })
  return new ShaderPass(material)
}
