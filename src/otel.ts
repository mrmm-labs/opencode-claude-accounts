/**
 * OpenTelemetry spans for model requests and tool calls, sent as OTLP/HTTP JSON.
 *
 * Off unless `otel.endpoint` is set. Every span of a session shares one trace id,
 * derived from the session id, so a trace viewer shows a session as one trace.
 * Spans carry names, timings, sizes and token counts: never tool arguments, tool
 * output or message text, which can hold secrets.
 */
import { createHash, randomBytes } from "node:crypto"

export type OtelConfig = {
  /** OTLP/HTTP base URL, e.g. http://localhost:4318. Empty turns tracing off. */
  endpoint: string
  headers?: Record<string, string>
}

export type Attr = string | number | boolean | undefined

export type Span = {
  name: string
  session?: string
  /** service.name for this span; defaults to "opencode". */
  service?: string
  spanId?: string
  parentId?: string
  /** Session whose id seeds the trace id: the root of a subagent tree. */
  traceSession?: string
  start: number
  end: number
  attrs: Record<string, Attr>
  error?: string
}

const MAX_QUEUE = 2000

export const traceIdFor = (session: string | undefined): string =>
  session
    ? createHash("sha256").update(session).digest("hex").slice(0, 32)
    : randomBytes(16).toString("hex")

const value = (v: Exclude<Attr, undefined>) =>
  typeof v === "string"
    ? { stringValue: v }
    : typeof v === "boolean"
      ? { boolValue: v }
      : Number.isInteger(v)
        ? { intValue: String(v) }
        : { doubleValue: v }

const nanos = (ms: number) => `${Math.round(ms)}000000`

/** The OTLP/JSON body for a batch of spans, one resource per service. */
export function encode(spans: readonly Span[], service = "opencode"): object {
  const byService = new Map<string, Span[]>()
  for (const s of spans) {
    const k = s.service ?? service
    byService.set(k, [...(byService.get(k) ?? []), s])
  }
  return {
    resourceSpans: [...byService].map(([name, group]) => ({
      resource: {
        attributes: [{ key: "service.name", value: { stringValue: name } }],
      },
      scopeSpans: [
        {
          scope: { name: "opencode-claude-accounts" },
          spans: group.map((s) => ({
            traceId: traceIdFor(s.traceSession ?? s.session),
            spanId: s.spanId ?? newSpanId(),
            ...(s.parentId ? { parentSpanId: s.parentId } : {}),
            name: s.name,
            kind: 3,
            startTimeUnixNano: nanos(s.start),
            endTimeUnixNano: nanos(Math.max(s.end, s.start)),
            attributes: Object.entries({ "session.id": s.session, ...s.attrs })
              .filter(([, v]) => v !== undefined && v !== "")
              .map(([key, v]) => ({
                key,
                value: value(v as Exclude<Attr, undefined>),
              })),
            status: s.error ? { code: 2, message: s.error } : { code: 1 },
          })),
        },
      ],
    })),
  }
}

export const newSpanId = (): string => randomBytes(8).toString("hex")

/** Buffers spans and posts them every few seconds; a failed post is dropped, never retried. */
export class Exporter {
  private queue: Span[] = []
  private timer: ReturnType<typeof setTimeout> | undefined
  private config: () => OtelConfig | undefined
  private post: (url: string, init: RequestInit) => Promise<unknown>
  private everyMs: number

  constructor(
    config: () => OtelConfig | undefined,
    post: (url: string, init: RequestInit) => Promise<unknown> = fetch,
    everyMs = 2000,
  ) {
    this.config = config
    this.post = post
    this.everyMs = everyMs
    // A short run (`opencode run`) exits before the timer fires; send what is left.
    process.once?.("beforeExit", () => void this.flush())
  }

  add(span: Span): void {
    if (!this.config()?.endpoint) return
    if (this.queue.length >= MAX_QUEUE) this.queue.shift()
    this.queue.push(span)
    if (!this.timer) {
      this.timer = setTimeout(() => void this.flush(), this.everyMs)
      ;(this.timer as { unref?: () => void }).unref?.()
    }
  }

  async flush(): Promise<void> {
    this.timer = undefined
    const c = this.config()
    const batch = this.queue.splice(0)
    if (!c?.endpoint || !batch.length) return
    try {
      await this.post(`${c.endpoint.replace(/\/+$/, "")}/v1/traces`, {
        method: "POST",
        headers: { "content-type": "application/json", ...c.headers },
        body: JSON.stringify(encode(batch)),
        signal: AbortSignal.timeout(5000),
      })
    } catch {
      // A missing collector must never slow or break a session.
    }
  }
}

