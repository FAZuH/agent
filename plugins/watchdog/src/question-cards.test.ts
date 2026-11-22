/** Question-card gate: V-PROPAGATE / V-ABORT flow. Scratch state, no live service. */
import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const scratch = mkdtempSync(join(tmpdir(), "jev-cards-"))
process.env.JEV_STATE_HOME = scratch
process.env.XDG_STATE_HOME = scratch
mkdirSync(join(scratch, "opencode"), { recursive: true })
writeFileSync(join(scratch, "opencode", "service.json"), JSON.stringify({ url: "http://127.0.0.1:1", password: "dummy" }))

const { loadState, saveState } = await import("../../../lib/jev/state.ts")
const { readToolBans, banTool, setToolBanCard, unbanTool, toolBanForForm } = await import("../../../lib/jev/tool-ban.ts")
const { resetCardRoute, markCardRouteActive, onBeforeExecute, handleCardReply, attachCardEvents, heldQuestionCards, releaseHeldCard, buildAskCard, ASK_OPTIONS } = await import("./question-cards.ts")
type CardDeps = import("./question-cards.ts").CardDeps
type DecideFn = import("./question-cards.ts").DecideFn

function setFlag(on: boolean) {
  const base = loadState()
  saveState({ config: { ...base.config, hook_tool_risk: { ...base.config.hook_tool_risk, questionCards: on } } })
}
function activate() {
  setFlag(true)
  resetCardRoute()
  markCardRouteActive()
}
function deactivate() {
  setFlag(false)
  resetCardRoute()
}
function stubFetch(onPost?: (formID: string) => void) {
  const original = globalThis.fetch
  const calls: Array<{ method: string; url: string }> = []
  const formIDs: string[] = []
  globalThis.fetch = (async (input: any, init: any) => {
    const method = String(init?.method ?? "")
    calls.push({ method, url: String(input ?? "") })
    if (method === "POST") {
      try {
        const id = String(JSON.parse(init?.body ?? "{}").id ?? "")
        formIDs.push(id)
        // A real host can hold the card and answer it before this process reads
        // the POST's response.
        onPost?.(id)
      } catch {}
    }
    return { status: 200, ok: true, text: async () => "{}" }
  }) as any
  return { calls, formIDs, restore: () => (globalThis.fetch = original) }
}
/**
 * An abort outcome as the unified operation returns it, minus the parts this
 * suite never inspects. `incomplete` stays truthful: tools and jobs have no
 * cancellation primitive, so the receipt always names them.
 */
function abortOutcome(scope: string[] = ["ses_block", "sub_a"], overrides: any = {}): any {
  const rows = [
    { step: "scope", status: "done", detail: `discovered ${scope.length - 1} owned descendants` },
    { step: "receipt", status: "done", detail: "the operation record carries this receipt" },
    { step: "ban", status: "done", detail: `durable subtree ban written for ${scope.length} of ${scope.length} sessions` },
    { step: "interrupt", status: "done", detail: `interrupted ${scope.length} of ${scope.length} sessions` },
    { step: "cards", status: "done", detail: "no question cards in scope" },
    { step: "approvals", status: "done", detail: "revoked 0 pending approvals; no native provider holds in scope" },
    { step: "reviews", status: "done", detail: "settled 0 queued reviews" },
    { step: "tools", status: "unsupported", detail: "no per-tool cancellation" },
    { step: "jobs", status: "unsupported", detail: "no background-job cancellation" },
  ]
  return {
    ok: true,
    sealed: true,
    durable: true,
    receipt: true,
    ban: { written: scope.length, failed: 0 },
    operation: { id: "op_1", sessionID: scope[0], scope, source: "chain", cause: "test", at: 1 },
    containment: rows,
    incomplete: rows.filter((row) => row.status !== "done"),
    ...overrides,
  }
}

