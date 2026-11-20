/**
 * The one `/claude` command: its sub-commands, how typed input is read, and how
 * missing arguments are asked for.
 *
 * The host completes only a slash command's name, never what follows it. So
 * "completion" here is an interactive chain of searchable pickers: `/claude`
 * lists the sub-commands, picking one asks for each argument it still needs.
 * Typing the whole thing is the fast path and skips the dialogs it can.
 *
 * Everything decidable lives here, as pure functions over a `Live` snapshot and
 * a `Dialogs` interface, so it is tested with a fake dialog. The registry is the
 * single source for parsing, the pickers, `/claude help` and the README table.
 */

export type Args = Record<string, string>

export type Option = {
  title: string
  value: string
  description?: string
  footer?: string
  category?: string
  /** Other things a typed value may match; the first is the one to show as valid. */
  aliases?: string[]
}

/** What the arguments' pickers are made from, read when they are needed. */
export type Live = {
  /** Auto, presets, accounts and "clear", for `switch`. */
  targets(): Option[]
  currentTarget(): string
  /** Every editable setting, for `config`. */
  settings(): Option[]
  /** A setting's choices; empty when it is typed rather than chosen. */
  settingValues(key: string): Option[]
  /** A setting's current value, to prefill its prompt. */
  settingNow(key: string): string
  /** `allow`/`decline` for credits, `on`/`off` for reserve, in this session. */
  flag(name: "credits" | "reserve"): string
}

export type Arg = {
  name: string
  /** `enum` is chosen from a list; `text` is typed. */
  kind: "enum" | "text"
  placeholder: string
  optional?: boolean
  /** Takes the rest of the typed line, spaces included. */
  rest?: boolean
  options?: readonly Option[] | ((live: Live, args: Args) => Option[])
  current?: (live: Live, args: Args) => string | undefined
  default?: string | ((live: Live, args: Args) => string | undefined)
}

export const WINDOWS = [
  { value: "1h", ms: 3_600_000, title: "last hour" },
  { value: "6h", ms: 21_600_000, title: "last 6 hours" },
  { value: "24h", ms: 86_400_000, title: "last 24 hours" },
  { value: "7d", ms: 604_800_000, title: "last 7 days" },
] as const
export const DEFAULT_WINDOW = "24h"

/** Milliseconds for a window value; the default for anything unknown. */
export function windowMs(value: string | undefined): number {
  return (
    WINDOWS.find((w) => w.value === value)?.ms ??
    WINDOWS.find((w) => w.value === DEFAULT_WINDOW)!.ms
  )
}

const windowArg: Arg = {
  name: "window",
  kind: "enum",
  placeholder: WINDOWS.map((w) => w.value).join("|"),
  optional: true,
  options: WINDOWS.map((w) => ({
    title: w.value,
    value: w.value,
    description: w.title,
  })),
  default: DEFAULT_WINDOW,
}

export type Spec = {
  name: string
  title: string
  description: string
  category: string
  args: readonly Arg[]
}

