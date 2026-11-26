// 从 ~/dev/creght-tpl/spectral-lab/src 原样拷来，改引擎时在那边改完再拷过来，别只改这里。
import * as THREE from 'three'
import { createBlackHole, HOLE_DEFAULTS, type HoleOptions, type HolePaletteName } from './blackhole'
import { createBeam } from './beam'
import { createPrism, GLASS_DEFAULTS, PALETTES, type GlassShape, type PaletteName } from './prism'
import type { Fx, Quality } from './common'

/**
 * 引擎入口：给一个 canvas 和一份配置，它负责渲染循环、尺寸、鼠标、画质和省电。
 * 工具和模板都只调这一个函数，不直接碰各个效果。
 */

export type Effect = 'glass' | 'hole' | 'beam'

export interface SpectralOptions {
  effect: Effect
  /** 玻璃的形态（effect 为 glass 时有效） */
  shape: GlassShape
  palette: PaletteName
  /** auto：按设备挑起始档，帧率不够再自动降档 */
  quality: Quality | 'auto'
  seed: number
  density: number
  thickness: number
  dispersion: number
  /** 速度倍率 */
  speed: number
  /** 循环周期（秒），0 = 不循环 */
  loop: number
  /** 定格在某一秒（截图、导出静帧用）；null = 正常播放 */
  frozen: number | null
  /** 是否跟随鼠标 */
  interactive: boolean
  /** 以下只对黑洞（effect 为 hole）有效；seed、dispersion、loop、speed 和玻璃共用 */
  holePalette: HolePaletteName
  tilt: number
  roll: number
  zoom: number
  glow: number
}

export const DEFAULTS: SpectralOptions = {
  effect: 'glass',
  shape: GLASS_DEFAULTS.shape,
  palette: GLASS_DEFAULTS.palette,
  quality: 'auto',
  seed: 0,
  density: 1,
  thickness: 1,
  dispersion: 1,
  speed: 1,
  loop: 0,
  frozen: null,
  interactive: true,
  holePalette: HOLE_DEFAULTS.palette,
  tilt: HOLE_DEFAULTS.tilt,
  roll: HOLE_DEFAULTS.roll,
  zoom: HOLE_DEFAULTS.zoom,
  glow: HOLE_DEFAULTS.glow,
}

export const SHAPES: GlassShape[] = ['burst', 'fan', 'ring', 'sphere', 'aperture', 'tunnel', 'cube', 'orbit', 'wave', 'lotus']
export const PALETTE_NAMES = Object.keys(PALETTES) as PaletteName[]

export interface SpectralHandle {
  /** 改配置。只改速度、定格、交互时不重建；其余会重建效果 */
  update(patch: Partial<SpectralOptions>): void
  /** 当前实际在用的画质档 */
  quality(): Quality
  /** 现在画到第几秒（已乘过速度；导出静帧时用它拿到和屏幕上同一帧） */
  time(): number
  /** 把时间拨回 0（重放开场） */
  restart(): void
  dispose(): void
}

const holeOptions = (o: SpectralOptions, quality: Quality): HoleOptions => ({
  quality,
  palette: o.holePalette,
  tilt: o.tilt,
  roll: o.roll,
  zoom: o.zoom,
  glow: o.glow,
  dispersion: o.dispersion,
  seed: o.seed,
  loop: o.loop,
})
/** 黑洞这几项只是 uniform，改了直接调 tune，不重建（拖滑杆才不卡） */
const HOLE_LIVE: (keyof SpectralOptions)[] = ['holePalette', 'tilt', 'roll', 'zoom', 'glow', 'dispersion', 'seed']

/** 按配置建一个效果。mountSpectral 和离屏导出共用 */
function createFx(renderer: THREE.WebGLRenderer, opts: SpectralOptions, quality: Quality): Fx {
  if (opts.effect === 'hole') return createBlackHole(renderer, holeOptions(opts, quality))
  if (opts.effect === 'beam') return createBeam(renderer, quality)
  return createPrism(renderer, {
    shape: opts.shape,
    palette: opts.palette,
    quality,
    seed: opts.seed,
    density: opts.density,
    thickness: opts.thickness,
    dispersion: opts.dispersion,
    loop: opts.loop,
  })
}

const STEP_DOWN: Record<Quality, Quality | null> = { high: 'medium', medium: 'low', low: null }