function deps(stopped: string[] = []): CardDeps & { toolBanned: any[]; cards: any[]; changedEvents: any[]; notices: any[]; aborts: any[]; outcome: any } {
  const toolBanned: any[] = []
  const cards: any[] = []
  const changedEvents: any[] = []
  const notices: any[] = []
  const aborts: any[] = []
  const d: any = {
    outcome: abortOutcome(),
    stopTree: async (sessionID: string, cause: string) => {
      stopped.push(sessionID)
      aborts.push({ sessionID, cause })
      return d.outcome
    },
    toolBan: (sessionID, subagents, reason) => toolBanned.push({ sessionID, subagents, reason }),
    staleCard: () => undefined,
    setCard: (sessionID, formID, tool) => cards.push({ sessionID, formID, tool }),
    unbanTool: (sessionID) => 1,
    changed: (reason) => changedEvents.push(reason),
    notifyAbort: async (sessionID, text) => { notices.push({ sessionID, text }) },
    enforced: () => true,
    aborts,
    toolBanned,
    cards,
    changedEvents,
    notices,
  }
  return d as any
}
const allow: DecideFn = async () => ({ effect: "allow", resources: ["x"] })
const propagate: DecideFn = async () => ({ effect: "propagate", message: "jev: held for you", resources: ["x"] })
const deny: DecideFn = async () => ({ effect: "deny", message: "jev: denied", resources: ["x"] })
const abort: DecideFn = async () => ({ effect: "abort", message: "jev: abort", resources: ["x"] })
const event = { sessionID: "ses_block", tool: "bash", id: "call_1", input: {} }

async function answer(formIDs: string[], decision: string) {
  await new Promise((r) => setTimeout(r, 10))
  handleCardReply(formIDs[0], { decision })
}

describe("card gate API", () => {
  test("opens a card with exactly the three user options, including abort", async () => {
    const card = buildAskCard("bash", "nonce1", "review notice")
    expect(card.card.fields[0].options).toEqual([
      { value: "allow", label: "Allow" },
      { value: "deny", label: "Deny" },
      { value: "abort", label: "Abort session" },
    ])
    expect(card.card.metadata).toMatchObject({ kind: "question", jevTool: "bash", reviewNotice: "review notice" })
    expect(ASK_OPTIONS.map((o) => o.value)).toEqual(["allow", "deny", "abort"])
  })
  test("exports the gate without hold machinery", async () => {
    const m = await import("./question-cards.ts")
    expect(typeof m.onBeforeExecute).toBe("function")
    expect((m as any).awaitCard).toBeUndefined()
  })
})

