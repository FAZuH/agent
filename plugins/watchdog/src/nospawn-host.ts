/**
 * The host glue for the no-respawn rule: the only module that touches `ctx`.
 *
 * Five jobs, in the order one `subagent` call meets them:
 *
 * 1. Observe, inside the tool wrapper, before the assert. Never throws: a throw
 *    there is a pre-assert `Tool.Error` that skips `permission.evaluate`, which
 *    would be a bypass rather than a block.
 * 2. Enforce, in `permission.evaluate`, through the real `verdict()`. A hold
 *    sets the effect to `ask`, so the host's own prompt asks the human; a deny
 *    sets the effect. A failure of this path denies, unlike every other Jev
 *    hook, which fails open.
 * 3. Bind, on `execute.after` and `session.created`, the child the call created.
 * 4. Cascade, on abort: seal the tombstone, revoke the call's pending prompts,
 *    interrupt the task's sessions, and contain only in-window unbound children.
 * 5. Keep the frontier, from `session.inbox.enqueued`, with the bounded repair
 *    schedule of design section 7.4.
 *
 * Trust boundary. The approval generation comes from a human reply this module
 * observes on `permission.replied` and nowhere else: not from the permission
 * event, not from the tool input, not from anything the model wrote. The
 * frontier comes from the durable event feed. Both are read per call, so a
 * change applies without a restart.
 *
 * Store reads are classified here, not in the store: `ENOENT` is a missing
 * file, and any other read error is unreadable evidence that holds the parent.
 * The store's own reader cannot tell the two apart, and this path must not
 * inherit that.
 */

import { readFileSync } from "node:fs"
import {
  ADMISSION_WINDOW_MS,
  BIND_GRACE_MS,
  HOLD_FANOUT,
  HOLD_MS,
  fingerprint,
  holdMarker,
  inAdmissionWindow,
  nextGeneration,
  verdict,
  type AdmissionDecision,
  type AdmissionInput,
  type AbortAuthority,
  type AuditEvidence,
  type CallRecord,
  type Fence,
  type Row,
  type TaskRecord,
  tombstoneState,
} from "./nospawn.ts"
import * as fsStore from "./nospawn-state.ts"
import { logCall } from "../../../lib/lib-jev/state.ts"
import {
  INBOX_ENQUEUED,
  USER_ITEM,
  applyEvent,
  retrySchedule,
  type FeedState,
  type Frontier,
  type SessionEvent,
} from "./nospawn-frontier.ts"

/** The tool this rule is about, and the only action it judges. */
export const SUBAGENT = "subagent"
/**
 * The durable events the keeper needs: the frontier, binding, deletion, and the
 * two ephemeral permission frames a hold is settled through.
 */
export const EVENT_TYPES = ["session.created", "session.deleted", "session.inbox.enqueued", "permission.asked", "permission.replied"]
/**
 * The last moment the host starts a mutation while a live pid holds the lock:
 * the store's stale window minus two wait budgets, because `write()` makes two
 * attempts and each waits one. Derived, so the two constants cannot drift.
 */
export const LOCK_TAKEOVER_MS = fsStore.LOCK_STALE_MS - 2 * fsStore.LOCK_WAIT_MS

type Verdict = "allow" | "hold" | "deny"

/** What the user asked to stop: one task key, or the parent's whole run. */
export interface AbortRequest {
  parentID: string
  /** The task key. Required for scope "task", absent for "session". */
  fingerprint?: string
  scope: "task" | "session"
  /** Who decided. Recorded on the tombstone and in the audit. */
  by: AbortAuthority
  cause: string
}

/** What one abort did: what the command prints and the audit records. */
export interface AbortReceipt {
  /** After this call the task is stopped, or the session is fenced. */
  sealed: boolean
  /** The tombstone or fence reached disk. False means memory-only: a restart loses it. */
  durable: boolean
  /** Call keys the aborted task owned, settled deny `revocation:abort`. */
  revoked: string[]
  /** Session ids the host accepted an interrupt for. */
  interrupted: string[]
  /** Children left alone; the audit line carries the reason. */
  preserved: string[]
  /** Bound children whose subtree fence reached disk: row 6 holds for them. */
  fenced: number
  /** Bound children whose fence write failed, so row 6 does not hold for them. */
  fenceFailures: string[]
  /**
   * The host posted its own synthetic notice for this abort. The command route
   * reads it to avoid saying the same thing twice.
   */
  notified: boolean
  /** Why nothing new was sealed. */
  reason?: string
}

export interface ObservedCall {
  sessionID: string
  messageID: string
  callID: string
  agent: string
  prompt: string
  resumeChildID?: string
}

export interface Decision {
  /** What the table decided. A `hold` with no answer still denies the call. */
  decision: Verdict
  row: Row
  reason: string
  /** The generation this decision admits, minted only from a human reply. */
  generation: number | null
  /** What the call's effect became: `allow` leaves the event, `deny` and `ask` write it. */
  effect: "allow" | "deny" | "ask"
}

export interface HostOptions {
  ctx?: any
  /** Store overrides for tests; the real module otherwise. */
  store?: Partial<typeof fsStore>
  /** The switch, re-read per call: turning it off stops enforcement at once. */
  enabled?: () => boolean
  /** The evaluator. Injected only to count invocations; the real table by default. */
  evaluate?: (input: AdmissionInput, records: TaskRecord[], fence?: Fence) => AdmissionDecision
  now?: () => number
  /** Retry timer for the degraded schedule. */
  schedule?: (fn: () => void, ms: number) => unknown
  /** One repair attempt: true when the feed answered. */
  repair?: (parentID: string) => boolean
  /** Read the tool call's own input, to catch a wrapper that saw another prompt. */
  readPrompt?: (ctx: any, call: { sessionID: string; messageID: string; callID: string }) => Promise<string | null>
  holdMs?: number
  graceMs?: number
  capMs?: number
}

export interface AdmissionHost {
  observe(call: ObservedCall): void
  enforce(event: any): Promise<Decision>
  /** One `permission.asked` frame: correlate it to the hold whose marker it carries. */
  asked(event: any): void
  /** One `permission.replied` frame: settle the hold it answers, if it is ours. */
  replied(event: any): void
  after(event: any): void
  created(event: any): void
  deleted(event: any): void
  /**
   * One `session.inbox.enqueued`. `itemType` is the wire's `data.item.type`
   * verbatim: only a `user` item advances the frontier, and a missing type is
   * not a user item.
   */
  userItem(parentID: string, seq: number, itemType?: unknown): void
  frontierFailed(parentID: string, reason: string): void
  frontierRepaired(parentID: string): void
  /** The durable feed died: every parent served by it is degraded. */
  feedFailed(reason: string): void
  /**
   * Stop one task or the parent's run. The only entry point for the rule: the
   * gate has no way to reach it from a verdict.
   */
  abort(request: AbortRequest): Promise<AbortReceipt>
  /** Fence the parent's own run and interrupt its children. */
  fenceParent(parentID: string, cause: string): Promise<void>
  /** Fence, revoke the session's open calls, then interrupt it and its children. */
  abortSession(parentID: string, by: AbortAuthority, cause: string): Promise<AbortReceipt>
  close(): void
}

interface Entry {
  key: string
  parentID: string
  messageID: string
  callID: string
  fingerprint: string | null
  agent: string
  resumeChildID?: string
  at: number
  /** The admission record reached the store. A failed write leaves it false. */
  durable: boolean
  /** From observation until `execute.after`: the child may still be unbound. */
  open: boolean
  settled: Decision | null
  /** A human answered the hold and the call was admitted. */
  approved: boolean
  /** The row of the hold currently open for this call, if any. */
  holdRow: Row | null
  /** The reason the open hold carries, for its settlement line and marker. */
  holdReason: string
  /** The marker the host's prompt shows. `permission.asked` is matched on it. */
  holdMarker: string | null
  /** The host's pending-permission id, once `permission.asked` names it. */
  perId: string | null
  /** Jev issued the reply for `perId`: its own frame carries no author. */
  jevReplied: boolean
  /** The hold deadline. Cleared on settlement, so a stale timer writes nothing. */
  holdTimer: unknown
}

