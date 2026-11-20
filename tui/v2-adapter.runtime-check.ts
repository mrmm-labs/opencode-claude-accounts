// Runtime check of the V2 adapter shim: run with `bun tui/v2-adapter.runtime-check.ts`.
// Type-checking cannot catch a member missing at runtime, which is how the
// "api.event.on" crash shipped, so this drives the adapter with a fake V2 context.
import assert from "node:assert/strict"

import { setupV2 } from "./v2-adapter.tsx"

const prompts: unknown[] = []
const synced: string[] = []
let loaded = false
const ctx = {
  options: {},
  location: { directory: "/repo" },
  theme: {},
  ui: { toast: { show() {} }, dialog: {}, slot() {} },
  keymap: { layer() {} },
  client: {
    session: {
      prompt: async (input: unknown) => {
        prompts.push(input)
        return {}
      },
    },
  },
  data: {
    session: {
      get: (id: string) =>
        id === "s1"
          ? {
              id,
              parentID: undefined,
              time: { created: 1 },
              location: { directory: "/repo/wt" },
            }
          : undefined,
      message: {
        list: () =>
          loaded
            ? [
                { id: "u1", type: "user", text: "hi" },
                {
                  id: "a1",
                  type: "assistant",
                  cost: 0.5,
                  tokens: {
                    input: 1,
                    output: 2,
                    reasoning: 0,
                    cache: { read: 3, write: 4 },
                  },
                  content: [
                    { type: "text", text: "ok" },
                    {
                      type: "tool",
                      name: "bash",
                      state: {
                        status: "completed",
                        input: { command: "git status" },
                        content: [{ type: "text", text: "clean" }],
                      },
                    },
                  ],
                },
              ]
            : undefined,
        sync: async (id: string) => {
          synced.push(id)
        },
      },
    },
  },
}

let api: any
setupV2(
  ctx as never,
  (async (a: unknown) => {
    api = a
  }) as never,
)
await new Promise((r) => setTimeout(r, 0))

// Not loaded yet: empty, and one sync requested.
assert.deepEqual(api.state.session.messages("s1"), [])
api.state.session.messages("s1")
assert.deepEqual(synced, ["s1"])

loaded = true
const msgs = api.state.session.messages("s1")
assert.deepEqual(
  msgs.map((m: any) => m.role),
  ["user", "assistant"],
)
assert.equal(msgs[1].tokens.cache.read, 3)
assert.deepEqual(api.state.part("a1"), [
  {
    type: "tool",
    tool: "bash",
    state: {
      status: "completed",
      input: { command: "git status" },
      output: "clean",
    },
  },
])
assert.equal(api.state.session.get("s1").directory, "/repo/wt")
assert.equal(api.state.path.directory, "/repo")

const res = await api.client.session.promptAsync({
  sessionID: "s1",
  parts: [{ text: "a" }, { text: "b" }],
})
assert.equal(res.error, undefined)
assert.deepEqual(prompts, [{ sessionID: "s1", text: "a\nb" }])

console.log("v2 adapter runtime check: ok")

// The whole plugin's startup through the adapter, with slot renders and the
// command list actually invoked: a missing V1 member throws here, not in the TUI.
const { default: plugin } = await import("./claude-auth-tui.tsx")
const failures: string[] = []
const toasts: string[] = []
const slots: Array<(p: unknown) => unknown> = []
const dispatched: string[] = []
let dialogOptions: Array<{ title: string; value: unknown; category?: string }> =
  []
let pick: unknown
let layer: any

// A clipboard stand-in on PATH, so the check never overwrites the real clipboard.
const {
  mkdtempSync,
  writeFileSync: write,
  chmodSync,
  readFileSync: readF,
} = await import("node:fs")
const { tmpdir } = await import("node:os")
const bin = mkdtempSync(`${tmpdir()}/clip-`)
for (const name of ["pbcopy", "wl-copy"]) {
  write(`${bin}/${name}`, `#!/bin/sh\ncat > ${bin}/clipboard\n`)
  chmodSync(`${bin}/${name}`, 0o755)
}
process.env.PATH = `${bin}:${process.env.PATH}`