type Call = {
  at: number
  spanId: string
  parentId?: string
  session: string
  task: boolean
}

/**
 * What links spans into one tree per session family: the chat span that asked for
 * a tool is the tool's parent, and a subagent's chat spans hang under the parent
 * session's open task call, in the root session's trace.
 */
export class SessionTracer {
  readonly meta = new Map<
    string,
    { title?: string; parent?: string; agent?: string }
  >()
  private lastChat = new Map<string, string>()
  private lastRead = new Map<string, number>()
  private calls = new Map<string, Call>()

  info(id: string): { title?: string; parent?: string; agent?: string } {
    let m = this.meta.get(id)
    if (!m) this.meta.set(id, (m = {}))
    return m
  }

  /** The top of this session's parent chain. */
  root(id: string): string {
    let cur = id
    for (let i = 0; i < 10; i++) {
      const p = this.meta.get(cur)?.parent
      if (!p) break
      cur = p
    }
    return cur
  }

  service(id: string | undefined, agent?: string): string {
    const a = agent ?? (id ? this.meta.get(id)?.agent : undefined)
    return a ? `opencode/${a}` : "opencode"
  }

  /** A new chat span of this session: its id, and the span it hangs under. */
  chat(id: string): { spanId: string; parentId?: string } {
    const spanId = newSpanId()
    this.lastChat.set(id, spanId)
    const parent = this.meta.get(id)?.parent
    let parentId: string | undefined
    if (parent) {
      for (const c of this.calls.values())
        if (c.session === parent && c.task) parentId = c.spanId
    }
    return { spanId, ...(parentId ? { parentId } : {}) }
  }

  /** True when this request read under half of what the session's previous one did. */
  cacheBust(id: string, cacheRead: number | undefined): boolean {
    if (cacheRead === undefined) return false
    const prev = this.lastRead.get(id)
    this.lastRead.set(id, cacheRead)
    return prev !== undefined && prev > 50_000 && cacheRead < prev / 2
  }

  begin(callID: string, session: string, tool: string, at = Date.now()): void {
    const parentId = this.lastChat.get(session)
    this.calls.set(callID, {
      at,
      spanId: newSpanId(),
      session,
      task: /^(task|subagent)$/i.test(tool.replace(/^mcp_/, "")),
      ...(parentId ? { parentId } : {}),
    })
    if (this.calls.size > 5000) {
      // A call whose after hook never came (aborted) must not grow the map forever.
      const cut = at - 3_600_000
      for (const [k, c] of this.calls) if (c.at < cut) this.calls.delete(k)
    }
  }

  end(callID: string): Call | undefined {
    const c = this.calls.get(callID)
    this.calls.delete(callID)
    return c
  }
}

const PRICE: [RegExp, number][] = [
  [/opus/, 5],
  [/sonnet/, 3],
  [/haiku/, 1],
]

/**
 * List-price USD of one request: input $/Mtok by model family, output 5x,
 * cache read 0.1x, cache writes 1.25x (5 min) and 2x (1 h).
 */
export function costUsd(
  model: string,
  u: {
    input: number
    output: number
    cacheRead: number
    cacheWrite: number
    cacheWrite1h: number
  },
): number | undefined {
  const p = PRICE.find(([re]) => re.test(model))?.[1]
  if (p === undefined) return undefined
  return (
    (u.input * p +
      u.output * 5 * p +
      u.cacheRead * 0.1 * p +
      u.cacheWrite * 1.25 * p +
      u.cacheWrite1h * 2 * p) /
    1e6
  )
}

const BUILTIN = new Set([
  "bash",
  "shell",
  "read",
  "write",
  "edit",
  "glob",
  "grep",
  "list",
  "patch",
  "task",
  "subagent",
  "todowrite",
  "todoread",
  "webfetch",
  "websearch",
  "question",
  "skill",
  "execute",
  "lsp",
])

/** For an MCP tool (`<server>_<tool>`), the server name; builtin tools have none. */
export function mcpServer(tool: string): string | undefined {
  const name = tool.replace(/^mcp_/, "")
  if (BUILTIN.has(name.toLowerCase())) return undefined
  const i = name.indexOf("_")
  return i > 0 ? name.slice(0, i) : undefined
}
