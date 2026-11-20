/**
 * The Optimize sidebar section as data, then as lines for a given width.
 *
 * Split in two so the layout is testable without a renderer: `optimizeView`
 * decides what to say, `layoutOptimize` and `layoutButtons` decide where it
 * goes. The sidebar is narrow, so every wrapped value hangs under the value
 * column instead of falling back to column 0, and the buttons wrap as groups.
 */
import type { CacheImpact, MissCause } from "../balance/index.ts"
import { MISS_CAUSE_LABEL } from "../balance/index.ts"
import { fitText, SEP } from "./chip.ts"
import type { Row } from "./tokens.ts"

type Level = NonNullable<Row["level"]>

export type OptimizeSidebarInput = {
  session: {
    turns: number
    cost: number
    lastContext: number
    input: number
    cacheRead: number
    cacheWrite: number
  }
  /** This session's request rows priced by cacheImpact, when the usage log has them. */
  cache?: Pick<CacheImpact, "requests" | "saved" | "byCause">
  /** The account reusing the least cache over 24h, when below 80% (worstCacheAccount). */
  worstAccount?: { name: string; hitRate: number }
  composition?: {
    fixed: number
    instructions: number
    tools: number
    injected: number
  }
  hints: readonly Row[]
  /** Model context window; 0 when unknown. */
  contextLimit: number
}

export type StatusRow = { label: string; value: string; level?: Level }
export type AdviceItem = { text: string; level: Level }
export type OptimizeView = {
  status: StatusRow[]
  advice: AdviceItem[]
  /** The folded heading: spend, context and how many fixes are waiting. */
  summary: string
}

/** 120k, 1.2M: whole thousands read faster in a narrow column than 120.0k. */
const short = (n: number) =>
  n >= 1e6
    ? `${(n / 1e6).toFixed(1)}M`
    : n >= 1e3
      ? `${Math.round(n / 1e3)}k`
      : String(Math.round(n))

const pct = (f: number) => `${Math.round(f * 100)}%`

/** Plain words for the hint labels, which are terse internal names. */
const HINT_WORDS: Record<string, string> = {
  duplicate: "duplicate file",
  instructions: "rules/AGENTS",
  injected: "reminders",
  schema: "tool schemas",
  context: "context",
  cache: "cache",
  "re-reads": "tool output",
  subagents: "subagents",
}

/**
 * What the section says: short status values, then the ranked fixes.
 *
 * Each value says what the number means and gets a level only when it needs
 * action. Hints keep their ranking but get readable names.
 */
export function optimizeView(i: OptimizeSidebarInput): OptimizeView {
  const s = i.session
  if (s.turns === 0)
    return {
      status: [{ label: "Session", value: "no turns yet" }],
      advice: [],
      summary: "no turns yet",
    }
  const status: StatusRow[] = [
    {
      label: "Spent",
      value: `$${s.cost.toFixed(2)}${SEP}${s.turns} turn${s.turns === 1 ? "" : "s"}`,
    },
  ]

  const read = s.input + s.cacheRead + s.cacheWrite
  if (read > 0) {
    const reused = s.cacheRead / read
    const saved =
      i.cache && i.cache.requests > 0
        ? `${SEP}\u2212${pct(i.cache.saved)} cost`
        : ""
    status.push({
      label: "Cache",
      value: `${pct(reused)} hit${saved}`,
      level: reused < 0.8 ? "warn" : "ok",
    })
    const causes = Object.entries(i.cache?.byCause ?? {})
      .filter(([c]) => c !== "first-request")
      .sort((a, b) => b[1].tokens - a[1].tokens)
    if (causes.length > 0) {
      const n = causes.reduce((t, [, v]) => t + v.n, 0)
      status.push({
        label: "Misses",
        value: `${n} (${MISS_CAUSE_LABEL[causes[0]![0] as MissCause]})`,
        level: "warn",
      })
    }
  }

  const w = i.worstAccount
  if (w && w.hitRate < 0.8)
    status.push({
      label: "Worst",
      value: `${w.name} ${pct(w.hitRate)} hit (24h)`,
      level: "warn",
    })

  const ctx = s.lastContext
  status.push({
    label: "Context",
    value:
      i.contextLimit > 0
        ? `${short(ctx)} / ${short(i.contextLimit)}\u00a0\u00a0${pct(ctx / i.contextLimit)}`
        : `${short(ctx)}${ctx > 150_000 ? ", compact now" : ""}`,
    level:
      ctx > 150_000 || (i.contextLimit > 0 && ctx / i.contextLimit > 0.75)
        ? "warn"
        : "ok",
  })

  const c = i.composition
  if (c && c.fixed > 0) {
    const parts = [
      c.instructions > 0 ? `rules ${short(c.instructions)}` : "",
      c.tools > 0 ? `tools ${short(c.tools)}` : "",
    ].filter(Boolean)
    status.push({
      label: "Re-sent",
      value: `${short(c.fixed)}/turn${parts.length ? ` (${parts.join(SEP)})` : ""}`,
    })
  }

  const advice: AdviceItem[] = i.hints
    .filter((h) => h.level && h.level !== "ok")
    .slice(0, 2)
    .map((h) => ({
      text: `${HINT_WORDS[h.label] ?? h.label.trim()}: ${h.value}`,
      level: h.level!,
    }))
  if (advice.length === 0)
    advice.push({ text: "nothing stands out", level: "ok" })

  const fixes = advice.filter((a) => a.level !== "ok").length
  const summary = [
    `$${s.cost.toFixed(2)}`,
    i.contextLimit > 0
      ? `ctx ${pct(ctx / i.contextLimit)}`
      : `ctx ${short(ctx)}`,
    fixes === 0 ? "no fixes" : `${fixes} fix${fixes === 1 ? "" : "es"}`,
  ].join(SEP)
  return { status, advice, summary }
}

