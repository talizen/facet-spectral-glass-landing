// 从 ~/dev/creght-tpl/spectral-lab/src 原样拷来，改引擎时在那边改完再拷过来，别只改这里。
import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { QUALITY, SPECTRUM, makeFinishPass, type Fx, type Pointer, type Quality } from './common'

/**
 * 程序化影棚，分两层：
 * - envSoft：几块很大的柔光，给玻璃面一个平缓的灰度（朝灯的面发灰，其余面是黑的）
 * - envStrips：几根很细的灯管。细到各个波长不会同时照到，折射出来就是一道完整的彩虹条
 */
export const ENV = /* glsl */ `
float strip(vec3 d, vec3 c, vec3 u, vec2 size, float soft) {
  c = normalize(c);
  float k = dot(d, c);
  if (k <= 0.0) return 0.0;
  u = normalize(u - c * dot(u, c));
  vec3 v = cross(c, u);
  vec2 p = vec2(dot(d, u), dot(d, v)) / k;
  vec2 q = smoothstep(size + soft, size - soft, abs(p));
  return q.x * q.y;
}
vec3 envSoft(vec3 d) {
  float L = 0.0;
  L += 2.4 * pow(max(dot(d, normalize(vec3(-0.5, 0.8, 0.45))), 0.0), 8.0);
  L += 2.0 * pow(max(dot(d, normalize(vec3(0.85, -0.25, 0.5))), 0.0), 9.0);
  L += 1.6 * pow(max(dot(d, normalize(vec3(0.0, -0.7, -0.7))), 0.0), 7.0);
  return vec3(0.86, 0.93, 1.0) * L;
}
vec3 envStrips(vec3 d) {
  float L = 0.0;
  L += strip(d, vec3(0.0, 1.0, 0.25), vec3(1, 0, 0), vec2(0.8, 0.024), 0.035);
  L += strip(d, vec3(-1.0, 0.15, 0.35), vec3(0, 1, 0), vec2(0.6, 0.022), 0.035);
  L += strip(d, vec3(1.0, -0.2, 0.3), vec3(0, 1, 0), vec2(0.6, 0.022), 0.035);
  L += strip(d, vec3(-0.4, 0.3, -1.0), vec3(1, -1, 0), vec2(0.6, 0.024), 0.035);
  L += strip(d, vec3(-0.6, -0.6, -0.5), vec3(1, -1, 0), vec2(0.45, 0.022), 0.035);
  return vec3(L);
}
vec3 env(vec3 d) { return envSoft(d) * 0.6 + envStrips(d) * 1.5; }
`

const BAR_VERT = /* glsl */ `
attribute vec3 aHalf;
varying vec3 vLocal, vCamLocal, vN, vHalf, vGroupPos;
varying mat3 vRot;
varying float vFacing, vFarFade;
void main() {
  mat4 M = modelMatrix * instanceMatrix;
  // 这一片在整体的正面还是背面：从整体中心指向它的方向，朝着相机是 1，背着是 -1
  vFacing = normalize(mat3(viewMatrix) * (M[3].xyz - modelMatrix[3].xyz)).z;
  // 隧道等纵深形态在极远端（z < -9.5）平滑淡入，避免循环复位时突然冒出；其余形态 |z| < 6 恒为 1
  vFarFade = smoothstep(-15.5, -9.5, instanceMatrix[3].z);
  mat3 R = mat3(M);
  vec3 lp = position * 2.0 * aHalf;
  vLocal = lp;
  vGroupPos = (instanceMatrix * vec4(lp, 1.0)).xyz;
  vN = normal;
  vHalf = aHalf;
  vRot = R;
  vCamLocal = transpose(R) * (cameraPosition - M[3].xyz);
  gl_Position = projectionMatrix * viewMatrix * M * vec4(lp, 1.0);
}
`

/**
 * 玻璃条的面：深色半透明底 + 柔光反射的灰度 + 棱线，再叠一层折射出来的彩虹条。
 * 彩虹条在条自己的局部坐标里做解析光追（入射折射 → 盒内最多 3 次全反射 → 出射折射），
 * 每个波长各走一遍，出射方向去采细灯管。
 * 输出是预乘 alpha：正面有一定遮挡，能压暗后面的条；背面只加棱线，不遮挡。
 */
