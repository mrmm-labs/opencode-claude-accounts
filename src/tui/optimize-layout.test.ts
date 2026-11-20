import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  collapsedLine,
  LABEL_W,
  layoutButtons,
  layoutOptimize,
  optimizeFrame,
  optimizeView,
  wrapText,
  type ButtonItem,
  type OptimizeSidebarInput,
  type OptimizeView,
} from "./optimize-layout.ts"

const session = {
  turns: 18,
  cost: 2.92,
  lastContext: 326_600,
  input: 1_000,
  cacheRead: 90_000,
  cacheWrite: 5_000,
}

const full: OptimizeSidebarInput = {
  session,
  cache: {
    requests: 18,
    saved: 0.83,
    byCause: {
      "first-request": { n: 1, tokens: 9_000 },
      "prefix-change": { n: 2, tokens: 50_000 },
    },
  },
  composition: {
    fixed: 38_000,
    instructions: 33_000,
    tools: 5_000,
    injected: 0,
  },
  hints: [
    {
      label: "subagents",
      value: "73% of reads: brief them tighter",
      level: "warn",
    },
    {
      label: "context",
      value: "326.6k: compact or start fresh",
      level: "warn",
    },
    { label: "hints", value: "x", level: "ok" },
  ],
  contextLimit: 400_000,
}

const by = (v: OptimizeView) =>
  Object.fromEntries(v.status.map((r) => [r.label, r]))

describe("optimizeView", () => {
  it("says each status in a short value and ranks the fixes", () => {
    const v = optimizeView(full)
    const s = by(v)
    assert.equal(s.Spent!.value, "$2.92 \u00b7 18 turns")
    assert.equal(s.Cache!.value, "94% hit \u00b7 \u221283% cost")
    assert.equal(s.Cache!.level, "ok")
    assert.match(s.Misses!.value, /^2 \(.+\)$/)
    assert.equal(s.Context!.value, "327k / 400k\u00a0\u00a082%")
    assert.equal(s.Context!.level, "warn")
    assert.equal(s["Re-sent"]!.value, "38k/turn (rules 33k \u00b7 tools 5k)")
    assert.deepEqual(
      v.advice.map((a) => a.text),
      [
        "subagents: 73% of reads: brief them tighter",
        "context: 326.6k: compact or start fresh",
      ],
    )
    assert.equal(v.summary, "$2.92 \u00b7 ctx 82% \u00b7 2 fixes")
  })

  it("warns on a cold cache and a full context, and says when nothing stands out", () => {
    const v = optimizeView({
      session: {
        ...session,
        lastContext: 170_000,
        cacheRead: 10_000,
        cacheWrite: 80_000,
      },
      hints: [],
      contextLimit: 0,
    })
    assert.equal(by(v).Cache!.level, "warn")
    assert.equal(by(v).Context!.value, "170k, compact now")
    assert.deepEqual(v.advice, [{ text: "nothing stands out", level: "ok" }])
    assert.equal(v.summary, "$2.92 \u00b7 ctx 170k \u00b7 no fixes")
  })

  it("names the worst account only below 80%", () => {
    const base = { session, hints: [], contextLimit: 0 }
    const v = optimizeView({
      ...base,
      worstAccount: { name: "Team 2", hitRate: 0.42 },
    })
    assert.equal(by(v).Worst!.value, "Team 2 42% hit (24h)")
    assert.equal(
      by(optimizeView({ ...base, worstAccount: { name: "T", hitRate: 0.9 } }))
        .Worst,
      undefined,
    )
  })

  it("has one row before the first turn", () => {
    const v = optimizeView({
      session: { ...session, turns: 0 },
      hints: [],
      contextLimit: 0,
    })
    assert.deepEqual(v.status, [{ label: "Session", value: "no turns yet" }])
    assert.deepEqual(v.advice, [])
    assert.equal(v.summary, "no turns yet")
  })
})

describe("wrapText", () => {
  it("fits short text on one line", () => {
    assert.deepEqual(wrapText("$2.92 \u00b7 18 turns", 20), [
      "$2.92 \u00b7 18 turns",
    ])
  })

  it("wraps at spaces and cuts a word longer than the column", () => {
    assert.deepEqual(wrapText("aa bb cc", 5), ["aa bb", "cc"])
    assert.deepEqual(wrapText("abcdefghij", 4), ["abcd", "efgh", "ij"])
  })

  it("never starts or ends a line with the separator", () => {
    const lines = wrapText("aaaa \u00b7 bbbb \u00b7 cccc", 6)
    assert.deepEqual(lines, ["aaaa", "bbbb", "cccc"])
  })
})