interface ParentState {
  frontier: Frontier
  subscription: FeedState
  /** The durable log read. Nothing reads it in B, so it starts healthy. */
  log: FeedState
  attempts: number
  since: number | null
  /** Why the feed failed, for the audit line a held admission writes. */
  reason: string
  timer: unknown
}

interface ChildInfo {
  parentID: string
  at: number
}

/** The parts of a call key. An incomplete triple identifies nothing. */
export function callKey(sessionID: string, messageID: string, callID: string): string {
  if (!sessionID || !messageID || !callID) return ""
  return `${sessionID}|${messageID}|${callID}`
}

export function createAdmissionHost(options: HostOptions = {}): AdmissionHost {
  const store: typeof fsStore = { ...fsStore, ...(options.store ?? {}) }
  const evaluate = options.evaluate ?? verdict
  const now = options.now ?? (() => Date.now())
  const schedule = options.schedule ?? ((fn: () => void, ms: number) => setTimeout(fn, ms))
  const holdMs = options.holdMs ?? HOLD_MS
  const graceMs = options.graceMs ?? BIND_GRACE_MS
  const capMs = options.capMs ?? ADMISSION_WINDOW_MS
  const enabled = options.enabled ?? (() => true)
  const ctx = options.ctx
  const readPrompt = options.readPrompt ?? promptFromContext

  const entries = new Map<string, Entry>()
  const calls = new Map<string, CallRecord>()
  const parents = new Map<string, ParentState>()
  const children = new Map<string, ChildInfo>()
  const bound = new Map<string, string>()

  let feedAlive = true
  let closed = false
  /** Tombstones whose durable write failed: the table must still see them. */
  const memory = new Map<string, TaskRecord>()
  /**
   * Parent fences whose durable write failed. The table reads them beside the
   * snapshot, so a session abort holds in this process even when the disk does
   * not carry the fence; `durable:false` says a restart loses it.
   */
  const fences = new Map<string, Fence>()

  const emptyParent = (): ParentState => ({
    frontier: { seq: 0, cursor: 0 },
    // A parent born after the feed died starts degraded, so a dead subscription
    // can never hand out a healthy-looking frontier.
    subscription: feedAlive ? "ok" : "failed",
    log: feedAlive ? "ok" : "failed",
    attempts: 0,
    since: feedAlive ? null : now(),
    reason: feedAlive ? "" : "feed_unavailable",
    timer: null,
  })

  const parent = (parentID: string): ParentState => {
    let state = parents.get(parentID)
    if (!state) {
      state = emptyParent()
      parents.set(parentID, state)
      // A parent born degraded has no feed failure to trigger its chain, so the
      // first reader arms the same four-attempt budget here.
      if (!feedAlive) scheduleRetry(parentID, state.reason)
    }
    return state
  }

  const audit = (parentID: string, line: fsStore.AuditLine): void => {
    try {
      store.appendAudit(parentID, line)
    } catch {
      // The audit is evidence, not a gate. It only speaks when the snapshot is
      // unreadable, so a lost line changes nothing on its own; the seal and the
      // record write are what the admission path holds on.
    }
  }

  const write = <T>(run: () => T): T | null => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return run()
      } catch {}
    }
    return null
  }

  // ——— 1. observation ———

  function observe(call: ObservedCall): void {
    try {
      if (!enabled()) return
      const key = callKey(call.sessionID, call.messageID, call.callID)
      if (!key || entries.has(key)) return
      const entry: Entry = {
        key,
        parentID: call.sessionID,
        messageID: call.messageID,
        callID: call.callID,
        fingerprint: null,
        agent: call.agent || "",
        resumeChildID: call.resumeChildID,
        at: now(),
        durable: false,
        open: true,
        settled: null,
        approved: false,
        holdRow: null,
        holdReason: "",
        holdMarker: null,
        perId: null,
        jevReplied: false,
        holdTimer: null,
      }
      entries.set(key, entry)
      calls.set(key, { mintAt: entry.at })
      try {
        // The whole prompt is hashed. A cap here would make two tasks that first
        // differ past it share a key, holding a call that is not a replacement.
        entry.fingerprint = fingerprint(String(call.prompt ?? ""))
      } catch {
        // An empty or unusable prompt leaves the entry unresolved: enforcement
        // holds instead of admitting a call nobody can identify.
        return
      }
      const existing = readEvidence(entry.parentID).records.find((item) => item.fingerprint === entry.fingerprint)
      // A call key belongs to the invocation that was aborted. Once the record is
      // a tombstone, a new call is a replacement, not the aborted call, so it
      // must not join the tombstone's keys.
      const claim = existing?.abortedAt == null
      const written = writeRecord(entry.parentID, entry.fingerprint, {
        agent: entry.agent,
        frontierAtAdmit: parent(entry.parentID).frontier.seq,
        ...(claim ? { callKeys: [entry.key] } : {}),
      })
      // Two attempts, then unresolved. The hook holds; the store never sees a
      // storm of retries.
      if (!written) return
      entry.durable = true
      audit(entry.parentID, { event: "admit", fingerprint: entry.fingerprint, callID: entry.key, detail: entry.agent })
    } catch {
      // A throw here would skip the assert, so nothing leaves this function.
    }
  }

  // ——— store evidence, classified here ———

  function readEvidence(parentID: string): {
    ok: boolean
    audit: AuditEvidence
    records: TaskRecord[]
    fence?: Fence
  } {
    // The store classifies its own read errors, so this path cannot inherit a
    // weaker rule: `unreadable` here means the file exists and could not be read.
    const read = store.readSnapshot(parentID)
    const ok = read.ok
    const audit: AuditEvidence = read.audit
    const sealed = [...memory.values()].filter((rec) => rec.parentID === parentID)
    // A fence whose durable write failed still holds in this process. It is
    // newer than whatever the disk carries, so it wins while it is present.
    const held = fences.get(parentID)
    if (!ok || !read.snap) return { ok: false, audit, records: sealed, ...(held ? { fence: held } : {}) }
    const records = Object.values(read.snap.tasks)
    // A tombstone whose durable write failed still holds. The disk record is the
    // base; the in-memory seal replaces it for this process, and adds itself
    // when the disk has no record at all.
    for (const rec of sealed) {
      const at = records.findIndex((item) => item.fingerprint === rec.fingerprint)
      if (at >= 0 && records[at].abortedAt == null) records[at] = rec
      else if (at < 0) records.push(rec)
    }
    return { ok: true, audit, records, fence: held ?? read.snap.fence }
  }

  // ——— 2. enforcement ———

  async function enforce(event: any): Promise<Decision> {
    // Re-read here: a fail-closed hook must stop the moment it is turned off,
    // not at the next restart.
    if (!enabled()) {
      return { decision: "allow", row: "none", reason: "the feature is off", generation: null, effect: "allow" }
    }
    if (String(event?.action ?? "") !== SUBAGENT) {
      return { decision: "allow", row: "none", reason: "not a subagent call", generation: null, effect: "allow" }
    }
    const key = callKey(String(event?.sessionID ?? ""), String(event?.source?.messageID ?? ""), String(event?.source?.id ?? ""))
    if (!key) return failClosed(event, null, "the assert carries no call source")
    const entry = entries.get(key)
    if (!entry) return failClosed(event, null, "no admission record for this call")
    // Terminal evidence never reopens.
    if (entry.settled?.effect === "deny") return apply(event, entry, entry.settled)
    // A human answered this call already: a duplicate assert returns that
    // answer instead of asking again.
    if (entry.approved && entry.settled) return apply(event, entry, entry.settled)
    if (!entry.fingerprint || !entry.durable) return failClosed(event, entry, "the call was never recorded")

    const seen = await readPrompt(ctx, { sessionID: entry.parentID, messageID: entry.messageID, callID: entry.callID })
    if (seen !== null) {
      let digest: string | null = null
      try {
        digest = fingerprint(String(seen))
      } catch {}
      // The wrapper and the assert must describe one prompt. Reading it back is
      // the only way to notice a wrapper that saw something else.
      if (digest !== null && digest !== entry.fingerprint) {
        return failClosed(event, entry, "the call input changed after the wrapper saw it")
      }
    }

    const evidence = readEvidence(entry.parentID)
    const input = admissionInput(entry, evidence)
    const decision = evaluate(input, evidence.records, evidence.fence)
    if (decision.effect === "allow") {
      if (decision.retire) retire(entry.parentID, entry.fingerprint, decision.reason)
      const opened = entry.holdRow !== null
      const settled = apply(event, entry, { decision: "allow", row: decision.row, reason: decision.reason, generation: decision.generation, effect: "allow" })
      // The evidence that raised the question is gone: the prompt has no answer
      // left to want, so it is granted rather than left for a stale reject.
      if (opened) {
        clearHold(entry)
        grantPrompt(entry)
      }
      return settled
    }
    if (decision.effect === "deny") {
      const opened = entry.holdRow !== null
      const settled = apply(event, entry, { decision: "deny", row: decision.row, reason: decision.reason, generation: decision.generation, effect: "deny" })
      if (opened) clearHold(entry)
      return settled
    }
    return hold(event, entry, decision)
  }

  /**
   * Turn a hold into the host's own prompt. The hook returns at once: the host
   * creates a pending permission from `ask`, and the human answers that. The
   * correlation runs the other way, from `permission.asked` back to this entry,
   * so nothing here waits on a reply.
   */
  function hold(event: any, entry: Entry, decision: AdmissionDecision): Decision {
    // This hook registers after the risk hook, so it is the last writer: an ask
    // here would turn that hook's deny into a question.
    if (String(event?.effect ?? "") === "deny") {
      audit(entry.parentID, {
        event: "hold_refused_by_deny",
        fingerprint: entry.fingerprint ?? undefined,
        callID: entry.key,
        detail: `${decision.row}: ${decision.reason}`,
      })
      return { decision: "hold", row: decision.row, reason: `${decision.reason}; a deny was already set`, generation: null, effect: "deny" }
    }
    // A second assert of a call that already has a prompt asks again with the
    // same marker and arms nothing: the open prompt is still the question, and
    // one timer for the call key is all this entry can settle.
    if (entry.holdRow === null) {
      entry.holdRow = decision.row
      entry.holdReason = decision.reason
      entry.holdMarker = holdMarker(entry.key, decision.reason)
      const state = parent(entry.parentID)
      audit(entry.parentID, {
        event: decision.row === "9" ? "degraded_hold" : "hold",
        fingerprint: entry.fingerprint ?? undefined,
        callID: entry.key,
        detail:
          decision.row === "9"
            ? `${state.reason || "frontier_unavailable"}: ${decision.reason}; attempts ${state.attempts}`
            : `${decision.reason}; attempts ${state.attempts}`,
      })
      entry.holdTimer = schedule(() => {
        entry.holdTimer = null
        void expire(entry)
      }, holdMs)
    }
    if (entry.holdMarker) {
      event.effect = "ask"
      event.message = entry.holdMarker
    }
    return { decision: "hold", row: entry.holdRow, reason: entry.holdReason, generation: null, effect: "ask" }
  }

  /**
   * The hold deadline. The host has no expiry of its own, so this is the only
   * deny Jev owns, and it is best-effort: the pending request is rejected only
   * when it is the only one waiting in the session.
   */
  async function expire(entry: Entry): Promise<void> {
    try {
      if (closed || entry.settled?.effect === "deny" || entry.holdRow === null) return
      const message = `${entry.holdMarker ?? "nospawn hold"} expired after ${holdMs} ms`
      if (!(await selfReject(entry, "the hold expired", message))) return
      settleDenied(entry, "hold_expired", `${message}; Jev rejected the call`)
    } catch {}
  }

  /** One `permission.asked`: the marker is the only name the two sides share. */
  function asked(event: any): void {
    try {
      const data = event?.data ?? {}
      const id = String(data.id ?? "")
      const sessionID = String(data.sessionID ?? "")
      const message = typeof data.message === "string" ? data.message : ""
      if (!id || !sessionID || !message) return
      for (const entry of entries.values()) {
        // A deny is terminal: its prompt is spent. An earlier allow is not, for
        // the table can re-decide a call it admitted once.
        if (entry.parentID !== sessionID || entry.holdRow === null || entry.settled?.effect === "deny") continue
        if (entry.holdMarker !== message) continue
        entry.perId = id
        return
      }
      // A marker that matches no open hold is another hook's prompt: not ours.
    } catch {}
  }

  /** One `permission.replied`: settle the hold it answers. */
  function replied(event: any): void {
    try {
      const data = event?.data ?? {}
      const requestID = String(data.requestID ?? "")
      if (!requestID) return
      const entry = [...entries.values()].find((item) => item.perId === requestID)
      if (!entry) return
      // A reply Jev issued and a terminally denied hold are both spent: the
      // frame carries no author, so only this record can tell them apart.
      if (entry.jevReplied || entry.settled?.effect === "deny" || entry.holdRow === null) return
      const reply = String(data.reply ?? "")
      if (reply === "reject") {
        settleDenied(entry, "hold_rejected", "a human rejected the call")
        return
      }
      if (reply !== "once" && reply !== "always") return
      mintApproval(entry, reply)
    } catch {}
  }

  /**
   * A human said yes: mint the generation this call is admitted under. The
   * answer is the only source of a generation, and it must still be safe to
   * admit, so an unreadable store mints nothing and says so.
   */
  function mintApproval(entry: Entry, reply: "once" | "always"): number | null {
    const row = entry.holdRow ?? "none"
    const after = readEvidence(entry.parentID)
    if (!after.ok) {
      audit(entry.parentID, {
        event: "hold_unrecorded",
        fingerprint: entry.fingerprint ?? undefined,
        callID: entry.key,
        perId: entry.perId ?? undefined,
        detail: `the store is unreadable; the ${reply} answer minted nothing`,
      })
      return null
    }
    const base = after.records.find((item) => item.fingerprint === entry.fingerprint)
    const approved = base ? nextGeneration(base, "human") : maxGeneration(after.records) + 1
    // The approved call key belongs to a new generation, not to the aborted
    // invocation: writing it into the tombstone would make the approved call a
    // row-1 replay on its next assert and revoke it on a later abort.
    const written = writeRecord(entry.parentID, entry.fingerprint ?? "", {
      agent: entry.agent,
      generation: approved,
      ...(base?.abortedAt == null ? { callKeys: [entry.key] } : {}),
    })
    if (!written) {
      // An approval the store refused is not an approval. A lock budget, a
      // corrupt snapshot and a full disk all land here.
      audit(entry.parentID, {
        event: "hold_unrecorded",
        fingerprint: entry.fingerprint ?? undefined,
        callID: entry.key,
        perId: entry.perId ?? undefined,
        detail: `the store refused generation ${approved}`,
      })
      return null
    }
    clearHold(entry)
    entry.approved = true
    // Jev asserts without `save`, so `always` saved no rule: it settles this
    // call and the next identical call asks again.
    audit(entry.parentID, {
      event: reply === "always" ? "hold_always_downgraded" : "hold_approved",
      fingerprint: entry.fingerprint ?? undefined,
      callID: entry.key,
      perId: entry.perId ?? undefined,
      detail:
        reply === "always"
          ? `generation ${approved}; no save was passed, so nothing persisted and the next call asks again`
          : `generation ${approved}`,
    })
    record(entry, { decision: "allow", row, reason: `a human approved generation ${approved}`, generation: approved, effect: "allow" })
    return approved
  }

  /**
   * Jev's own reject, only when it cannot touch another call. One `reject` on
   * this host rejects every pending permission in the session, and no narrower
   * cancel route exists, so a shared session is never auto-denied: the hold is
   * skipped, audited, and left standing.
   */
  async function selfReject(entry: Entry, reason: string, message?: string): Promise<boolean> {
    const perId = entry.perId
    if (!perId) {
      audit(entry.parentID, {
        event: "hold_uncancellable",
        fingerprint: entry.fingerprint ?? undefined,
        callID: entry.key,
        detail: `${reason}; permission.asked never arrived`,
      })
      return false
    }
    const others = await pendingOthers(entry.parentID, perId)
    // A reject is session-wide on this host: `HOLD_FANOUT` allows one only when
    // nothing else is waiting, and a shared session is never auto-denied.
    if (HOLD_FANOUT === "solo-only" && others !== 0) {
      audit(entry.parentID, {
        event: "hold_fanout_skipped",
        fingerprint: entry.fingerprint ?? undefined,
        callID: entry.key,
        perId,
        detail: `${reason}; ${others === null ? "an unknown number of" : String(others)} other pending permission(s) in the session`,
      })
      return false
    }
    if (await jevReply(entry, "reject", message)) return true
    audit(entry.parentID, {
      event: "hold_uncancellable",
      fingerprint: entry.fingerprint ?? undefined,
      callID: entry.key,
      perId,
      detail: `${reason}; the self-reply was refused`,
    })
    return false
  }

  /**
   * How many other permissions are pending in that session. `null` when the
   * list cannot be read, which is treated as "others exist": the host rejects
   * the whole session on one `reject`, so an unknown count must not read as zero.
   */
  async function pendingOthers(sessionID: string, perId: string): Promise<number | null> {
    try {
      const list = ctx?.permission?.list
      if (typeof list !== "function") return null
      const rows = await list.call(ctx.permission, { sessionID })
      const all: any[] | null = Array.isArray(rows) ? rows : Array.isArray(rows?.data) ? rows.data : null
      if (!all) return null
      return all.filter((row) => String(row?.sessionID ?? "") === sessionID && String(row?.id ?? "") !== perId).length
    } catch {
      return null
    }
  }

  /**
   * Reply to a pending request as Jev. The frame this produces carries no
   * author, so the call itself is the only record: mark the entry before the
   * await, or a fast frame is read as a human's answer.
   */
  async function jevReply(entry: Entry, decision: "once" | "reject", message?: string): Promise<boolean> {
    const perId = entry.perId
    const reply = ctx?.permission?.reply
    if (!perId || typeof reply !== "function") return false
    entry.jevReplied = true
    try {
      await reply.call(ctx.permission, { sessionID: entry.parentID, requestID: perId, decision, ...(message ? { message } : {}) })
      return true
    } catch {
      entry.jevReplied = false
      return false
    }
  }

  /** Resolve a prompt for a call this module has already admitted. */
  function grantPrompt(entry: Entry): void {
    if (!entry.perId || entry.jevReplied) return
    void (async () => {
      if (await jevReply(entry, "once")) return
      audit(entry.parentID, {
        event: "hold_uncancellable",
        fingerprint: entry.fingerprint ?? undefined,
        callID: entry.key,
        perId: entry.perId ?? undefined,
        detail: "the call was admitted; the self-reply was refused",
      })
    })()
  }

  /** Settle a hold deny under the line that names why, with no generic deny beside it. */
  function settleDenied(entry: Entry, line: fsStore.AuditEvent, detail: string): void {
    const row = entry.holdRow ?? "none"
    clearHold(entry)
    entry.settled = { decision: "hold", row, reason: detail, generation: null, effect: "deny" }
    audit(entry.parentID, {
      event: line,
      fingerprint: entry.fingerprint ?? undefined,
      callID: entry.key,
      perId: entry.perId ?? undefined,
      detail,
    })
  }

  /** Drop the deadline and the open-hold marker. The pending id stays, to ignore its frame. */
  function clearHold(entry: Entry): void {
    if (entry.holdTimer !== null) {
      try {
        clearTimeout(entry.holdTimer as ReturnType<typeof setTimeout>)
      } catch {}
      entry.holdTimer = null
    }
    entry.holdRow = null
  }

  function admissionInput(
    entry: Entry,
    evidence: { ok: boolean; audit: AuditEvidence; records: TaskRecord[]; fence?: Fence },
  ): AdmissionInput {
    const state = parent(entry.parentID)
    const readable = state.subscription === "ok" && state.log === "ok"
    return {
      parentID: entry.parentID,
      fingerprint: entry.fingerprint ?? "",
      callKey: entry.key,
      ...(entry.resumeChildID ? { resumeChildID: entry.resumeChildID } : {}),
      frontierNow: readable ? state.frontier.seq : null,
      stateOk: evidence.ok,
      audit: evidence.audit,
      now: now(),
    }
  }

  /**
   * The first verdict for a call key wins. The event is only ever narrowed to
   * `deny`: an allow here means "this rule has nothing against the call", not
   * "the host must allow it", so the other Jev hooks keep their say.
   */
  function apply(event: any, entry: Entry, decision: Decision): Decision {
    return denyEvent(event, record(entry, decision))
  }

  /** Narrow the event. A decision that is not a deny leaves it untouched. */
  function denyEvent(event: any, decision: Decision): Decision {
    if (decision.effect !== "deny") return decision
    event.effect = "deny"
    event.message = `nospawn: ${decision.reason}`
    return decision
  }

  /**
   * Store a settlement. A deny is terminal. A later allow replaces an earlier
   * allow, so the reported row is the one that just decided; a later deny
   * replaces an allow, because an abort between two asserts must not leave the
   * replayed call admitted.
   */
  function record(entry: Entry, decision: Decision): Decision {
    const stored = entry.settled
    if (stored?.effect === "deny") return stored
    entry.settled = decision
    entry.holdRow = null
    // One line per outcome change: a repeated allow writes nothing new. An ask
    // is the hold's own line, written when the hold opened.
    if ((!stored || stored.effect !== decision.effect) && decision.effect !== "ask") {
      audit(entry.parentID, {
        event: decision.effect === "allow" ? "allow" : "deny",
        fingerprint: entry.fingerprint ?? undefined,
        callID: entry.key,
        detail: `${decision.row}: ${decision.reason}`,
      })
    }
    return decision
  }

  /**
   * A failure of this path denies. It is the one fail-closed hook in the
   * plugin, and it is why the whole feature is off by default. The verdict it
   * reports is `hold`: nothing was proven either way, and the effect says so.
   */
  function failClosed(event: any, entry: Entry | null, reason: string): Decision {
    const decision: Decision = { decision: "hold", row: "none", reason, generation: null, effect: "deny" }
    if (entry) record(entry, decision)
    return denyEvent(event, decision)
  }

  // ——— 3. binding ———

  function after(event: any): void {
    try {
      if (String(event?.tool ?? "") !== SUBAGENT) return
      const key = callKey(String(event?.sessionID ?? ""), String(event?.messageID ?? ""), String(event?.id ?? ""))
      const entry = key ? entries.get(key) : undefined
      const childID = typeof event?.result?.metadata?.sessionID === "string" ? event.result.metadata.sessionID : ""
      if (entry) {
        entry.open = false
        const call = calls.get(entry.key)
        if (call) call.boundAt = now()
      }
      if (!key || !childID) return
      if (bound.has(childID)) return
      if (!entry || !entry.fingerprint) {
        // No observation means no task to bind to: the child is unbound, and
        // only the cascade's window rule may touch it.
        children.set(childID, { parentID: String(event?.sessionID ?? ""), at: now() })
        return
      }
      bindChild(entry.parentID, entry.fingerprint, entry.key, childID)
    } catch {}
  }

  function bindChild(parentID: string, key: string, callID: string, childID: string): void {
    bound.set(childID, parentID)
    children.set(childID, { parentID, at: children.get(childID)?.at ?? now() })
    writeRecord(parentID, key, { ...(callID ? { callKeys: [callID] } : {}), childIDs: [childID] })
    audit(parentID, { event: "bind", fingerprint: key, callID, childID })
  }

  function created(event: any): void {
    try {
      const data = event?.data ?? {}
      const childID = String(data.sessionID ?? "")
      const parentID = typeof data.parentID === "string" ? data.parentID : ""
      if (!childID || !parentID) return
      const at = typeof event?.created === "number" ? event.created : now()
      children.set(childID, { parentID, at })
      if (bound.has(childID)) return
      const open = [...entries.values()].filter((entry) => entry.parentID === parentID && entry.open && entry.fingerprint)
      if (open.length !== 1) return
      const entry = open[0]
      const call = calls.get(entry.key)
      if (!call || !withinCall(call, at)) return
      bindChild(parentID, entry.fingerprint!, entry.key, childID)
    } catch {}
  }

  /**
   * A child's creation inside one open call's lifetime: not before the call was
   * minted, not after it bound (plus grace), and never past the window cap. An
   * aborted call uses `inAdmissionWindow` instead, which has an abort anchor.
   */
  function withinCall(call: CallRecord, at: number): boolean {
    if (!Number.isFinite(at) || at < call.mintAt) return false
    if (call.boundAt != null && at > call.boundAt + graceMs) return false
    return at <= call.mintAt + capMs
  }

  function deleted(event: any): void {
    try {
      const parentID = String(event?.data?.sessionID ?? "")
      if (!parentID) return
      write(() => store.removeParent(parentID))
      for (const [key, entry] of entries) if (entry.parentID === parentID) entries.delete(key)
      for (const [childID, info] of children) if (childID === parentID || info.parentID === parentID) children.delete(childID)
      for (const sealed of [...memory.keys()]) if (sealed.startsWith(`${parentID}|`)) memory.delete(sealed)
      fences.delete(parentID)
      parents.delete(parentID)
    } catch {}
  }

  // ——— 4. frontier ———

  function userItem(parentID: string, seq: number, itemType?: unknown): void {
    const state = parent(parentID)
    // Only a human prompt is a user turn. A synthetic notice (the abort's own
    // notice included), a compaction, a move, or an event the host sends with
    // no type at all must not advance the frontier: advancing it retires a
    // tombstone the user never answered.
    if (typeof itemType !== "string" || itemType !== USER_ITEM) return
    const event: SessionEvent = {
      type: INBOX_ENQUEUED,
      durable: { aggregateID: parentID, seq },
      data: { item: { type: USER_ITEM } },
    }
    const next = applyEvent(state.frontier, event, parentID)
    if (next === state.frontier) return
    state.frontier = next
    mutateSnapshot(parentID, (snap) => {
      snap.frontierSeq = next.seq
      snap.eventCursor = next.cursor
    })
  }

  function frontierFailed(parentID: string, reason: string): void {
    const state = parent(parentID)
    state.subscription = "failed"
    state.reason = reason
    if (state.since === null) state.since = now()
    mutateSnapshot(parentID, (snap) => {
      snap.degraded = { reason, since: state.since ?? now(), attempts: state.attempts }
    })
    // One chain per parent: a repeated failure from the same dead feed would
    // otherwise arm a second timer beside the first and double the retries.
    if (state.timer !== null) return
    state.attempts = 0
    scheduleRetry(parentID, reason)
  }

  function scheduleRetry(parentID: string, reason: string): void {
    if (closed) return
    const state = parent(parentID)
    state.attempts += 1
    const delay = retrySchedule(state.attempts)
    // Four attempts is the whole budget. After it, the parent holds until a
    // repair arrives; a fifth retry is not scheduled.
    if (delay === null) return
    state.timer = schedule(() => {
      state.timer = null
      if (options.repair?.(parentID)) frontierRepaired(parentID)
      else scheduleRetry(parentID, reason)
    }, delay)
  }

  function frontierRepaired(parentID: string): void {
    const state = parent(parentID)
    if (state.timer !== null) {
      try {
        clearTimeout(state.timer as ReturnType<typeof setTimeout>)
      } catch {}
      state.timer = null
    }
    state.subscription = "ok"
    state.log = "ok"
    state.attempts = 0
    state.since = null
    state.reason = ""
    mutateSnapshot(parentID, (snap) => {
      delete snap.degraded
    })
    // An open hold whose call no longer matches a live tombstone is released;
    // one that still matches stays held. Nothing is replayed as a new admission.
    for (const entry of entries.values()) {
      if (entry.parentID !== parentID || entry.settled?.effect === "deny" || entry.holdRow === null) continue
      const evidence = readEvidence(parentID)
      const again = evaluate(admissionInput(entry, evidence), evidence.records, evidence.fence)
      if (again.effect !== "allow") continue
      entry.settled = {
        decision: "allow",
        row: again.row,
        reason: `${again.reason}; evidence repaired`,
        generation: null,
        effect: "allow",
      }
      entry.holdRow = null
      audit(parentID, {
        event: "evidence_repaired",
        fingerprint: entry.fingerprint ?? undefined,
        callID: entry.key,
        perId: entry.perId ?? undefined,
        detail: again.reason,
      })
      clearHold(entry)
      grantPrompt(entry)
    }
  }

  /**
   * The feed died. Every parent the host has seen is degraded, and any parent
   * born later starts degraded, so a frozen frontier cannot look healthy. The
   * recovery is a fresh subscription; until C wires one, it takes a restart.
   */
  function feedFailed(reason: string): void {
    if (closed) return
    // The feed is the frontier's only source: why it failed, in the call log.
    logCall({ hook: "hook_no_respawn", site: "feed", reason })
    feedAlive = false
    for (const parentID of [...parents.keys()]) frontierFailed(parentID, reason)
  }

  // ——— 5. abort and the session fence ———

  /**
   * Stop one task, in the contract's order: seal, revoke, interrupt, contain,
   * fence, notify. The tombstone is durable before anything a replacement can
   * observe, and nothing here resumes anything.
   *
   * A second abort of a task that is already sealed re-seals nothing, moves no
   * frontier, and revokes only the keys that record owns. A tombstone that is
   * retired or expired is refused instead: the store merge keeps it spent, so
   * reporting `sealed:true` would be a lie.
   */
  async function abort(request: AbortRequest): Promise<AbortReceipt> {
    const { parentID, by, cause } = request
    if (request.scope === "session") return abortSession(parentID, by, cause)
    const receipt = emptyReceipt()
    const key = String(request.fingerprint ?? "")
    if (!key) return refuse(receipt, parentID, "no task fingerprint was named")
    const read = store.readSnapshot(parentID)
    if (read.reason === "missing") return refuse(receipt, parentID, "no such task in this session")
    if (!read.ok) return refuse(receipt, parentID, `the store is ${read.reason}`)
    const evidence = readEvidence(parentID)
    if (!evidence.ok) return refuse(receipt, parentID, "the store is unreadable")
    const rec = evidence.records.find((item) => item.fingerprint === key)
    if (!rec) return refuse(receipt, parentID, "no such task in this session")

    const at = now()
    const sealState = tombstoneState(rec, at)
    if (sealState === "retired" || sealState === "expired") {
      // A spent tombstone is terminal. Re-sealing it would report `sealed:true`
      // for a write the store's merge keeps retired, and reopening it would move
      // a state the user never asked to move. Refuse, and name which.
      return refuse(receipt, parentID, sealState === "retired" ? "already_retired" : "already_expired")
    }
    if (rec.abortedAt != null) {
      // Already sealed: revoke only what this record owns, then stop. The seal
      // is not moved, so the frontier scope stays where the abort put it.
      revokeTask(parentID, rec, at, receipt)
      audit(parentID, { event: "abort_done", fingerprint: key, detail: `${by}: ${cause}; already sealed; revoked ${receipt.revoked.length}` })
      receipt.sealed = true
      receipt.durable = !memory.has(`${parentID}|${key}`)
      receipt.reason = "already aborted"
      return receipt
    }

    const state = parent(parentID)
    const frontierAtAbort = state.frontier.seq
    // Seal first: the audit line is fsynced before anything a replacement can
    // observe, so a crash between the two leaves the tombstone visible.
    audit(parentID, { event: "abort", fingerprint: key, detail: `${by}: ${cause}` })
    const written = writeRecord(parentID, key, { abortedAt: at, abortedBy: by, cause, frontierAtAbort, retiredAt: null })
    receipt.sealed = true
    receipt.durable = written
    if (!written) {
      // The tombstone must be durable before anything a replacement can observe.
      // When it is not, the seal is held in memory for this process and the
      // audit says so. The cascade still runs: the abort was decided. After a
      // restart this seal is gone, which is why `durable` is in the receipt.
      memory.set(`${parentID}|${key}`, { ...rec, abortedAt: at, abortedBy: by, cause, frontierAtAbort, retiredAt: null })
      audit(parentID, { event: "abort", fingerprint: key, detail: `${by}: ${cause}; tombstone held in memory only` })
    }

    revokeTask(parentID, rec, at, receipt)

    const interrupted = [...rec.childIDs, ...descendants(rec.childIDs)]
    const refused: string[] = []
    for (const childID of interrupted) if (await interrupt(childID)) receipt.interrupted.push(childID)
    else refused.push(childID)

    // Contain only a child created inside the aborted call's window, and only
    // when no sibling admission could own it. Anything else is preserved.
    const others = [...entries.values()].filter(
      (entry) => entry.parentID === parentID && entry.open && entry.settled?.decision === "allow" && !rec.callKeys.includes(entry.key),
    )
    const call = rec.callKeys.map((item) => calls.get(item)).find((item) => !!item)
    for (const [childID, info] of children) {
      if (info.parentID !== parentID || bound.has(childID) || rec.childIDs.includes(childID)) continue
      const inside = call ? inAdmissionWindow(info.at, { ...call, abortedAt: at }, graceMs, capMs) : false
      if (inside && others.length === 0) {
        if (await interrupt(childID)) receipt.interrupted.push(childID)
        else refused.push(childID)
        bindChild(parentID, key, rec.callKeys[0] ?? "", childID)
        continue
      }
      receipt.preserved.push(childID)
      audit(parentID, { event: "ambiguous_child_preserved", fingerprint: key, childID, detail: inside ? "a sibling admission was open" : "outside the admission window" })
    }

    // Row 6's producer: every session bound to this task denies new admissions,
    // and no approval lifts that. Read the record again: containment above may
    // have bound one more child.
    const boundChildren = readEvidence(parentID).records.find((item) => item.fingerprint === key)?.childIDs ?? rec.childIDs
    const unfenced: string[] = []
    for (const childID of boundChildren) if (!(await fenceSubtree(childID, key, cause))) unfenced.push(childID)
    // Named in the receipt, not only the audit: a child the fence missed can
    // still spawn, and the user must not be told otherwise.
    receipt.fenced = boundChildren.length - unfenced.length
    receipt.fenceFailures = unfenced

    receipt.notified = await notify(parentID, `Jev aborted task ${key.slice(0, 12)} (${by}): ${cause}. Unrelated work continues; a replacement of that task is held until your next message.`)
    audit(parentID, {
      event: "abort_done",
      fingerprint: key,
      detail: `${by}: ${cause}; revoked ${receipt.revoked.length}, interrupted ${receipt.interrupted.length}, preserved ${receipt.preserved.length}${refused.length ? `, interrupt refused ${refused.join(",")}` : ""}${unfenced.length ? `, subtree fence refused ${unfenced.join(",")}` : ""}`,
    })
    return receipt
  }

  /**
   * Stop the parent's own run: fence first, then revoke every open call in the
   * session, then interrupt the parent and its children. A pending prompt left
   * open would otherwise take a late answer and restart the stopped run.
   */
  async function abortSession(parentID: string, by: AbortAuthority, cause: string): Promise<AbortReceipt> {
    const receipt = emptyReceipt()
    const at = now()
    audit(parentID, { event: "abort", detail: `session: ${by}: ${cause}` })
    const { fence, written } = writeParentFence(parentID, `session: ${by}: ${cause}`, at)
    receipt.sealed = true
    receipt.durable = written
    if (written) {
      // The disk now carries the newest fence, so a memory-only one from an
      // earlier failed write must not shadow it.
      fences.delete(parentID)
    } else {
      // The disk has no fence, so the table would admit a new subagent call in
      // this session. Hold it here for the rest of the process instead; the
      // receipt says a restart loses that hold.
      fences.set(parentID, fence)
      audit(parentID, { event: "abort", detail: `session: ${by}: ${cause}; parent fence held in memory only` })
    }

    for (const entry of entries.values()) {
      if (entry.parentID !== parentID || entry.settled?.effect === "deny") continue
      const call = calls.get(entry.key)
      if (call) call.abortedAt = at
      record(entry, { decision: "deny", row: "fence", reason: "revocation:abort", generation: null, effect: "deny" })
      clearHold(entry)
      // Only a call that was actually asked has a prompt to resolve.
      if (entry.perId) void selfReject(entry, "the call was revoked")
      receipt.revoked.push(entry.key)
    }

    const childIDs = [...children.entries()].filter(([, info]) => info.parentID === parentID).map(([id]) => id)
    const refused: string[] = []
    for (const sessionID of [...childIDs, ...descendants(childIDs), parentID]) {
      if (await interrupt(sessionID)) receipt.interrupted.push(sessionID)
      else refused.push(sessionID)
    }

    receipt.notified = await notify(parentID, `Jev aborted this session (${by}): ${cause}. A new subagent call is held until your next message.`)
    audit(parentID, {
      event: "abort_done",
      detail: `session: ${by}: ${cause}; revoked ${receipt.revoked.length}, interrupted ${receipt.interrupted.length}${refused.length ? `, interrupt refused ${refused.join(",")}` : ""}`,
    })
    return receipt
  }

  function emptyReceipt(): AbortReceipt {
    return { sealed: false, durable: false, revoked: [], interrupted: [], preserved: [], fenced: 0, fenceFailures: [], notified: false }
  }

  function refuse(receipt: AbortReceipt, parentID: string, reason: string): AbortReceipt {
    receipt.reason = reason
    audit(parentID, { event: "abort_refused", detail: reason })
    return receipt
  }

  /**
   * Revoke exactly the calls the aborted record owns. The call key is the only
   * identity this record has: a hold with the same fingerprint but a key the
   * record never claimed belongs to a call this abort cannot tell apart from
   * another task's, so it is left to the sealed record. Approval then needs a
   * generation newer than that record, and an unanswered hold expires to deny.
   */
  function revokeTask(parentID: string, rec: TaskRecord, at: number, receipt: AbortReceipt): void {
    for (const entry of entries.values()) {
      if (entry.parentID !== parentID || entry.settled?.effect === "deny") continue
      if (!rec.callKeys.includes(entry.key)) {
        // Two tasks with one prompt share one fingerprint, so the key is the
        // only discriminator there is. The choice is audited because it leaves
        // a question on screen that this abort did not close.
        if (entry.holdRow !== null && entry.fingerprint === rec.fingerprint) {
          audit(parentID, {
            event: "hold_preserved",
            fingerprint: rec.fingerprint,
            callID: entry.key,
            detail: "a hold this task's record never owned; left to the sealed record",
          })
        }
        continue
      }
      const call = calls.get(entry.key)
      if (call) call.abortedAt = at
      // A call already allowed is revoked here: the gate's settlement is the
      // abort's, and `record` lets a deny replace a stale allow.
      record(entry, { decision: "deny", row: "1", reason: "revocation:abort", generation: null, effect: "deny" })
      clearHold(entry)
      // Only a call that was actually asked has a prompt to resolve.
      if (entry.perId) void selfReject(entry, "the call was revoked")
      receipt.revoked.push(entry.key)
    }
  }

  /** Row 6's writer: an admission inside this session denies and stays denied. */
  async function fenceSubtree(childID: string, key: string, cause: string): Promise<boolean> {
    const at = now()
    return mutateSnapshot(childID, (snap) => {
      snap.fence = { kind: "subtree", atSeq: snap.frontierSeq, cause: `task ${key.slice(0, 12)}: ${cause}`, at }
    })
  }

  /** The parent fence write both `fenceParent` and `abortSession` use. */
  function writeParentFence(parentID: string, cause: string, at: number): { fence: Fence; written: boolean } {
    const state = parent(parentID)
    const fence: Fence = { kind: "parent", atSeq: state.frontier.seq, cause, at }
    const written = mutateSnapshot(parentID, (snap) => {
      snap.fence = fence
    })
    return { fence, written }
  }

  /** Tell the parent's session. Never the aborted child: that would be a resume. */
  async function notify(parentID: string, text: string): Promise<boolean> {
    try {
      if (typeof ctx?.session?.synthetic !== "function") return false
      await ctx.session.synthetic({ sessionID: parentID, text, delivery: "queue" })
      return true
    } catch {
      return false
    }
  }

  async function fenceParent(parentID: string, cause: string): Promise<void> {
    const at = now()
    const { written } = writeParentFence(parentID, cause, at)
    if (!written) {
      // No durable fence means the parent cannot be held for certain; the audit
      // line still records the abort, which is what a later read holds on.
      audit(parentID, { event: "abort", detail: `parent fence not written: ${cause}` })
    } else {
      fences.delete(parentID)
    }
    const all = [...children.entries()].filter(([, info]) => info.parentID === parentID).map(([id]) => id)
    for (const childID of all) await interrupt(childID)
  }

  function descendants(roots: string[]): string[] {
    const out: string[] = []
    const queue = [...roots]
    while (queue.length) {
      const current = queue.shift()!
      for (const [childID, info] of children) {
        if (info.parentID !== current || roots.includes(childID) || out.includes(childID)) continue
        out.push(childID)
        queue.push(childID)
      }
    }
    return out
  }

  /** True when the host accepted the interrupt. A refusal is reported, not swallowed. */
  async function interrupt(sessionID: string): Promise<boolean> {
    try {
      const run = ctx?.session?.interrupt
      if (typeof run !== "function") return false
      await run({ sessionID })
      return true
    } catch {
      return false
    }
  }

  function retire(parentID: string, key: string, reason: string): void {
    if (!writeRecord(parentID, key, { retiredAt: now() })) return
    audit(parentID, { event: "retire", fingerprint: key, detail: reason })
  }

  /**
   * Takeover rule: a lock older than the stale window is only taken over when
   * its holder is dead. The store itself preempts by age alone and its release
   * is token-matched, but a preempted writer's body can still run on and write
   * after the new holder, so the host never starts a mutation that would need
   * that preemption.
   *
   * Tradeoff: a live but wedged writer holds the parent for every admission
   * until it exits, instead of racing it. A hold is recoverable by the user; a
   * lost tombstone is not.
   */
  function lockAvailable(parentID: string): boolean {
    let path: string
    try {
      path = `${store.parentPaths(parentID).snapshot}.lock`
    } catch {
      return false
    }
    let token: string
    try {
      token = readFileSync(path, "utf8")
    } catch (error) {
      // No lock file is the normal case. Any other read error is not a licence
      // to write: the store decides, and the admission path holds on failure.
      return (error as NodeJS.ErrnoException)?.code === "ENOENT"
    }
    const [pid, at] = token.trim().split(/\s+/)
    const since = Number(at)
    const holder = Number(pid)
    if (!Number.isFinite(since) || now() - since <= LOCK_TAKEOVER_MS) return true
    if (!Number.isFinite(holder) || holder <= 0) return true
    try {
      process.kill(holder, 0)
      return false
    } catch (error) {
      return (error as NodeJS.ErrnoException)?.code === "ESRCH"
    }
  }

  /**
   * Whether a mutation may start. Two refusals, both fail-closed:
   *
   * - A snapshot that exists and cannot be read may be the only copy of a
   *   tombstone. The store's reader calls every read error "missing" and would
   *   replace it with a blank one, so the classification lives here.
   * - A lock older than the stale window whose holder is alive (see
   *   `lockAvailable`).
   */
  function canMutate(parentID: string): boolean {
    try {
      if (store.readSnapshot(parentID).reason === "unreadable") return false
    } catch {
      return false
    }
    return lockAvailable(parentID)
  }

  /**
   * Read-merge-write one record through the store's lock. The existing record is
   * the base, so a bind cannot reset `frontierAtAdmit` and a tombstone cannot
   * drop the child ids the call already owns.
   */
  function writeRecord(parentID: string, key: string, patch: Partial<TaskRecord>): boolean {
    const existing = readEvidence(parentID).records.find((item) => item.fingerprint === key)
    const base: TaskRecord = existing ?? {
      parentID,
      fingerprint: key,
      agent: "",
      generation: nextGeneration(undefined),
      frontierAtAdmit: parent(parentID).frontier.seq,
      callKeys: [],
      childIDs: [],
      retiredAt: null,
    }
    if (!canMutate(parentID)) return false
    const next: TaskRecord = { ...base, ...patch, parentID, fingerprint: key }
    return write(() => store.writeTask(parentID, key, next)) !== null
  }

  /**
   * Under the parent lock, and never over a snapshot it could not read: a
   * write here must not replace the only copy of a tombstone. A lock throw is
   * a hold, which the caller's read path already enforces.
   *
   * `store.writeSnapshot` is the store's raw writer, and the only one that can
   * move `fence`, `frontierSeq` or `degraded`; the store's own docstring says
   * milestone B must not call it. Contract 3 names this call under
   * `withParentLock` as the permitted form, so it is used here and nowhere
   * else. Closing the gap needs a store API for the non-task fields.
   */
  function mutateSnapshot(parentID: string, edit: (snap: fsStore.Snapshot) => void): boolean {
    if (!canMutate(parentID)) return false
    try {
      return store.withParentLock(parentID, () => {
        const read = store.readSnapshot(parentID)
        if (!read.ok && read.reason !== "missing") return false
        const snap =
          read.snap ??
          ({ v: 1, parentID, frontierSeq: parent(parentID).frontier.seq, eventCursor: parent(parentID).frontier.cursor, tasks: {} } as fsStore.Snapshot)
        edit(snap)
        store.writeSnapshot(parentID, snap)
        return true
      })
    } catch {
      return false
    }
  }

  function close(): void {
    closed = true
    for (const state of parents.values()) {
      if (state.timer === null) continue
      try {
        clearTimeout(state.timer as ReturnType<typeof setTimeout>)
      } catch {}
      state.timer = null
    }
    // A hold deadline outliving the host would write a settlement for a call
    // nothing is watching any more.
    for (const entry of entries.values()) clearHold(entry)
  }

  return {
    observe,
    enforce,
    asked,
    replied,
    after,
    created,
    deleted,
    userItem,
    frontierFailed,
    frontierRepaired,
    feedFailed,
    abort,
    fenceParent,
    abortSession,
    close,
  }
}