const full = {
  ...ctx,
  ui: {
    ...ctx.ui,
    toast: {
      show: (t: { message: string; variant?: string }) => {
        toasts.push(t.message)
        if (t.variant === "error") failures.push(t.message)
      },
    },
    slot: (s: { render: (p: unknown) => unknown }) => slots.push(s.render),
    dialog: {
      select: async (o: { options: typeof dialogOptions }) => {
        dialogOptions = o.options
        return pick
      },
    },
  },
  keymap: {
    layer: (f: () => unknown) => (layer = f()),
    dispatch: (id: string) => dispatched.push(id),
  },
}
plugin.setup(full as never)
await new Promise((r) => setTimeout(r, 200))
assert.deepEqual(failures, [], "plugin setup reported an error")
// JSX needs the real renderer; the code before the JSX (session tracking, the
// new-session toast) still runs, and any other error fails the check.
for (const render of slots) {
  try {
    render({ sessionID: "s1" })
  } catch (e) {
    if ((e as Error).message !== "No renderer found") throw e
  }
}
assert.ok(slots.length >= 3, `expected sidebar slots, got ${slots.length}`)
// 1 + N slash entries: /cc and one /cc-<sub> per registry entry, all keeping
// their typed arguments, names unique.
const { SPECS } = await import("../src/tui/commands.ts")
const slashed = layer.commands.filter((c: any) => c.slash)
const want = ["cc", ...SPECS.map((s: any) => `cc-${s.name}`)]
assert.deepEqual(
  slashed.map((c: any) => c.slash),
  want.map((name) => ({ name, arguments: true })),
  "/cc plus one /cc-<sub> per registry entry",
)
assert.equal(new Set(want).size, want.length, "slash names are unique")
for (const s of SPECS as any[]) {
  const c = slashed.find((x: any) => x.slash.name === `cc-${s.name}`)
  assert.ok(c.description.includes(`/cc-${s.name}`), `${s.name} shows usage`)
  assert.ok(!c.palette, `${s.name} is slash-only: the palette has its own`)
}
const palette = layer.commands.filter((c: any) => c.palette)
assert.equal(
  new Set(palette.map((c: any) => c.title)).size,
  palette.length,
  "no duplicate palette entries",
)
const claude = slashed[0]
const sub = (name: string) =>
  slashed.find((c: any) => c.slash.name === `cc-${name}`)

// Bare /cc lists every sub-command with its usage; escape does nothing.
pick = undefined
await claude.run("")
await new Promise((r) => setTimeout(r, 20))
const subs = dialogOptions.map((o: any) => o.title)
assert.deepEqual(
  [
    "switch",
    "accounts",
    "stats",
    "tokens",
    "cache",
    "optimize",
    "config",
  ].filter((n) => !subs.includes(n)),
  [],
  "sub-commands listed",
)
assert.match(
  (dialogOptions.find((o: any) => o.title === "switch") as any).footer,
  /^\/cc-switch </,
)
// A sub-command entry runs like /cc <sub> <rest>: missing args walk the picker.
await sub("switch").run("")
await new Promise((r) => setTimeout(r, 20))
assert.ok(
  dialogOptions.some((o: any) => o.value === "__auto__"),
  "/cc-switch offers auto",
)
// An unknown name toasts and still offers the list.
await claude.run("zzz")
await new Promise((r) => setTimeout(r, 20))
assert.ok(toasts.some((t) => /Unknown sub-command "zzz"/.test(t)))
// A known sub-command with a missing argument asks for it, with live values.
await claude.run("switch")
await new Promise((r) => setTimeout(r, 20))
assert.ok(
  dialogOptions.some((o: any) => o.value === "__auto__"),
  "switch offers auto",
)
assert.ok(
  dialogOptions.some((o: any) => o.value === "__clear__"),
  "switch offers clear",
)
assert.equal(prompts.length, 1, "cancelled walks sent nothing")

await sub("optimize").run("")
await new Promise((r) => setTimeout(r, 50))
assert.equal(prompts.length, 2, "/cc-optimize sent one prompt")
assert.match((prompts[1] as { text: string }).text, /Token optimisation report/)
// tokens: the dialog lists actions and every report row; "paste" copies the full
// report and fires the TUI's own paste command.
pick = "paste"
await sub("tokens").run("")
await new Promise((r) => setTimeout(r, 120))
assert.deepEqual(
  dialogOptions.slice(0, 3).map((o) => o.value),
  ["paste", "copy", "optimize"],
)
assert.ok(
  dialogOptions.some((o) => o.category?.startsWith("Optimize")),
  "report rows listed",
)
assert.deepEqual(dispatched, ["prompt.paste"])
assert.match(readF(`${bin}/clipboard`, "utf-8"), /Token optimisation report/)
assert.deepEqual(failures, [])

console.log(
  `plugin setup through adapter: ok (${slots.length} slots, /cc-optimize sent, /cc-tokens pastes ${dialogOptions.length} rows)`,
)
// The plugin keeps refresh timers running; nothing else to wait for.
process.exit(0)
