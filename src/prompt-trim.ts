/**
 * Drop whole sections of the system prompt for chosen agents.
 *
 * OpenCode sends every agent the same global instructions, and plugins append
 * their own blocks on top. A subagent pays for all of it on every request,
 * though most of it is written for the person in the main session.
 *
 * The prompt is split into sections at lines that start with one of
 * `sections` (for example OpenCode's "Instructions from: "). Text before the
 * first such line is never touched. A section is dropped when its first line
 * starts with one of the prefixes listed for the agent, or under "*" for an
 * agent with no entry of its own. A key starting with "@" names a reusable
 * list; "@name" in any list stands for it, so a list is written once.
 */
export type PromptTrimConfig = {
  sections: readonly string[]
  trim: Readonly<Record<string, readonly string[]>>
}

export type Dropped = { head: string; bytes: number }

type SystemEntry = { type?: string; text?: string }

export function trimText(
  text: string,
  sections: readonly string[],
  drop: readonly string[],
): { text: string; dropped: Dropped[] } {
  const dropped: Dropped[] = []
  if (!drop.length || !sections.length) return { text, dropped }
  const lines = text.split("\n")
  const out: string[] = []
  let skipping = false
  for (const line of lines) {
    if (sections.some((s) => line.startsWith(s))) {
      skipping = drop.some((d) => line.startsWith(d))
      if (skipping) dropped.push({ head: line.slice(0, 80), bytes: 0 })
    }
    if (skipping)
      dropped[dropped.length - 1].bytes += Buffer.byteLength(line) + 1
    else out.push(line)
  }
  return dropped.length ? { text: out.join("\n"), dropped } : { text, dropped }
}

/** Replace each "@name" with the list under that key, once per name. */
export function expand(
  trim: Readonly<Record<string, readonly string[]>>,
  list: readonly string[],
  seen = new Set<string>(),
): string[] {
  return list.flatMap((p) => {
    if (!p.startsWith("@")) return [p]
    if (seen.has(p)) return []
    seen.add(p)
    return expand(trim, trim[p] ?? [], seen)
  })
}

/** Trim `parsed.system` in place; returns what was dropped. */
export function trimPrompt(
  parsed: unknown,
  agent: string | null | undefined,
  config: PromptTrimConfig,
): Dropped[] {
  if (!agent || agent.startsWith("@") || !parsed || typeof parsed !== "object")
    return []
  const drop = expand(config.trim, config.trim[agent] ?? config.trim["*"] ?? [])
  const body = parsed as { system?: unknown }
  const system = body.system
  if (!drop.length) return []
  if (typeof system === "string") {
    const r = trimText(system, config.sections, drop)
    body.system = r.text
    return r.dropped
  }
  if (!Array.isArray(system)) return []
  const dropped: Dropped[] = []
  for (const entry of system as SystemEntry[]) {
    if (typeof entry?.text !== "string") continue
    const r = trimText(entry.text, config.sections, drop)
    entry.text = r.text
    dropped.push(...r.dropped)
  }
  return dropped
}