function maxGeneration(records: TaskRecord[]): number {
  return records.reduce((best, rec) => (rec.generation > best ? rec.generation : best), 0)
}

/**
 * The tool's own input, read back from the session the same way the risk hook
 * does. A missing read is not a changed read: only a prompt that exists and
 * differs is evidence, and anything else leaves the wrapper's word standing.
 */
async function promptFromContext(
  ctx: any,
  call: { sessionID: string; messageID: string; callID: string },
): Promise<string | null> {
  try {
    if (!ctx?.session?.context) return null
    const messages = await ctx.session.context({ sessionID: call.sessionID })
    const list = Array.isArray(messages) ? messages : []
    const message = list.find((item: any) => item?.id === call.messageID)
    const part = message?.content?.find?.((item: any) => item?.type === "tool" && item?.id === call.callID)
    const prompt = part?.state?.input?.prompt
    return typeof prompt === "string" ? prompt : null
  } catch {
    return null
  }
}

// ——— registration ———

/** The tool wrapper: observe, then run the builtin. Never throws. */
function wrapSubagent(editor: any, host: AdmissionHost): void {
  const tool = editor?.get?.(SUBAGENT)
  if (!tool || typeof tool.execute !== "function") return
  editor.update(SUBAGENT, (mutable: any) => {
    const original = mutable.execute
    mutable.execute = async (input: any, context: any) => {
      try {
        host.observe({
          sessionID: String(context?.sessionID ?? ""),
          messageID: String(context?.messageID ?? ""),
          callID: String(context?.id ?? ""),
          agent: String(context?.agent ?? ""),
          prompt: typeof input?.prompt === "string" ? input.prompt : "",
          resumeChildID: typeof input?.sessionID === "string" && input.sessionID ? input.sessionID : undefined,
        })
      } catch {}
      return original(input, context)
    }
  })
}

