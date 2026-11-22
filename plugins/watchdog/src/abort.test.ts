/**
 * Self-check for the abort operation: identity, scope, containment rows and the
 * durable ban. No host, no network, no model: a fake IO and a temp state
 * directory.
 *
 *   bun test plugins/watchdog/src/abort.test.ts
 *
 * These are unit tests against the modules, not host evidence.
 */

import { afterAll, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const scratch = mkdtempSync(join(tmpdir(), "jev-abort-test-"))

const ENV_KEYS = ["JEV_DATA_DIR", "JEV_SECRET_DIR", "OPENCODE_JEV_STATE_HOME", "OPENCODE_JEV_SESSION_BAN_DIR"]
const prior: Record<string, string | undefined> = {}
for (const key of ENV_KEYS) prior[key] = process.env[key]

process.env.JEV_DATA_DIR = scratch
process.env.JEV_SECRET_DIR = join(scratch, "secrets")
process.env.OPENCODE_JEV_STATE_HOME = join(scratch, "jev")
process.env.OPENCODE_JEV_SESSION_BAN_DIR = join(scratch, "session-ban")

import type { AbortIO, AbortRecord, ContainmentRow, ReleaseIO } from "./abort.ts"

const {
  abortSubtree,
  awaitReleaseHold,
  containDeny,
  incompleteContainment,
  readAbortRecords,
  appendAbortRecord,
  replaceAbortRecord,
  reconcileAbortRecords,
  releaseOperation,
  coveringOperations,
  markAbortStarted,
  resetAbortMarks,
  RELEASE_CONTINUE_TEXT,
  abortFile,
  ABORT_FILE,
} = await import("./abort.ts")
const { readSnapshot, writeSubtreeBan } = await import("./session-ban-state.ts")
const { verdict } = await import("./session-ban.ts")

// The mark registry is process-wide: a case that starts an abort must not
// refuse its session in the next file this run loads.
beforeEach(() => resetAbortMarks())

afterAll(() => {
  for (const key of ENV_KEYS) {
    if (prior[key] === undefined) delete process.env[key]
    else process.env[key] = prior[key]
  }
  rmSync(scratch, { recursive: true, force: true })
})

interface Calls {
  order: string[]
  marked: string[][]
  interrupts: string[]
  cards: Array<[string, string]>
  released: string[]
  reviews: string[][]
  holds: string[][]
  approvals: string[][]
  bans: Array<{ ids: string[]; cause: string }>
  audit: any[]
}

const FOUND = (...ids: string[]) => async () => ({ ok: true as const, ids })

function fakeIO(over: Record<string, any> = {}) {
  const calls: Calls = { order: [], marked: [], interrupts: [], cards: [], released: [], reviews: [], holds: [], approvals: [], bans: [], audit: [] }
  const records: AbortRecord[] = []
  const io: AbortIO = {
    subtree: over.subtree ?? FOUND(),
    markAborted: (ids: string[]) => {
      calls.marked.push(ids)
      calls.order.push("mark")
    },
    holdReleases: () => {
      calls.order.push("hold")
      return () => calls.order.push("unhold")
    },
    interrupt:
      over.interrupt ??
      (async (sessionID: string) => {
        calls.interrupts.push(sessionID)
        calls.order.push(`interrupt:${sessionID}`)
        return "done" as const
      }),
    cards: over.cards ?? (() => []),
    cancelCard:
      over.cancelCard ??
      (async (sessionID: string, formID: string) => {
        calls.cards.push([sessionID, formID])
        return true
      }),
    releaseCard: (formID: string) => {
      calls.released.push(formID)
    },
    reviews: (sessionIDs: string[]) => {
      calls.reviews.push(sessionIDs)
      return over.reviewsOut ?? { settled: 0, started: 0 }
    },
    holds: async (sessionIDs: string[]) => {
      calls.holds.push(sessionIDs)
      return over.holdsOut ?? { revoked: 0, failed: 0, unconfirmed: 0, unsupported: 0, openDetail: [] }
    },
    approvals: (sessionIDs: string[]) => {
      calls.approvals.push(sessionIDs)
      return over.approvalsOut ?? { revoked: 0, failed: 0 }
    },
    ban: (sessionIDs: string[], cause: string) => {
      calls.bans.push({ ids: sessionIDs, cause })
      calls.order.push("ban")
      return over.banOut ?? { written: sessionIDs.length, failed: 0 }
    },
    store: {
      append: (record: AbortRecord) => {
        calls.order.push("record")
        if (over.appendOk === false) return false
        records.push(record)
        return true
      },
      replace: (record: AbortRecord) => {
        if (over.replaceOk === false) return false
        const at = records.findIndex((entry) => entry.operation.id === record.operation.id)
        if (at >= 0) records[at] = record
        else records.push(record)
        return true
      },
    },
    now: () => over.now ?? 1_700_000_000_000,
    audit: (row: any) => calls.audit.push(row),
  }
  return { io, calls, records }
}

const rowOf = (containment: ContainmentRow[], step: string) => containment.find((row) => row.step === step)!

/** A fresh record store for one case: `abortFile()` resolves per call. */
function recordHome(name: string): string {
  const dir = join(scratch, `records-${name}`)
  mkdirSync(dir, { recursive: true })
  process.env.OPENCODE_JEV_STATE_HOME = dir
  return dir
}

describe("the abort operation", () => {
  test("one abort is one operation with its own identity and the selected subtree", async () => {
    const { io, records } = fakeIO({ subtree: FOUND("ses_child_a", "ses_child_b") })
    const first = await abortSubtree(io, { sessionID: "ses_root", source: "human", cause: "operator abort" })
    const second = await abortSubtree(io, { sessionID: "ses_root", source: "human", cause: "operator abort" })
    expect(first.operation.scope).toEqual(["ses_root", "ses_child_a", "ses_child_b"])
    expect(first.operation.sessionID).toBe("ses_root")
    expect(first.operation.source).toBe("human")
    expect(first.operation.id).toMatch(/^op_[0-9a-z]+$/)
    // Deselecting the same session twice keeps two independent operations.
    expect(second.operation.id).not.toBe(first.operation.id)
    expect(records).toHaveLength(2)
  })

  test("the selected session is cancelled before discovery, the subtree joins after", async () => {
    let releaseScan: (() => void) | null = null
    const { io, calls } = fakeIO({
      subtree: async () => {
        await new Promise<void>((resolve) => {
          releaseScan = resolve
        })
        return { ok: true as const, ids: ["ses_child_a"] }
      },
    })
    const pending = abortSubtree(io, { sessionID: "ses_root", source: "chain", cause: "the chain aborted" })
    for (let turn = 0; turn < 20 && !releaseScan; turn++) await new Promise((resolve) => setTimeout(resolve, 0))
    expect(releaseScan).not.toBeNull()
    // Discovery is still running, and the selected session already refuses: a
    // call parked in its final execution check cannot be allowed out of here.
    expect(calls.marked).toEqual([["ses_root"]])
    expect(calls.order).toContain("hold")
    expect(calls.bans).toEqual([])
    releaseScan!()
    await pending
    expect(calls.marked).toEqual([["ses_root"], ["ses_root", "ses_child_a"]])
  })

  test("a discovery call that never answers is bounded, and the hold is dropped", async () => {
    // A listing that never settles would pin every release waiting on this abort.
    const { io, calls } = fakeIO({ subtree: () => new Promise(() => {}) })
    const at = Date.now()
    const outcome = await abortSubtree(io, {
      sessionID: "ses_root",
      source: "chain",
      cause: "the chain aborted",
      scanTimeoutMs: 30,
    })
    expect(Date.now() - at).toBeLessThan(2000)
    // The hold is released, so the parked releases resume.
    expect(calls.order).toContain("unhold")
    // The selected session is still held; discovery is named as what it is.
    expect(outcome.operation.scope).toEqual(["ses_root"])
    const scope = rowOf(outcome.containment, "scope")
    expect(scope.status).toBe("failed")
    expect(scope.detail).toContain("did not answer within 30ms")
    expect(scope.detail).toContain("descendants are unknown")
    expect(calls.bans[0].ids).toEqual(["ses_root"])
    expect(outcome.sealed).toBe(false)
  }, 5000)

  test("the discovery hold covers a release that never goes through the chain", async () => {
    // With the chain off the io's own hold is a no-op, so the process-wide one is
    // the only thing keeping a card route's release out until the descendants are
    // known.
    let release: (() => void) | null = null
    const { io } = fakeIO({
      subtree: () =>
        new Promise((resolve) => {
          release = () => resolve({ ok: true as const, ids: ["ses_child_a"] })
        }),
      holdReleases: () => () => {},
    })
    const aborting = abortSubtree(io, { sessionID: "ses_root", source: "chain", cause: "the chain aborted" })
    let resumed = false
    const waiting = awaitReleaseHold().then(() => {
      resumed = true
    })
    await new Promise((r) => setTimeout(r, 5))
    expect(resumed).toBe(false)
    release!()
    await aborting
    await waiting
    expect(resumed).toBe(true)
  })

  test("a gate read waits out a hold opened during its own await", async () => {
    // The depth-zero race the epoch alone cannot close: no hold is open when the
    // gate is called, so the primitive returns on its fast path — and the caller's
    // await still yields before it can read anything. The abort opens its hold in
    // that gap. The gate must not be read across it.
    const { releaseWhenClear } = await import("./abort.ts")
    let releaseScan: (() => void) | null = null
    const fake = fakeIO({
      subtree: () =>
        new Promise((resolve) => {
          releaseScan = () => resolve({ ok: true as const, ids: ["ses_child"] })
        }),
    })
    let reads = 0
    const gate = releaseWhenClear(
      () => {
        reads += 1
        return "blocked"
      },
      (refusal) => refusal,
    )
    // Same synchronous block: the hold is open before the gate's continuation.
    const aborting = abortSubtree(fake.io, { sessionID: "ses_root", source: "chain", cause: "queued" })
    // The scan is parked, so the gate's continuation gets every chance to read:
    // while the hold is open it must not read at all.
    for (let turn = 0; turn < 5; turn++) await new Promise((r) => setTimeout(r, 0))
    expect(releaseScan).not.toBeNull()
    expect(reads).toBe(0)

    releaseScan!()
    expect(await gate).toBe("blocked")
    await aborting
    expect(reads).toBe(1)
  })

  test("the release runs in the block that reads the gate, before the read's own queued work", async () => {
    // The read and the release are one step. A read that queues work is the
    // hazard: if the answer travelled back to the caller across an await, that
    // queued work would run between the read and the release, and an abort that
    // started in it would find the call released on a stale clean answer.
    const { releaseWhenClear } = await import("./abort.ts")
    const order: string[] = []
    await releaseWhenClear(
      () => {
        order.push("read")
        void Promise.resolve().then(() => order.push("queued"))
        return null
      },
      () => {
        order.push("release")
      },
    )
    expect(order).toEqual(["read", "release", "queued"])
  })

  test("a release that captured the resolved promise still waits for a hold opened next", async () => {
    // The reviewed race: the promise captured was already resolved when a second
    // abort opened its own hold, so a single-shot await resumed with a descendant
    // neither marked nor banned. B opens here in the synchronous step right after
    // A's hold closed, before the waiter's continuation can run.
    const { awaitReleaseHold } = await import("./abort.ts")
    let releaseA: (() => void) | null = null
    let releaseB: (() => void) | null = null
    const a = fakeIO({
      subtree: () =>
        new Promise((resolve) => {
          releaseA = () => resolve({ ok: true as const, ids: ["ses_a_child"] })
        }),
    })
    const b = fakeIO({
      subtree: () =>
        new Promise((resolve) => {
          releaseB = () => resolve({ ok: true as const, ids: ["ses_b_child"] })
        }),
    })
    let abortingB: Promise<unknown> | null = null
    let startedB = false
    // A's hold closes, then the identity write runs synchronously: start B here,
    // between the close and any microtask, exactly the window in question.
    const appendA = a.io.store.append
    a.io.store.append = (record) => {
      const ok = appendA(record)
      if (!startedB) {
        startedB = true
        abortingB = abortSubtree(b.io, { sessionID: "ses_root_b", source: "chain", cause: "second" })
      }
      return ok
    }

    const abortingA = abortSubtree(a.io, { sessionID: "ses_root_a", source: "chain", cause: "first" })
    let resumed = false
    const waiting = awaitReleaseHold().then(() => {
      resumed = true
    })
    expect(releaseA).not.toBeNull()

    releaseA!()
    await new Promise((r) => setTimeout(r, 0))
    // B's scan is still parked: the waiter must not have resumed on A's promise.
    expect(startedB).toBe(true)
    expect(resumed).toBe(false)

    releaseB!()
    await waiting
    await abortingA
    await abortingB
    expect(resumed).toBe(true)
  })

  test("the scope is registered, then the durable ban written, before anything is interrupted", async () => {
    const { io, calls } = fakeIO({ subtree: FOUND("ses_child_a") })
    await abortSubtree(io, { sessionID: "ses_root", source: "chain", cause: "the chain aborted" })
    // Registration first, so a call already awaiting its execution check cannot
    // release into a scope that is about to be banned.
    expect(calls.marked[0]).toEqual(["ses_root"])
    expect(calls.marked[1]).toEqual(["ses_root", "ses_child_a"])
    // The selected session is marked, then the scan's release hold is taken;
    // the subtree joins before the hold lifts, and only then is anything written.
    expect(calls.order.slice(0, 6)).toEqual(["mark", "hold", "mark", "unhold", "record", "ban"])
  })

  test("ancestors and unrelated siblings stay outside the scope", async () => {
    const { io, calls } = fakeIO({
      subtree: FOUND("ses_child_a"),
      cards: () => [
        { formID: "frm_in_scope", sessionID: "ses_child_a" },
        { formID: "frm_sibling", sessionID: "ses_sibling" },
      ],
    })
    const outcome = await abortSubtree(io, { sessionID: "ses_root", source: "chain", cause: "the chain aborted" })
    expect(outcome.operation.scope).toEqual(["ses_root", "ses_child_a"])
    expect(calls.bans[0].ids).toEqual(["ses_root", "ses_child_a"])
    expect(calls.interrupts).toEqual(["ses_child_a", "ses_root"])
    expect(calls.released).toEqual(["frm_in_scope"])
    expect(calls.cards).toEqual([["ses_child_a", "frm_in_scope"]])
    expect(calls.approvals[0]).toEqual(["ses_root", "ses_child_a"])
  })

  test("a refused interrupt is incomplete containment, never a stop", async () => {
    const { io } = fakeIO({
      subtree: FOUND("ses_child_a"),
      interrupt: async (sessionID: string) => (sessionID === "ses_child_a" ? "refused" : "done"),
    })
    const outcome = await abortSubtree(io, { sessionID: "ses_root", source: "chain", cause: "the chain aborted" })
    expect(rowOf(outcome.containment, "interrupt").status).toBe("failed")
    expect(rowOf(outcome.containment, "interrupt").detail).toContain("1 of 2")
    expect(rowOf(outcome.containment, "interrupt").detail).toContain("1 refused")
    expect(incompleteContainment(outcome.containment).map((row) => row.step)).toContain("interrupt")
  })

  test("an interrupt the host does not answer is unconfirmed, not a stop", async () => {
    const { io } = fakeIO({
      subtree: FOUND("ses_child_a"),
      interrupt: async () => "unconfirmed",
    })
    const outcome = await abortSubtree(io, { sessionID: "ses_root", source: "chain", cause: "the chain aborted" })
    const row = rowOf(outcome.containment, "interrupt")
    expect(row.status).toBe("unconfirmed")
    expect(row.detail).toContain("0 of 2")
    expect(row.detail).toContain("2 unconfirmed")
  })

  test("a host with no interrupt primitive is unsupported, never a stop", async () => {
    const { io } = fakeIO({
      subtree: FOUND("ses_child_a"),
      interrupt: async () => "unsupported",
    })
    const outcome = await abortSubtree(io, { sessionID: "ses_root", source: "chain", cause: "the chain aborted" })
    const row = rowOf(outcome.containment, "interrupt")
    expect(row.status).toBe("unsupported")
    expect(row.detail).toContain("2 could not be attempted")
  })

  test("failed discovery is incomplete containment over the known session only", async () => {
    const { io, calls } = fakeIO({ subtree: async () => ({ ok: false as const, reason: "the session listing failed" }) })
    const outcome = await abortSubtree(io, { sessionID: "ses_root", source: "chain", cause: "the chain aborted" })
    // The selected session is known and stays held; the descendants are not.
    expect(outcome.operation.scope).toEqual(["ses_root"])
    expect(calls.bans[0].ids).toEqual(["ses_root"])
    const scope = rowOf(outcome.containment, "scope")
    expect(scope.status).toBe("failed")
    expect(scope.detail).toContain("the session listing failed")
    expect(scope.detail).toContain("unknown")
    // The subtree is not reported as blocked when discovery never ran.
    expect(outcome.sealed).toBe(false)
    expect(incompleteContainment(outcome.containment).map((row) => row.step)).toContain("scope")
  })

  test("a started review cannot be cancelled and is recorded unsupported", async () => {
    const { io } = fakeIO({ reviewsOut: { settled: 2, started: 1 } })
    const outcome = await abortSubtree(io, { sessionID: "ses_root", source: "chain", cause: "the chain aborted" })
    const row = rowOf(outcome.containment, "reviews")
    expect(row.status).toBe("unsupported")
    expect(row.detail).toContain("settled 2")
    expect(row.detail).toContain("discarded")
  })

  test("a failed card cancellation is not reported as confirmed cleanup", async () => {
    const { io, calls } = fakeIO({
      cards: () => [
        { formID: "frm_one", sessionID: "ses_root" },
        { formID: "frm_two", sessionID: "ses_root" },
      ],
      cancelCard: async (_sessionID: string, formID: string) => formID === "frm_one",
    })
    const outcome = await abortSubtree(io, { sessionID: "ses_root", source: "human", cause: "operator abort" })
    const row = rowOf(outcome.containment, "cards")
    expect(row.status).toBe("failed")
    expect(row.detail).toContain("1 of 2")
    // Both waiters are released: a card that could not be removed is not a hold.
    expect(calls.released).toEqual(["frm_one", "frm_two"])
  })

  test("a native provider hold is counted in the approvals row, never reported as none", async () => {
    // A provider hold is not a card: it waits in the session-ban provider with a
    // pending permission prompt behind it. The row must count it, or the receipt
    // reads "no holds" while a prompt is still on screen.
    const { io, calls } = fakeIO({ holdsOut: { revoked: 1, failed: 0, unconfirmed: 0, unsupported: 0, openDetail: [] } })
    const outcome = await abortSubtree(io, { sessionID: "ses_root", source: "human", cause: "operator abort" })
    const row = rowOf(outcome.containment, "approvals")
    expect(row.status).toBe("done")
    expect(row.detail).toContain("native provider holds: 1 released")
    expect(row.detail).not.toContain("no native provider holds")
    // The inventory is asked over the same scope the abort holds.
    expect(calls.holds).toEqual([["ses_root"]])
    // The cards row speaks only for question cards, so it cannot be read as a
    // claim about every kind of hold.
    expect(rowOf(outcome.containment, "cards").detail).toBe("no question cards in scope")
  })

  test("a prompt the host refused to close makes the approvals step incomplete", async () => {
    const { io } = fakeIO({ holdsOut: { revoked: 1, failed: 1, unconfirmed: 0, unsupported: 0, openDetail: [] } })
    const outcome = await abortSubtree(io, { sessionID: "ses_root", source: "human", cause: "operator abort" })
    const row = rowOf(outcome.containment, "approvals")
    expect(row.status).toBe("failed")
    expect(row.detail).toContain("1 released")
    expect(row.detail).toContain("1 left open")
    expect(incompleteContainment(outcome.containment).map((item) => item.step)).toContain("approvals")
  })

  test("a hold whose prompt was never named is unconfirmed, not a release", async () => {
    const { io } = fakeIO({
      holdsOut: {
        revoked: 0,
        failed: 0,
        unconfirmed: 2,
        unsupported: 1,
        openDetail: [
          { requestID: null, reason: "unnamed" },
          { requestID: null, reason: "unnamed" },
        ],
      },
    })
    const outcome = await abortSubtree(io, { sessionID: "ses_root", source: "human", cause: "operator abort" })
    const row = rowOf(outcome.containment, "approvals")
    expect(row.status).toBe("unsupported")
    expect(row.detail).toContain("2 with no prompt named")
    expect(row.detail).toContain("1 not cancellable")
    expect(incompleteContainment(outcome.containment).map((item) => item.step)).toContain("approvals")
  })

  test("a named prompt is reported by its request id, apart from an unnamed one", async () => {
    // Two prompts stayed open for different reasons. Collapsing them into "no
    // prompt named" would hide the request id a recovery reader needs, so the row
    // carries both facts and stays incomplete.
    const { io } = fakeIO({
      holdsOut: {
        revoked: 0,
        failed: 0,
        unconfirmed: 3,
        unsupported: 0,
        openDetail: [
          { requestID: null, reason: "unnamed" },
          { requestID: "per_named_1", reason: "in-flight" },
          { requestID: "per_named_2", reason: "no-outcome" },
        ],
      },
    })
    const outcome = await abortSubtree(io, { sessionID: "ses_root", source: "human", cause: "operator abort" })
    const row = rowOf(outcome.containment, "approvals")
    expect(row.status).toBe("unconfirmed")
    expect(row.detail).toContain("1 with no prompt named")
    expect(row.detail).toContain("2 unconfirmed (request per_named_1: a reply is still in flight; request per_named_2: no reply outcome was observed)")
    expect(incompleteContainment(outcome.containment).map((item) => item.step)).toContain("approvals")
  })

  test("unsupported tool and job cancellation is named, never claimed", async () => {
    const { io, calls } = fakeIO()
    const outcome = await abortSubtree(io, { sessionID: "ses_root", source: "chain", cause: "the chain aborted" })
    expect(rowOf(outcome.containment, "tools").status).toBe("unsupported")
    expect(rowOf(outcome.containment, "jobs").status).toBe("unsupported")
    const steps = incompleteContainment(outcome.containment).map((row) => row.step)
    expect(steps).toContain("tools")
    expect(steps).toContain("jobs")
    // The audit row names the incomplete steps, so no row reads as "all stopped".
    const row = calls.audit.find((entry: any) => entry.event === "abort_operation")!
    expect(row.incomplete).toContain("tools:unsupported")
    expect(row.incomplete).toContain("jobs:unsupported")
  })

  test("an abort whose receipt cannot be written leaves a record that claims nothing", async () => {
    const { io, records } = fakeIO({ replaceOk: false })
    const outcome = await abortSubtree(io, { sessionID: "ses_root", source: "human", cause: "operator abort" })
    expect(outcome.durable).toBe(true)
    expect(outcome.receipt).toBe(false)
    // A receipt that did not land never reads as sealed, whatever the ban did.
    expect(outcome.sealed).toBe(false)
    expect(rowOf(outcome.containment, "receipt").status).toBe("failed")
    expect(incompleteContainment(outcome.containment).map((row) => row.step)).toContain("receipt")
    // The identity-only write says every step is unconfirmed, never that all stopped.
    const seeded = records[0].containment
    expect(seeded).toHaveLength(1)
    expect(seeded[0]).toMatchObject({ step: "receipt", status: "unsupported" })
    expect(seeded[0].detail).toContain("unconfirmed")
  })

  test("a written receipt is done, and the unsupported steps stay named", async () => {
    const { io } = fakeIO({ subtree: FOUND("ses_child_a") })
    const outcome = await abortSubtree(io, { sessionID: "ses_root", source: "chain", cause: "the chain aborted" })
    expect(rowOf(outcome.containment, "receipt").status).toBe("done")
    expect(outcome.receipt).toBe(true)
    // Sealed means discovery ran and the ban reached every scope member; it is
    // never "all stopped".
    expect(outcome.sealed).toBe(true)
    expect(outcome.ban).toEqual({ written: 2, failed: 0 })
    expect(incompleteContainment(outcome.containment).map((row) => row.step)).toEqual(["tools", "jobs"])
  })

  test("a record that cannot be written is reported, not claimed durable", async () => {
    const { io } = fakeIO({ appendOk: false })
    const outcome = await abortSubtree(io, { sessionID: "ses_root", source: "chain", cause: "the chain aborted" })
    expect(outcome.durable).toBe(false)
    expect(outcome.ok).toBe(false)
    expect(outcome.sealed).toBe(false)
  })

  test("a partial ban write is reported as coverage, not as a sealed subtree", async () => {
    const { io } = fakeIO({
      subtree: FOUND("ses_child_a"),
      banOut: { written: 1, failed: 1 },
    })
    const outcome = await abortSubtree(io, { sessionID: "ses_root", source: "chain", cause: "the chain aborted" })
    expect(outcome.ban).toEqual({ written: 1, failed: 1 })
    expect(outcome.sealed).toBe(false)
    expect(rowOf(outcome.containment, "ban").status).toBe("failed")
  })

  test("the cause reaches the record as printable ASCII, clipped", async () => {
    const { io, records } = fakeIO()
    const outcome = await abortSubtree(io, {
      sessionID: "ses_root",
      source: "human",
      cause: `bad\u0000cause\u001b[31m ${"x".repeat(300)}`,
    })
    expect(outcome.operation.cause.length).toBeLessThanOrEqual(160)
    expect(outcome.operation.cause).not.toContain("\u0000")
    expect(outcome.operation.cause).not.toContain("\u001b")
    expect(records[0].operation.cause).toBe(outcome.operation.cause)
  })
})

describe("the operation store", () => {
  test("a written operation is readable after a restart", async () => {
    recordHome("restart")
    const record: AbortRecord = {
      operation: { id: "op_restart1", sessionID: "ses_keep", scope: ["ses_keep", "ses_keep_child"], source: "chain", cause: "the chain aborted", at: 5 },
      containment: [{ step: "interrupt", status: "done", detail: "interrupted 2 of 2 sessions" }],
    }
    expect(appendAbortRecord(record)).toBe(true)
    expect(
      replaceAbortRecord({
        ...record,
        containment: [...record.containment, { step: "tools", status: "unsupported", detail: "no per-tool cancellation" }],
      }),
    ).toBe(true)
    expect(abortFile()).toBe(join(process.env.OPENCODE_JEV_STATE_HOME!, ABORT_FILE))
    const read = readAbortRecords()
    expect(read.ok).toBe(true)
    if (!read.ok) throw new Error("unreachable")
    expect(read.records).toHaveLength(1)
    expect(read.records[0].operation.sessionID).toBe("ses_keep")
    expect(read.records[0].containment.map((row) => row.step)).toEqual(["interrupt", "tools"])
  })

  test("a corrupt record file is an error, never an empty set", () => {
    recordHome("corrupt")
    writeFileSync(abortFile(), "{ not json")
    const read = readAbortRecords()
    expect(read.ok).toBe(false)
    if (read.ok) throw new Error("unreachable")
    expect(read.reason).toBe("corrupt")
  })

  test("an identity-only record is reconciled: the ban is rewritten from its own scope", async () => {
    recordHome("recovery")
    const { io, calls } = fakeIO()
    // The real record file: recovery must rewrite what a restart would read.
    io.store = { append: appendAbortRecord, replace: replaceAbortRecord }
    // The state a process death between the identity write and the ban leaves.
    const record: AbortRecord = {
      operation: { id: "op_crashed", sessionID: "ses_crash", scope: ["ses_crash", "ses_crash_child"], source: "chain", cause: "the chain aborted", at: 7 },
      containment: [{ step: "receipt", status: "unsupported", detail: "the containment receipt was not written; treat every step as unconfirmed" }],
    }
    expect(appendAbortRecord(record)).toBe(true)

    expect(reconcileAbortRecords(io)).toEqual({ restored: 1, failed: 0, blocked: null, scopes: ["ses_crash", "ses_crash_child"] })
    expect(calls.bans[0].ids).toEqual(["ses_crash", "ses_crash_child"])
    const read = readAbortRecords()
    expect(read.ok).toBe(true)
    if (!read.ok) throw new Error("unreachable")
    const rows = read.records[0].containment
    expect(rows.find((row) => row.step === "ban")?.status).toBe("done")
    // The receipt still says unconfirmed: recovery re-applies the restriction, it
    // does not invent the steps that never returned.
    expect(rows.some((row) => row.step === "receipt" && row.status === "done")).toBe(false)
    expect(calls.audit[0]).toMatchObject({ event: "abort_recovery", operationID: "op_crashed", scope: 2 })
  })

  test("a confirmed record is left alone by recovery", async () => {
    recordHome("recovery-clean")
    const { io, calls } = fakeIO()
    const record: AbortRecord = {
      operation: { id: "op_finished", sessionID: "ses_done", scope: ["ses_done"], source: "human", cause: "operator abort", at: 8 },
      containment: [
        { step: "ban", status: "done", detail: "durable subtree ban written for 1 of 1 sessions" },
        { step: "receipt", status: "done", detail: "the operation record carries this receipt" },
      ],
    }
    expect(appendAbortRecord(record)).toBe(true)
    expect(reconcileAbortRecords(io)).toEqual({ restored: 0, failed: 0, blocked: null, scopes: ["ses_done"] })
    expect(calls.bans).toEqual([])
    expect(calls.audit).toEqual([])
  })

  test("a confirmed receipt with a failed ban is re-asserted, not skipped", async () => {
    recordHome("recovery-receipt-done-ban-failed")
    const { io, calls } = fakeIO()
    io.store = { append: appendAbortRecord, replace: replaceAbortRecord }
    // The shape a ban write failure leaves behind: the record says it is
    // complete, the ban row says it is not. Keyed on the receipt, recovery would
    // skip it and leave the scope unbanned forever.
    const record: AbortRecord = {
      operation: { id: "op_ban_failed", sessionID: "ses_bf", scope: ["ses_bf", "ses_bf_child"], source: "human", cause: "operator abort", at: 6 },
      containment: [
        { step: "ban", status: "failed", detail: "durable subtree ban written for 0 of 2 sessions" },
        { step: "receipt", status: "done", detail: "the operation record carries this receipt" },
      ],
    }
    expect(appendAbortRecord(record)).toBe(true)

    expect(reconcileAbortRecords(io)).toEqual({ restored: 1, failed: 0, blocked: null, scopes: ["ses_bf", "ses_bf_child"] })
    expect(calls.bans[0].ids).toEqual(["ses_bf", "ses_bf_child"])
    expect(calls.bans[0].cause).toBe("recovery: the abort ban was not confirmed")
    const read = readAbortRecords()
    if (!read.ok) throw new Error("unreachable")
    expect(read.records[0].containment.find((row) => row.step === "ban")?.status).toBe("done")
    // The receipt is untouched: recovery re-applies enforcement, it does not
    // rewrite what the operation already reported.
    expect(read.records[0].containment.find((row) => row.step === "receipt")?.status).toBe("done")
  })

  test("a ban row that names a partial scope is not a confirmed ban", async () => {
    recordHome("recovery-partial-ban")
    const { io, calls } = fakeIO()
    // `done` with a count short of the recorded scope is the shape a partially
    // written ban leaves; the row's own numbers are what decide.
    appendAbortRecord({
      operation: { id: "op_partial", sessionID: "ses_p", scope: ["ses_p", "ses_p_child"], source: "chain", cause: "the chain aborted", at: 5 },
      containment: [
        { step: "ban", status: "done", detail: "durable subtree ban written for 1 of 2 sessions" },
        { step: "receipt", status: "done", detail: "the operation record carries this receipt" },
      ],
    })
    expect(reconcileAbortRecords(io).restored).toBe(1)
    expect(calls.bans[0].ids).toEqual(["ses_p", "ses_p_child"])
  })

  test("a ban recovery that cannot write blocks its own scope", async () => {
    recordHome("recovery-failed")
    const { io, calls } = fakeIO({ banOut: { written: 0, failed: 1 } })
    appendAbortRecord({
      operation: { id: "op_blocked", sessionID: "ses_blocked", scope: ["ses_blocked"], source: "chain", cause: "the chain aborted", at: 9 },
      containment: [{ step: "receipt", status: "unsupported", detail: "the containment receipt was not written; treat every step as unconfirmed" }],
    })
    // The record file is readable, but this scope has no enforcement: the gate
    // must carry the scope, never report a clean recovery.
    expect(reconcileAbortRecords(io)).toEqual({
      restored: 0,
      failed: 1,
      blocked: { reason: "reassert-failed", sessions: ["ses_blocked"] },
      scopes: ["ses_blocked"],
    })
    expect(calls.audit.some((row: any) => row.event === "abort_recovery_blocked" && row.reason === "reassert-failed")).toBe(true)
  })

  test("the blocked scope is the union of every record whose ban did not land", async () => {
    recordHome("recovery-union")
    const { io } = fakeIO({ banOut: { written: 0, failed: 2 } })
    for (const [id, sessionID] of [["op_a", "ses_a"], ["op_b", "ses_b"]] as const) {
      appendAbortRecord({
        operation: { id, sessionID, scope: [sessionID, `${sessionID}_child`], source: "chain", cause: "the chain aborted", at: 10 },
        containment: [{ step: "receipt", status: "unsupported", detail: "the containment receipt was not written; treat every step as unconfirmed" }],
      })
    }
    const outcome = reconcileAbortRecords(io)
    expect(outcome.blocked).toEqual({ reason: "reassert-failed", sessions: ["ses_a", "ses_a_child", "ses_b", "ses_b_child"] })
  })

  test("a corrupt record store is a recovery failure, never a clean result", async () => {
    recordHome("recovery-corrupt")
    writeFileSync(abortFile(), "{ not json")
    const { io, calls } = fakeIO()
    expect(reconcileAbortRecords(io)).toEqual({ restored: 0, failed: 0, blocked: { reason: "corrupt", sessions: null }, scopes: [] })
    // Nothing is attempted: the scopes are unknown, so no ban is guessed.
    expect(calls.bans).toEqual([])
    expect(calls.audit[0]).toMatchObject({ event: "abort_recovery_blocked", reason: "corrupt" })
  })

  test("an unreadable record store is a recovery failure with its own reason", async () => {
    recordHome("recovery-unreadable")
    mkdirSync(abortFile(), { recursive: true })
    const { io, calls } = fakeIO()
    expect(reconcileAbortRecords(io)).toEqual({ restored: 0, failed: 0, blocked: { reason: "unreadable", sessions: null }, scopes: [] })
    expect(calls.bans).toEqual([])
    expect(calls.audit[0]).toMatchObject({ event: "abort_recovery_blocked", reason: "unreadable" })
  })

  test("one malformed record makes the whole store unrecoverable", async () => {
    recordHome("recovery-malformed")
    writeFileSync(
      abortFile(),
      JSON.stringify({
        v: 1,
        operations: [
          {
            operation: { id: "op_ok", sessionID: "ses_ok", scope: ["ses_ok"], source: "chain", cause: "aborted", at: 1 },
            containment: [{ step: "receipt", status: "done", detail: "the operation record carries this receipt" }],
          },
          { operation: { id: "op_bad" } },
        ],
      }),
    )
    const { io, calls } = fakeIO()
    expect(reconcileAbortRecords(io)).toEqual({ restored: 0, failed: 0, blocked: { reason: "corrupt", sessions: null }, scopes: [] })
    expect(calls.bans).toEqual([])
  })
})

describe("the operation record", () => {
  test("carries no prompt, argument, secret or model text", async () => {
    const { io, calls, records } = fakeIO({
      subtree: FOUND("ses_child_a"),
      cards: () => [{ formID: "frm_one", sessionID: "ses_root" }],
      reviewsOut: { settled: 1, started: 1 },
      approvalsOut: { revoked: 1, failed: 0 },
    })
    await abortSubtree(io, { sessionID: "ses_root", source: "chain", cause: "the review chain aborted this session" })
    const audit = JSON.stringify(calls.audit)
    const detail = JSON.stringify(records)
    for (const text of [audit, detail]) {
      expect(text).not.toContain("command")
      expect(text).not.toContain("arguments")
      expect(text).not.toContain("prompt")
      expect(text).not.toContain("SECRET")
    }
    // The audit names the incomplete steps and the scope size, nothing else.
    const row = calls.audit.find((entry: any) => entry.event === "abort_operation")!
    expect(row.scope).toBe(2)
    expect(row.linearizedAt).toBe(1_700_000_000_000)
    expect(Object.keys(row).sort()).toEqual(["cause", "event", "incomplete", "linearizedAt", "operationID", "scope", "sessionID", "source"])
  })
})

describe("the chain verdict's deny shapes", () => {
  test("a queued deny cancels only that call", async () => {
    const { io, calls, records } = fakeIO()
    const outcome = await containDeny(io, { sessionID: "ses_root", itemID: "wd_abc.1", shape: "queued" })
    expect(outcome.aborted).toBe(false)
    expect(records).toHaveLength(0)
    expect(calls.audit).toHaveLength(1)
    expect(calls.audit[0]).toMatchObject({ event: "chain_deny", shape: "queued" })
    expect(calls.interrupts).toEqual([])
  })

  test("a started deny records the source deny separately from the subtree abort", async () => {
    const { io, calls, records } = fakeIO({ subtree: FOUND("ses_child_a") })
    const outcome = await containDeny(io, { sessionID: "ses_root", itemID: "wd_abc.2", shape: "started" })
    expect(outcome.aborted).toBe(true)
    expect(records).toHaveLength(1)
    // Two rows, two events: the verdict that decided and the containment it caused.
    const events = calls.audit.map((row: any) => row.event)
    expect(events[0]).toBe("chain_deny")
    expect(events).toContain("abort_operation")
    expect(calls.audit[0].shape).toBe("started")
    expect(records[0].operation.source).toBe("chain")
  })
})

describe("the durable abort ban", () => {
  test("no approval and no later user turn clears a subtree ban", async () => {
    const dir = join(scratch, "session-ban")
    mkdirSync(dir, { recursive: true })
    expect(writeSubtreeBan("ses_ban_me", "abort op_1", 1_700_000_000_000)).toBe(true)
    const read = readSnapshot("ses_ban_me")
    expect(read.ok).toBe(true)
    expect(read.snap?.sessionBan?.kind).toBe("subtree")
    // A later frontier (an ordinary user message) and a fresh human approval.
    const decision = verdict(
      {
        parentID: "ses_ban_me",
        fingerprint: "f",
        callKey: "k",
        approvedGeneration: 9,
        frontierNow: 10_000,
        stateOk: true,
        audit: "clean",
        now: 1_900_000_000_000,
      },
      [],
      read.snap!.sessionBan,
    )
    expect(decision).toMatchObject({ effect: "deny", row: "6", retire: false, generation: null })
  })

  test("a parent-kind ban is the approvable one, which is why the abort does not write it", () => {
    const decision = verdict(
      {
        parentID: "ses_ban_me",
        fingerprint: "f",
        callKey: "k",
        approvedGeneration: 9,
        frontierNow: 10_000,
        stateOk: true,
        audit: "clean",
        now: 1_900_000_000_000,
      },
      [],
      { kind: "parent", atSeq: 1, cause: "session abort", at: 1 },
    )
    expect(decision.effect).toBe("allow")
  })
})

describe("the release operation", () => {
  const CONFIRMED: ContainmentRow[] = [
    { step: "ban", status: "done", detail: "durable subtree ban written for the whole scope" },
    { step: "receipt", status: "done", detail: "the operation record carries this receipt" },
  ]
  const IDENTITY_ONLY: ContainmentRow[] = [
    { step: "receipt", status: "unsupported", detail: "the containment receipt was not written; treat every step as unconfirmed" },
  ]

  const recordOf = (id: string, sessionID: string, scope: string[], over: Record<string, any> = {}): AbortRecord => ({
    operation: { id, sessionID, scope, source: "human", cause: "operator abort", at: 1, ...over },
    containment: CONFIRMED,
  })

  interface ReleaseCalls {
    unbans: Array<[string, string]>
    unmarks: string[][]
    continues: Array<{ sessionID: string; text: string }>
    audits: any[]
  }

  function fakeReleaseIO(over: Record<string, any> = {}) {
    const calls: ReleaseCalls = { unbans: [], unmarks: [], continues: [], audits: [] }
    const io: ReleaseIO = {
      unban: (sessionID, operation) => {
        calls.unbans.push([sessionID, operation])
        return over.unban ? over.unban(sessionID, operation) : ("cleared" as const)
      },
      unmark: (sessionIDs) => calls.unmarks.push(sessionIDs),
      continue: async (sessionID, text) => {
        calls.continues.push({ sessionID, text })
        return over.continue ? await over.continue(sessionID, text) : ("sent" as const)
      },
      // The real record file: coverage is derived from it, so the store is it.
      store: { append: appendAbortRecord, replace: replaceAbortRecord },
      now: () => over.now ?? 2_000_000_000_000,
      audit: (row: any) => calls.audits.push(row),
    }
    return { io, calls }
  }

  test("an unknown id and an unreadable store release nothing", async () => {
    recordHome("release-unknown")
    appendAbortRecord(recordOf("op_known", "ses_known", ["ses_known"]))
    const { io, calls } = fakeReleaseIO()
    const unknown = await releaseOperation(io, { operationID: "op_missing" })
    expect(unknown.ok).toBe(false)
    expect(unknown.reason).toContain("no abort operation has this id")
    writeFileSync(abortFile(), "{ not json")
    const corrupt = await releaseOperation(io, { operationID: "op_known", continue: true })
    expect(corrupt.ok).toBe(false)
    expect(corrupt.reason).toContain("cannot be read")
    expect(corrupt.continued).toBe("prevented")
    expect(calls.unbans).toEqual([])
    expect(calls.continues).toEqual([])
  })

  test("a child's release never lifts the ancestor's coverage over it", async () => {
    // Criterion 7: B is the child's own abort, A an ancestor's separate one.
    recordHome("release-child-first")
    appendAbortRecord(recordOf("op_anc", "ses_root", ["ses_root", "ses_child"]))
    appendAbortRecord(recordOf("op_child", "ses_child", ["ses_child"]))
    const { io, calls } = fakeReleaseIO()
    const outcome = await releaseOperation(io, { operationID: "op_child", continue: true })
    // The ancestor covers the child's whole scope, so nothing clears.
    expect(outcome.ok).toBe(true)
    expect(outcome.covered).toEqual(["ses_child"])
    expect(outcome.ban).toEqual({ cleared: 0, kept: 0, failed: 0 })
    expect(outcome.incomplete).toEqual([])
    expect(calls.unbans).toEqual([])
    expect(calls.unmarks).toEqual([[]])
    // No continuation: the child is still effectively blocked by the ancestor.
    expect(outcome.continued).toBe("prevented")
    expect(outcome.reason).toContain("still effectively blocked")
    expect(calls.continues).toEqual([])
    // The child's operation is released on disk; the ancestor's is untouched.
    const read = readAbortRecords()
    if (!read.ok) throw new Error("unreachable")
    expect(read.records.find((entry) => entry.operation.id === "op_child")?.operation.released).toBe(2_000_000_000_000)
    expect(read.records.find((entry) => entry.operation.id === "op_anc")?.operation.released).toBeUndefined()
  })

  test("the ancestor's release lifts only itself, and continuing it resumes no child", async () => {
    // Criterion 8: A is released while the child's own abort stands.
    recordHome("release-ancestor-first")
    appendAbortRecord(recordOf("op_anc", "ses_root", ["ses_root", "ses_child"]))
    appendAbortRecord(recordOf("op_child", "ses_child", ["ses_child"]))
    const { io, calls } = fakeReleaseIO()
    const outcome = await releaseOperation(io, { operationID: "op_anc", continue: true })
    expect(outcome.covered).toEqual(["ses_child"])
    expect(calls.unbans).toEqual([["ses_root", "op_anc"]])
    expect(calls.unmarks).toEqual([["ses_root"]])
    // One prompt, to the selected session only; the child's own abort holds it.
    expect(outcome.continued).toBe("sent")
    expect(calls.continues).toEqual([{ sessionID: "ses_root", text: RELEASE_CONTINUE_TEXT }])
    // The release and its continuation persist as one operation state.
    const read = readAbortRecords()
    if (!read.ok) throw new Error("unreachable")
    const released = read.records.find((entry) => entry.operation.id === "op_anc")?.operation
    expect(released?.released).toBe(2_000_000_000_000)
    expect(released?.continuedAt).toBe(2_000_000_000_000)
    expect(read.records.find((entry) => entry.operation.id === "op_child")?.operation.released).toBeUndefined()
  })

  test("releasing both operations clears every restriction, one prompt each", async () => {
    // Criterion 9, both-released half: no session stays covered.
    recordHome("release-both")
    appendAbortRecord(recordOf("op_anc", "ses_root", ["ses_root", "ses_child"]))
    appendAbortRecord(recordOf("op_child", "ses_child", ["ses_child"]))
    const { io, calls } = fakeReleaseIO()
    const first = await releaseOperation(io, { operationID: "op_anc", continue: true })
    const second = await releaseOperation(io, { operationID: "op_child", continue: true })
    expect(first.covered).toEqual(["ses_child"])
    expect(first.continued).toBe("sent")
    expect(second.covered).toEqual([])
    expect(second.ban).toEqual({ cleared: 1, kept: 0, failed: 0 })
    expect(second.continued).toBe("sent")
    expect(calls.unbans.map((entry) => entry[0])).toEqual(["ses_root", "ses_child"])
    expect(calls.continues.map((entry) => entry.sessionID)).toEqual(["ses_root", "ses_child"])
  })

  test("an operation that lands between the clear and the send prevents the prompt", async () => {
    recordHome("release-race")
    appendAbortRecord(recordOf("op_solo", "ses_solo", ["ses_solo"]))
    let landed = false
    const { io, calls } = fakeReleaseIO({
      unban: () => {
        if (!landed) {
          // A second abort lands while the rows are being cleared.
          landed = true
          appendAbortRecord(recordOf("op_late", "ses_solo", ["ses_solo"]))
        }
        return "cleared"
      },
    })
    const outcome = await releaseOperation(io, { operationID: "op_solo", continue: true })
    expect(outcome.continued).toBe("prevented")
    expect(outcome.reason).toContain("still effectively blocked")
    expect(calls.continues).toEqual([])
  })

  test("a live abort mark at the send boundary prevents the prompt", async () => {
    recordHome("release-mark")
    appendAbortRecord(recordOf("op_mark", "ses_mark", ["ses_mark"]))
    // The fake unmark records the call and leaves the real mark registry
    // alone, which stands in for an abort that landed in the window between
    // the unmark and the send boundary.
    markAbortStarted(["ses_mark"])
    const { io, calls } = fakeReleaseIO()
    const outcome = await releaseOperation(io, { operationID: "op_mark", continue: true })
    expect(outcome.continued).toBe("prevented")
    expect(outcome.reason).toContain("still effectively blocked")
    expect(calls.continues).toEqual([])
  })

  test("a restriction row that fails to clear stays blocked and blocks the prompt", async () => {
    recordHome("release-unban-failed")
    appendAbortRecord(recordOf("op_f", "ses_f", ["ses_f", "ses_f_child"]))
    const { io, calls } = fakeReleaseIO({ unban: () => "failed" })
    const outcome = await releaseOperation(io, { operationID: "op_f", continue: true })
    expect(outcome.ban).toEqual({ cleared: 0, kept: 0, failed: 2 })
    expect(outcome.incomplete).toEqual([{ step: "ban", status: "failed", detail: expect.stringContaining("stay blocked") }])
    expect(outcome.continued).toBe("prevented")
    expect(calls.continues).toEqual([])
  })

  test("another family's row on the selected session prevents its continuation", async () => {
    recordHome("release-kept")
    appendAbortRecord(recordOf("op_k", "ses_k", ["ses_k"]))
    const { io, calls } = fakeReleaseIO({ unban: () => "kept" })
    const outcome = await releaseOperation(io, { operationID: "op_k", continue: true })
    expect(outcome.ban).toEqual({ cleared: 0, kept: 1, failed: 0 })
    expect(outcome.incomplete).toEqual([])
    expect(outcome.continued).toBe("prevented")
    expect(calls.continues).toEqual([])
  })

  test("a retried release finishes the clear but never repeats the prompt", async () => {
    // Criterion 10's retry: the record says released and continued, the rows
    // are whatever a crash left, and the answer is `already`.
    recordHome("release-retry")
    appendAbortRecord(recordOf("op_r", "ses_r", ["ses_r"]))
    const { io, calls } = fakeReleaseIO()
    const first = await releaseOperation(io, { operationID: "op_r", continue: true })
    expect(first.already).toBe(false)
    expect(first.continued).toBe("sent")
    expect(first.receipt).toBe(true)
    const second = await releaseOperation(io, { operationID: "op_r", continue: true })
    expect(second.already).toBe(true)
    expect(second.ok).toBe(true)
    expect(second.continued).toBe("already")
    // The row clear ran again, idempotently; the prompt did not.
    expect(calls.unbans).toEqual([
      ["ses_r", "op_r"],
      ["ses_r", "op_r"],
    ])
    expect(calls.continues).toHaveLength(1)
  })

  test("the release audit is counts and statuses only", async () => {
    recordHome("release-audit")
    appendAbortRecord(recordOf("op_a", "ses_a", ["ses_a"]))
    const { io, calls } = fakeReleaseIO()
    await releaseOperation(io, { operationID: "op_a" })
    expect(calls.audits).toHaveLength(1)
    const row = calls.audits[0]
    expect(Object.keys(row).sort()).toEqual([
      "already",
      "cleared",
      "continued",
      "durable",
      "event",
      "failed",
      "kept",
      "operationID",
      "scope",
      "sessionID",
    ])
    expect(row.event).toBe("abort_release")
    // No continuation text, no prompt vocabulary, no call detail.
    expect(JSON.stringify(calls.audits)).not.toContain("Continue")
    expect(JSON.stringify(calls.audits)).not.toContain("prompt")
  })

  test("effective coverage is the OR of every active operation's scope", () => {
    const records = [
      recordOf("op_direct", "ses_c", ["ses_c"]),
      recordOf("op_anc", "ses_root", ["ses_root", "ses_c"]),
      recordOf("op_rel", "ses_other", ["ses_other"], { released: 5 }),
      recordOf("op_far", "ses_far", ["ses_far"]),
    ]
    expect(coveringOperations(records, "ses_c").map((operation) => operation.id)).toEqual(["op_direct", "op_anc"])
    expect(coveringOperations(records, "ses_far").map((operation) => operation.id)).toEqual(["op_far"])
    expect(coveringOperations(records, "ses_unrelated")).toEqual([])
  })

  test("a released operation is not re-asserted at restart", async () => {
    // Criterion 6's restart half: the released scope keeps no enforcement, the
    // active one keeps all of it.
    recordHome("release-reconcile")
    appendAbortRecord({
      operation: { id: "op_rel", sessionID: "ses_rel", scope: ["ses_rel", "ses_rel_child"], source: "human", cause: "operator abort", at: 1, released: 5 },
      containment: IDENTITY_ONLY,
    })
    appendAbortRecord({
      operation: { id: "op_live", sessionID: "ses_live", scope: ["ses_live"], source: "human", cause: "operator abort", at: 2 },
      containment: IDENTITY_ONLY,
    })
    const { io, calls } = fakeIO()
    const outcome = reconcileAbortRecords(io)
    expect(outcome.scopes).toEqual(["ses_live"])
    expect(outcome.blocked).toEqual(null)
    expect(calls.bans.map((ban) => ban.ids)).toEqual([["ses_live"]])
    expect(calls.bans[0].cause).toBe("recovery: the abort ban was not confirmed")
  })
})
