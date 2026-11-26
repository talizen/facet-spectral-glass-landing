import { useEffect, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { PALETTE_NAMES, type SpectralOptions } from '../lib/spectral/engine'
import { PALETTES, type PaletteName } from '../lib/spectral/prism'
import { ACCENT, FAQ, FEATURES, FOOT, HERO_SHAPES, LOGOS, NAV, PILLARS, PLANS, STATS } from '../lib/content'
import { ProductDemo } from '../component/ProductDemo'
import { SpectralCanvas } from '../component/SpectralCanvas'

function Logo() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M10 1.5 18.5 10 10 18.5 1.5 10 10 1.5Z" stroke="currentColor" strokeWidth="1.3" />
      <path d="M10 1.5v17M1.5 10h17" stroke="currentColor" strokeWidth="1.3" opacity=".45" />
    </svg>
  )
}

/** 卡片鼠标跟随微光：只更新 CSS 变量，不触发 React 重渲染 */
function trackGlow(e: ReactPointerEvent<HTMLElement>) {
  const r = e.currentTarget.getBoundingClientRect()
  e.currentTarget.style.setProperty('--mx', `${e.clientX - r.left}px`)
  e.currentTarget.style.setProperty('--my', `${e.clientY - r.top}px`)
}

export default function Index() {
  const [palette, setPalette] = useState<PaletteName>('ice')
  const [frozen, setFrozen] = useState<number | null>(null)
  const [heroIdx, setHeroIdx] = useState(0)
  const [heroShown, setHeroShown] = useState(0)
  const [heroSwapping, setHeroSwapping] = useState(false)
  const [pillarIdx, setPillarIdx] = useState(0)
  const [pillarShown, setPillarShown] = useState(0)
  const [pillarSwapping, setPillarSwapping] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [signInOpen, setSignInOpen] = useState(false)
  const [signInEmail, setSignInEmail] = useState('')
  const [signInSent, setSignInSent] = useState(false)
  const [annual, setAnnual] = useState(true)
  const [open, setOpen] = useState(0)
  const [subEmail, setSubEmail] = useState('')
  const [subDone, setSubDone] = useState(false)

  const archRef = useRef<HTMLElement>(null)
  const [archNear, setArchNear] = useState(false)
  const ctaRef = useRef<HTMLElement>(null)
  const [ctaNear, setCtaNear] = useState(false)

  // 挂载后再读地址栏参数，保证服务端渲染与浏览器首帧一致
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const p = params.get('palette') as PaletteName | null
    if (p && p in PALETTES) setPalette(p)
    const s = params.get('shape')
    if (s) {
      const idx = HERO_SHAPES.findIndex((item) => item.shape === s)
      if (idx >= 0) {
        setHeroIdx(idx)
        setHeroShown(idx)
      }
    }
    if (params.has('t')) {
      const t = Number(params.get('t'))
      if (Number.isFinite(t)) setFrozen(t)
    }
  }, [])

  // 顶栏滚动态
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Esc 关闭弹窗或移动端菜单
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSignInOpen(false)
        setMenuOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 中段 Architecture 玻璃：快滚到附近时再挂载，不拖慢首屏
  useEffect(() => {
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setArchNear(true), { rootMargin: '450px' })
    if (archRef.current) io.observe(archRef.current)
    return () => io.disconnect()
  }, [])

  // 结尾 CTA 玻璃：离视口还有 550px 时再建
  useEffect(() => {
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setCtaNear(true), { rootMargin: '550px' })
    if (ctaRef.current) io.observe(ctaRef.current)
    return () => io.disconnect()
  }, [])

  // 轻量滚入渐显（一次性，尊重 prefers-reduced-motion）
  useEffect(() => {
    const nodes = document.querySelectorAll<HTMLElement>('.reveal')
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      nodes.forEach((el) => el.classList.add('is-in'))
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add('is-in')
            io.unobserve(e.target)
          }
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' },
    )
    nodes.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [])

  // 首屏形态柔和淡出切换
  useEffect(() => {
    if (heroIdx === heroShown) {
      setHeroSwapping(false)
      return
    }
    setHeroSwapping(true)
    const t = setTimeout(() => {
      setHeroShown(heroIdx)
      setHeroSwapping(false)
    }, 220)
    return () => clearTimeout(t)
  }, [heroIdx, heroShown])

  // 中段 Architecture 形态柔和淡出切换
  useEffect(() => {
    if (pillarIdx === pillarShown) {
      setPillarSwapping(false)
      return
    }
    setPillarSwapping(true)
    const t = setTimeout(() => {
      setPillarShown(pillarIdx)
      setPillarSwapping(false)
    }, 220)
    return () => clearTimeout(t)
  }, [pillarIdx, pillarShown])

  useEffect(() => {
    const bg = '#' + PALETTES[palette].bg.toString(16).padStart(6, '0')
    document.documentElement.style.setProperty('--bg', bg)
    document.documentElement.style.setProperty('--accent', ACCENT[palette])
  }, [palette])

  const onSubscribe = (e: FormEvent) => {
    e.preventDefault()
    if (!subEmail.trim() || !subEmail.includes('@')) return
    setSubDone(true)
  }

  const onSignIn = (e: FormEvent) => {
    e.preventDefault()
    if (!signInEmail.trim() || !signInEmail.includes('@')) return
    setSignInSent(true)
  }

  const heroPreset = HERO_SHAPES[heroShown]
  const heroOptions: Partial<SpectralOptions> = {
    effect: 'glass',
    palette,
    frozen,
    shape: heroPreset.shape,
    seed: heroPreset.seed,
    density: heroPreset.density,
    thickness: heroPreset.thickness,
  }

  const activePillar = PILLARS[pillarIdx]
  const shownPillar = PILLARS[pillarShown]
  const archOptions: Partial<SpectralOptions> = {
    effect: 'glass',
    palette,
    frozen,
    shape: shownPillar.preset.shape,
    seed: shownPillar.preset.seed,
    density: shownPillar.preset.density,
    thickness: shownPillar.preset.thickness,
  }

  return (
    <>
      <nav className={`nav${scrolled ? ' is-scrolled' : ''}`}>
        <div className="wrap nav-in">
          <a className="brand" href="#top" onClick={() => setMenuOpen(false)}>
            <Logo />
            Facet
          </a>
          <div className="nav-links">
            {NAV.map((n) => (
              <a key={n.label} href={n.href}>
                {n.label}
              </a>
            ))}
          </div>
          <div className="nav-cta">
            <button
              type="button"
              className="link link-btn"
              onClick={() => {
                setSignInSent(false)
                setSignInOpen(true)
              }}
            >
              Sign in
            </button>
            <a href="#pricing" className="btn btn-sm">
              Start free
            </a>
            <button
              type="button"
              className={`menu-btn${menuOpen ? ' is-open' : ''}`}
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
            >
              <span />
              <span />
            </button>
          </div>
        </div>
        {menuOpen && (
          <div className="nav-drawer">
            <div className="wrap nav-drawer-in">
              {NAV.map((n) => (
                <a key={n.label} href={n.href} onClick={() => setMenuOpen(false)}>
                  {n.label}
                </a>
              ))}
              <button
                type="button"
                className="drawer-signin"
                onClick={() => {
                  setMenuOpen(false)
                  setSignInSent(false)
                  setSignInOpen(true)
                }}
              >
                Sign in
              </button>
            </div>
          </div>
        )}
      </nav>

      <main id="top">
        {/* 首屏：只占 1 屏，右侧是实时玻璃舞台，右下角可轻量切换预览形态 */}
        <section className="hero">
          <div className={`hero-stage${heroSwapping ? ' is-swapping' : ''}`}>
            <SpectralCanvas options={heroOptions} replayKey={heroShown} />
          </div>
          <div className="wrap hero-in">
            <p className="eyebrow">
              <i /> Research agent · now in open beta
            </p>
            <h1>
              Every angle
              <br />
              of the answer.
            </h1>
            <p className="lede">
              Facet splits one question into dozens of lines of inquiry, reads the sources for you, and hands back a
              brief you can trace line by line.
            </p>
            <div className="actions">
              <a href="#pricing" className="btn">
                Start free
              </a>
              <a href="#demo" className="btn btn-ghost">
                Try the interactive brief
              </a>
            </div>
            <dl className="stats">
              {STATS.map(([n, l]) => (
                <div key={l}>
                  <dt>{n}</dt>
                  <dd>{l}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="hero-shapes" role="group" aria-label="Hero glass shape">
            {HERO_SHAPES.map((item, i) => (
              <button
                key={item.shape}
                type="button"
                className={heroIdx === i ? 'is-on' : ''}
                aria-pressed={heroIdx === i}
                onClick={() => setHeroIdx(i)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </section>

        <section className="band reveal">
          <div className="wrap">
            <p className="eyebrow center">Trusted by research, strategy and policy teams</p>
            <div className="logos">
              {LOGOS.map((l) => (
                <span key={l}>{l}</span>
              ))}
            </div>
          </div>
        </section>

        <section className="block reveal" id="demo">
          <div className="wrap">
            <header className="block-head">
              <p className="eyebrow">
                <b>01</b> How it works
              </p>
              <h2>Three steps, most of them yours to skip.</h2>
            </header>
            <ProductDemo />
          </div>
        </section>

        {/* 中段视觉锚点：把原先三屏玻璃精炼成 1 块紧凑的双栏可切换舞台 */}
        <section className="block reveal" id="architecture" ref={archRef}>
          <div className="wrap">
            <header className="block-head">
              <p className="eyebrow">
                <b>02</b> Architecture
              </p>
              <h2>Built like optics, not a single prompt.</h2>
            </header>
            <div className="arch-grid">
              <div className="arch-list" role="tablist" aria-label="Research stages">
                {PILLARS.map((p, i) => {
                  const active = pillarIdx === i
                  return (
                    <div key={p.tag} className={`arch-item${active ? ' is-active' : ''}`}>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={active}
                        className="arch-trigger"
                        onClick={() => setPillarIdx(i)}
                      >
                        <span className="arch-code">{p.code}</span>
                        <span className="arch-meta">
                          <strong>{p.tag}</strong>
                          <small>{p.preset.label}</small>
                        </span>
                      </button>
                      {active && (
                        <div className="arch-detail">
                          <h3>{p.title}</h3>
                          <p>{p.body}</p>
                          <ul className="ticks">
                            {p.ticks.map((t) => (
                              <li key={t}>{t}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              <div className="arch-stage-wrap">
                <div className={`arch-stage${pillarSwapping ? ' is-swapping' : ''}`}>
                  {archNear && <SpectralCanvas options={archOptions} replayKey={pillarShown} />}
                </div>
                <div className="arch-caption">
                  <span>
                    {activePillar.code} · {activePillar.tag}
                  </span>
                  <span>{activePillar.preset.label} optics</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="block reveal" id="features">
          <div className="wrap">
            <header className="block-head">
              <p className="eyebrow">
                <b>03</b> Built for real work
              </p>
              <h2>Depth without the afternoon it used to cost.</h2>
            </header>
            <div className="grid">
              {FEATURES.map(([t, b], i) => (
                <article className="card" key={t} onPointerMove={trackGlow}>
                  <span className="card-n">{String(i + 1).padStart(2, '0')}</span>
                  <h3>{t}</h3>
                  <p>{b}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="block reveal" id="pricing">
          <div className="wrap">
            <div className="pricing-top">
              <header className="block-head">
                <p className="eyebrow">
                  <b>04</b> Pricing
                </p>
                <h2>Start alone, bring the team when it clicks.</h2>
              </header>
              <div className="billing" role="group" aria-label="Billing period">
                <button type="button" className={!annual ? 'is-on' : ''} onClick={() => setAnnual(false)}>
                  Monthly
                </button>
                <button type="button" className={annual ? 'is-on' : ''} onClick={() => setAnnual(true)}>
                  Annual <span className="save">−20%</span>
                </button>
              </div>
            </div>
            <div className="plans">
              {PLANS.map((p) => (
                <article className={`card plan${p.featured ? ' is-featured' : ''}`} key={p.name} onPointerMove={trackGlow}>
                  <h3>{p.name}</h3>
                  <p className="price">
                    {annual ? p.annual : p.monthly} <small>{annual ? p.noteAnnual : p.noteMonthly}</small>
                  </p>
                  <ul>
                    {p.items.map((it) => (
                      <li key={it}>{it}</li>
                    ))}
                  </ul>
                  <a href="#top" className={`btn${p.featured ? '' : ' btn-ghost'}`}>
                    {p.cta}
                  </a>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="block reveal" id="docs">
          <div className="wrap faq-wrap">
            <header className="block-head">
              <p className="eyebrow">
                <b>05</b> Questions
              </p>
              <h2>Asked before you had to.</h2>
            </header>
            <div className="faq">
              {FAQ.map(([q, a], i) => (
                <div className={`faq-item${open === i ? ' is-open' : ''}`} key={q}>
                  <button type="button" onClick={() => setOpen(open === i ? -1 : i)} aria-expanded={open === i}>
                    {q}
                    <i aria-hidden="true" />
                  </button>
                  <div className="faq-a">
                    <p>{a}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="cta" ref={ctaRef}>
          <div className="wrap cta-in reveal">
            <p className="eyebrow center">
              <i /> Open beta · no card needed
            </p>
            <h2>Ask it something hard.</h2>
            <p className="lede">Twenty runs a month are free. Bring the question you have been putting off.</p>
            <div className="actions center">
              <a href="#pricing" className="btn">
                Start free
              </a>
              <a href="#demo" className="btn btn-ghost">
                Try the brief
              </a>
            </div>
          </div>
          {/* 底部呼应玻璃：扇形只露出上半截，像从页面底下升起来 */}
          <div className="cta-glass">
            {ctaNear && <SpectralCanvas options={{ effect: 'glass', shape: 'fan', palette, seed: 5, density: 1.15, thickness: 1, frozen }} />}
          </div>
        </section>
      </main>

      <footer className="foot" id="changelog">
        <div className="wrap">
          <div className="foot-top">
            <div className="foot-brand">
              <a className="brand" href="#top">
                <Logo />
                Facet
              </a>
              <p>A research agent for questions that deserve more than one pass.</p>
              {subDone ? (
                <p className="foot-confirm" role="status">
                  <i aria-hidden="true" /> You&apos;re on the list — we&apos;ll write when major releases ship.
                </p>
              ) : (
                <form className="foot-form" onSubmit={onSubscribe}>
                  <input
                    type="email"
                    required
                    value={subEmail}
                    onChange={(e) => setSubEmail(e.target.value)}
                    placeholder="you@company.com"
                    aria-label="Email address"
                  />
                  <button type="submit">Get updates</button>
                </form>
              )}
            </div>
            {FOOT.map(([title, links]) => (
              <nav key={title} aria-label={title}>
                <h3>{title}</h3>
                {links.map((l) => (
                  <a key={l} href="#top">
                    {l}
                  </a>
                ))}
              </nav>
            ))}
          </div>
          <div className="foot-bar">
            <p>© 2026 Facet Labs, Inc.</p>
            <p className="status">
              <i /> All systems normal
            </p>
            <div className="foot-social">
              {['X', 'GitHub', 'LinkedIn'].map((l) => (
                <a key={l} href="#top">
                  {l}
                </a>
              ))}
            </div>
          </div>
        </div>
        <div className="foot-mark" aria-hidden="true">
          Facet
        </div>
      </footer>

      <div className="themes" role="group" aria-label="Theme">
        <span>Theme</span>
        {PALETTE_NAMES.map((p) => (
          <button
            key={p}
            type="button"
            className={p === palette ? 'on' : ''}
            style={{ background: ACCENT[p] }}
            onClick={() => setPalette(p)}
            aria-label={p}
            aria-pressed={p === palette}
            title={p}
          />
        ))}
      </div>

      {signInOpen && (
        <div
          className="modal-bg"
          role="dialog"
          aria-modal="true"
          aria-labelledby="signin-title"
          onClick={() => setSignInOpen(false)}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <span className="brand">
                <Logo />
                Facet
              </span>
              <button type="button" className="modal-x" aria-label="Close" onClick={() => setSignInOpen(false)}>
                ×
              </button>
            </div>
            <h3 id="signin-title">Sign in to your workspace</h3>
            {signInSent ? (
              <p className="modal-done" role="status">
                We sent a one-time sign-in link to <strong>{signInEmail}</strong>. Check your inbox to continue.
              </p>
            ) : (
              <form className="modal-form" onSubmit={onSignIn}>
                <p>Enter your work email and we&apos;ll send a single-use link — no password required.</p>
                <input
                  type="email"
                  required
                  autoFocus
                  value={signInEmail}
                  onChange={(e) => setSignInEmail(e.target.value)}
                  placeholder="you@company.com"
                  aria-label="Work email"
                />
                <button type="submit" className="btn">
                  Continue with email
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  )
}