/**
 * Wire the host to a live `ctx`. Returns the cleanup, so setup can keep it.
 * Registration is capability-probed per domain: a host without one simply has
 * no hook there, which the next milestone proves in the real host.
 */
/**
 * What `setup` keeps: the disposer, and the two entry points the plugin has no
 * other way to reach. Without this handle an abort trigger cannot exist.
 */
export interface NoRespawnHandle {
  dispose: () => void
  abort(request: AbortRequest): Promise<AbortReceipt>
  abortSession(parentID: string, by: AbortAuthority, cause: string): Promise<AbortReceipt>
}

/** A handle that records nothing: the feature is off, so there is nothing to stop. */
function offHandle(): NoRespawnHandle {
  const refuse = async (): Promise<AbortReceipt> => ({
    sealed: false,
    durable: false,
    revoked: [],
    interrupted: [],
    preserved: [],
    fenced: 0,
    fenceFailures: [],
    notified: false,
    reason: "the feature is off",
  })
  return { dispose: () => {}, abort: refuse, abortSession: refuse }
}

export async function register(ctx: any, options: HostOptions = {}): Promise<NoRespawnHandle> {
  const host = createAdmissionHost({ ...options, ctx })
  await attach(ctx, host)
  return {
    dispose: () => host.close(),
    abort: (request) => host.abort(request),
    abortSession: (parentID, by, cause) => host.abortSession(parentID, by, cause),
  }
}