/** The order here is the order of `/claude help` and the README table. */
export const SPECS = [
  {
    name: "switch",
    title: "Switch account or preset",
    description: "choose a preset, Auto, or pin one account",
    category: "Accounts",
    args: [
      {
        name: "target",
        kind: "enum",
        placeholder: "account|preset|auto|clear",
        rest: true,
        options: (live: Live) => live.targets(),
        current: (live: Live) => live.currentTarget(),
      },
    ],
  },
  {
    name: "accounts",
    title: "Manage accounts",
    description:
      "enable or disable, rename, assign IDs, set ceilings, edit presets",
    category: "Accounts",
    args: [],
  },
  {
    name: "presets",
    title: "Edit presets",
    description: "the preset editor on the Manage accounts menu",
    category: "Accounts",
    args: [],
  },
  {
    name: "credits",
    title: "Paid credits in this session",
    description: "allow or decline spending paid overflow in this session",
    category: "Accounts",
    args: [
      {
        name: "state",
        kind: "enum",
        placeholder: "allow|decline",
        options: [
          {
            title: "allow",
            value: "allow",
            description:
              "this session may spend overflow once every allowance is gone",
          },
          {
            title: "decline",
            value: "decline",
            description: "this session stops instead of spending",
          },
        ],
        current: (live: Live) => live.flag("credits"),
      },
    ],
  },
  {
    name: "reserve",
    title: "Reserved quota in this session",
    description: "let this session spend accounts past their ceiling",
    category: "Accounts",
    args: [
      {
        name: "state",
        kind: "enum",
        placeholder: "on|off",
        options: [
          {
            title: "on",
            value: "on",
            description: "this session may spend an account past its ceiling",
          },
          {
            title: "off",
            value: "off",
            description:
              "this session leaves quota above each ceiling in reserve",
          },
        ],
        current: (live: Live) => live.flag("reserve"),
      },
    ],
  },
  {
    name: "stats",
    title: "Usage by session",
    description: "usage per session over a window",
    category: "Usage",
    args: [windowArg],
  },
  {
    name: "tokens",
    title: "Token usage",
    description: "per-session token breakdown and the fix report",
    category: "Usage",
    args: [],
  },
  {
    name: "cache",
    title: "Cache impact and settings",
    description:
      "hit rate, cost saved, misses by cause; change cacheTtl, contextEditing",
    category: "Usage",
    args: [windowArg],
  },
  {
    name: "optimize",
    title: "Ranked fixes",
    description: "ask the agent for a fix plan",
    category: "Optimize",
    args: [],
  },
  {
    name: "debug",
    title: "Explain routing",
    description: "what the balancer is actually doing, right now",
    category: "Diagnostics",
    args: [],
  },
  {
    name: "requests",
    title: "Recent requests",
    description: "requests over a window; open one to see the path it took",
    category: "Diagnostics",
    args: [windowArg],
  },
  {
    name: "config",
    title: "Edit settings",
    description: "change a setting that applies without a restart",
    category: "Settings",
    args: [
      {
        name: "setting",
        kind: "enum",
        placeholder: "setting",
        options: (live: Live) => live.settings(),
      },
      {
        name: "value",
        kind: "text",
        placeholder: "value",
        rest: true,
        options: (live: Live, args: Args) =>
          live.settingValues(args.setting ?? ""),
        current: (live: Live, args: Args) =>
          live.settingNow(args.setting ?? ""),
        default: (live: Live, args: Args) =>
          live.settingNow(args.setting ?? ""),
      },
    ],
  },
  {
    name: "help",
    title: "Commands",
    description: "every sub-command with its usage",
    category: "Help",
    args: [],
  },
] as const satisfies readonly Spec[]

export type CommandName = (typeof SPECS)[number]["name"]
export type Run = (args: Args) => void | Promise<void>
export type Command = Spec & { run: Run }

/** The registry: the declarative specs with their handlers attached. */
export function commandsWith(runs: Record<CommandName, Run>): Command[] {
  return SPECS.map((s) => ({ ...s, run: runs[s.name] }))
}

export const SLASH = "claude"

export function usage(spec: Pick<Spec, "name" | "args">): string {
  const args = spec.args.map((a) =>
    a.optional ? `[${a.placeholder}]` : `<${a.placeholder}>`,
  )
  return [`/${SLASH}`, spec.name, ...args].join(" ")
}

const optionsOf = (arg: Arg, live: Live, args: Args): Option[] =>
  typeof arg.options === "function"
    ? arg.options(live, args)
    : [...(arg.options ?? [])]

const defaultOf = (arg: Arg, live: Live, args: Args): string | undefined =>
  typeof arg.default === "function" ? arg.default(live, args) : arg.default

/** The word to type for an option: its first alias, else its value. */
export const typeable = (o: Option) => o.aliases?.[0] ?? o.value

export type Match =
  | { ok: true; option: Option }
  | { ok: false; candidates: Option[] }

/**
 * A typed value against a list: exact, then unique prefix, then unique
 * fragment, over the value, the title and every alias. Several equal hits are
 * ambiguous rather than the first one, so a duplicated name never picks for you.
 */