describe("gate effects", () => {
  test("route inactive: onBeforeExecute is a no-op", async () => {
    deactivate()
    const f = stubFetch()
    const d = deps()
    try {
      await onBeforeExecute({}, event, propagate, d)
      expect(f.calls.length).toBe(0)
      expect(d.cards.length).toBe(0)
    } finally {
      f.restore()
    }
  })
  test("allow: tool runs, no stop, no card, no notify", async () => {
    activate()
    const d = deps()
    try {
      await onBeforeExecute({}, event, allow, d)
      expect(d.cards.length).toBe(0)
      expect(d.notices.length).toBe(0)
    } finally {
      deactivate()
    }
  })
  test("an abort that lands during the awaited decision refuses the allow", async () => {
    // With the chain and the session-ban provider off this route is the only
    // gate: the pre-decide read cannot be the last one.
    activate()
    const d = deps()
    let reads = 0
    d.blocked = () => (++reads === 1 ? null : "an abort covers this session, so this call is not admitted")
    try {
      await expect(onBeforeExecute({}, event, allow, d)).rejects.toThrow(/an abort covers this session/)
      expect(reads).toBeGreaterThan(1)
      expect(d.changedEvents).toEqual([])
    } finally {
      deactivate()
    }
  })
  test("allow before any abort still runs the call", async () => {
    activate()
    const d = deps()
    d.blocked = () => null
    try {
      await expect(onBeforeExecute({}, event, allow, d)).resolves.toBeUndefined()
    } finally {
      deactivate()
    }
  })
  test("the decision settles in the block that reads the gate, so a queued mark cannot land between them", async () => {
    // The read is the last step before the route answers the call. A read that
    // queues work is the hazard: if the answer travelled back across an await, that
    // work would run between the read and the settlement, and an abort that started
    // in it would find the call already released.
    activate()
    const { markAbortStarted, abortStarted, resetAbortMarks } = await import("./abort.ts")
    const sessionID = "ses_card_release_block"
    const seen: boolean[] = []
    let reads = 0
    const d = deps()
    d.blocked = () => {
      reads += 1
      // The second read is the one before the settlement; the first is the entry.
      if (reads === 2) void Promise.resolve().then(() => markAbortStarted([sessionID]))
      return null
    }
    const decided: DecideFn = async () => ({
      effect: "allow",
      resources: ["x"],
      settle: () => {
        seen.push(abortStarted(sessionID))
      },
    })
    try {
      await expect(onBeforeExecute({}, { ...event, sessionID }, decided, d)).resolves.toBeUndefined()
      // Settled before the queued mark ran, and the mark did run.
      expect(seen).toEqual([false])
      expect(abortStarted(sessionID)).toBe(true)
    } finally {
      resetAbortMarks()
      deactivate()
    }
  })

  test("deny skips only this call: no tree stop, no tool ban, no card", async () => {
    activate()
    const f = stubFetch()
    const stopped: string[] = []
    const d = deps(stopped)
    try {
      await expect(onBeforeExecute({}, event, deny, d)).rejects.toThrow(/denied/)
      expect(stopped).toEqual([])
      expect(d.toolBanned.length).toBe(0)
      expect(d.cards.length).toBe(0)
      expect(f.calls.length).toBe(0)
    } finally {
      f.restore()
      deactivate()
    }
  })
  test("abort stops the tree through the unified operation and names its own cause", async () => {
    activate()
    const stopped: string[] = []
    const d = deps(stopped)
    try {
      await expect(onBeforeExecute({}, event, abort, d)).rejects.toThrow(/abort/)
      expect(stopped).toContain("ses_block")
      // The trigger is the recorded cause, not a generic sentence.
      expect(d.aborts).toEqual([{ sessionID: "ses_block", cause: "the Jev verdict aborted the session" }])
      expect(d.notices.length).toBe(1)
      expect(d.notices[0].sessionID).toBe("ses_block")
      expect(d.notices[0].text).toContain("the Jev verdict aborted the session")
      expect(d.changedEvents).toContain("abort")
    } finally {
      deactivate()
    }
  })
  test("a failed identity write is named by the thrown message, never as a recorded operation", async () => {
    activate()
    const d = deps()
    // The store refused the first write: the operation has no durable record,
    // so nothing about it may read as recorded or restart-safe.
    d.outcome = abortOutcome(undefined, { ok: false, durable: false, receipt: false, sealed: false })
    try {
      const thrown = await onBeforeExecute({}, event, abort, d).catch((error) => error as Error)
      expect(thrown).toBeInstanceOf(Error)
      expect(thrown.message).toContain("abort record could not be written")
      expect(thrown.message).not.toContain("was recorded")
      expect(thrown.message).not.toContain("The stop is durable")
    } finally {
      deactivate()
    }
  })
  test("a stop nothing enforces is recorded, not called durable", async () => {
    activate()
    const d = deps()
    // Sealed record, no admission hook: the ban is on disk and blocks nothing.
    d.enforced = () => false
    try {
      await expect(onBeforeExecute({}, event, abort, d)).rejects.toThrow(/abort/)
      const text = String(d.notices[0]?.text ?? "")
      expect(text).toContain("No admission hook is active in this process")
      expect(text).not.toContain("The stop is durable")
    } finally {
      deactivate()
    }
  })
  test("an unrecorded stop with no hook names both facts, never 'recorded but not enforced'", async () => {
    activate()
    const d = deps()
    // The identity write failed AND every admission hook is off: two facts, and
    // the notice must not borrow the vocabulary of a recorded-but-unenforced stop.
    d.outcome = abortOutcome(undefined, { ok: false, durable: false, receipt: false, sealed: false })
    d.enforced = () => false
    try {
      await expect(onBeforeExecute({}, event, abort, d)).rejects.toThrow(/aborted/)
      const text = String(d.notices[0]?.text ?? "")
      expect(text).toContain("abort record could not be written")
      expect(text).toContain("No admission hook is active in this process")
      expect(text).not.toContain("The stop is recorded")
      expect(text).not.toContain("The stop is durable")
    } finally {
      deactivate()
    }
  })
  test("the thrown card result carries the enforcement caveat, never a bare durable stop", async () => {
    activate()
    const d = deps()
    // Sealed record, no admission hook: durable on disk, and it refuses nothing.
    d.enforced = () => false
    try {
      const thrown = await onBeforeExecute({}, event, abort, d).catch((error) => error as Error)
      expect(thrown.message).toContain("abort operation op_1 was recorded")
      expect(thrown.message).toContain("No admission hook is active in this process")
      expect(thrown.message).not.toContain("The stop is durable")
    } finally {
      deactivate()
    }
  })
  test("a failed record with a written ban states both, never 'nothing durable'", async () => {
    activate()
    const d = deps()
    // The identity append was refused, but the separate durable ban landed on
    // every scoped session. The record track cannot speak for the ban track: the
    // notice must name the missing record AND the ban that still refuses calls.
    d.outcome = abortOutcome(["ses_block", "sub_a"], { ok: false, durable: false, receipt: false, sealed: false, ban: { written: 2, failed: 0 } })
    try {
      await expect(onBeforeExecute({}, event, abort, d)).rejects.toThrow(/aborted/)
      const text = String(d.notices[0]?.text ?? "")
      expect(text).toContain("abort record could not be written")
      expect(text).toContain("The durable ban was written for all 2 sessions")
      expect(text).not.toContain("nothing durable covers this session")
      expect(text).not.toContain("The stop is durable")
    } finally {
      deactivate()
    }
  })
  test("a failed record with a partial ban counts the ban instead of generalising", async () => {
    activate()
    const d = deps()
    // Both writes fell short by different amounts: the record not at all, the ban
    // on one of two sessions. Each track reports its own count.
    d.outcome = abortOutcome(["ses_block", "sub_a"], { ok: false, durable: false, receipt: false, sealed: false, ban: { written: 1, failed: 1 } })
    d.enforced = () => false
    try {
      await expect(onBeforeExecute({}, event, abort, d)).rejects.toThrow(/aborted/)
      const text = String(d.notices[0]?.text ?? "")
      expect(text).toContain("abort record could not be written")
      expect(text).toContain("written for 1 of 2 sessions")
      expect(text).toContain("No admission hook is active in this process")
      expect(text).not.toContain("nothing durable covers this session")
    } finally {
      deactivate()
    }
  })
  test("the notice states what the receipt shows, never a blanket durable stop", async () => {
    activate()
    const d = deps()
    // Discovery failed and the ban landed on one of two scoped sessions: the
    // notice must say both instead of claiming the subtree stopped.
    d.outcome = abortOutcome(["ses_block", "sub_a"], {
      sealed: false,
      ban: { written: 1, failed: 1 },
      containment: [
        { step: "scope", status: "failed", detail: "the session listing did not answer within 5000ms" },
        { step: "receipt", status: "done", detail: "the operation record carries this receipt" },
        { step: "ban", status: "failed", detail: "durable subtree ban written for 1 of 2 sessions" },
        { step: "interrupt", status: "failed", detail: "interrupted 0 of 2 sessions; 2 refused" },
      ],
      incomplete: [
        { step: "scope", status: "failed", detail: "the session listing did not answer within 5000ms" },
        { step: "ban", status: "failed", detail: "durable subtree ban written for 1 of 2 sessions" },
        { step: "interrupt", status: "failed", detail: "interrupted 0 of 2 sessions; 2 refused" },
      ],
    })
    try {
      await expect(onBeforeExecute({}, event, abort, d)).rejects.toThrow(/abort/)
      const text = String(d.notices[0]?.text ?? "")
      expect(text).toContain("Discovery failed")
      expect(text).toContain("only the selected session is covered")
      expect(text).toContain("written for 1 of 2 sessions")
      expect(text).toContain("Containment incomplete")
      expect(text).toContain("not fully durable")
      // The old blanket claim is gone.
      expect(text).not.toContain("was stopped durably")
      expect(text).not.toContain("(including its subagents) was stopped")
    } finally {
      deactivate()
    }
  })
})