/**
 * Wire one host to a `ctx`, split out so a test can hold the same host the
 * hooks call. Each domain is probe-then-register in its own try/catch: a host
 * that rejects one hook name must not take the other three down with it.
 *
 * Every domain also writes one call-log record: swallowing a failure keeps the
 * plugin alive, and would otherwise leave a silent registration invisible until
 * a paid session misbehaved.
 */
export async function attach(ctx: any, host: AdmissionHost): Promise<void> {
  await wire("tool.transform", typeof ctx?.tool?.transform === "function", () =>
    ctx.tool.transform((editor: any) => wrapSubagent(editor, host)),
  )
  await wire("tool.hook.execute.after", typeof ctx?.tool?.hook === "function", () =>
    ctx.tool.hook("execute.after", (event: any) => {
      host.after(event)
    }),
  )
  await wire("permission.hook.evaluate", typeof ctx?.permission?.hook === "function", () =>
    ctx.permission.hook("evaluate", async (event: any) => {
      try {
        return await host.enforce(event)
      } catch {
        // The admission path does not inherit the permission hook's fail-open
        // wrapper: an error here denies.
        event.effect = "deny"
        event.message = "nospawn: enforcement failed"
        return { decision: "hold", row: "none", reason: "enforcement failed", generation: null, effect: "deny" }
      }
    }),
  )
  if (typeof ctx?.event?.subscribe !== "function") {
    recordAttach("event.subscribe", false)
    host.feedFailed("the host has no event subscription")
    return
  }
  try {
    const stream = ctx.event.subscribe({ types: EVENT_TYPES })
    // Recorded before `pump` starts: "wired" must not depend on a stream that
    // never yields.
    recordAttach("event.subscribe", true)
    void pump(stream, host)
  } catch (error) {
    recordAttach("event.subscribe", true, error)
    host.feedFailed("the host refused the event subscription")
  }
}