export function mountSpectral(canvas: HTMLCanvasElement, options: Partial<SpectralOptions> = {}): SpectralHandle {
  let opts: SpectralOptions = { ...DEFAULTS, ...options }
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' })
  renderer.setClearColor(0x000000, 1)

  const coarse = window.matchMedia('(pointer: coarse)').matches
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
  let quality: Quality = opts.quality === 'auto' ? (coarse ? 'medium' : 'high') : opts.quality

  const pointer = { x: 0, y: 0 }
  let fx: Fx | null = null
  let time = 0
  let last = performance.now()
  let visible = true
  let dirty = true // 暂停或定格时，只有这个为真才补画一帧

  // 玻璃效果建一次要编译着色器、分配渲染目标，会卡一下。页面在几个形态之间来回切（滚动换场景）时
  // 把建好的留着复用，最多留 4 个；其它效果参数是连续变的，不缓存
  const cache = new Map<string, Fx>()
  const cacheKey = () =>
    opts.effect === 'glass'
      ? [quality, opts.shape, opts.palette, opts.seed, opts.density, opts.thickness, opts.dispersion, opts.loop].join('|')
      : ''

  function build() {
    if (fx && ![...cache.values()].includes(fx)) fx.dispose()
    const key = cacheKey()
    const hit = key ? cache.get(key) : undefined
    if (hit) {
      cache.delete(key) // 重新插到最后，最近用的最后淘汰
      cache.set(key, hit)
      fx = hit
    } else {
      fx = createFx(renderer, opts, quality)
      if (key) {
        cache.set(key, fx)
        if (cache.size > 4) {
          const oldest = cache.keys().next().value!
          cache.get(oldest)!.dispose()
          cache.delete(oldest)
        }
      }
    }
    resize()
    samples = 0
    slow = 0
    strikes = 0
  }

  function resize() {
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    // 画布被隐藏（display:none）时尺寸是 0：不动，等它再显示出来。按 0 或者按窗口尺寸重设都会让画面闪一下变形
    if (!w || !h) return
    renderer.setSize(w, h, false)
    fx?.resize(w, h)
    dirty = true
  }

  // 自动降档：攒够一段帧时间，平均低于约 38 帧就降一档
  let samples = 0
  let slow = 0
  let strikes = 0 // 连续几段都慢。只慢一段多半是页面在滚动或者刚切了场景，不算
  function measure(dt: number) {
    if (opts.quality !== 'auto' || opts.frozen !== null) return
    samples++
    if (samples < 40) return // 刚建好的头几十帧在编译着色器，不算
    if (dt > 0.026) slow++
    if (samples >= 160) {
      const next = STEP_DOWN[quality]
      strikes = slow > 80 ? strikes + 1 : 0
      if (strikes >= 2 && next) {
        quality = next
        build()
      }
      samples = 40
      slow = 0
    }
  }

  function frame(now: number) {
    const dt = Math.min((now - last) / 1000, 0.1)
    last = now
    if (!visible && !dirty) return
    const still = opts.frozen !== null || reduced.matches
    if (!still) {
      time += dt * opts.speed
      measure(dt)
    } else if (!dirty) return
    // “减少动效”时停在一个展开好的静帧上
    const t = opts.frozen ?? (reduced.matches ? 6 : time)
    fx?.render(opts.loop ? t % opts.loop : t, opts.interactive ? pointer : { x: 0, y: 0 })
    dirty = false
  }

  const onMove = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect()
    // 画布被隐藏时宽高是 0，除出来是无穷大，会把效果里的旋转算成 NaN（玻璃条整个消失，而且恢复不了）
    if (!r.width || !r.height) return
    const clamp = (v: number) => Math.min(2, Math.max(-2, v))
    pointer.x = clamp(((e.clientX - r.left) / r.width) * 2 - 1)
    pointer.y = clamp(((e.clientY - r.top) / r.height) * 2 - 1)
    if (opts.frozen !== null) dirty = true
  }
  window.addEventListener('pointermove', onMove)
  const ro = new ResizeObserver(resize)
  ro.observe(canvas)
  // 滚出视口、切到别的标签页都停掉，不白烧显卡
  const io = new IntersectionObserver((es) => {
    // 快速滚动时一次回调里会攒好几条记录，最后一条才是现在的状态
    visible = es[es.length - 1].isIntersecting && !document.hidden
    last = performance.now()
  })
  io.observe(canvas)
  const onVis = () => {
    visible = !document.hidden
    last = performance.now()
  }
  document.addEventListener('visibilitychange', onVis)

  build()
  renderer.setAnimationLoop(frame)

  return {
    update(patch) {
      const prev = opts
      opts = { ...opts, ...patch }
      const light: (keyof SpectralOptions)[] = ['speed', 'frozen', 'interactive']
      const live = opts.effect === 'hole' && prev.effect === 'hole' && fx?.tune ? HOLE_LIVE : []
      const changed = (Object.keys(patch) as (keyof SpectralOptions)[]).filter((k) => prev[k] !== opts[k])
      const rebuild = changed.some((k) => !light.includes(k) && !live.includes(k))
      if (patch.quality && patch.quality !== prev.quality) {
        quality = opts.quality === 'auto' ? (coarse ? 'medium' : 'high') : opts.quality
      }
      if (rebuild) build()
      else if (changed.some((k) => live.includes(k))) fx?.tune?.({ ...holeOptions(opts, quality) })
      dirty = true
    },
    quality: () => quality,
    time: () => opts.frozen ?? time,
    restart() {
      time = 0
      dirty = true
    },
    dispose() {
      renderer.setAnimationLoop(null)
      window.removeEventListener('pointermove', onMove)
      document.removeEventListener('visibilitychange', onVis)
      ro.disconnect()
      io.disconnect()
      if (fx && ![...cache.values()].includes(fx)) fx.dispose()
      cache.forEach((f) => f.dispose())
      cache.clear()
      renderer.dispose()
    },
  }
}

export interface OffscreenHandle {
  /** 画布本身（没挂到页面上），render 之后同一个任务里可以直接 drawImage / 读像素 */
  canvas: HTMLCanvasElement
  /** 画第 time 秒那一帧（有 loop 时按周期取余），不跟随鼠标 */
  render(time: number): void
  dispose(): void
}

/**
 * 离屏渲染：按固定像素尺寸逐帧画，给导出图片 / 视频用。
 * 不起渲染循环、不看鼠标和窗口大小，画质固定 high，像素比固定 1（width × height 就是输出尺寸）。
 */
export function createOffscreen(options: Partial<SpectralOptions>, width: number, height: number): OffscreenHandle {
  const opts: SpectralOptions = { ...DEFAULTS, ...options }
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true })
  renderer.setClearColor(0x000000, 1)
  renderer.setPixelRatio(1)
  renderer.setSize(width, height, false)
  const fx = createFx(renderer, opts, 'high')
  fx.resize(width, height, 1)
  return {
    canvas,
    render(time) {
      fx.render(opts.loop ? time % opts.loop : time, { x: 0, y: 0 })
    },
    dispose() {
      fx.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
    },
  }
}
