import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"

import {
  commandsTable,
  commandsWith,
  dispatch,
  helpOptions,
  matchOption,
  menuOptions,
  parse,
  SPECS,
  usage,
  walk,
  windowMs,
  type Args,
  type CommandName,
  type Dialogs,
  type Live,
  type Option,
} from "./commands.ts"

const TARGETS: Option[] = [
  { title: "Team 1", value: "s1", aliases: ["Acme 1", "Team 1"] },
  { title: "Team 2", value: "s2", aliases: ["Acme 2", "Team 2"] },
  { title: "Team 2 alt", value: "s4", aliases: ["Acme 2 alt", "Team 2"] },
  { title: "Rotate", value: "preset:rr", aliases: ["rr", "Rotate"] },
  { title: "Auto", value: "__auto__", aliases: ["auto"] },
  { title: "Clear selection", value: "__clear__", aliases: ["clear"] },
]
const SETTINGS: Option[] = [
  { title: "Strategy: sticky", value: "strategy", aliases: ["strategy"] },
  { title: "Switch at: 0.95", value: "switchAt", aliases: ["switchAt"] },
]
const live: Live = {
  targets: () => TARGETS,
  currentTarget: () => "s1",
  settings: () => SETTINGS,
  settingValues: (key) =>
    key === "strategy"
      ? [
          { title: "sticky", value: "sticky" },
          { title: "least-used", value: "least-used" },
        ]
      : [],
  settingNow: (key) => (key === "switchAt" ? "0.95" : "sticky"),
  flag: (name) => (name === "credits" ? "allow" : "off"),
}

type Call =
  | { kind: "select"; title: string; options: Option[]; current?: string }
  | { kind: "prompt"; title: string; value?: string }
  | { kind: "toast"; message: string }
  | { kind: "close" }

/** Answers the dialogs in order; `undefined` is escape. */
function fakeDialogs(answers: (string | undefined)[]) {
  const calls: Call[] = []
  const io: Dialogs = {
    async select(o) {
      calls.push({ kind: "select", ...o })
      return answers.shift()
    },
    async prompt(o) {
      calls.push({ kind: "prompt", title: o.title, value: o.value })
      return answers.shift()
    },
    toast: (message) => calls.push({ kind: "toast", message }),
    close: () => calls.push({ kind: "close" }),
  }
  return { io, calls, left: () => answers.length }
}

const kinds = (calls: Call[]) => calls.map((c) => c.kind)

function registry() {
  const ran: { name: string; args: Args }[] = []
  const runs = Object.fromEntries(
    SPECS.map((s) => [
      s.name,
      (args: Args) => void ran.push({ name: s.name, args }),
    ]),
  ) as Record<CommandName, (args: Args) => void>
  return { commands: commandsWith(runs), ran }
}

const command = (input: string) => {
  const p = parse(input, live)
  assert.equal(p.kind, "command", input)
  return p as Extract<typeof p, { kind: "command" }>
}

describe("matchOption", () => {
  it("prefers exact, then a unique prefix, then a unique fragment", () => {
    assert.equal(
      (matchOption("auto", TARGETS) as { option: Option }).option.value,
      "__auto__",
    )
    assert.equal(
      (matchOption("ro", TARGETS) as { option: Option }).option.value,
      "preset:rr",
    )
    assert.equal(
      (matchOption("cle", TARGETS) as { option: Option }).option.value,
      "__clear__",
    )
    assert.equal(
      (matchOption("acme 1", TARGETS) as { option: Option }).option.value,
      "s1",
    )
  })

  it("reports several equal hits instead of picking one", () => {
    const m = matchOption("team 2", TARGETS)
    assert.equal(m.ok, false)
    assert.deepEqual(
      (m as { candidates: Option[] }).candidates.map((o) => o.value),
      ["s2", "s4"],
    )
  })

  it("has no candidates when nothing matches", () => {
    assert.deepEqual(matchOption("zzz", TARGETS), { ok: false, candidates: [] })
  })
})