const BAR_FRAG = /* glsl */ `
precision highp float;
uniform float uEdge, uDispersion, uSpot, uSat, uBackDim, uFrost, uFlow, uFlowT, uBand;
varying float vFacing, vFarFade;
uniform vec3 uLight, uSpectrum;
varying vec3 vLocal, vCamLocal, vN, vHalf, vGroupPos;
varying mat3 vRot;
${SPECTRUM}
${ENV}

float edgeF(vec3 p, vec3 h, float w) {
  vec3 q = h - abs(p);
  float a = min(q.x, min(q.y, q.z));
  float c = max(q.x, max(q.y, q.z));
  float b = q.x + q.y + q.z - a - c;
  return 1.0 - smoothstep(0.0, w, b);
}

// 面上一点到最近棱边的距离
float edgeD(vec3 p, vec3 h) {
  vec3 q = h - abs(p);
  float a = min(q.x, min(q.y, q.z));
  float c = max(q.x, max(q.y, q.z));
  return q.x + q.y + q.z - a - c;
}

void main() {
  vec3 rd = normalize(vLocal - vCamLocal);
  vec3 n = normalize(vN);
  float e = edgeF(vLocal, vHalf, uEdge);

  if (!gl_FrontFacing) {
    // 背面只留棱线，叠出"透明盒子"的线框感
    gl_FragColor = vec4(vec3(0.82, 0.9, 1.0) * uLight * e * 0.5, 0.0) * mix(uBackDim, 1.0, smoothstep(-0.12, 0.12, vFacing)) * vFarFade;
    return;
  }

  // 平面整面的反射/折射方向几乎一样，颜色会是一整块；沿条长加一点缓慢的方向偏移，
  // 相当于玻璃有轻微弧度，灰度和彩虹才会在面上铺成渐变
  // 相位里带上横向坐标，等值线就是斜的，彩虹条斜着划过条面
  float ph = vLocal.x * 0.8 + (vLocal.y + vLocal.z) * 2.6;
  vec3 bend = vec3(0.0, sin(ph + vHalf.y * 40.0), cos(ph * 0.8 + vHalf.z * 50.0)) * 0.42;
  vec3 bendR = vec3(0.0, sin(vLocal.x * 0.9 + vHalf.y * 40.0), cos(vLocal.x * 0.7 + vHalf.z * 50.0)) * 0.18 * (1.0 - uBand);
  // 面上一层很细的磨砂颗粒
  float grain = fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453);
  float F = 0.04 + 0.96 * pow(1.0 - max(dot(-rd, n), 0.0), 5.0);
  float cap = step(0.5, abs(n.x)); // 两头的端面
  vec3 col = vec3(0.006, 0.009, 0.018);
  col += envSoft(vRot * normalize(reflect(rd, n) + bendR)) * (0.035 + 0.965 * F) * (0.5 + 1.5 * cap * (1.0 - uBand)) * (0.7 + 0.6 * grain);
  col += vec3(0.012, 0.014, 0.02) * grain;
  col += vec3(0.07, 0.085, 0.11) * cap * (1.0 - uBand);
  // 约三成的侧面是整块的浅灰磨砂，沿条长由亮到暗
  float frost = step(0.78, fract(vHalf.y * 91.0 + abs(n.y) * 0.53 + abs(n.z) * 0.29)) * (1.0 - cap);
  float fgrad = smoothstep(-1.1, 0.9, vLocal.x / vHalf.x * sign(cos(vHalf.z * 173.0)));
  col += vec3(0.15, 0.17, 0.21) * frost * fgrad * (0.75 + 0.5 * grain) * uFrost;

  // 平行的两个面一进一出，各波长出射方向其实相同（真实玻璃板也不分色）。
  // 这里人为按波长把出射方向再错开，才有参考图里那种彩虹条
  vec3 spread = normalize(vec3(0.25, sin(vHalf.y * 90.0), cos(vHalf.z * 70.0))) * uDispersion;
  // 原图的彩虹多是条端部一块斜切的光斑：中间发白，一侧蓝青、一侧黄红。
  // 这块直接按"位置 + 视角"算，不靠碰运气照到灯管：只在部分条的一个朝向的面上出现
  float sx = vLocal.x / vHalf.x * sign(sin(vHalf.y * 211.0));
  float sd = sx + (vLocal.y / vHalf.y + vLocal.z / vHalf.z) * 0.16;
  float spot = smoothstep(-0.12, -0.08, sd) * smoothstep(0.95, 0.55, sd);
  // 哪些面有彩虹：按片的尺寸挑。uFlow 开着时这个挑选随时间滚动，彩虹就一圈圈地流过去（边缘放软，不会突然亮灭）
  float pick = fract(vHalf.z * 53.0 + abs(n.y) * 0.37 + abs(n.z) * 0.71 + uFlowT);
  float soft = smoothstep(0.5, 0.68, pick) * smoothstep(1.0, 0.86, pick);
  spot *= mix(step(0.72, pick), soft, uFlow) * (1.0 - cap);
  float hpos = (sd + 0.1) * 1.1 + dot(vRot * n, vec3(0.3, 0.5, 0.2)) * 1.4 + rd.y * 1.5;
  // 环带模式（球型用）：以球体局部空间的连续纬度角为主坐标，所有纬度方向严格沿纬线统一、视觉等宽；
  // 叠一点片内经向偏移做出切割玻璃的微折射台阶；收紧单波长半宽保留高纯度棱镜色散；只在大面（z 朝外）出彩虹，薄边不漏色
  float latN = asin(clamp(normalize(vGroupPos).y, -1.0, 1.0)) / 1.5707963;
  float bandD = fract((latN + (vLocal.y / vHalf.y) * 0.03) * 1.05 + uFlowT) - 0.5;
  vec3 wn = normalize(vRot * n);
  float ndl = max(dot(wn, normalize(vec3(-0.42, 0.32, 0.85))), 0.0);
  float bandShade = 0.16 + 0.94 * pow(ndl, 1.5) + 0.44 * pow(F, 1.3);
  float curSpot = mix(spot, step(0.5, abs(n.z)) * bandShade, uBand);
  vec3 acc = vec3(0.0), ws = vec3(0.0);
  const int N = SAMPLES;
  float qScale = pow(10.0 / float(N), 0.8);
  for (int i = 0; i < N; i++) {
    float t = (float(i) + 0.5) / float(N);
    float ior = 1.5 + 0.4 * (0.5 - t);
    vec3 d = refract(rd, n, 1.0 / ior);
    vec3 o = vLocal;
    vec3 outD = d;
    float eIn = 0.0, att = 1.0;
    for (int b = 0; b < 3; b++) {
      d += vec3(1e-5) * (1.0 - abs(sign(d)));
      vec3 tt = (sign(d) * vHalf - o) / d;
      float tE = min(tt.x, min(tt.y, tt.z));
      vec3 ne = normalize(-sign(d) * step(tt, vec3(tE)));
      o += d * tE;
      eIn += edgeF(o, vHalf, uEdge) * att;
      att *= 0.6;
      vec3 r2 = refract(d, ne, ior);
      if (dot(r2, r2) > 0.0) { outD = r2; break; }
      d = reflect(d, ne);
      outD = d;
    }
    vec3 w = spectrum(t);
    acc += w * (envStrips(vRot * normalize(outD + bend + spread * (t - 0.5))) * (1.0 - F) * 0.3 * (1.0 - uBand) + eIn * 0.1); // 环带模式下不要灯管折射出的斜彩虹，方向会和环带打架
    // 采样少的画质档把每个波长的带子放宽，免得彩虹断成一条条
    float gOrig = (fract(hpos) - 0.5 - (t - 0.5) * 0.62) / (0.085 * qScale);
    float gBand = (bandD - (t - 0.5) * 0.21) / (0.0285 * qScale);
    float g = mix(gOrig, gBand, uBand);
    // 蓝端再带一点红，光斑边缘就有品红
    acc += (w + vec3(0.55, 0.0, 0.0) * smoothstep(0.2, 0.0, t)) * exp(-g * g) * curSpot * uSpot;
    ws += w;
  }

  // 外棱一道亮线，往里再一道淡线，像倒角
  // 倒角：棱线往里一条略亮的窄带，带的内侧再收一道细线，像厚玻璃的边
  float bd = edgeD(vLocal, vHalf);
  float bw = uEdge * 3.6;
  float bevel = 1.0 - smoothstep(bw - 0.006, bw, bd);
  float inner = 1.0 - smoothstep(0.0, 0.011, abs(bd - bw));
  col += vec3(0.92, 0.96, 1.0) * (e * 2.1 + bevel * 0.05 + inner * mix(0.5, 0.28, uBand));
  col *= uLight;
  // 彩虹最后加，单独过配色：uSat 控制饱和度（0 就是纯白光斑），uSpectrum 染色。
  // 不除以各通道权重和：只有部分波长照到灯时保持纯色，而不是被归一化冲淡
  vec3 sp = acc / ws.g * vec3(0.82, 1.0, 1.12);
  col += mix(vec3(dot(sp, vec3(0.3, 0.5, 0.2))), sp, uSat) * uSpectrum;
  // 球型这类闭合的形态：背面那半压暗，不然会透过正面的缝叠成一团；正面玻璃正视略通透、斜视厚实
  float alpha = mix(0.9, mix(0.7, 0.92, F), uBand);
  gl_FragColor = vec4(col, alpha) * mix(uBackDim, 1.0, smoothstep(-0.12, 0.12, vFacing)) * vFarFade;
}
`