describe("V-PROPAGATE", () => {
  test("a reply that lands before the card POST returns still resolves the hold", async () => {
    // The host holds the card as soon as it accepts the POST, so its reply can
    // reach this process before the POST's response is read. A waiter armed only
    // after that response would drop the answer and hold the call to its timeout.
    activate()
    const f = stubFetch((id) => handleCardReply(id, { decision: "allow" }))
    const d = deps()
    d.askTimeoutMs = 50
    try {
      await expect(onBeforeExecute({}, event, propagate, d)).resolves.toBeUndefined()
      expect(d.changedEvents).toContain("propagate")
    } finally {
      f.restore()
      deactivate()
    }
  })
  test("holds the call and lets the tool run when the user allows", async () => {
    activate()
    const f = stubFetch()
    const d = deps()
    try {
      const p = onBeforeExecute({}, event, propagate, d)
      await answer(f.formIDs, "allow")
      await expect(p).resolves.toBeUndefined()
      expect(d.staleCard).toBeDefined()
      expect(d.cards.length).toBe(1)
      expect(d.changedEvents).toContain("propagate")
    } finally {
      f.restore()
      deactivate()
    }
  })
  test("an abort that lands while the card is open refuses the user's allow", async () => {
    activate()
    const f = stubFetch()
    const d = deps()
    // The entry read is clean; the abort lands while the card is open, so the
    // release after the card reads the restriction.
    let reads = 0
    d.blocked = () => (++reads <= 1 ? null : "an abort covers this session, so this call is not admitted")
    try {
      const p = onBeforeExecute({}, event, propagate, d)
      await answer(f.formIDs, "allow")
      await expect(p).rejects.toThrow(/an abort covers this session/)
    } finally {
      f.restore()
      deactivate()
    }
  })
  test("user deny skips the call without stopping the tree", async () => {
    activate()
    const f = stubFetch()
    const stopped: string[] = []
    const d = deps(stopped)
    try {
      const p = onBeforeExecute({}, event, propagate, d)
      await answer(f.formIDs, "deny")
      await expect(p).rejects.toThrow(/denied/)
      expect(stopped).toEqual([])
      expect(d.notices.length).toBe(0)
    } finally {
      f.restore()
      deactivate()
    }
  })
  test("user abort triggers V-ABORT: the unified stop, with the user as its cause", async () => {
    activate()
    const f = stubFetch()
    const stopped: string[] = []
    const d = deps(stopped)
    try {
      const p = onBeforeExecute({}, event, propagate, d)
      await answer(f.formIDs, "abort")
      await expect(p).rejects.toThrow(/aborted/)
      expect(stopped).toContain("ses_block")
      expect(d.aborts).toEqual([{ sessionID: "ses_block", cause: "the user aborted the session from a held card" }])
      expect(d.notices.length).toBe(1)
      expect(d.notices[0].text).toContain("the user aborted the session from a held card")
    } finally {
      f.restore()
      deactivate()
    }
  })
  test("a reply to a rejected card authorizes nothing, and the retry gets a fresh id", async () => {
    // The host rejected the first id (a duplicate), so that card is not this
    // call's: the id may name an existing card of someone else's. Its reply must
    // not authorize the hold even though it arrived first.
    activate()
    const posts: string[] = []
    const original = globalThis.fetch
    globalThis.fetch = (async (input: any, init: any) => {
      if (String(init?.method ?? "") !== "POST") return { status: 204, ok: true, text: async () => "{}" }
      const id = String(JSON.parse(init?.body ?? "{}").id ?? "")
      posts.push(id)
      if (posts.length === 1) {
        handleCardReply(id, { decision: "allow" })
        return { status: 409, ok: false, text: async () => "{}" }
      }
      // The retry is never answered: the rejected id's answer is gone.
      return { status: 200, ok: true, text: async () => "{}" }
    }) as any
    const d = deps()
    d.askTimeoutMs = 30
    try {
      // The retry opens and nobody answers it, so the hold ends on its timeout:
      // had the rejected id's allow applied, this would resolve instead.
      await expect(onBeforeExecute({}, event, propagate, d)).rejects.toThrow(/denied by the user/)
      expect(posts).toHaveLength(2)
      expect(posts[0]).not.toBe(posts[1])
      // Only the confirmed card is recorded, and only the retry id exists.
      expect(d.cards).toHaveLength(1)
      expect(d.cards[0].formID).toBe(posts[1])
    } finally {
      globalThis.fetch = original
      deactivate()
    }
  })
  test("a reply to a confirmed card still authorizes when the retry opened", async () => {
    // The retry is a real card: its own answer applies, so a rejection of the
    // first attempt costs a second POST and nothing else.
    activate()
    const posts: string[] = []
    const original = globalThis.fetch
    globalThis.fetch = (async (input: any, init: any) => {
      if (String(init?.method ?? "") !== "POST") return { status: 204, ok: true, text: async () => "{}" }
      const id = String(JSON.parse(init?.body ?? "{}").id ?? "")
      posts.push(id)
      if (posts.length === 1) {
        handleCardReply(id, { decision: "deny" })
        return { status: 409, ok: false, text: async () => "{}" }
      }
      handleCardReply(id, { decision: "allow" })
      return { status: 200, ok: true, text: async () => "{}" }
    }) as any
    const d = deps()
    d.askTimeoutMs = 50
    try {
      await expect(onBeforeExecute({}, event, propagate, d)).resolves.toBeUndefined()
      expect(posts).toHaveLength(2)
      expect(d.cards).toHaveLength(1)
      expect(d.cards[0].formID).toBe(posts[1])
    } finally {
      globalThis.fetch = original
      deactivate()
    }
  })
  test("a card the host never confirms settles the hold refused", async () => {
    activate()
    const original = globalThis.fetch
    globalThis.fetch = (async () => ({ status: 500, ok: false, text: async () => "{}" })) as any
    const d = deps()
    d.askTimeoutMs = 30
    try {
      await expect(onBeforeExecute({}, event, propagate, d)).rejects.toThrow(/could not be answered/)
      expect(d.cards).toHaveLength(0)
      expect(heldQuestionCards()).toEqual([])
    } finally {
      globalThis.fetch = original
      deactivate()
    }
  })
  test("an open question card is a held card the abort can release", async () => {
    activate()
    const f = stubFetch()
    const d = deps()
    d.askTimeoutMs = 60_000
    try {
      const p = onBeforeExecute({}, event, propagate, d)
      for (let tick = 0; tick < 200 && f.formIDs.length === 0; tick++) await new Promise((r) => setTimeout(r, 1))
      expect(heldQuestionCards()).toEqual([{ formID: f.formIDs[0], sessionID: "ses_block" }])
      expect(releaseHeldCard(f.formIDs[0])).toBe(true)
      await expect(p).rejects.toThrow(/could not be answered/)
      expect(heldQuestionCards()).toEqual([])
      expect(releaseHeldCard(f.formIDs[0])).toBe(false)
    } finally {
      f.restore()
      deactivate()
    }
  })
  test("a cancelled card settles the hold instead of waiting out its timeout", async () => {
    activate()
    const f = stubFetch()
    const d = deps()
    // The host dropped the card: the waiter must settle as a refusal, not wait
    // out the timeout. 300ms keeps a regression failing fast.
    d.askTimeoutMs = 300
    const queue: any[] = []
    let wake: (() => void) | null = null
    const stream = {
      [Symbol.asyncIterator]() {
        return {
          async next() {
            while (!queue.length) await new Promise<void>((resolve) => (wake = resolve))
            return { value: queue.shift(), done: false }
          },
        }
      },
    }
    try {
      attachCardEvents({ event: { subscribe: () => stream } })
      // Settled as a value: the rejection can land before the awaits below, and
      // an unawaited rejection would be reported as an unhandled one.
      const p = onBeforeExecute({}, event, propagate, d).then(
        () => "allowed",
        (error: Error) => error.message,
      )
      for (let tick = 0; tick < 200 && f.formIDs.length === 0; tick++) await new Promise((r) => setTimeout(r, 1))
      expect(f.formIDs).toHaveLength(1)
      queue.push({ type: "form.cancelled", data: { id: f.formIDs[0] } })
      wake?.()
      // The waiter itself is gone, not merely timed out: an ignored cancellation
      // would leave it registered until the timeout above.
      for (let tick = 0; tick < 100 && heldQuestionCards().length > 0; tick++) await new Promise((r) => setTimeout(r, 1))
      expect(heldQuestionCards()).toEqual([])
      expect(await p).toContain("could not be answered")
      expect(d.changedEvents).toContain("deny")
    } finally {
      f.restore()
      deactivate()
    }
  })
  test("times out to deny when the user never answers", async () => {
    activate()
    const f = stubFetch()
    const d = deps()
    d.askTimeoutMs = 5
    try {
      await expect(onBeforeExecute({}, event, propagate, d)).rejects.toThrow(/denied/)
    } finally {
      f.restore()
      deactivate()
    }
  })
  test("a second reply after the first is harmless", async () => {
    activate()
    const f = stubFetch()
    const d = deps()
    try {
      const p = onBeforeExecute({}, event, propagate, d)
      await answer(f.formIDs, "allow")
      await expect(p).resolves.toBeUndefined()
      expect(handleCardReply(f.formIDs[0], { decision: "abort" })).toBe(false)
    } finally {
      f.restore()
      deactivate()
    }
  })
})