describe("parse", () => {
  it("shows every sub-command for empty input", () => {
    for (const input of [undefined, "", "   "]) {
      const p = parse(input, live)
      assert.equal(p.kind, "menu")
      assert.equal((p as { matches: unknown[] }).matches.length, SPECS.length)
    }
  })

  it("reads a full typed form", () => {
    const p = command("switch auto")
    assert.equal(p.spec.name, "switch")
    assert.deepEqual(p.args, { target: "__auto__" })
    assert.equal(p.invalid, undefined)
    assert.deepEqual(command("stats 7d").args, { window: "7d" })
    assert.deepEqual(command("config strategy least-used").args, {
      setting: "strategy",
      value: "least-used",
    })
  })

  it("lets the last argument take the rest of the line, spaces included", () => {
    assert.deepEqual(command("switch Acme 1").args, { target: "s1" })
    assert.deepEqual(command("config switchAt 90%").args, {
      setting: "switchAt",
      value: "90%",
    })
  })

  it("accepts a unique sub-command prefix and runs it", () => {
    assert.equal(command("sw auto").spec.name, "switch")
    assert.equal(command("opt").spec.name, "optimize")
    assert.equal(command("t").spec.name, "tokens")
  })

  it("keeps an exact name even when it is also a prefix", () => {
    const only = [
      { ...SPECS[0], name: "a" },
      { ...SPECS[0], name: "ab" },
    ]
    const p = parse("a", live, only)
    assert.equal(p.kind, "command")
  })

  it("opens a filtered menu for an ambiguous prefix", () => {
    const p = parse("s", live)
    assert.equal(p.kind, "menu")
    assert.deepEqual(
      (p as { matches: { name: string }[] }).matches.map((m) => m.name),
      ["switch", "stats"],
    )
    assert.deepEqual(
      (parse("c", live) as { matches: { name: string }[] }).matches.map(
        (m) => m.name,
      ),
      ["credits", "cache", "config"],
    )
  })

  it("flags an unknown sub-command", () => {
    assert.deepEqual(parse("zzz", live), { kind: "unknown", query: "zzz" })
  })

  it("keeps what parsed and flags the first invalid value", () => {
    const p = command("config nope 1")
    assert.deepEqual(p.args, {})
    assert.equal(p.invalid?.arg.name, "setting")
    assert.equal(p.invalid?.raw, "nope")
    assert.equal(p.invalid?.candidates.length, SETTINGS.length)

    const w = command("stats 99h")
    assert.equal(w.invalid?.arg.name, "window")
    assert.deepEqual(
      w.invalid?.candidates.map((o) => o.value),
      ["1h", "6h", "24h", "7d"],
    )
  })

  it("narrows an ambiguous account to its candidates", () => {
    const p = command("switch Team 2")
    assert.equal(p.invalid?.arg.name, "target")
    assert.deepEqual(
      p.invalid?.candidates.map((o) => o.value),
      ["s2", "s4"],
    )
  })

  it("reports arguments it has no place for", () => {
    assert.deepEqual(command("tokens now").extra, ["now"])
    assert.deepEqual(command("stats 1h more").extra, ["more"])
  })
})