export function matchOption(raw: string, options: readonly Option[]): Match {
  const q = raw.trim().toLowerCase()
  const keys = (o: Option) =>
    [o.value, o.title, ...(o.aliases ?? [])].map((k) => k.toLowerCase())
  const tiers = [
    (k: string) => k === q,
    (k: string) => k.startsWith(q),
    (k: string) => k.includes(q),
  ]
  for (const test of tiers) {
    const hits = options.filter((o) => keys(o).some(test))
    if (hits.length === 1) return { ok: true, option: hits[0]! }
    if (hits.length > 1) return { ok: false, candidates: hits }
  }
  return { ok: false, candidates: [] }
}

export type Invalid = {
  arg: Arg
  raw: string
  /** What matched ambiguously, or every choice when nothing did. */
  candidates: Option[]
}

export type Parsed =
  | { kind: "menu"; matches: Spec[]; query: string }
  | { kind: "unknown"; query: string }
  | {
      kind: "command"
      spec: Spec
      args: Args
      invalid?: Invalid
      extra: string[]
    }

/** Everything after `/claude`, read against the registry. */
export function parse(
  input: string | undefined,
  live: Live,
  specs: readonly Spec[] = SPECS,
): Parsed {
  const tokens = (input ?? "").trim().split(/\s+/).filter(Boolean)
  const word = tokens.shift()?.toLowerCase()
  if (!word) return { kind: "menu", matches: [...specs], query: "" }

  const exact = specs.find((s) => s.name === word)
  const prefixed = specs.filter((s) => s.name.startsWith(word))
  const spec = exact ?? (prefixed.length === 1 ? prefixed[0] : undefined)
  if (!spec) {
    return prefixed.length > 1
      ? { kind: "menu", matches: prefixed, query: word }
      : { kind: "unknown", query: word }
  }

  const args: Args = {}
  for (const arg of spec.args) {
    if (tokens.length === 0) break
    const raw = arg.rest ? tokens.splice(0).join(" ") : tokens.shift()!
    const options = optionsOf(arg, live, args)
    if (arg.kind === "text" && options.length === 0) {
      args[arg.name] = raw
      continue
    }
    const m = matchOption(raw, options)
    if (m.ok) {
      args[arg.name] = m.option.value
      continue
    }
    return {
      kind: "command",
      spec,
      args,
      invalid: {
        arg,
        raw,
        candidates: m.candidates.length ? m.candidates : options,
      },
      extra: [],
    }
  }
  return { kind: "command", spec, args, extra: tokens }
}

/** The sub-command list: this is what completion shows for `/claude`. */
export function menuOptions(specs: readonly Spec[]): Option[] {
  return specs.map((s) => ({
    title: s.name,
    value: s.name,
    description: s.description,
    footer: usage(s),
    category: s.category,
  }))
}

export type Variant = "info" | "success" | "warning" | "error"

/** The three things the walk needs from a host, each cancellable. */
export type Dialogs = {
  select(o: {
    title: string
    options: Option[]
    current?: string
  }): Promise<string | undefined>
  prompt(o: {
    title: string
    placeholder?: string
    value?: string
  }): Promise<string | undefined>
  toast(message: string, variant: Variant): void
  /** Closes whatever dialog the walk left open. */
  close(): void
}

const validNames = (options: readonly Option[], max = 8) => {
  const list = options.map(typeable)
  return list.length > max
    ? `${list.slice(0, max).join(", ")}, \u2026`
    : list.join(", ")
}

/**
 * Asks for every argument still missing, in order. `undefined` means the
 * operator cancelled at some step, and nothing has been done.
 *
 * Optional arguments are asked only when `askOptional` (the operator came from
 * the picker); typed, they take their default so `/claude stats` just runs.
 */