const SPHERE_VERT = /* glsl */ `
varying vec3 vWN, vWP;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWP = wp.xyz;
  vWN = mat3(modelMatrix) * normal;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`

/** 中心玻璃球：把"只有玻璃条"的那一帧倒着、按波长错开比例采进来，再加一圈蓝白菲涅尔边。 */
const SPHERE_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tScene;
uniform vec2 uRes;
uniform vec3 uRim, uLight;
varying vec3 vWN, vWP;
${SPECTRUM}
${ENV}
void main() {
  vec3 N = normalize(vWN);
  vec3 V = normalize(cameraPosition - vWP);
  float ndv = max(dot(N, V), 0.0);
  float fr = pow(1.0 - ndv, 2.5);
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 d = uv - 0.5;

  vec3 acc = vec3(0.0), ws = vec3(0.0);
  for (int i = 0; i < 8; i++) {
    float t = (float(i) + 0.5) / 8.0;
    float k = (2.6 + 1.6 * (1.0 - t)) / (ndv + 0.35);
    vec3 w = spectrum(t);
    acc += w * texture2D(tScene, 0.5 - d * k).rgb;
    ws += w;
  }
  vec3 col = acc / ws * 0.07 * (1.0 - fr);

  vec3 rim = mix(uRim, vec3(0.8, 0.92, 1.0) * uLight, smoothstep(0.78, 0.99, fr));
  // 蓝圈左下更厚更亮，右上收窄，和原图一样不对称
  float side = 0.55 + 0.45 * dot(normalize(N.xy + 1e-4), normalize(vec2(-0.8, -0.6)));
  col += rim * smoothstep(0.06, 0.5, fr * mix(0.8, 1.5, side)) * 3.2;
  col += env(reflect(-V, N)) * (0.04 + 0.96 * pow(1.0 - ndv, 5.0));
  gl_FragColor = vec4(col, 1.0);
}
`

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export type GlassShape =
  | 'burst'
  | 'fan'
  | 'ring'
  | 'sphere'
  | 'aperture'
  | 'tunnel'
  | 'cube'
  | 'orbit'
  | 'wave'
  | 'lotus'

/** 配色只动四样：背景、白光的色温、彩虹的染色和饱和度、球的边光 */
export interface Palette {
  bg: number
  light: [number, number, number]
  spectrum: [number, number, number]
  sat: number
  rim: [number, number, number]
}
export const PALETTES = {
  ice: { bg: 0x000000, light: [1, 1, 1], spectrum: [1, 1, 1], sat: 1, rim: [0.02, 0.1, 1.0] },
  ember: { bg: 0x050201, light: [1.05, 0.93, 0.82], spectrum: [1.25, 0.85, 0.5], sat: 0.9, rim: [1.0, 0.25, 0.03] },
  aurora: { bg: 0x000403, light: [0.88, 1.03, 0.97], spectrum: [0.55, 1.15, 0.95], sat: 1, rim: [0.03, 0.9, 0.5] },
  violet: { bg: 0x030108, light: [0.95, 0.92, 1.08], spectrum: [1.05, 0.6, 1.3], sat: 1, rim: [0.5, 0.1, 1.0] },
  gold: { bg: 0x040300, light: [1.08, 0.98, 0.82], spectrum: [1.3, 1.0, 0.45], sat: 0.55, rim: [1.0, 0.62, 0.1] },
  mono: { bg: 0x000000, light: [1, 1, 1], spectrum: [1, 1, 1], sat: 0, rim: [0.75, 0.8, 0.85] },
} satisfies Record<string, Palette>
export type PaletteName = keyof typeof PALETTES

export interface GlassOptions {
  shape: GlassShape
  palette: PaletteName
  quality: Quality
  /** 随机种子：同一个种子排布完全一样 */
  seed: number
  /** 数量倍率，1 = 默认 */
  density: number
  /** 粗细倍率，1 = 默认 */
  thickness: number
  /** 彩虹强度，0 = 没有彩虹，1 = 默认 */
  dispersion: number
  /** 循环周期（秒）。0 = 不循环；大于 0 时所有运动都严格以它为周期，导出视频首尾能接上 */
  loop: number
}
export const GLASS_DEFAULTS: GlassOptions = {
  shape: 'burst',
  palette: 'ice',
  quality: 'high',
  seed: 0,
  density: 1,
  thickness: 1,
  dispersion: 1,
  loop: 0,
}

// 循环周期。一次只跑一个效果，渲染前由 createPrism 设好，下面几个时间函数读它
let loopT = 0
/** 频率 f 的相位。循环模式下把频率吸附到"一个周期里转整数圈" */
function phase(time: number, f: number) {
  if (!loopT) return time * f
  const k = Math.max(1, Math.round((f * loopT) / (Math.PI * 2)))
  return (k * Math.PI * 2 * time) / loopT
}
const osc = (time: number, f: number, ph = 0) => Math.sin(phase(time, f) + ph)
/** 匀速转动的角度。循环模式下一个周期转不满整圈，改成同样快慢的来回摆 */
const turn = (time: number, rate: number) =>
  loopT ? ((rate * loopT) / (Math.PI * 2)) * Math.sin((Math.PI * 2 * time) / loopT) : time * rate
/** 开场进度 0→1；循环模式没有开场 */
const intro = (time: number, delay: number, dur: number) => (loopT ? 1 : easeOut((time - delay) / dur))

/** 一种形态 = 一组长方体的尺寸 + 每帧怎么摆。着色器不关心形态。 */
interface Layout {
  count: number
  /** 每个实例的半长宽高（局部 x 是长轴），3 个一组 */
  halves: number[]
  /** 中心球半径 */
  sphere: number
  /** 相机距离（方形画面下） */
  camera: number
  /** 彩虹光斑的亮度倍率。片小的形态每片上只有一小道彩虹，要提亮才看得出 */
  spot?: number
  /** 彩虹排成沿着片短边方向渐变的整条色带（不随视角变），而不是斜切的光斑 */
  band?: boolean
  /** 彩虹是否在各片之间流动（每 16 秒左右轮一遍） */
  flow?: boolean
  /** 浅灰磨砂面的强度。磨砂是按片的尺寸随机挑的，片都一样大的形态会整圈一起变灰，关掉 */
  frost?: number
  /** 背对相机的那一半画多亮（0–1）。闭合的形态用它压暗背面，默认 1 不处理 */
  backDim?: number
  /** 整体姿态 */
  pose(time: number, eased: Pointer, group: THREE.Group): void
  /** 第 i 个实例在 group 里的位置和朝向（只有旋转和平移，不带缩放） */
  place(i: number, time: number, out: THREE.Matrix4): void
}

const ax = new THREE.Vector3()
const ay = new THREE.Vector3()
const az = new THREE.Vector3()
const tmp = new THREE.Vector3()
const q = new THREE.Quaternion()
const easeOut = (x: number) => 1 - Math.pow(1 - Math.min(Math.max(x, 0), 1), 4)

/** 放射：一簇一簇近乎平行的条从球心朝四周炸开 */
function burstLayout(o: GlassOptions): Layout {
  interface Bar {
    dir: THREE.Vector3
    roll: number
    r0: number
    len: number
    phase: number
    delay: number
  }
  const rand = mulberry32(7 + o.seed)
  const bars: Bar[] = []
  const halves: number[] = []
  const CLUSTERS = Math.max(8, Math.round(26 * o.density))
  for (let c = 0; c < CLUSTERS; c++) {
    // 方向在画面平面里绕一圈均匀分布，前后（z）随机偏一些；最后几簇直接朝向相机
    const toward = c >= CLUSTERS - 3
    const ring = CLUSTERS - 3
    // 朝向相机的三簇放在球的下方，像原图中下那几根露出方形端面的条
    const th = toward
      ? -Math.PI / 2 + (c - ring - 1) * 0.5 + (rand() - 0.5) * 0.2
      : (c / ring) * Math.PI * 2 + (rand() - 0.5) * 0.18
    const z = toward ? 1.6 + rand() * 1.0 : (rand() - 0.5) * 1.0
    const base = new THREE.Vector3(Math.cos(th), Math.sin(th), z).normalize()
    const n = 1 + Math.floor(rand() * 3.2)
    for (let i = 0; i < n; i++) {
      const dir = base
        .clone()
        .add(new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).multiplyScalar(0.22))
        .normalize()
      const r0 = toward ? 1.15 + rand() * 0.5 : 1.25 + rand() * 1.3
      const len = Math.min(1.5 + rand() * 1.9, 5.6 - r0)
      bars.push({ dir, roll: rand() * Math.PI, r0, len, phase: rand() * 6.283, delay: rand() * 0.9 })
      // 四分之一是薄板，其余是截面接近方形的条
      halves.push(len / 2, (0.2 + rand() * 0.22) * o.thickness, rand() < 0.25 ? 0.035 : (0.1 + rand() * 0.2) * o.thickness)
    }
  }
  // 贴着球再放几根短粗的条，原图球周围有一圈这样的小块
  for (let i = 0; i < 6; i++) {
    const th = (i / 6) * Math.PI * 2 + rand() * 0.6
    const dir = new THREE.Vector3(Math.cos(th), Math.sin(th), (rand() - 0.5) * 1.6).normalize()
    const len = 0.6 + rand() * 0.8
    bars.push({ dir, roll: rand() * Math.PI, r0: 1.3 + rand() * 0.35, len, phase: rand() * 6.283, delay: rand() * 0.9 })
    halves.push(len / 2, (0.2 + rand() * 0.18) * o.thickness, (0.14 + rand() * 0.16) * o.thickness)
  }
  return {
    count: bars.length,
    halves,
    sphere: 0.95,
    camera: 21,
    pose(time, eased, group) {
      group.rotation.set(
        -eased.y * 0.4 + osc(time, 0.17, Math.PI / 2) * 0.1,
        eased.x * 0.5 + osc(time, 0.21) * 0.12,
        turn(time, 0.08),
      )
    },
    place(i, time, out) {
      const b = bars[i]
      const breathe = osc(time, 0.7, b.phase) * 0.16
      const r = (b.r0 + b.len / 2 + breathe) * (0.25 + 0.75 * intro(time, b.delay, 1.6))
      ax.copy(b.dir)
      tmp.set(0, 0, 1)
      if (Math.abs(ax.z) > 0.9) tmp.set(0, 1, 0)
      ay.crossVectors(tmp, ax).normalize()
      q.setFromAxisAngle(ax, b.roll + turn(time, 0.12) * Math.sin(b.phase))
      ay.applyQuaternion(q)
      az.crossVectors(ax, ay)
      out.makeBasis(ax, ay, az).setPosition(tmp.copy(ax).multiplyScalar(r))
    },
  }
}

/** 扇形：一叠薄玻璃片绕同一根轴逐片错开，像旋转楼梯，开场从合拢到展开 */
function fanLayout(o: GlassOptions): Layout {
  const rand = mulberry32(21 + o.seed)
  const N = Math.max(8, Math.round(36 * o.density))
  const halves: number[] = []
  const lens: number[] = []
  for (let i = 0; i < N; i++) {
    const len = 3.3 + rand() * 0.9
    lens.push(len)
    halves.push(len / 2, (0.62 + rand() * 0.2) * o.thickness, 0.03 + rand() * 0.02)
  }
  return {
    count: N,
    halves,
    sphere: 0.85,
    camera: 21,
    pose(time, eased, group) {
      group.rotation.set(-1.0 + eased.y * 0.3, eased.x * 0.4, turn(time, 0.12))
    },
    place(i, time, out) {
      const k = i - (N - 1) / 2
      const open = intro(time, 0, 2.4) * (1 + 0.1 * osc(time, 0.5))
      // 片数变了也保持总张角不变
      const th = k * 0.35 * (36 / N) * open
      ax.set(Math.cos(th), Math.sin(th), 0)
      // 每片再绕自己的长轴拧一点，侧棱才接得到光
      q.setFromAxisAngle(ax, 0.24 + 0.1 * osc(time, 0.6, i * 0.4))
      az.set(0, 0, 1).applyQuaternion(q)
      ay.crossVectors(az, ax)
      out.makeBasis(ax, ay, az).setPosition(
        tmp.copy(ax).multiplyScalar(1.15 + lens[i] / 2).setZ(k * 0.17 * (36 / N)),
      )
    },
  }
}

/** 环形：两圈竖立的玻璃板围着球，像涡轮叶片，叶片角度和高低成波浪起伏 */
function ringLayout(o: GlassOptions): Layout {
  const rand = mulberry32(33 + o.seed)
  const N1 = Math.max(6, Math.round(26 * o.density))
  const N2 = Math.max(4, Math.round(12 * o.density))
  const halves: number[] = []
  for (let i = 0; i < N1; i++) halves.push((3.0 + 1.1 * Math.sin(i * 0.97)) / 2, (0.5 + rand() * 0.06) * o.thickness, 0.05 + rand() * 0.03)
  for (let i = 0; i < N2; i++) halves.push((1.7 + 0.5 * Math.sin(i * 1.7)) / 2, (0.3 + rand() * 0.05) * o.thickness, 0.05 + rand() * 0.03)
  return {
    count: N1 + N2,
    halves,
    sphere: 0.9,
    camera: 16.5,
    pose(time, eased, group) {
      group.rotation.set(-1.05 + eased.y * 0.3 + osc(time, 0.2) * 0.06, eased.x * 0.4, 0)
    },
    place(i, time, out) {
      const outer = i < N1
      const j = outer ? i : i - N1
      const n = outer ? N1 : N2
      const th = (j / n) * Math.PI * 2 + turn(time, outer ? 0.1 : -0.17)
      const around = (j / n) * Math.PI * 2
      const blade = (outer ? 0.75 : -0.6) + 0.5 * osc(time, 0.8, around * 2)
      const R = (outer ? 3.9 : 2.05) * (0.3 + 0.7 * intro(time, j * 0.03, 1.8))
      ax.set(0, 0, 1)
      // 板的法线从径向朝切向偏一个叶片角
      az.set(Math.cos(th + blade), Math.sin(th + blade), 0)
      ay.crossVectors(az, ax)
      out.makeBasis(ax, ay, az).setPosition(Math.cos(th) * R, Math.sin(th) * R, 0.35 * osc(time, 0.4, around + 1.0))
    },
  }
}

/** 球：玻璃片按纬线一圈圈排在球面上，大小一致、对齐经纬，像一颗切面整齐的玻璃球包着中心的核 */
function sphereLayout(o: GlassOptions): Layout {
  const rand = mulberry32(51 + o.seed)
  const RADIUS = 3.1
  const GAP = 0.9 // 每片占格子的比例，剩下的是缝
  const POLE = 0.24 // 两极各留一个圆口（弧度）：极点附近一圈只放得下两三片，怎么排都不整齐
  const RINGS = Math.max(5, Math.round(9 * Math.sqrt(o.density)))
  const cell = ((Math.PI - POLE * 2) * RADIUS) / RINGS // 一格的边长（沿经线）
  const tiles: { ring: number; lat: number; th: number }[] = []
  const halves: number[] = []
  const offsets: number[] = []
  for (let k = 0; k < RINGS; k++) {
    const lat = POLE + ((k + 0.5) / RINGS) * (Math.PI - POLE * 2) // 从北极量起的角
    const circ = 2 * Math.PI * RADIUS * Math.sin(lat)
    const n = Math.max(5, Math.round(circ / cell)) // 这一圈放几片，尽量接近正方形
    offsets.push(rand() * Math.PI * 2) // 种子只决定每一圈从哪里起头
    for (let j = 0; j < n; j++) {
      tiles.push({ ring: k, lat, th: (j / n) * Math.PI * 2 })
      halves.push(((circ / n) * GAP) / 2, (cell * GAP) / 2, 0.048 * o.thickness)
    }
  }
  return {
    count: tiles.length,
    halves,
    sphere: 1.3,
    camera: 19,
    backDim: 0.1,
    spot: 1.38,
    frost: 0,
    flow: true,
    band: true,
    pose(time, eased, group) {
      group.rotation.set(0.3 - eased.y * 0.5, eased.x * 0.6 + turn(time, 0.1), 0.16)
    },
    place(i, time, out) {
      const t = tiles[i]
      // 相邻两圈反着转，像魔方的层
      const th = t.th + offsets[t.ring] + turn(time, t.ring % 2 ? 0.14 : -0.14)
      const sl = Math.sin(t.lat)
      az.set(Math.cos(th) * sl, Math.cos(t.lat), Math.sin(th) * sl) // 薄的方向朝外
      ax.set(-Math.sin(th), 0, Math.cos(th)) // 长边沿纬线
      ay.crossVectors(az, ax)
      // 一道波从上往下一圈圈扫过，扫到的那一圈整圈往外鼓
      const wave = Math.max(0, osc(time, 0.8, -t.ring * 0.75)) ** 4
      const rad = (RADIUS + wave * 0.2) * (0.3 + 0.7 * intro(time, t.ring * 0.09, 1.6))
      out.makeBasis(ax, ay, az).setPosition(tmp.copy(az).multiplyScalar(rad))
    },
  }
}

/** 光圈：一圈斜叠的薄玻璃叶片围着核心，随时间同步收拢和张开，像相机镜头的光学快门 */
function apertureLayout(o: GlassOptions): Layout {
  const rand = mulberry32(67 + o.seed)
  const N = Math.max(10, Math.round(18 * o.density))
  const halves: number[] = []
  const seedShift = rand() * Math.PI * 2
  for (let i = 0; i < N; i++) {
    const len = 3.25 + rand() * 0.25
    halves.push(len / 2, (0.64 + rand() * 0.08) * o.thickness, 0.045 + rand() * 0.028)
  }
  return {
    count: N,
    halves,
    sphere: 1.05,
    camera: 17.5,
    spot: 1.15,
    frost: 0.45,
    pose(time, eased, group) {
      group.rotation.set(0.18 - eased.y * 0.42, -0.14 + eased.x * 0.48, turn(time, 0.05))
    },
    place(i, time, out) {
      const openIntro = intro(time, i * 0.025, 1.8)
      const iris = 0.5 + 0.5 * osc(time, 0.55)
      const th = (i / N) * Math.PI * 2 + seedShift + turn(time, 0.08)
      // 光圈叶片沿切线偏内斜插，iris 越大越向外摆开，露出中心球
      const ang = th + Math.PI * 0.54 + (0.28 - 0.34 * iris) * openIntro
      ax.set(Math.cos(ang), Math.sin(ang), 0)
      ay.set(-Math.sin(ang), Math.cos(ang), 0)
      az.set(0, 0, 1)
      // 瓦片式微倾：每片前端略向 +z、后端略向 -z，环环相叠不穿模，且更容易接到斜射彩光
      q.setFromAxisAngle(ay, 0.2)
      ax.applyQuaternion(q)
      az.applyQuaternion(q)
      q.setFromAxisAngle(ax, 0.16)
      ay.applyQuaternion(q)
      az.applyQuaternion(q)
      const r = (1.92 + 0.78 * iris) * (0.45 + 0.55 * openIntro)
      out.makeBasis(ax, ay, az).setPosition(Math.cos(th) * r, Math.sin(th) * r, 0)
    },
  }
}

/** 隧道：多层错角旋转的方形玻璃门框沿纵深排开，循环向镜头推进，尽头是中心的核 */
function tunnelLayout(o: GlassOptions): Layout {
  const rand = mulberry32(83 + o.seed)
  const LAYERS = Math.max(5, Math.round(9 * o.density))
  const SIDES = 4
  const count = LAYERS * SIDES
  const halves: number[] = []
  const seedRot = rand() * Math.PI * 2
  const RAD = 2.75
  for (let i = 0; i < count; i++) {
    halves.push(2.52, (0.46 + rand() * 0.08) * o.thickness, 0.055 + rand() * 0.032)
  }
  return {
    count,
    halves,
    sphere: 0.88,
    camera: 17.5,
    spot: 1.2,
    frost: 0.35,
    pose(time, eased, group) {
      group.rotation.set(
        -eased.y * 0.22 + osc(time, 0.19) * 0.04,
        eased.x * 0.28 + osc(time, 0.15) * 0.05,
        turn(time, 0.04),
      )
    },
    place(i, time, out) {
      const layer = Math.floor(i / SIDES)
      const side = i % SIDES
      // flow 在 loop 模式下吸附到整数周期，保证首尾帧每层门框精确重合
      const flow = phase(time, 0.95) / (Math.PI * 2)
      const u = (((layer / LAYERS + flow) % 1) + 1) % 1
      const z = -15.5 + u * 24.5
      const rot = seedRot + u * Math.PI * 0.95
      const ang = rot + side * (Math.PI / 2)
      const open = 0.55 + 0.45 * intro(time, layer * 0.06, 1.5)
      const r = RAD * open
      // 梁长沿方框边切向，宽面略朝走廊内侧仰倾，镜头直视时能看到大块折射彩虹
      ax.set(-Math.sin(ang), Math.cos(ang), 0)
      tmp.set(Math.cos(ang), Math.sin(ang), 0) // 径向外
      az.set(0, 0, 1)
      q.setFromAxisAngle(ax, 0.44)
      ay.copy(tmp).applyQuaternion(q)
      az.crossVectors(ax, ay)
      out.makeBasis(ax, ay, az).setPosition(tmp.x * r, tmp.y * r, z)
    },
  }
}

/** 悬浮晶格魔方：3×3×3 镂空玻璃方块围着中心核，上下层缓慢错位拧动、整体呼吸拉开缝隙 */
function cubeLayout(o: GlassOptions): Layout {
  const rand = mulberry32(131 + o.seed)
  const cells: [number, number, number][] = []
  const halves: number[] = []
  for (let x = -1; x <= 1; x++) {
    for (let y = -1; y <= 1; y++) {
      for (let z = -1; z <= 1; z++) {
        if (x === 0 && y === 0 && z === 0) continue
        cells.push([x, y, z])
        const s = (0.58 + rand() * 0.05) * o.thickness
        halves.push(s, s * (0.94 + rand() * 0.12), s * (0.9 + rand() * 0.2))
      }
    }
  }
  return {
    count: cells.length,
    halves,
    sphere: 0.92,
    camera: 18.5,
    backDim: 0.45,
    spot: 1.45,
    frost: 0.22,
    pose(time, eased, group) {
      group.rotation.set(0.55 - eased.y * 0.4, 0.72 + eased.x * 0.5 + turn(time, 0.15), 0.14)
    },
    place(i, time, out) {
      const [gx, gy, gz] = cells[i]
      const open = intro(time, (gy + 1) * 0.18 + Math.abs(gx) * 0.08, 1.5)
      const spread = 1.56 / Math.pow(o.density, 0.22)
      const step = (spread + 0.18 * (0.5 + 0.5 * osc(time, 0.7))) * (0.45 + 0.55 * open)
      // 顶层与底层反方向轻拧，像透明魔方
      const twist = gy === 0 ? 0 : gy * 0.42 * osc(time, 0.48)
      const c = Math.cos(twist)
      const s = Math.sin(twist)
      const px = (gx * c - gz * s) * step
      const pz = (gx * s + gz * c) * step
      ax.set(c, 0, s)
      ay.set(0, 1, 0)
      az.set(-s, 0, c)
      out.makeBasis(ax, ay, az).setPosition(px, gy * step, pz)
    },
  }
}

/** 三轴星环（浑天仪）：三圈不同倾角和半径的玻璃片圆环绕各自轴交错慢转，套在中心核外 */
function orbitLayout(o: GlassOptions): Layout {
  const rand = mulberry32(149 + o.seed)
  const rings = [
    { R: 2.15, n: Math.max(8, Math.round(14 * o.density)), tiltX: 0.42, tiltZ: 0.32, speed: 0.22, w: 0.44 },
    { R: 3.05, n: Math.max(10, Math.round(18 * o.density)), tiltX: -0.78, tiltZ: 0.88, speed: -0.16, w: 0.48 },
    { R: 3.9, n: Math.max(12, Math.round(22 * o.density)), tiltX: 0.92, tiltZ: -0.72, speed: 0.12, w: 0.52 },
  ]
  const items: { rIdx: number; j: number }[] = []
  const halves: number[] = []
  const quats = rings.map((r) => new THREE.Quaternion().setFromEuler(new THREE.Euler(r.tiltX, 0, r.tiltZ)))
  const seedOff = rings.map(() => rand() * Math.PI * 2)
  rings.forEach((r, rIdx) => {
    const seg = ((2 * Math.PI * r.R) / r.n) * 0.88
    for (let j = 0; j < r.n; j++) {
      items.push({ rIdx, j })
      halves.push(seg / 2, r.w * o.thickness, 0.042 + rand() * 0.036)
    }
  })
  return {
    count: items.length,
    halves,
    sphere: 1.05,
    camera: 19,
    spot: 1.4,
    frost: 0.22,
    pose(time, eased, group) {
      group.rotation.set(0.2 - eased.y * 0.4, eased.x * 0.5 + turn(time, 0.07), 0)
    },
    place(i, time, out) {
      const { rIdx, j } = items[i]
      const r = rings[rIdx]
      const open = intro(time, rIdx * 0.16 + j * 0.015, 1.6)
      const th = (j / r.n) * Math.PI * 2 + seedOff[rIdx] + turn(time, r.speed)
      const rad = r.R * (0.4 + 0.6 * open)
      ax.set(-Math.sin(th), 0, Math.cos(th)) // 切向
      // 玻璃片绕切向倾斜 40°，形成斜切星环缎带
      tmp.set(Math.cos(th), 0, Math.sin(th))
      q.setFromAxisAngle(ax, 0.7)
      ay.copy(tmp).applyQuaternion(q)
      az.crossVectors(ax, ay)
      tmp.set(Math.cos(th) * rad, 0, Math.sin(th) * rad).applyQuaternion(quats[rIdx])
      ax.applyQuaternion(quats[rIdx])
      ay.applyQuaternion(quats[rIdx])
      az.applyQuaternion(quats[rIdx])
      out.makeBasis(ax, ay, az).setPosition(tmp)
    },
  }
}

/** 玻璃波阵：斜俯视的 8×8 玻璃片矩阵按 2D 波浪起伏高低与倾角，铺满画面 */
function waveLayout(o: GlassOptions): Layout {
  const rand = mulberry32(163 + o.seed)
  const G = Math.max(5, Math.round(8 * Math.sqrt(o.density)))
  const coords: [number, number][] = []
  const halves: number[] = []
  for (let ix = 0; ix < G; ix++) {
    for (let iz = 0; iz < G; iz++) {
      coords.push([(ix / (G - 1)) * 2 - 1, (iz / (G - 1)) * 2 - 1])
      halves.push(0.48, 0.48 * o.thickness, 0.06 + rand() * 0.036)
    }
  }
  return {
    count: coords.length,
    halves,
    sphere: 0.9,
    camera: 19.5,
    spot: 1.32,
    frost: 0.28,
    pose(time, eased, group) {
      group.rotation.set(0.68 - eased.y * 0.25, -0.44 + eased.x * 0.35 + turn(time, 0.05), 0.05)
    },
    place(i, time, out) {
      const [ux, uz] = coords[i]
      const open = intro(time, Math.hypot(ux, uz) * 0.35, 1.5)
      const span = 4.7 * (0.4 + 0.6 * open)
      const x = ux * span
      const z = uz * span
      const p1 = ux * 3.2 + uz * 2.1
      const p2 = ux * 1.9 - uz * 3.0
      const y = -0.85 + 0.62 * osc(time, 0.75, p1) + 0.38 * osc(time, 0.55, p2)
      // 随波浪斜率自然微倾
      const tiltX = 0.28 * Math.cos(phase(time, 0.75) + p1)
      const tiltZ = 0.22 * Math.cos(phase(time, 0.55) + p2)
      az.set(tiltX, 1, tiltZ).normalize()
      ax.set(1, 0, 0).addScaledVector(az, -az.x).normalize()
      ay.crossVectors(az, ax)
      out.makeBasis(ax, ay, az).setPosition(x, y, z)
    },
  }
}

/** 水晶花冠：内外两层斜上舒展的玻璃花瓣围着发光花蕊缓缓开合呼吸 */
function lotusLayout(o: GlassOptions): Layout {
  const rand = mulberry32(181 + o.seed)
  const N1 = Math.max(6, Math.round(10 * o.density))
  const N2 = Math.max(8, Math.round(14 * o.density))
  const halves: number[] = []
  for (let i = 0; i < N1; i++) halves.push(1.38 + rand() * 0.1, (0.56 + rand() * 0.06) * o.thickness, 0.042 + rand() * 0.032)
  for (let i = 0; i < N2; i++) halves.push(1.78 + rand() * 0.14, (0.68 + rand() * 0.06) * o.thickness, 0.045 + rand() * 0.034)
  return {
    count: N1 + N2,
    halves,
    sphere: 1.0,
    camera: 18.2,
    spot: 1.38,
    frost: 0.28,
    pose(time, eased, group) {
      group.rotation.set(0.64 - eased.y * 0.35, eased.x * 0.5 + turn(time, 0.12), 0)
    },
    place(i, time, out) {
      const inner = i < N1
      const j = inner ? i : i - N1
      const n = inner ? N1 : N2
      const open = intro(time, (inner ? 0 : 0.25) + j * 0.03, 1.7)
      const bloom = 0.5 + 0.5 * osc(time, 0.55, inner ? 0.5 : 0)
      const th = (j / n) * Math.PI * 2 + (inner ? 0 : Math.PI / n) + turn(time, inner ? 0.08 : -0.05)
      // 花瓣仰角：内层偏收拢、外层偏舒展，随 bloom 缓缓开合
      const elev = (inner ? 0.96 - 0.26 * bloom : 0.42 - 0.22 * bloom) * open + (1 - open) * 1.35
      const r0 = inner ? 1.1 : 1.45
      const len = halves[i * 3]
      const ce = Math.cos(elev)
      const se = Math.sin(elev)
      ax.set(Math.cos(th) * ce, se, Math.sin(th) * ce) // 花瓣沿斜上方向伸出
      tmp.set(-Math.sin(th), 0, Math.cos(th)) // 切向
      q.setFromAxisAngle(ax, inner ? 0.2 : -0.16)
      ay.copy(tmp).applyQuaternion(q)
      az.crossVectors(ax, ay)
      const cx = Math.cos(th) * (r0 + len * ce)
      const cy = -0.75 + len * se
      const cz = Math.sin(th) * (r0 + len * ce)
      out.makeBasis(ax, ay, az).setPosition(cx, cy, cz)
    },
  }
}

const LAYOUTS: Record<GlassShape, (o: GlassOptions) => Layout> = {
  burst: burstLayout,
  fan: fanLayout,
  ring: ringLayout,
  sphere: sphereLayout,
  aperture: apertureLayout,
  tunnel: tunnelLayout,
  cube: cubeLayout,
  orbit: orbitLayout,
  wave: waveLayout,
  lotus: lotusLayout,
}

export function createPrism(renderer: THREE.WebGLRenderer, options: Partial<GlassOptions> = {}): Fx {
  const opts = { ...GLASS_DEFAULTS, ...options }
  const Q = QUALITY[opts.quality]
  const pal: Palette = PALETTES[opts.palette] ?? PALETTES.ice
  loopT = opts.loop
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(pal.bg)
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100)
  const layout = LAYOUTS[opts.shape](opts)
  const halves = layout.halves

  const geo = new THREE.BoxGeometry(1, 1, 1)
  geo.setAttribute('aHalf', new THREE.InstancedBufferAttribute(new Float32Array(halves), 3))
  const barMat = new THREE.ShaderMaterial({
    uniforms: {
      uEdge: { value: 0.026 },
      uDispersion: { value: 0.42 },
      uSpot: { value: 1.5 * opts.dispersion * (layout.spot ?? 1) },
      uBackDim: { value: layout.backDim ?? 1 },
      uFrost: { value: layout.frost ?? 1 },
      uFlow: { value: layout.flow ? 1 : 0 },
      uFlowT: { value: 0 },
      uBand: { value: layout.band ? 1 : 0 },
      uSat: { value: pal.sat },
      uLight: { value: new THREE.Vector3(...pal.light) },
      uSpectrum: { value: new THREE.Vector3(...pal.spectrum).multiplyScalar(Math.min(opts.dispersion, 1.5)) },
    },
    defines: { SAMPLES: Q.samples },
    vertexShader: BAR_VERT,
    fragmentShader: BAR_FRAG,
    side: THREE.DoubleSide,
    transparent: true,
    premultipliedAlpha: true,
    depthWrite: false,
  })
  const halfAttr = geo.getAttribute('aHalf') as THREE.InstancedBufferAttribute
  const mats = Array.from({ length: layout.count }, () => new THREE.Matrix4())
  const depth = new Float32Array(layout.count)
  const order = mats.map((_, i) => i)
  const mesh = new THREE.InstancedMesh(geo, barMat, layout.count)
  mesh.frustumCulled = false
  const group = new THREE.Group()
  group.add(mesh)
  scene.add(group)

  // —— 中心球 ——
  const sceneRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType })
  const sphereMat = new THREE.ShaderMaterial({
    uniforms: {
      tScene: { value: sceneRT.texture },
      uRes: { value: new THREE.Vector2(1, 1) },
      uRim: { value: new THREE.Vector3(...pal.rim) },
      uLight: { value: new THREE.Vector3(...pal.light) },
    },
    vertexShader: SPHERE_VERT,
    fragmentShader: SPHERE_FRAG,
  })
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(layout.sphere, 64, 48), sphereMat)
  scene.add(sphere)

  const composer = new EffectComposer(renderer)
  composer.addPass(new RenderPass(scene, camera))
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.06, 0.3, 0.92)
  if (Q.bloom) composer.addPass(bloom)
  const finish = makeFinishPass({ dispersion: 0.006, exposure: 1.05 })
  composer.addPass(finish)

  const eased = { x: 0, y: 0 }

  return {
    render(time: number, pointer: Pointer) {
      eased.x += (pointer.x - eased.x) * 0.05
      eased.y += (pointer.y - eased.y) * 0.05

      loopT = opts.loop
      layout.pose(time, eased, group)
      for (let i = 0; i < layout.count; i++) {
        layout.place(i, time, mats[i])
        depth[i] = tmp.setFromMatrixPosition(mats[i]).applyQuaternion(group.quaternion).z
      }
      // 半透明要从远到近画：每帧按条中心的深度给实例排序（相机在 +z）
      order.sort((a, b) => depth[a] - depth[b])
      for (let k = 0; k < order.length; k++) {
        const i = order[k]
        mesh.setMatrixAt(k, mats[i])
        halfAttr.setXYZ(k, halves[i * 3], halves[i * 3 + 1], halves[i * 3 + 2])
      }
      mesh.instanceMatrix.needsUpdate = true
      halfAttr.needsUpdate = true

      // 先单独渲一帧"只有玻璃条"，给球做折射用
      if (Q.prepass) {
        sphere.visible = false
        renderer.setRenderTarget(sceneRT)
        renderer.render(scene, camera)
        renderer.setRenderTarget(null)
        sphere.visible = true
      }

      if (layout.flow) barMat.uniforms.uFlowT.value = phase(time, 0.39) / (Math.PI * 2)
      finish.uniforms.uTime.value = time
      composer.render()
    },
    resize(width: number, height: number, pixelRatio?: number) {
      const aspect = width / height
      const pr = pixelRatio ?? Math.min(window.devicePixelRatio, Q.pr)
      camera.aspect = aspect
      camera.position.set(0, 0, layout.camera / Math.min(aspect, 1))
      camera.lookAt(0, 0, 0)
      camera.updateProjectionMatrix()
      composer.setPixelRatio(pr)
      composer.setSize(width, height)
      sceneRT.setSize(Math.round((width * pr) / 2), Math.round((height * pr) / 2))
      sphereMat.uniforms.uRes.value.set(width * pr, height * pr)
      finish.uniforms.uAspect.value = aspect
    },
    dispose() {
      composer.dispose()
      sceneRT.dispose()
      geo.dispose()
      barMat.dispose()
      sphere.geometry.dispose()
      sphereMat.dispose()
      bloom.dispose()
      finish.material.dispose()
    },
  }
}
