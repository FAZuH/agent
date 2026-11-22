/**
 * Self-check for abort delivery: one receipt per operation, the redaction
 * allowlist, bounded retries, notice statuses and the parent-abort
 * suppression. No host, no network: a fake IO and a temp state directory.
 *
 *   bun test plugins/watchdog/src/delivery.test.ts
 *
 * These are unit tests against the module, not host evidence.
 */

import { afterAll, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const scratch = mkdtempSync(join(tmpdir(), "jev-delivery-test-"))

const ENV_KEYS = ["JEV_DATA_DIR", "JEV_SECRET_DIR", "OPENCODE_JEV_STATE_HOME", "OPENCODE_JEV_SESSION_BAN_DIR"]
const prior: Record<string, string | undefined> = {}
for (const key of ENV_KEYS) prior[key] = process.env[key]

process.env.JEV_DATA_DIR = scratch
process.env.JEV_SECRET_DIR = join(scratch, "secrets")
process.env.OPENCODE_JEV_STATE_HOME = join(scratch, "jev")
process.env.OPENCODE_JEV_SESSION_BAN_DIR = join(scratch, "session-ban")

import type { AbortOutcome, ContainmentRow } from "./abort.ts"
import type { DeliveryIO } from "./delivery.ts"

const { appendAbortRecord, markAbortStarted, resetAbortMarks } = await import("./abort.ts")
const { queueAbortDelivery, pumpAbortDelivery, receiptBody, noticeText, readDeliveryRows, DELIVERY_FILE } = await import("./delivery.ts")

// Delivery rows and abort marks are process-wide state; each case starts clean.
beforeEach(() => {
  resetAbortMarks()
  rmSync(join(scratch, "jev", DELIVERY_FILE), { force: true })
})

afterAll(() => {
  for (const key of ENV_KEYS) {
    if (prior[key] === undefined) delete process.env[key]
    else process.env[key] = prior[key]
  }
  rmSync(scratch, { recursive: true, force: true })
})

const ENDPOINT = "http://receipts.example/hook"

interface DeliveryCalls {
  posts: Array<{ url: string; body: string }>
  notices: Array<{ parentID: string; text: string }>
  scheduled: Array<() => Promise<void>>
  audits: any[]
}

function fakeIO(over: Record<string, any> = {}) {
  const calls: DeliveryCalls = { posts: [], notices: [], scheduled: [], audits: [] }
  const io: DeliveryIO = {
    parentOf: over.parentOf ?? (async () => null),
    notice: async (parentID, text) => {
      calls.notices.push({ parentID, text })
      return over.notice ?? true
    },
    post: async (url, body) => {
      calls.posts.push({ url, body })
      return over.post ?? true
    },
    endpoint: () => over.endpoint ?? ENDPOINT,
    maxAttempts: () => over.maxAttempts ?? 3,
    retryDelayMs: () => over.retryDelayMs ?? 10,
    schedule: (run) => {
      calls.scheduled.push(run)
    },
    now: () => over.now ?? 1_000,
    audit: (row) => {
      calls.audits.push(row)
    },
  }
  return { io, calls }
}

function outcome(over: Record<string, any> = {}): AbortOutcome {
  return {
    ok: true,
    sealed: true,
    durable: true,
    receipt: true,
    ban: { written: 0, failed: 0 },
    operation: {
      id: over.id ?? "op_case",
      sessionID: over.sessionID ?? "ses_child",
      scope: over.scope ?? ["ses_child", "ses_desc"],
      source: over.source ?? "chain",
      cause: over.cause ?? "a test abort",
      at: over.at ?? 1000,
    },
    containment: over.containment ?? [{ step: "receipt", status: "done", detail: "record written" }],
    incomplete: over.incomplete ?? [],
  }
}

function rows(): Array<ReturnType<typeof asDeliveryRow>> {
  const read = readDeliveryRows()
  if (!read.ok) throw new Error("the delivery queue did not read")
  return read.rows
}

function asDeliveryRow(row: any) {
  return row
}

function partialRows(): ContainmentRow[] {
  return [
    { step: "receipt", status: "done", detail: "record written" },
    { step: "ban", status: "failed", detail: "1 refused" },
    { step: "interrupt", status: "unsupported", detail: "no interrupt primitive" },
  ]
}

describe("queue", () => {
  test("one row per operation, receipt queued when an endpoint is configured", () => {
    const { io, calls } = fakeIO()
    expect(queueAbortDelivery(io, outcome())).toBe("queued")
    const read = readDeliveryRows()
    expect(read.ok).toBe(true)
    if (!read.ok) throw new Error("unreachable")
    expect(read.rows.length).toBe(1)
    const row = read.rows[0]
    expect(row.operationID).toBe("op_case")
    expect(row.sessionID).toBe("ses_child")
    expect(row.scope).toBe(2)
    expect(row.source).toBe("chain")
    expect(row.cause).toBe("a test abort")
    expect(row.receipt.status).toBe("queued")
    expect(row.receipt.attempts).toBe(0)
    expect(row.notice).toBe("queued")
    expect(row.containment.length).toBe(1)
    expect(existsSync(join(scratch, "jev", DELIVERY_FILE))).toBe(true)
    expect(calls.audits.some((entry) => entry.event === "abort_delivery_queue" && entry.result === "queued")).toBe(true)
  })

  test("an empty endpoint names itself no-endpoint instead of faking a delivery", () => {
    const { io } = fakeIO({ endpoint: "" })
    expect(queueAbortDelivery(io, outcome({ id: "op_noendpoint" }))).toBe("queued")
    expect(rows()[0].receipt.status).toBe("no-endpoint")
  })

  test("a second queue of the same operation answers deduplicated and writes nothing", () => {
    const { io } = fakeIO()
    const event = outcome()
    expect(queueAbortDelivery(io, event)).toBe("queued")
    expect(queueAbortDelivery(io, event)).toBe("deduplicated")
    expect(rows().length).toBe(1)
  })

  test("an unreadable queue answers unavailable instead of reading as empty", () => {
    const { io, calls } = fakeIO()
    writeFileSync(join(scratch, "jev", DELIVERY_FILE), "{oops", { mode: 0o600 })
    expect(queueAbortDelivery(io, outcome())).toBe("unavailable")
    expect(readDeliveryRows().ok).toBe(false)
    expect(calls.audits.some((entry) => entry.event === "abort_delivery_queue" && entry.result === "unavailable")).toBe(true)
  })
})

describe("receipt body redaction", () => {
  test("the body is an allowlist: no endpoint, no scope id list, counts only", () => {
    const { io } = fakeIO()
    queueAbortDelivery(io, outcome({ containment: partialRows(), cause: "a judged abort" }))
    const row = rows()[0]
    const parsed = JSON.parse(receiptBody(row))
    expect(Object.keys(parsed).sort()).toEqual(["at", "cause", "containment", "event", "incomplete", "operationID", "scope", "sessionID", "source"])
    expect(parsed.event).toBe("abort_receipt")
    expect(typeof parsed.scope).toBe("number")
    expect(parsed.scope).toBe(2)
    for (const entry of parsed.containment) expect(Object.keys(entry).sort()).toEqual(["detail", "status", "step"])
    expect(receiptBody(row)).not.toContain("receipts.example")
    expect(receiptBody(row)).not.toContain("ses_desc")
  })

  test("a partial operation reports its exact shortfalls, never an all-stopped claim", () => {
    const { io } = fakeIO()
    queueAbortDelivery(io, outcome({ containment: partialRows() }))
    const parsed = JSON.parse(receiptBody(rows()[0]))
    expect(parsed.incomplete).toEqual(["ban:failed", "interrupt:unsupported"])
    const text = noticeText(rows()[0])
    expect(text).toContain("stopped short of: ban:failed, interrupt:unsupported")
    expect(text).not.toContain("Every containment step reported done")
  })

  test("a complete operation states its steps done without inflating them", () => {
    const { io } = fakeIO()
    queueAbortDelivery(io, outcome())
    const parsed = JSON.parse(receiptBody(rows()[0]))
    expect(parsed.incomplete).toEqual([])
    expect(noticeText(rows()[0])).toContain("Every containment step reported done")
  })
})

describe("pump receipts", () => {
  test("a successful POST delivers once and stops scheduling", async () => {
    const { io, calls } = fakeIO()
    queueAbortDelivery(io, outcome())
    await pumpAbortDelivery(io)
    expect(calls.posts.length).toBe(1)
    expect(calls.posts[0].url).toBe(ENDPOINT)
    // The body the transport received is the same allowlist the builder makes.
    const parsed = JSON.parse(calls.posts[0].body)
    expect(Object.keys(parsed).sort()).toEqual(["at", "cause", "containment", "event", "incomplete", "operationID", "scope", "sessionID", "source"])
    expect(calls.posts[0].body).not.toContain("receipts.example")
    const row = rows()[0]
    expect(row.receipt.status).toBe("delivered")
    expect(row.receipt.attempts).toBe(1)
    expect(calls.scheduled.length).toBe(0)
  })

  test("a no-endpoint row is never posted", async () => {
    const { io, calls } = fakeIO({ endpoint: "" })
    queueAbortDelivery(io, outcome({ id: "op_none" }))
    await pumpAbortDelivery(io)
    expect(calls.posts.length).toBe(0)
    expect(rows()[0].receipt.status).toBe("no-endpoint")
  })

  test("failures retry on schedule, then read failed at the cap and never exceed it", async () => {
    const { io, calls } = fakeIO({ post: false, maxAttempts: 3 })
    queueAbortDelivery(io, outcome({ id: "op_retry" }))
    await pumpAbortDelivery(io)
    expect(rows()[0].receipt.attempts).toBe(1)
    expect(rows()[0].receipt.status).toBe("queued")
    expect(calls.scheduled.length).toBe(1)
    await calls.scheduled.shift()!()
    expect(rows()[0].receipt.attempts).toBe(2)
    expect(rows()[0].receipt.status).toBe("queued")
    expect(calls.scheduled.length).toBe(1)
    await calls.scheduled.shift()!()
    expect(rows()[0].receipt.attempts).toBe(3)
    expect(rows()[0].receipt.status).toBe("failed")
    expect(calls.scheduled.length).toBe(0)
    expect(calls.posts.length).toBe(3)
    await pumpAbortDelivery(io)
    expect(rows()[0].receipt.attempts).toBe(3)
    expect(calls.posts.length).toBe(3)
  })

  test("an unreadable queue is a no-op pass", async () => {
    const { io, calls } = fakeIO()
    writeFileSync(join(scratch, "jev", DELIVERY_FILE), "{oops", { mode: 0o600 })
    await pumpAbortDelivery(io)
    expect(calls.posts.length).toBe(0)
    expect(calls.notices.length).toBe(0)
  })
})

describe("pump notices", () => {
  test("no host-recorded parent reads absent and never writes", async () => {
    const { io, calls } = fakeIO({ parentOf: async () => null })
    queueAbortDelivery(io, outcome({ id: "op_orphan" }))
    await pumpAbortDelivery(io)
    expect(rows()[0].notice).toBe("absent")
    expect(calls.notices.length).toBe(0)
  })

  test("a live parent abort suppresses the notice before any write", async () => {
    const { io, calls } = fakeIO({ parentOf: async () => "ses_parent_live" })
    markAbortStarted(["ses_parent_live"])
    queueAbortDelivery(io, outcome({ id: "op_liveparent" }))
    await pumpAbortDelivery(io)
    expect(rows()[0].notice).toBe("suppressed")
    expect(calls.notices.length).toBe(0)
  })

  test("an active durable operation covering the parent suppresses the notice", async () => {
    const { io, calls } = fakeIO({ parentOf: async () => "ses_parent_covered" })
    appendAbortRecord({
      operation: { id: "op_cover", sessionID: "ses_parent_covered", scope: ["ses_parent_covered"], source: "human", cause: "cover", at: 999 },
      containment: [],
    })
    queueAbortDelivery(io, outcome({ id: "op_coveredparent" }))
    await pumpAbortDelivery(io)
    expect(rows()[0].notice).toBe("suppressed")
    expect(calls.notices.length).toBe(0)
  })

  test("a released operation covering the parent no longer suppresses", async () => {
    const { io, calls } = fakeIO({ parentOf: async () => "ses_parent_released" })
    appendAbortRecord({
      operation: { id: "op_released_cover", sessionID: "ses_parent_released", scope: ["ses_parent_released"], source: "human", cause: "cover", at: 999, released: 1234 },
      containment: [],
    })
    queueAbortDelivery(io, outcome({ id: "op_releasedparent" }))
    await pumpAbortDelivery(io)
    expect(rows()[0].notice).toBe("delivered")
    expect(calls.notices.length).toBe(1)
  })

  test("a taken queue write delivers the notice once, with the fixed text", async () => {
    const { io, calls } = fakeIO({ parentOf: async () => "ses_parent_ok" })
    queueAbortDelivery(io, outcome({ id: "op_noticed" }))
    await pumpAbortDelivery(io)
    expect(rows()[0].notice).toBe("delivered")
    expect(calls.notices.length).toBe(1)
    expect(calls.notices[0].parentID).toBe("ses_parent_ok")
    expect(calls.notices[0].text).toContain("no turn was started and nothing was resumed")
    expect(calls.notices[0].text).not.toContain("receipts.example")
  })

  test("a refused queue write reads failed", async () => {
    const { io, calls } = fakeIO({ parentOf: async () => "ses_parent_refused", notice: false })
    queueAbortDelivery(io, outcome({ id: "op_refused" }))
    await pumpAbortDelivery(io)
    expect(rows()[0].notice).toBe("failed")
    expect(calls.notices.length).toBe(1)
  })

  test("a delivered receipt and a delivered notice are one pass over one row", async () => {
    const { io, calls } = fakeIO({ parentOf: async () => "ses_parent_both" })
    queueAbortDelivery(io, outcome({ id: "op_both" }))
    await pumpAbortDelivery(io)
    const row = rows()[0]
    expect(row.receipt.status).toBe("delivered")
    expect(row.notice).toBe("delivered")
    expect(calls.posts.length).toBe(1)
    expect(calls.notices.length).toBe(1)
  })
})

describe("pump survival and queue honesty (ticket #19 carry pairs)", () => {
  test("a transport that throws is one failed attempt: the row persists, the pass resolves, the bounded successor is scheduled", async () => {
    // The #17 carry: a throw used to escape the pass, so no write-back and no
    // successor ever landed and the receipt sat queued forever with no retry.
    const { io, calls } = fakeIO({ maxAttempts: 2 })
    ;(io as any).post = async (url: string, body: string) => {
      calls.posts.push({ url, body })
      throw new Error("the transport dropped dead")
    }
    expect(queueAbortDelivery(io, outcome({ id: "op_throw" }))).toBe("queued")
    await expect(pumpAbortDelivery(io)).resolves.toBeUndefined()
    const first = readDeliveryRows().rows.find((entry) => entry.operationID === "op_throw")
    expect(first?.receipt).toEqual({ status: "queued", attempts: 1, lastAt: 1000 })
    expect(calls.posts).toHaveLength(1)
    // The failed attempt owes its successor: the bounded retry contract.
    expect(calls.scheduled).toHaveLength(1)

    // The second throwing attempt exhausts the bound and the row reads failed.
    await expect(pumpAbortDelivery(io)).resolves.toBeUndefined()
    const second = readDeliveryRows().rows.find((entry) => entry.operationID === "op_throw")
    expect(second?.receipt).toEqual({ status: "failed", attempts: 2, lastAt: 1000 })
  })

  test("a parent lookup or notice that throws is a failed notice; the receipt side still settles", async () => {
    // The same escape in the notice half of the pass: a host whose session
    // listing throws must not strand the row or the receipt attempt.
    const thrown = fakeIO({ parentOf: async () => { throw new Error("the listing exploded") } })
    expect(queueAbortDelivery(thrown.io, outcome({ id: "op_parent_throw" }))).toBe("queued")
    await expect(pumpAbortDelivery(thrown.io)).resolves.toBeUndefined()
    const parentRow = readDeliveryRows().rows.find((entry) => entry.operationID === "op_parent_throw")
    expect(parentRow?.receipt.status).toBe("delivered")
    expect(parentRow?.notice).toBe("failed")

    const noticed = fakeIO({ parentOf: async () => "ses_parent_notice" })
    ;(noticed.io as any).notice = async () => {
      throw new Error("the queue write exploded")
    }
    expect(queueAbortDelivery(noticed.io, outcome({ id: "op_notice_throw" }))).toBe("queued")
    await expect(pumpAbortDelivery(noticed.io)).resolves.toBeUndefined()
    const noticeRow = readDeliveryRows().rows.find((entry) => entry.operationID === "op_notice_throw")
    expect(noticeRow?.receipt.status).toBe("delivered")
    expect(noticeRow?.notice).toBe("failed")
  })

  test("an unreadable queue file is unavailable, never an empty queue", async () => {
    // The #17 carry: every read error used to read as "nothing owed". Only a
    // missing file is empty; anything else must not lie about what it holds.
    const path = join(scratch, "jev", DELIVERY_FILE)
    rmSync(path, { force: true })
    mkdirSync(path, { recursive: true })
    try {
      expect(readDeliveryRows()).toEqual({ ok: false })
      const { io, calls } = fakeIO()
      expect(queueAbortDelivery(io, outcome({ id: "op_unreadable" }))).toBe("unavailable")
      expect(calls.audits).toContainEqual(expect.objectContaining({ event: "abort_delivery_queue", result: "unavailable" }))
      // A pump pass over an unreadable queue attempts nothing and stays alive.
      const pumped = fakeIO()
      await expect(pumpAbortDelivery(pumped.io)).resolves.toBeUndefined()
      expect(pumped.calls.posts).toEqual([])
    } finally {
      rmSync(path, { recursive: true, force: true })
    }
  })
})