describe("walk", () => {
  const spec = (name: string) => SPECS.find((s) => s.name === name)!

  it("asks only for what is missing, in order: a pick, then typed text", async () => {
    const d = fakeDialogs(["switchAt", "0.9"])
    const args = await walk(spec("config"), { args: {} }, d.io, live, false)
    assert.deepEqual(args, { setting: "switchAt", value: "0.9" })
    assert.deepEqual(kinds(d.calls), ["select", "prompt"])
    // The prompt is prefilled with the setting's current value.
    assert.equal((d.calls[1] as { value?: string }).value, "0.95")
  })

  it("offers a setting's choices as a pick, with the current one marked", async () => {
    const d = fakeDialogs(["least-used"])
    const args = await walk(
      spec("config"),
      { args: { setting: "strategy" } },
      d.io,
      live,
      false,
    )
    assert.deepEqual(args, { setting: "strategy", value: "least-used" })
    const call = d.calls[0] as Extract<Call, { kind: "select" }>
    assert.deepEqual(
      call.options.map((o) => o.value),
      ["sticky", "least-used"],
    )
    assert.equal(call.current, "sticky")
  })

  it("marks the current account in the switch picker", async () => {
    const d = fakeDialogs(["s2"])
    await walk(spec("switch"), { args: {} }, d.io, live, false)
    assert.equal((d.calls[0] as { current?: string }).current, "s1")
  })

  it("cancels cleanly at any step", async () => {
    for (const answers of [[undefined], ["switchAt", undefined]]) {
      const d = fakeDialogs([...answers])
      const args = await walk(spec("config"), { args: {} }, d.io, live, false)
      assert.equal(args, undefined)
    }
  })

  it("skips optional arguments when typed and asks when picked", async () => {
    const typed = fakeDialogs([])
    assert.deepEqual(
      await walk(spec("stats"), { args: {} }, typed.io, live, false),
      { window: "24h" },
    )
    assert.deepEqual(typed.calls, [])

    const picked = fakeDialogs(["7d"])
    assert.deepEqual(
      await walk(spec("stats"), { args: {} }, picked.io, live, true),
      { window: "7d" },
    )
    assert.equal((picked.calls[0] as { current?: string }).current, "24h")
  })

  it("re-asks for an empty required text value", async () => {
    const d = fakeDialogs(["  ", "0.8"])
    const args = await walk(
      spec("config"),
      { args: { setting: "switchAt" } },
      d.io,
      live,
      false,
    )
    assert.equal(args?.value, "0.8")
    assert.deepEqual(kinds(d.calls), ["prompt", "toast", "prompt"])
  })

  it("toasts the valid values for an invalid one, then reopens that picker", async () => {
    const d = fakeDialogs(["1h"])
    const p = command("stats 99h")
    const args = await walk(p.spec, p, d.io, live, false)
    assert.deepEqual(args, { window: "1h" })
    assert.deepEqual(kinds(d.calls), ["toast", "select"])
    const toast = (d.calls[0] as { message: string }).message
    assert.match(toast, /"99h" is not a valid window/)
    assert.match(toast, /1h, 6h, 24h, 7d/)
  })
})

describe("dispatch", () => {
  it("lists the sub-commands for /claude, then walks the picked one's arguments", async () => {
    const { commands, ran } = registry()
    const d = fakeDialogs(["switch", "__auto__"])
    await dispatch("", { commands, live, io: d.io })
    assert.deepEqual(kinds(d.calls), ["select", "select", "close"])
    const menu = d.calls[0] as Extract<Call, { kind: "select" }>
    assert.deepEqual(
      menu.options.map((o) => o.title),
      SPECS.map((s) => s.name),
    )
    assert.equal(
      menu.options[0]!.footer,
      "/claude switch <account|preset|auto|clear>",
    )
    assert.ok(menu.options.every((o) => o.category && o.description))
    assert.deepEqual(ran, [{ name: "switch", args: { target: "__auto__" } }])
  })

  it("asks optional arguments when the sub-command came from the picker", async () => {
    const { commands, ran } = registry()
    const d = fakeDialogs(["stats", "7d"])
    await dispatch(undefined, { commands, live, io: d.io })
    assert.deepEqual(ran, [{ name: "stats", args: { window: "7d" } }])
  })

  it("runs a fully typed command with no dialogs", async () => {
    const { commands, ran } = registry()
    const d = fakeDialogs([])
    await dispatch("switch auto", { commands, live, io: d.io })
    assert.deepEqual(d.calls, [])
    assert.deepEqual(ran, [{ name: "switch", args: { target: "__auto__" } }])
    await dispatch("stats", { commands, live, io: d.io })
    assert.deepEqual(ran[1], { name: "stats", args: { window: "24h" } })
  })

  it("prompts only the missing arguments of a known sub-command", async () => {
    const { commands, ran } = registry()
    const d = fakeDialogs(["0.9"])
    await dispatch("config switchAt", { commands, live, io: d.io })
    assert.deepEqual(kinds(d.calls), ["prompt", "close"])
    assert.deepEqual(ran, [
      { name: "config", args: { setting: "switchAt", value: "0.9" } },
    ])
  })

  it("offers only the matches of an ambiguous prefix", async () => {
    const { commands, ran } = registry()
    const d = fakeDialogs(["stats", "24h"])
    await dispatch("s", { commands, live, io: d.io })
    const menu = d.calls[0] as Extract<Call, { kind: "select" }>
    assert.deepEqual(
      menu.options.map((o) => o.value),
      ["switch", "stats"],
    )
    assert.equal(ran[0]?.name, "stats")
  })

  it("toasts an unknown name and still offers the list", async () => {
    const { commands, ran } = registry()
    const d = fakeDialogs([undefined])
    await dispatch("zzz", { commands, live, io: d.io })
    assert.deepEqual(kinds(d.calls), ["toast", "select"])
    assert.match(
      (d.calls[0] as { message: string }).message,
      /Unknown sub-command "zzz"/,
    )
    assert.deepEqual(ran, [])
  })

  it("does nothing when escape is pressed at the list or at an argument", async () => {
    for (const answers of [
      [undefined],
      ["switch", undefined],
      ["config", "switchAt", undefined],
    ]) {
      const { commands, ran } = registry()
      const d = fakeDialogs([...answers])
      await dispatch("", { commands, live, io: d.io })
      assert.deepEqual(ran, [])
      assert.ok(!kinds(d.calls).includes("close"))
    }
  })

  it("refuses extra words with the usage line and runs nothing", async () => {
    const { commands, ran } = registry()
    const d = fakeDialogs([])
    await dispatch("tokens now", { commands, live, io: d.io })
    assert.deepEqual(ran, [])
    assert.match(
      (d.calls[0] as { message: string }).message,
      /Usage: \/claude tokens$/,
    )
  })

  it("reopens a bad typed value's picker and runs with the choice", async () => {
    const { commands, ran } = registry()
    const d = fakeDialogs(["s2"])
    await dispatch("switch Team 2", { commands, live, io: d.io })
    assert.deepEqual(kinds(d.calls), ["toast", "select", "close"])
    const select = d.calls[1] as Extract<Call, { kind: "select" }>
    assert.deepEqual(
      select.options.map((o) => o.value),
      ["s2", "s4"],
    )
    assert.deepEqual(ran, [{ name: "switch", args: { target: "s2" } }])
  })
})

