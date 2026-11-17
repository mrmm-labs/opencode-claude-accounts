import assert from "node:assert/strict"
import { afterEach, describe, it } from "node:test"
import {
  getHooks,
  newHookStats,
  runBefore,
  runResponse,
  type Hooks,
} from "./hooks.ts"

const KEY = "__claudeAccountsHooks"
const g = globalThis as unknown as Record<string, Hooks | undefined>
const req = () => ({ url: "https://x/v1/messages", headers: new Headers() })

afterEach(() => {
  delete g[KEY]
})

describe("getHooks", () => {
  it("creates the registry once and shares an existing one", () => {
    const mine: Hooks = { before: [], response: [] }
    g[KEY] = mine
    assert.equal(getHooks(), mine)
    delete g[KEY]
    assert.equal(getHooks(), getHooks())
  })
})

describe("runBefore", () => {
  it("returns the input string untouched when nothing is registered", async () => {
    const raw = '{"model":"m",  "x":1}'
    assert.equal(await runBefore(raw, req(), newHookStats()), raw)
  })

  it("runs hooks in order and re-serialises the mutated body", async () => {
    getHooks().before.push(
      (r) => void (r.body.a = r.model),
      (r) => void (r.body.b = r.body.a),
    )
    const stats = newHookStats()
    const out = await runBefore('{"model":"m"}', req(), stats)
    assert.deepEqual(JSON.parse(out), { model: "m", a: "m", b: "m" })
    assert.deepEqual(stats, { before: 2, response: 0, errors: 0 })
  })

  it("rolls a throwing hook back, body and headers, and keeps going", async () => {
    getHooks().before.push(
      (r) => {
        r.body.half = true
        r.headers.set("x-half", "1")
        r.headers.delete("x-keep")
        throw new Error("boom")
      },
      (r) => void (r.body.ok = true),
    )
    const r = req()
    r.headers.set("x-keep", "1")
    const stats = newHookStats()
    const out = JSON.parse(await runBefore('{"model":"m"}', r, stats))
    assert.deepEqual(out, { model: "m", ok: true })
    assert.equal(r.headers.get("x-half"), null)
    assert.equal(r.headers.get("x-keep"), "1")
    assert.equal(stats.errors, 1)
  })

  it("leaves a body that is not a JSON object alone", async () => {
    getHooks().before.push(() => assert.fail("must not run"))
    for (const raw of ["[1]", "not json", "null"])
      assert.equal(await runBefore(raw, req(), newHookStats()), raw)
  })

  it("ignores registry entries that are not functions", async () => {
    getHooks().before.push("nope" as never, (r) => void (r.body.ok = 1))
    const out = await runBefore('{"model":"m"}', req(), newHookStats())
    assert.equal(JSON.parse(out).ok, 1)
  })
})

describe("runResponse", () => {
  const sent = (body: string) => ({
    url: "https://x/v1/messages",
    body,
    headers: new Headers({ authorization: "Bearer t" }),
    agent: "build",
    sessionID: "ses_1",
  })
  const noResend = async () => new Response("unused")

  it("skips a hook that throws or returns a non-Response", async () => {
    const first = new Response("ok")
    getHooks().response.push(
      () => {
        throw new Error("boom")
      },
      (() => "nope") as never,
    )
    const stats = newHookStats()
    const out = await runResponse(first, sent("{}"), noResend, stats)
    assert.equal(out, first)
    assert.equal(stats.errors, 2)
  })

  it("hands each hook the previous hook's response and the request context", async () => {
    const seen: unknown[] = []
    getHooks().response.push(
      (res, ctx) => {
        seen.push(ctx.model, ctx.agent, ctx.sessionID)
        return new Response("second", { status: res.status })
      },
      async (res) => new Response((await res.text()) + "+third"),
    )
    const out = await runResponse(
      new Response("first"),
      sent('{"model":"m"}'),
      noResend,
      newHookStats(),
    )
    assert.equal(await out.text(), "second+third")
    assert.deepEqual(seen, ["m", "build", "ses_1"])
  })

  it("lets resend go out once with the same headers, then refuses", async () => {
    const calls: Array<{ body: string; auth: string | null }> = []
    let second: unknown
    getHooks().response.push(async (_res, ctx) => {
      const r = await ctx.resend({ model: "m", again: true })
      second = await ctx.resend({}).catch((e: Error) => e.message)
      return r
    })
    const out = await runResponse(
      new Response("first"),
      sent('{"model":"m"}'),
      async (body, headers) => {
        calls.push({ body, auth: headers.get("authorization") })
        return new Response("again")
      },
      newHookStats(),
    )
    assert.equal(await out.text(), "again")
    assert.deepEqual(calls, [
      { body: '{"model":"m","again":true}', auth: "Bearer t" },
    ])
    assert.match(String(second), /once/)
  })
})
