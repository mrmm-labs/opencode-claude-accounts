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

/** The OTLP/JSON body for a batch of spans. */
export function encode(spans: readonly Span[], service = "opencode"): object {
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: "service.name", value: { stringValue: service } },
          ],
        },
        scopeSpans: [
          {
            scope: { name: "opencode-claude-accounts" },
            spans: spans.map((s) => ({
              traceId: traceIdFor(s.session),
              spanId: randomBytes(8).toString("hex"),
              name: s.name,
              kind: 3,
              startTimeUnixNano: nanos(s.start),
              endTimeUnixNano: nanos(Math.max(s.end, s.start)),
              attributes: Object.entries({
                "session.id": s.session,
                ...s.attrs,
              })
                .filter(([, v]) => v !== undefined && v !== "")
                .map(([key, v]) => ({
                  key,
                  value: value(v as Exclude<Attr, undefined>),
                })),
              status: s.error ? { code: 2, message: s.error } : { code: 1 },
            })),
          },
        ],
      },
    ],
  }
}

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

/** Times tool calls between OpenCode's before and after hooks. */
export class ToolTimer {
  private started = new Map<string, number>()

  begin(callID: string, at = Date.now()): void {
    this.started.set(callID, at)
    if (this.started.size > 5000) {
      // A call whose after hook never came (aborted) must not grow the map forever.
      const cut = at - 3_600_000
      for (const [k, t] of this.started) if (t < cut) this.started.delete(k)
    }
  }

  end(callID: string): number | undefined {
    const t = this.started.get(callID)
    this.started.delete(callID)
    return t
  }
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