export type Tone = "muted" | "text" | "warn" | "critical"
export type Seg = { text: string; tone: Tone }
/** An empty line is a blank row. */
export type Line = Seg[]

export const LABEL_W = 9
const MIN_WIDTH = 20

const tone = (l?: Level): Tone =>
  l === "critical" ? "critical" : l === "warn" ? "warn" : "text"

/**
 * Greedy word wrap. A word longer than the column is cut, and a line never
 * starts or ends with the `·` separator: it is dropped where the break falls.
 */
export function wrapText(text: string, width: number): string[] {
  const w = Math.max(1, width)
  const lines: string[] = []
  let cur = ""
  const flush = () => {
    if (cur) lines.push(cur)
    cur = ""
  }
  for (const word of text.split(" ").filter(Boolean)) {
    let rest = [...word]
    while (rest.length > w) {
      flush()
      lines.push(rest.slice(0, w).join(""))
      rest = rest.slice(w)
    }
    const piece = rest.join("")
    if (!piece) continue
    if (!cur) cur = piece
    else if ([...cur].length + 1 + rest.length <= w) cur += ` ${piece}`
    else {
      flush()
      cur = piece
    }
  }
  flush()
  const dot = SEP.trim()
  return lines
    .map((l, n) =>
      (n < lines.length - 1
        ? l.replace(new RegExp(` ${dot}$`), "")
        : l
      ).replace(new RegExp(`^${dot} `), ""),
    )
    .filter(Boolean)
}

/**
 * Status rows, a blank line, then the numbered fixes. Labels are a fixed
 * column; a wrapped value or fix continues under its own first character.
 */
export function layoutOptimize(view: OptimizeView, width: number): Line[] {
  const w = Math.max(MIN_WIDTH, width)
  const out: Line[] = []
  for (const r of view.status) {
    const t = tone(r.level)
    wrapText(r.value, w - LABEL_W).forEach((text, n) =>
      out.push([
        {
          text: (n === 0 ? r.label : "").padEnd(LABEL_W),
          tone: "muted",
        },
        { text, tone: t },
      ]),
    )
  }
  if (view.advice.length > 0) out.push([])
  view.advice.forEach((a, n) => {
    const t = a.level === "ok" ? "text" : tone(a.level)
    const lead = a.level === "ok" ? "\u2713 " : `${n + 1}. `
    wrapText(a.text, w - lead.length).forEach((text, k) =>
      out.push([
        { text: k === 0 ? lead : " ".repeat(lead.length), tone: t },
        { text, tone: t },
      ]),
    )
  })
  return out
}

export type ButtonId = "plan" | "prompt" | "details" | "refresh"
export type ButtonItem =
  | { kind: "button"; id: ButtonId; label: string; primary: boolean }
  | { kind: "sep" }

/** Primary first; the two groups are the agent actions and the view actions. */
const GROUPS: { id: ButtonId; label: string; primary: boolean }[][] = [
  [
    { id: "plan", label: "fix plan", primary: true },
    { id: "prompt", label: "prompt", primary: false },
  ],
  [
    { id: "details", label: "details", primary: false },
    { id: "refresh", label: "\u21bb", primary: false },
  ],
]

const button = (b: (typeof GROUPS)[number][number]): ButtonItem => ({
  kind: "button",
  ...b,
})
// Brackets around the label; a sep is one cell. Items sit one cell apart.
const cell = (it: ButtonItem) => (it.kind === "sep" ? 1 : it.label.length + 2)
const rowWidth = (items: ButtonItem[]) =>
  items.reduce((n, it) => n + cell(it), 0) + Math.max(0, items.length - 1)

/** Greedy rows, but never a lone button on the last row when it can be avoided. */
function wrapGroup(items: ButtonItem[], width: number): ButtonItem[][] {
  const rows: ButtonItem[][] = [[]]
  for (const it of items) {
    const row = rows[rows.length - 1]!
    if (row.length > 0 && rowWidth([...row, it]) > width) rows.push([it])
    else row.push(it)
  }
  const last = rows[rows.length - 1]!
  const prev = rows[rows.length - 2]
  if (prev && last.length === 1 && prev.length > 1) last.unshift(prev.pop()!)
  return rows
}

/**
 * One row when everything fits, with a `·` between the groups. Otherwise each
 * group gets its own row, and a group wider than the sidebar wraps on its own.
 */
export function layoutButtons(width: number): ButtonItem[][] {
  const [a, b] = GROUPS.map((g) => g.map(button)) as [
    ButtonItem[],
    ButtonItem[],
  ]
  const one = [...a, { kind: "sep" } as const, ...b]
  if (rowWidth(one) <= width) return [one]
  return [...wrapGroup(a, width), ...wrapGroup(b, width)]
}

const buttonText = (items: ButtonItem[]) =>
  items
    .map((it) => (it.kind === "sep" ? SEP.trim() : `[${it.label}]`))
    .join(" ")

/** The folded section: heading and summary on one line, cut to the width. */
export function collapsedLine(
  view: OptimizeView,
  width: number,
): { head: string; note: string } {
  const head = "\u25b8 Optimize"
  return {
    head,
    note: fitText(`  ${view.summary}`, Math.max(0, width - head.length)),
  }
}

/** The whole section as plain text, for tests and for reading a layout. */
export function optimizeFrame(
  view: OptimizeView,
  width: number,
  folded = false,
): string[] {
  if (folded) {
    const c = collapsedLine(view, width)
    return [c.head + c.note]
  }
  return [
    "\u25be Optimize (this session)",
    ...layoutOptimize(view, width).map((l) => l.map((s) => s.text).join("")),
    "",
    ...layoutButtons(width).map(buttonText),
  ]
}
