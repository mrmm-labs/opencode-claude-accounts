import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { sanitize } from "./config.ts"
import { encode, Exporter, mcpServer, ToolTimer, traceIdFor } from "./otel.ts"

describe("encode", () => {
  it("gives every span of a session the same trace id and typed attributes", () => {
    const body = encode([
      {
        name: "chat m",
        session: "ses_a",
        start: 1000,
        end: 2500,
        attrs: {
          "gen_ai.usage.input_tokens": 12,
          ok: true,
          ratio: 0.5,
          skip: undefined,
        },
      },
      {
        name: "tool read",
        session: "ses_a",
        start: 3000,
        end: 3001,
        attrs: {},
        error: "boom",
      },
    ]) as any
    const [a, b] = body.resourceSpans[0].scopeSpans[0].spans
    assert.equal(a.traceId, traceIdFor("ses_a"))
    assert.equal(a.traceId, b.traceId)
    assert.equal(a.traceId.length, 32)
    assert.notEqual(a.spanId, b.spanId)
    assert.equal(a.startTimeUnixNano, "1000000000")
    assert.equal(a.endTimeUnixNano, "2500000000")
    const attrs = Object.fromEntries(
      a.attributes.map((x: any) => [x.key, x.value]),
    )
    assert.deepEqual(attrs["gen_ai.usage.input_tokens"], { intValue: "12" })
    assert.deepEqual(attrs.ok, { boolValue: true })
    assert.deepEqual(attrs.ratio, { doubleValue: 0.5 })
    assert.deepEqual(attrs["session.id"], { stringValue: "ses_a" })
    assert.ok(!("skip" in attrs))
    assert.deepEqual(b.status, { code: 2, message: "boom" })
  })
})

describe("Exporter", () => {
  it("does nothing without an endpoint and posts a batch with one", async () => {
    const posts: { url: string; body: any }[] = []
    let endpoint = ""
    const post = async (url: string, init: RequestInit) => {
      posts.push({ url, body: JSON.parse(String(init.body)) })
    }
    const ex = new Exporter(() => ({ endpoint }), post, 60_000)
    ex.add({ name: "x", start: 0, end: 1, attrs: {} })
    await ex.flush()
    assert.equal(posts.length, 0)
    endpoint = "http://collector:4318/"
    ex.add({ name: "x", start: 0, end: 1, attrs: {} })
    ex.add({ name: "y", start: 0, end: 1, attrs: {} })
    await ex.flush()
    assert.equal(posts.length, 1)
    assert.equal(posts[0].url, "http://collector:4318/v1/traces")
    assert.equal(posts[0].body.resourceSpans[0].scopeSpans[0].spans.length, 2)
  })

  it("swallows a failed post", async () => {
    const ex = new Exporter(
      () => ({ endpoint: "http://x" }),
      async () => {
        throw new Error("down")
      },
      60_000,
    )
    ex.add({ name: "x", start: 0, end: 1, attrs: {} })
    await ex.flush()
  })
})

describe("tools", () => {
  it("times a call once and names MCP servers", () => {
    const t = new ToolTimer()
    t.begin("c1", 5)
    assert.equal(t.end("c1"), 5)
    assert.equal(t.end("c1"), undefined)
    assert.equal(mcpServer("bitwarden_get_password"), "bitwarden")
    assert.equal(mcpServer("mcp_github_list_issues"), "github")
    assert.equal(mcpServer("read"), undefined)
    assert.equal(mcpServer("Shell"), undefined)
  })
})

describe("otel config", () => {
  it("keeps an endpoint and string headers", () => {
    assert.deepEqual(
      sanitize({ otel: { endpoint: "http://h:4318", headers: { a: "b" } } })
        .otel,
      {
        endpoint: "http://h:4318",
        headers: { a: "b" },
      },
    )
    assert.equal(sanitize({ otel: { endpoint: 4 } }).otel, undefined)
  })
})

describe("exit", () => {
  it("flushes what is queued when the process is about to exit", async () => {
    let posted = 0
    const ex = new Exporter(
      () => ({ endpoint: "http://x" }),
      async () => void posted++,
      60_000,
    )
    ex.add({ name: "x", start: 0, end: 1, attrs: {} })
    process.emit("beforeExit", 0)
    await new Promise((r) => setImmediate(r))
    assert.equal(posted, 1)
  })
})
