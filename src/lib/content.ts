import type { GlassShape, PaletteName } from './spectral/prism'

/** 每套配色配一个界面强调色（按钮、链接、编号） */
export const ACCENT: Record<PaletteName, string> = {
  ice: '#6f9bff',
  ember: '#ff8a4c',
  aurora: '#35e0a8',
  violet: '#a97bff',
  gold: '#f0bd58',
  mono: '#e9e9e9',
}

export interface ShapePreset {
  label: string
  shape: GlassShape
  seed: number
  density: number
  thickness: number
}

/** 首屏可选预览形态（默认第一个原创球形） */
export const HERO_SHAPES: ShapePreset[] = [
  { label: 'Sphere', shape: 'sphere', seed: 0, density: 1, thickness: 1 },
  { label: 'Aperture', shape: 'aperture', seed: 0, density: 1, thickness: 1 },
  { label: 'Orbit', shape: 'orbit', seed: 0, density: 1, thickness: 1 },
  { label: 'Cube', shape: 'cube', seed: 0, density: 1, thickness: 1 },
]

export interface PillarItem {
  code: string
  tag: string
  title: string
  body: string
  ticks: string[]
  preset: ShapePreset
}

/** 中段单屏玻璃叙事模块：把原本三屏拆解合并成一块可点切的双栏舞台 */
export const PILLARS: PillarItem[] = [
  {
    code: '01',
    tag: 'Decompose',
    title: 'One question, fanned into thirty-six.',
    body: 'Before it reads anything, Facet plans. Your question becomes a spread of narrower ones that run side by side.',
    ticks: [
      'Inspect the plan before a single page is opened',
      'Drop a thread or add the angle it missed',
      'Parallel execution instead of slow linear loops',
    ],
    preset: { label: 'Fan', shape: 'fan', seed: 0, density: 1, thickness: 1 },
  },
  {
    code: '02',
    tag: 'Converge',
    title: 'Everything points back to one brief.',
    body: 'Findings across every thread are cross-checked, contradictions are flagged, and what survives is written cleanly.',
    ticks: [
      'Conflicting sources shown side by side',
      'Every claim linked to the passage behind it',
      'Export to Markdown, Docs or pull requests',
    ],
    preset: { label: 'Ring', shape: 'ring', seed: 0, density: 1, thickness: 1 },
  },
  {
    code: '03',
    tag: 'Trace',
    title: 'Follow every claim down to the source.',
    body: 'Each statement is locked to its original passage inside an encrypted workspace — never used to train any model.',
    ticks: [
      'Inline citations checked against source text',
      'Per-workspace encryption with zero retention',
      'Audit trail ready for legal and policy review',
    ],
    preset: { label: 'Burst', shape: 'burst', seed: 3, density: 0.85, thickness: 0.9 },
  },
]

export const NAV: { label: string; href: string }[] = [
  { label: 'Workflow', href: '#demo' },
  { label: 'Architecture', href: '#architecture' },
  { label: 'Features', href: '#features' },
  { label: 'Pricing', href: '#pricing' },
  { label: 'Docs', href: '#docs' },
]

export const STATS: [string, string][] = [
  ['36', 'parallel threads per question'],
  ['4.2 s', 'median time to first draft'],
  ['100%', 'of claims carry a citation'],
]

export const LOGOS = ['Northwind', 'Halcyon', 'Meridian Labs', 'Oakline', 'Vantor', 'Quillon']

export const FEATURES: [string, string][] = [
  ['Parallel threads', 'A question is split into independent lines of inquiry that run at the same time, so depth does not cost you an afternoon.'],
  ['Line-level citations', 'Every sentence in the brief links to the passage it came from. Hover to read the source without leaving the page.'],
  ['Private by default', 'Your documents are never used for training, and each workspace is encrypted with its own key.'],
  ['Bring your own model', 'Route threads to the model that suits them: a fast one for reading, a careful one for the final draft.'],
  ['Team workspaces', 'Share briefs, pin sources and leave comments. Everyone sees the same map of what was read and why.'],
  ['API and webhooks', 'Start a run from your own tools and get the finished brief delivered as Markdown, JSON or a pull request.'],
]

export const STEPS: { id: string; title: string; body: string; meta: string }[] = [
  {
    id: 'ask',
    title: 'Ask',
    body: 'Write the question the way you would ask a colleague. Attach files or point Facet at a folder.',
    meta: '3 files · 28 web sources',
  },
  {
    id: 'map',
    title: 'Review the map',
    body: 'Facet shows the threads it plans to follow. Drop the ones you do not need, add the angle it missed.',
    meta: '4 active lines of inquiry',
  },
  {
    id: 'brief',
    title: 'Ship the brief',
    body: 'A few seconds later you have a draft with sources attached. Edit it, export it, or send it on.',
    meta: 'Verified · 3 inline citations',
  },
]

