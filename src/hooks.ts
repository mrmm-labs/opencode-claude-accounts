/**
 * Request and response hooks for other plugins.
 *
 * Plugins share one process but load in any order, so the registry lives on
 * `globalThis` and both sides create it with `??=`. Nothing needs importing:
 * the types below are for authors who want them.
 *
 *   ;(globalThis as any).__claudeAccountsHooks ??= { before: [], response: [] }
 *
 * A hook that throws is logged and skipped. It can never fail a turn.
 */
import { log } from "./logger.ts"

export type HookRequest = {
  url: string
  /** Parsed JSON body of POST /v1/messages; mutate in place. */
  body: Record<string, unknown>
  /** Outgoing headers; mutate in place. */
  headers: Headers
  /** `body.model`. */
  model: string
  agent?: string
  sessionID?: string
}

export type HookContext = HookRequest & {
  /**
   * Send ONE more request with this body, on the same account and headers.
   * Before hooks do not run again for it. A second call rejects.
   */
  resend: (body: Record<string, unknown>) => Promise<Response>
}

export type BeforeHook = (req: HookRequest) => void | Promise<void>
export type ResponseHook = (
  res: Response,
  ctx: HookContext,
) => Response | Promise<Response>

export type Hooks = {
  before: BeforeHook[]
  response: ResponseHook[]
}

export type HookStats = { before: number; response: number; errors: number }

const KEY = "__claudeAccountsHooks"

export function getHooks(): Hooks {
  const g = globalThis as unknown as Record<string, Hooks | undefined>
  return (g[KEY] ??= { before: [], response: [] })
}

function live<T>(list: unknown): T[] {
  return Array.isArray(list)
    ? list.filter((h): h is T => typeof h === "function")
    : []
}

export function newHookStats(): HookStats {
  return { before: 0, response: 0, errors: 0 }
}

function fail(
  kind: "before" | "response",
  index: number,
  err: unknown,
  stats: HookStats,
): void {
  stats.errors++
  log("hook_failed", {
    level: "warn",
    kind,
    index,
    error: err instanceof Error ? err.message : String(err),
  })
}

function restoreHeaders(target: Headers, snapshot: Headers): void {
  for (const key of Array.from(target.keys())) target.delete(key)
  snapshot.forEach((value, key) => target.set(key, value))
}

/**
 * Run the before hooks over one outgoing attempt. Returns the body to send:
 * the input string untouched when no hook is registered, else re-serialised.
 */
export async function runBefore(
  raw: string,
  req: Omit<HookRequest, "body" | "model">,
  stats: HookStats,
): Promise<string> {
  const hooks = live<BeforeHook>(getHooks().before)
  if (hooks.length === 0) return raw
  let body: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return raw
    body = parsed as Record<string, unknown>
  } catch {
    return raw
  }
  for (const [i, hook] of hooks.entries()) {
    const bodySnap = structuredClone(body)
    const headersSnap = new Headers(req.headers)
    stats.before++
    try {
      await hook({
        ...req,
        body,
        model: typeof body.model === "string" ? body.model : "unknown",
      })
    } catch (err) {
      body = bodySnap
      restoreHeaders(req.headers, headersSnap)
      fail("before", i, err, stats)
    }
  }
  return JSON.stringify(body)
}

/**
 * Run the response hooks, in order, on the response about to be returned.
 * `sent` is the last request that went out: its body (as sent) and the very
 * headers it used.
 */
export async function runResponse(
  res: Response,
  sent: {
    url: string
    body: BodyInit | null | undefined
    headers: Headers
    agent?: string
    sessionID?: string
  },
  resend: (body: string, headers: Headers) => Promise<Response>,
  stats: HookStats,
): Promise<Response> {
  const hooks = live<ResponseHook>(getHooks().response)
  if (hooks.length === 0) return res
  let parsed: Record<string, unknown> = {}
  try {
    const p: unknown = JSON.parse(String(sent.body))
    if (p && typeof p === "object" && !Array.isArray(p))
      parsed = p as Record<string, unknown>
  } catch {}
  let resent = false
  const ctx: HookContext = {
    url: sent.url,
    body: parsed,
    headers: sent.headers,
    model: typeof parsed.model === "string" ? parsed.model : "unknown",
    ...(sent.agent ? { agent: sent.agent } : {}),
    ...(sent.sessionID ? { sessionID: sent.sessionID } : {}),
    resend: async (body) => {
      if (resent) throw new Error("resend is allowed once per request")
      resent = true
      return resend(JSON.stringify(body), sent.headers)
    },
  }
  let current = res
  for (const [i, hook] of hooks.entries()) {
    stats.response++
    try {
      const next = await hook(current, ctx)
      if (next instanceof Response) current = next
      else throw new Error("response hook did not return a Response")
    } catch (err) {
      fail("response", i, err, stats)
    }
  }
  return current
}