describe("layoutOptimize", () => {
  const text = (v: OptimizeView, w: number) =>
    layoutOptimize(v, w).map((l) => l.map((s) => s.text).join(""))

  it("hangs wrapped values under the value column, never at column 0", () => {
    const lines = text(optimizeView(full), 28)
    const i = lines.findIndex((l) => l.startsWith("Re-sent"))
    assert.ok(lines[i + 1]!.startsWith(" ".repeat(LABEL_W)))
    assert.ok(lines[i + 1]!.trim().length > 0)
    const adviceAt = lines.indexOf("") + 1
    for (const l of lines.slice(adviceAt)) {
      assert.match(l, /^(\d\. |\u2713 | {3})\S/)
    }
  })

  for (const w of [26, 32, 40]) {
    it(`fits width ${w} and keeps a blank line between status and fixes`, () => {
      const lines = text(optimizeView(full), w)
      for (const l of lines) assert.ok([...l].length <= w, `${w}: "${l}"`)
      assert.equal(lines.filter((l) => l === "").length, 1)
      assert.ok(lines.indexOf("") > 0)
      assert.match(lines[lines.indexOf("") + 1]!, /^1\. /)
    })
  }

  it("fits all five status rows on one line each at width 40", () => {
    const lines = text(optimizeView(full), 40)
    assert.equal(lines.indexOf(""), 5)
  })

  it("colours fixes and leaves labels muted", () => {
    const lines = layoutOptimize(optimizeView(full), 40)
    assert.equal(lines[0]![0]!.tone, "muted")
    const fix = lines.find((l) => l[0]?.text === "1. ")!
    assert.equal(fix[0]!.tone, "warn")
    assert.equal(fix[1]!.tone, "warn")
  })

  it("has no blank line when there are no fixes to list", () => {
    const v = optimizeView({
      session: { ...session, turns: 0 },
      hints: [],
      contextLimit: 0,
    })
    assert.deepEqual(text(v, 32), ["Session  no turns yet"])
  })
})

describe("layoutButtons", () => {
  const ids = (rows: ButtonItem[][]) =>
    rows.map((r) =>
      r.map((i) => (i.kind === "sep" ? "\u00b7" : i.id)).join(" "),
    )

  it("puts everything on one row with a separator when it fits", () => {
    assert.deepEqual(ids(layoutButtons(40)), [
      "plan prompt \u00b7 details refresh",
    ])
  })

  it("wraps as whole groups at 32 and 26, primary first", () => {
    const want = ["plan prompt", "details refresh"]
    assert.deepEqual(ids(layoutButtons(32)), want)
    assert.deepEqual(ids(layoutButtons(26)), want)
  })

  it("only the first button is primary", () => {
    const flat = layoutButtons(26).flat()
    const primaries = flat.filter((i) => i.kind === "button" && i.primary)
    assert.equal(primaries.length, 1)
    assert.equal(flat[0]!.kind === "button" && flat[0]!.primary, true)
  })

  it("never leaves a single button alone below a pair", () => {
    for (const w of [14, 16, 20, 22]) {
      const rows = layoutButtons(w)
      const buttons = rows.map((r) => r.filter((i) => i.kind === "button"))
      const last = buttons[buttons.length - 1]!
      if (buttons.length > 1 && last.length === 1)
        assert.equal(buttons[buttons.length - 2]!.length, 1, `width ${w}`)
    }
  })
})

describe("collapsedLine", () => {
  it("is one line with the summary", () => {
    const c = collapsedLine(
      optimizeView({ ...full, hints: [full.hints[0]!] }),
      40,
    )
    assert.equal(
      c.head + c.note,
      "\u25b8 Optimize  $2.92 \u00b7 ctx 82% \u00b7 1 fix",
    )
  })

  it("is cut to the width", () => {
    const c = collapsedLine(optimizeView(full), 24)
    assert.equal([...(c.head + c.note)].length, 24)
    assert.ok(c.note.endsWith("\u2026"))
  })
})

describe("optimizeFrame", () => {
  it("folded is a single line", () => {
    assert.equal(optimizeFrame(optimizeView(full), 40, true).length, 1)
  })
})