describe("card records", () => {
  test("a 409 on first create stores the retry card id", async () => {
    activate()
    const original = globalThis.fetch
    let postCount = 0
    const created: string[] = []
    globalThis.fetch = (async (_input: any, init: any) => {
      if (String(init?.method) === "POST") {
        postCount++
        let id = ""
        try { id = String(JSON.parse(init?.body ?? "{}").id ?? "") } catch {}
        created.push(id)
        return postCount === 1
          ? ({ status: 409, ok: false, text: async () => "{}" } as any)
          : ({ status: 200, ok: true, text: async () => "{}" } as any)
      }
      return { status: 200, ok: true, text: async () => "{}" } as any
    }) as any
    const cards: any[] = []
    const d: CardDeps = {
      stopTree: async () => [],
      toolBan: (sid, subs, reason) => banTool(sid, subs, reason),
      staleCard: (sid) => readToolBans().find((b) => b.sessionID === sid)?.formID,
      setCard: (sid, formID, tool) => { setToolBanCard(sid, formID, tool); cards.push({ sid, formID }) },
      unbanTool: (sid) => unbanTool(sid),
      changed: () => {},
    }
    try {
      const p = onBeforeExecute({}, event, propagate, d)
      await new Promise((r) => setTimeout(r, 10))
      handleCardReply(created[1], { decision: "allow" })
      await expect(p).resolves.toBeUndefined()
      expect(postCount).toBe(2)
      expect(created[0]).not.toBe(created[1])
      expect(cards[0].formID).toBe(created[1])
    } finally {
      globalThis.fetch = original
      deactivate()
      unbanTool("ses_block")
    }
  })
  test("the tool ban card reply lifts the tool ban", async () => {
    banTool("ses_reply", ["sub_x"], "block")
    const fid = "frm_jev_block_reply1"
    setToolBanCard("ses_reply", fid, "bash")
    ;(globalThis as any).__jevCardLiftToolBan = (id: string) => unbanTool(id)
    expect(handleCardReply(fid, { decision: "lift-tool-ban" })).toBe(true)
    expect(toolBanForForm(fid)).toBeUndefined()
    expect(handleCardReply(fid, { decision: "lift-tool-ban" })).toBe(false)
    delete (globalThis as any).__jevCardLiftToolBan
  })
})
