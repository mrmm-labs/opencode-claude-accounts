import assert from "node:assert/strict"
import { DatabaseSync } from "node:sqlite"
import { describe, it } from "node:test"
import { Worker } from "node:worker_threads"

import { scanGlobal } from "./global-scan.ts"

describe("scanGlobal", () => {
  it("totals the window from the store and closes the handle", () => {
    const d = new DatabaseSync(":memory:")
    d.exec(`
      create table session_v2 (id text, title text, parent_id text);
      create table session_message (session_id text, type text, time_created int, data text);
      insert into session_v2 values ('a','one',null);
      insert into session_message values ('a','assistant', ${Date.now()},
        '{"role":"assistant","cost":0.5,"tokens":{"input":1,"output":2,"cache":{"read":10,"write":0}}}');
    `)
    let closed = false
    const r = scanGlobal(
      () => ({
        query: (q) => ({ all: (...a) => d.prepare(q).all(...(a as [number])) }),
        close: () => {
          closed = true
        },
      }),
      Date.now() + 1,
    )
    assert.equal(r.totals?.sessions, 1)
    assert.equal(r.daily?.length, 7)
    assert.ok(closed)
  })

  it("answers with an error message as a worker when the store cannot open", async () => {
    const w = new Worker(new URL("./global-scan.ts", import.meta.url), {
      workerData: { dbPath: "/nonexistent/opencode.db", now: Date.now() },
    })
    const msg = await new Promise<{ error?: string }>((resolve, reject) => {
      w.once("message", resolve)
      w.once("error", reject)
    })
    await w.terminate()
    assert.equal(typeof msg.error, "string")
  })
})
