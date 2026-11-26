import { useState } from 'react'
import { DEMO_CITATIONS, DEMO_PROMPTS, DEMO_THREADS, STEPS } from '../lib/content'

/** 交互式三步产品演示：纯 React/CSS 实现，零外图依赖，买家换 content.ts 即可改内容 */
export function ProductDemo() {
  const [step, setStep] = useState(0)
  const [promptIdx, setPromptIdx] = useState(0)
  const [enabled, setEnabled] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(DEMO_THREADS.map((t) => [t.id, t.defaultOn])),
  )
  const [citeId, setCiteId] = useState(1)

  const activePrompt = DEMO_PROMPTS[promptIdx]
  const activeCount = DEMO_THREADS.filter((t) => enabled[t.id]).length
  const activeCite = DEMO_CITATIONS.find((c) => c.id === citeId) ?? DEMO_CITATIONS[0]

  const toggleThread = (id: string) => {
    setEnabled((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  return (
    <div className="demo-grid">
      <ol className="demo-steps" role="tablist" aria-label="How Facet works">
        {STEPS.map((s, i) => (
          <li key={s.id}>
            <button
              type="button"
              role="tab"
              aria-selected={step === i}
              className={`demo-step${step === i ? ' is-active' : ''}`}
              onClick={() => setStep(i)}
            >
              <span className="demo-num">{i + 1}</span>
              <div className="demo-step-body">
                <h3>{s.title}</h3>
                <p>{s.body}</p>
                <small>{s.meta}</small>
              </div>
            </button>
          </li>
        ))}
      </ol>

      <div className="demo-win" role="tabpanel" aria-label={STEPS[step].title}>
        <div className="demo-bar">
          <span className="demo-bar-title">
            <i aria-hidden="true" />
            facet / run-0418 · {STEPS[step].title.toLowerCase()}
          </span>
          <span className="demo-bar-meta">{step === 1 ? `${activeCount} of ${DEMO_THREADS.length} threads` : STEPS[step].meta}</span>
        </div>

        <div className="demo-body">
          {step === 0 && (
            <div className="demo-pane">
              <div className="demo-pills" role="group" aria-label="Sample prompts">
                {DEMO_PROMPTS.map((p, idx) => (
                  <button
                    key={p.label}
                    type="button"
                    className={idx === promptIdx ? 'is-on' : ''}
                    onClick={() => setPromptIdx(idx)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <div className="demo-query">
                <span className="demo-kicker">Question</span>
                <p>{activePrompt.question}</p>
              </div>
              <div className="demo-files">
                {activePrompt.files.map((f) => (
                  <span key={f} className="demo-chip">
                    {f}
                  </span>
                ))}
              </div>
              <div className="demo-foot">
                <span>Planner estimates 36 threads · ~4 s</span>
                <button type="button" className="demo-next" onClick={() => setStep(1)}>
                  Preview map →
                </button>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="demo-pane">
              <p className="demo-hint">Toggle any line of inquiry before Facet starts reading:</p>
              <ul className="demo-threads">
                {DEMO_THREADS.map((t) => {
                  const on = !!enabled[t.id]
                  return (
                    <li key={t.id}>
                      <button
                        type="button"
                        aria-pressed={on}
                        className={`demo-thread${on ? ' is-on' : ''}`}
                        onClick={() => toggleThread(t.id)}
                      >
                        <span className="demo-check" aria-hidden="true" />
                        <span className="demo-thread-text">
                          <strong>{t.title}</strong>
                          <small>
                            {t.sources} sources · {t.time}
                          </small>
                        </span>
                        <span className="demo-state">{on ? 'Included' : 'Skipped'}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
              <div className="demo-foot">
                <span>{activeCount} threads queued in parallel</span>
                <button type="button" className="demo-next" onClick={() => setStep(2)}>
                  Read brief →
                </button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="demo-pane">
              <div className="demo-brief">
                <span className="demo-kicker">Executive brief · hover or click a citation</span>
                <p>
                  Keep predictable seat bands for European enterprise deals, paired with a pooled monthly credit allowance.
                  Pure metered billing slowed security-reviewed contracts where buyers needed a first-year cap{' '}
                  <button
                    type="button"
                    className={`cite${citeId === 1 ? ' is-on' : ''}`}
                    onMouseEnter={() => setCiteId(1)}
                    onClick={() => setCiteId(1)}
                  >
                    [1]
                  </button>
                  , while finance teams approved fixed bands in under two weeks{' '}
                  <button
                    type="button"
                    className={`cite${citeId === 2 ? ' is-on' : ''}`}
                    onMouseEnter={() => setCiteId(2)}
                    onClick={() => setCiteId(2)}
                  >
                    [2]
                  </button>
                  . Across comparable B2B AI launches, hybrid tiers delivered stronger net expansion without hurting
                  conversion{' '}
                  <button
                    type="button"
                    className={`cite${citeId === 3 ? ' is-on' : ''}`}
                    onMouseEnter={() => setCiteId(3)}
                    onClick={() => setCiteId(3)}
                  >
                    [3]
                  </button>
                  .
                </p>
              </div>
              <div className="demo-source" aria-live="polite">
                <span className="demo-source-head">
                  [{activeCite.id}] {activeCite.source}
                </span>
                <blockquote>{activeCite.quote}</blockquote>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
