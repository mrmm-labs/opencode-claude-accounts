import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { DEFAULT_CONFIG, sanitize } from "./config.ts"
import { expand, trimPrompt, trimText } from "./prompt-trim.ts"

const PROMPT = [
  "You are the builder.",
  "",
  "Instructions from: /repo/AGENTS.md",
  "repo rules",
  "",
  "Instructions from: /home/notes/style.md",
  "style rules",
  "",
  "Here is some useful information about the environment you are running in:",
  "<env>cwd</env>",
  "",
  "READER MODE ACTIVE",
  "be brief for a human",
  "",
  "SPEED TIPS",
  "use direct urls",
].join("\n")

const sections = [
  ...DEFAULT_CONFIG.promptSections,
  "READER MODE ACTIVE",
  "SPEED TIPS",
]

describe("trimText", () => {
  it("drops exactly the matching sections and keeps the rest in order", () => {
    const r = trimText(PROMPT, sections, [
      "Instructions from: /home/notes/",
      "READER MODE ACTIVE",
    ])
    assert.equal(
      r.text,
      [
        "You are the builder.",
        "",
        "Instructions from: /repo/AGENTS.md",
        "repo rules",
        "",
        "Here is some useful information about the environment you are running in:",
        "<env>cwd</env>",
        "",
        "SPEED TIPS",
        "use direct urls",
      ].join("\n"),
    )
    assert.deepEqual(
      r.dropped.map((d) => d.head),
      ["Instructions from: /home/notes/style.md", "READER MODE ACTIVE"],
    )
    assert.equal(
      r.dropped.reduce((n, d) => n + d.bytes, 0),
      Buffer.byteLength(PROMPT) - Buffer.byteLength(r.text),
    )
  })

  it("never drops the text before the first section", () => {
    const r = trimText(PROMPT, sections, ["You are"])
    assert.equal(r.text, PROMPT)
    assert.deepEqual(r.dropped, [])
  })

  it("a dropped section runs to the next known section start", () => {
    const r = trimText(PROMPT, DEFAULT_CONFIG.promptSections, [
      "Here is some useful",
    ])
    assert.ok(r.text.endsWith("style rules\n"))
  })
})

describe("trimPrompt", () => {
  const config = {
    sections,
    trim: { "*": ["READER MODE ACTIVE"], build: [] },
  }
  const body = () => ({ system: [{ type: "text", text: PROMPT }] })

  it("trims a subagent through the * entry", () => {
    const b = body()
    assert.equal(trimPrompt(b, "general", config).length, 1)
    assert.ok(!b.system[0].text.includes("be brief"))
  })

  it("leaves an exempt agent and agentless requests alone", () => {
    for (const agent of ["build", null]) {
      const b = body()
      assert.deepEqual(trimPrompt(b, agent, config), [])
      assert.equal(b.system[0].text, PROMPT)
    }
  })

  it("trims a string system prompt too", () => {
    const b = { system: PROMPT }
    trimPrompt(b, "general", config)
    assert.ok(!b.system.includes("be brief"))
  })
})

describe("named lists", () => {
  it("expands @name references, once each, and never treats them as agents", () => {
    const trim = {
      "@a": ["A", "@b"],
      "@b": ["B", "@a"],
      "*": ["@a", "C"],
    }
    assert.deepEqual(expand(trim, trim["*"]), ["A", "B", "C"])
    const b = { system: PROMPT }
    assert.deepEqual(trimPrompt(b, "@a", { sections, trim }), [])
  })

  it("lets one agent reuse a list the * entry also uses", () => {
    const trim = {
      "@reader": ["READER MODE ACTIVE"],
      "@notes": ["Instructions from: /home/notes/"],
      "*": ["@reader", "@notes"],
      writer: ["@reader"],
    }
    const w = { system: PROMPT }
    trimPrompt(w, "writer", { sections, trim })
    assert.ok(
      w.system.includes("style rules") && !w.system.includes("be brief"),
    )
    const g = { system: PROMPT }
    trimPrompt(g, "general", { sections, trim })
    assert.ok(
      !g.system.includes("style rules") && !g.system.includes("be brief"),
    )
  })
})

describe("config", () => {
  it("keeps valid lists, an empty exemption, and drops bad entries", () => {
    const c = sanitize({
      promptSections: ["A", "B"],
      promptTrim: { "*": ["A"], build: [], bad: [1], worse: "A" },
    })
    assert.deepEqual(c.promptSections, ["A", "B"])
    assert.deepEqual(c.promptTrim, { "*": ["A"], build: [] })
    assert.equal(sanitize({ promptSections: [""] }).promptSections, undefined)
  })
})
