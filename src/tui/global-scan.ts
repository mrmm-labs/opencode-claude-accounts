/**
 * The 7-day store scan behind the global token view, run off the TUI thread.
 *
 * On a store of a few GB the scan takes seconds, and bun:sqlite blocks the
 * thread it runs on, so the TUI starts this file as a worker and waits for its
 * one message: the result, or `{ error }`.
 */

import { parentPort, workerData } from "node:worker_threads"

import { readStore } from "./store.ts"
import { dailySeries, globalTotals } from "./tokens.ts"
import { traffic } from "./traffic.ts"

type Db = {
  query: (sql: string) => { all: (...a: unknown[]) => unknown[] }
  close: () => void
}

export type GlobalScan = {
  totals?: ReturnType<typeof globalTotals>
  tools?: ReturnType<typeof traffic>
  daily?: number[]
  error?: string
}

export function scanGlobal(open: () => Db, now: number): GlobalScan {
  const db = open()
  try {
    const { sessions: rows, calls } = readStore(
      (sql, since) => db.query(sql).all(since),
      now - 7 * 86_400_000,
    )
    return {
      totals: globalTotals(rows),
      tools: traffic(calls),
      daily: dailySeries(
        rows as unknown as Parameters<typeof dailySeries>[0],
        now,
      ),
    }
  } finally {
    db.close()
  }
}

const job = workerData as { dbPath?: unknown; now?: unknown } | null
if (parentPort && typeof job?.dbPath === "string") {
  const port = parentPort
  const dbPath = job.dbPath
  const now = typeof job.now === "number" ? job.now : Date.now()
  ;(
    import("bun:sqlite" as string) as Promise<{
      Database: new (p: string, o: { readonly: boolean }) => Db
    }>
  )
    .then(({ Database }) =>
      scanGlobal(() => new Database(dbPath, { readonly: true }), now),
    )
    .then(
      (r) => port.postMessage(r),
      (e: unknown) =>
        port.postMessage({
          error: String((e as Error)?.message ?? e),
        } satisfies GlobalScan),
    )
}