export async function walk(
  spec: Spec,
  parsed: { args: Args; invalid?: Invalid },
  io: Dialogs,
  live: Live,
  askOptional: boolean,
): Promise<Args | undefined> {
  const args: Args = { ...parsed.args }
  let invalid = parsed.invalid
  for (const arg of spec.args) {
    if (args[arg.name] !== undefined) continue
    const fallback = defaultOf(arg, live, args)
    if (arg.optional && !askOptional && !invalid) {
      if (fallback !== undefined) args[arg.name] = fallback
      continue
    }
    const title = `${spec.title} (${arg.name})`
    for (;;) {
      let options = optionsOf(arg, live, args)
      if (invalid?.arg === arg) {
        // Offer what the typed value could have meant, or all of it.
        options = invalid.candidates
        io.toast(
          `"${invalid.raw}" is not a valid ${arg.name}. Try: ${validNames(options)}`,
          "warning",
        )
        invalid = undefined
      }
      if (options.length > 0) {
        const current = arg.current?.(live, args) ?? fallback
        const value = await io.select({
          title,
          options,
          ...(current !== undefined ? { current } : {}),
        })
        if (value === undefined) return undefined
        args[arg.name] = value
        break
      }
      const value = await io.prompt({
        title,
        placeholder: arg.placeholder,
        ...(fallback !== undefined ? { value: fallback } : {}),
      })
      if (value === undefined) return undefined
      const text = value.trim()
      if (text === "" && !arg.optional) {
        io.toast(`${arg.name} cannot be empty`, "warning")
        continue
      }
      args[arg.name] = text === "" ? (fallback ?? "") : text
      break
    }
  }
  return args
}

/**
 * `/claude <input>`: parse, walk what is missing, run.
 *
 * Nothing runs unless every argument was given or chosen, so escape at any step
 * leaves no side effect.
 */
export async function dispatch(
  input: string | undefined,
  deps: { commands: readonly Command[]; live: Live; io: Dialogs },
): Promise<void> {
  const { commands, live } = deps
  let shown = false
  const io: Dialogs = {
    ...deps.io,
    select: (o) => ((shown = true), deps.io.select(o)),
    prompt: (o) => ((shown = true), deps.io.prompt(o)),
  }
  const parsed = parse(input, live, commands)

  let spec: Spec
  let args: Args = {}
  let invalid: Invalid | undefined
  let picked = false
  if (parsed.kind === "command") {
    if (parsed.extra.length > 0) {
      io.toast(
        `Unexpected "${parsed.extra.join(" ")}". Usage: ${usage(parsed.spec)}`,
        "warning",
      )
      return
    }
    ;({ spec, args, invalid } = parsed)
  } else {
    if (parsed.kind === "unknown")
      io.toast(`Unknown sub-command "${parsed.query}". Pick one.`, "warning")
    const name = await io.select({
      title: SLASH,
      options: menuOptions(parsed.kind === "menu" ? parsed.matches : commands),
    })
    if (name === undefined) return
    spec = commands.find((c) => c.name === name)!
    picked = true
  }

  const done = await walk(spec, { args, invalid }, io, live, picked)
  if (!done) return
  if (shown) io.close()
  await commands.find((c) => c.name === spec.name)!.run(done)
}

/** One row per sub-command with its usage: what `/claude help` shows. */
export function helpOptions(specs: readonly Spec[] = SPECS): Option[] {
  return specs.map((s) => ({
    title: usage(s),
    value: s.name,
    description: s.description,
    category: s.category,
  }))
}

/**
 * The README's Commands table, generated so it cannot drift from the registry.
 * Padded to the formatter's alignment, which would otherwise rewrite it.
 */
export function commandsTable(specs: readonly Spec[] = SPECS): string {
  const cell = (s: string) => s.replace(/\|/g, "\\|")
  const rows = [
    ["Command", "What it does"],
    ...specs.map((s) => [`\`${cell(usage(s))}\``, cell(s.description)]),
  ]
  const w = [0, 1].map((i) => Math.max(...rows.map((r) => r[i]!.length)))
  const line = (r: string[]) =>
    `| ${r.map((c, i) => c.padEnd(w[i]!)).join(" | ")} |`
  return [
    line(rows[0]!),
    `| ${w.map((n) => "-".repeat(n)).join(" | ")} |`,
    ...rows.slice(1).map(line),
  ].join("\n")
}