describe("registry", () => {
  it("has unique names and a usage line each", () => {
    const names = SPECS.map((s) => s.name)
    assert.equal(new Set(names).size, names.length)
    for (const s of SPECS) assert.match(usage(s), /^\/claude [a-z]+/)
    assert.equal(
      usage(SPECS.find((s) => s.name === "stats")!),
      "/claude stats [1h|6h|24h|7d]",
    )
  })

  it("generates the help rows from the registry", () => {
    const rows = helpOptions()
    assert.equal(rows.length, SPECS.length)
    assert.deepEqual(
      rows.map((r) => r.title),
      SPECS.map((s) => usage(s)),
    )
    assert.ok(rows.every((r) => r.description && r.category))
    assert.deepEqual(
      menuOptions(SPECS).map((o) => o.footer),
      SPECS.map((s) => usage(s)),
    )
  })

  it("has every old command as a sub-command", () => {
    for (const name of [
      "switch",
      "accounts",
      "presets",
      "stats",
      "tokens",
      "cache",
      "optimize",
      "debug",
      "requests",
      "config",
      "help",
    ])
      assert.ok(
        SPECS.some((s) => s.name === name),
        name,
      )
  })

  it("reads windows, defaulting to 24h", () => {
    assert.equal(windowMs("1h"), 3_600_000)
    assert.equal(windowMs("7d"), 604_800_000)
    assert.equal(windowMs(undefined), 86_400_000)
    assert.equal(windowMs("nonsense"), 86_400_000)
  })

  it("is the table in the README", () => {
    const readme = readFileSync(
      new URL("../../README.md", import.meta.url),
      "utf-8",
    )
    const m = readme.match(
      /<!-- commands:start -->\s*([\s\S]*?)\s*<!-- commands:end -->/,
    )
    assert.ok(m, "README has the commands markers")
    assert.equal(
      m![1],
      commandsTable(),
      "README Commands table is out of date; replace it with:\n" +
        commandsTable(),
    )
  })

  it("registers exactly one slash entry, and it keeps its arguments", () => {
    const tui = readFileSync(
      new URL("../../tui/claude-auth-tui.tsx", import.meta.url),
      "utf-8",
    )
    assert.equal(tui.match(/slashName:\s/g)?.length, 1)
    assert.match(tui, /slashName: SLASH,\s+slashArguments: true,/)
    assert.equal(tui.match(/\bslash:\s*\{/g), null)
  })
})
