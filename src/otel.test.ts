import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { sanitize } from "./config.ts"
import {
  costUsd,
  encode,
  Exporter,
  mcpServer,
  SessionTracer,
  traceIdFor,
} from "./otel.ts"

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
  it("names MCP servers", () => {
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
    // Call the hook it registered rather than emit beforeExit, which the test runner listens to too.
    const hook = process.listeners("beforeExit").at(-1) as (
      code: number,
    ) => void
    hook(0)
    await new Promise((r) => setImmediate(r))
    assert.equal(posted, 1)
  })
})

describe("SessionTracer", () => {
  it("hangs tools under the chat that asked for them and subagents under the task call", () => {
    const tr = new SessionTracer()
    tr.info("child").parent = "root"
    tr.info("root").agent = "build"
    const rootChat = tr.chat("root")
    assert.equal(rootChat.parentId, undefined)
    tr.begin("call-task", "root", "task", 10)
    const childChat = tr.chat("child")
    const task = tr.end("call-task")!
    assert.equal(task.parentId, rootChat.spanId)
    assert.equal(childChat.parentId, task.spanId)
    assert.equal(tr.root("child"), "root")
    assert.equal(tr.service("root"), "opencode/build")
    assert.equal(tr.service("child", "builder"), "opencode/builder")
    assert.equal(tr.service(undefined), "opencode")
    assert.equal(tr.end("call-task"), undefined)
  })

  it("flags a request that read under half the previous cache", () => {
    const tr = new SessionTracer()
    assert.equal(tr.cacheBust("s", 200_000), false)
    assert.equal(tr.cacheBust("s", 210_000), false)
    assert.equal(tr.cacheBust("s", 0), true)
    assert.equal(tr.cacheBust("s", 30_000), false)
  })
})

describe("encode by service", () => {
  it("puts each service in its own resource and keeps parent links", () => {
    const body = encode([
      {
        name: "chat m",
        service: "opencode/build",
        session: "s",
        traceSession: "r",
        spanId: "a".repeat(16),
        start: 0,
        end: 1,
        attrs: {},
      },
      {
        name: "anthropic.messages",
        service: "anthropic",
        session: "s",
        traceSession: "r",
        parentId: "a".repeat(16),
        start: 0,
        end: 1,
        attrs: {},
      },
    ]) as any
    const names = body.resourceSpans.map(
      (r: any) => r.resource.attributes[0].value.stringValue,
    )
    assert.deepEqual(names, ["opencode/build", "anthropic"])
    const child = body.resourceSpans[1].scopeSpans[0].spans[0]
    assert.equal(child.parentSpanId, "a".repeat(16))
    assert.equal(child.traceId, traceIdFor("r"))
  })
})

describe("costUsd", () => {
  it("prices by model family at list price", () => {
    const u = {
      input: 1_000_000,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      cacheWrite1h: 0,
    }
    assert.equal(costUsd("claude-opus-5-5", u), 5)
    assert.equal(
      costUsd("claude-sonnet-5-5", { ...u, input: 0, output: 1_000_000 }),
      15,
    )
    assert.equal(
      costUsd("claude-haiku-5-5", { ...u, input: 0, cacheRead: 1_000_000 }),
      0.1,
    )
    assert.equal(
      costUsd("claude-opus-5-5", {
        ...u,
        input: 0,
        cacheWrite: 1_000_000,
        cacheWrite1h: 1_000_000,
      }),
      16.25,
    )
    assert.equal(costUsd("gpt-x", u), undefined)
  })
})