/** `attached` means the registration call returned: present, and not thrown. */
function recordAttach(site: string, present: boolean, error?: unknown): void {
  logCall({
    hook: "hook_no_respawn",
    site: `attach.${site}`,
    present,
    attached: present && error === undefined,
    ...(error === undefined
      ? {}
      : { error: error instanceof Error ? error.message : String(error) }),
  })
}

async function wire(site: string, present: boolean, run: () => unknown): Promise<void> {
  if (!present) return recordAttach(site, false)
  try {
    await run()
    recordAttach(site, true)
  } catch (error) {
    recordAttach(site, true, error)
  }
}

async function pump(stream: any, host: AdmissionHost): Promise<void> {
  let first = true
  try {
    for await (const event of stream) {
      const type = String(event?.type ?? "")
      if (first) {
        first = false
        logCall({ hook: "hook_no_respawn", site: "attach.event.first", type })
      }
      if (type === "session.created") host.created(event)
      else if (type === "session.deleted") host.deleted(event)
      else if (type === "permission.asked") host.asked(event)
      else if (type === "permission.replied") host.replied(event)
      else if (type === INBOX_ENQUEUED) {
        const parentID = String(event?.durable?.aggregateID ?? "")
        const seq = Number(event?.durable?.seq)
        // The wire says what was enqueued; the frontier decides on that type,
        // not on the event name.
        const itemType = event?.data?.item?.type
        if (parentID && Number.isFinite(seq)) host.userItem(parentID, seq, itemType)
      }
    }
  } catch {}
  // A stream that ended, cleanly or not, can no longer keep a frontier.
  host.feedFailed("the event feed stopped")
}

/**
 * The one guard the flag needs: off means no hook, no subscription, and no
 * state file. `setup` calls this and nothing else.
 */
export async function start(ctx: any, enabled: () => boolean, options: HostOptions = {}): Promise<NoRespawnHandle> {
  if (!enabled()) return offHandle()
  return register(ctx, { ...options, enabled })
}