export const DEMO_PROMPTS = [
  {
    label: 'Enterprise pricing',
    question: 'Should we move from seat-based pricing to usage tiers before launching in Europe next quarter?',
    files: ['Q3_Pricing_Memo.pdf', 'EU_Enterprise_Calls.md', '28 live sources'],
  },
  {
    label: 'AI regulation',
    question: 'Which EU AI Act obligations apply to an internal research agent deployed across regulated banks?',
    files: ['EU_AI_Act_Ch4.pdf', 'Compliance_Checklist.xlsx', '19 live sources'],
  },
]

export const DEMO_THREADS = [
  { id: 't1', title: 'Peer pricing benchmarks across 14 B2B AI tools', sources: 11, time: '1.4 s', defaultOn: true },
  { id: 't2', title: 'Procurement friction in annual EU enterprise contracts', sources: 8, time: '1.9 s', defaultOn: true },
  { id: 't3', title: 'Gross margin sensitivity under high-volume burst usage', sources: 6, time: '2.1 s', defaultOn: true },
  { id: 't4', title: 'Historical churn after hybrid tier migrations (2024–2026)', sources: 5, time: '1.7 s', defaultOn: false },
]

export const DEMO_CITATIONS = [
  {
    id: 1,
    source: 'Q3_Pricing_Memo.pdf · p. 6',
    quote: '“71% of security-reviewed deals stalled when spend could not be capped in the first year.”',
  },
  {
    id: 2,
    source: 'EU_Enterprise_Calls.md · Call #14',
    quote: '“Finance signs off in two weeks for predictable seat bands; metered overages go to committee.”',
  },
  {
    id: 3,
    source: 'Meridian SaaS Index 2026 · Table 4',
    quote: '“Hybrid seat + pooled credit models retained 18% higher net dollar expansion than pure metering.”',
  },
]

export interface Plan {
  name: string
  monthly: string
  annual: string
  noteMonthly: string
  noteAnnual: string
  cta: string
  featured?: boolean
  items: string[]
}

export const PLANS: Plan[] = [
  {
    name: 'Solo',
    monthly: '$0',
    annual: '$0',
    noteMonthly: 'forever',
    noteAnnual: 'forever',
    cta: 'Start free',
    items: ['20 runs a month', '12 threads per run', 'Web and PDF sources', 'Markdown export'],
  },
  {
    name: 'Team',
    monthly: '$24',
    annual: '$19',
    noteMonthly: 'per seat / month',
    noteAnnual: 'per seat / mo · billed yearly',
    cta: 'Start 14-day trial',
    featured: true,
    items: ['Unlimited runs', '36 threads per run', 'Shared workspaces', 'Drive, Notion and Slack', 'Priority models'],
  },
  {
    name: 'Scale',
    monthly: 'Custom',
    annual: 'Custom',
    noteMonthly: 'annual',
    noteAnnual: 'annual · volume pricing',
    cta: 'Talk to us',
    items: ['Everything in Team', 'Single sign-on and audit log', 'Bring your own model', 'Dedicated region', 'Named support engineer'],
  },
]

export const FOOT: [string, string[]][] = [
  ['Product', ['Overview', 'Workflow', 'Architecture', 'Pricing', 'Changelog']],
  ['Developers', ['Docs', 'API reference', 'Webhooks', 'Status']],
  ['Company', ['About', 'Customers', 'Careers', 'Contact']],
  ['Legal', ['Privacy', 'Terms', 'Security', 'DPA']],
]

export const FAQ: [string, string][] = [
  ['How is this different from a chatbot?', 'A chatbot answers from one pass over a few pages. Facet plans the research first, runs many threads side by side, and only then writes, so the brief covers angles a single pass would miss.'],
  ['Can I see what it read?', 'Yes. The map lists every thread and every source it opened, including the ones it decided not to use and why.'],
  ['Which models does it use?', 'Facet ships with a default pair of models and lets Team and Scale plans choose their own for each stage.'],
  ['Is my data used for training?', 'No. Your questions, files and briefs stay in your workspace and are never used to train any model.'],
  ['Can I cancel at any time?', 'Yes. Plans are monthly unless you choose annual billing, and you keep access until the end of the period you paid for.'],
]
