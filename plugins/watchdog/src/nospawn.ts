/**
 * The no-respawn rule as pure data: the task key, the verdict table, the
 * admission window and the generation. No host, no filesystem, no clock.
 *
 * Every constant below is one of the nine decisions fixed in
 * probes/no-respawn-identity/design.md section 9. Change that file before
 * changing a number here, or the two disagree about what the plugin promises.
 */

import { createHash } from "node:crypto"

/** Decision 1: a recognised replacement waits this long for a human, then Jev rejects it. */
export const HOLD_MS = 60_000
/** Decision 2: wall backstop for a tombstone no user turn ever retires. */
export const TTL_MS = 900_000
/** How long after a call binds its child an unbound child can still belong to it. */
export const BIND_GRACE_MS = 2_000
/** Ceiling on the admission window, whatever the binding record says. */
export const ADMISSION_WINDOW_MS = 60_000
/** Decision 3: a same-agent spawn in the aborted turn is not held on its own. */
export const STRICTER_TIER = false
/** Decision 4: the host task id is not pursued; the key stays (parent, fingerprint). */
export const HOST_TASK_ID = false
/** Decision 5: API-created children are contained after the fact, inside the window only. */
export const API_CONTAINMENT = "window" as const
/** Decision 6: the store is one directory, private to the user. */
export const STATE_DIR_MODE = 0o700
export const STATE_FILE_MODE = 0o600
/**
 * Decision 7: the hold's answers. The prompt is the host's, so this is the
 * host's fixed vocabulary. `always` is accepted and settles this call only:
 * Jev asserts without `save`, so it persists no rule and never becomes a
 * standing grant.
 */
export const HOLD_REPLIES = ["once", "always", "reject"] as const
export type HoldReply = (typeof HOLD_REPLIES)[number]
/**
 * When Jev may reject a pending hold itself. A reject is session-wide on this
 * host: it rejects every pending permission in that session, in both the plain
 * and the message-carrying shape, and no narrower cancel route exists. So Jev
 * rejects only when its own request is the only pending one; otherwise the
 * timer skips, audits `hold_fanout_skipped`, and leaves the hold standing.
 * Proved on the host by probes/jev-ask-enforce, not one of the nine decisions.
 */
export const HOLD_FANOUT = "solo-only" as const
/** Decision 8: keys fold case, so a case-only replacement cannot slip through. */
export const LOWERCASE = true
/** Decision 9: frontier repair backoff; a fourth failure leaves the parent held. */
export const DEGRADED_RETRY_MS = [250, 1_000, 4_000, 15_000] as const

export type Verdict = "allow" | "hold" | "deny"
/**
 * Who decided to stop a task or a session. Recorded on the tombstone so a later
 * read can tell a human stop from a checker's.
 */
export type AbortAuthority = "user" | "system" | "host"
export type TombstoneState = "none" | "live" | "expired" | "retired"

/**
 * What the audit log alone proves about this parent. `clean` is the only value
 * that admits under missing evidence: a record can be missing, unreadable or
 * show a live tombstone, and only the last two hold.
 */
export type AuditEvidence = "live" | "clean" | "unreadable"

/**
 * The row of design section 6 that decided an admission, kept so a log line
 * says why rather than only what.
 */
export type Row =
  | "1"
  | "2"
  | "3"
  | "4"
  | "5"
  | "6"
  | "7"
  | "8"
  | "9"
  | "10"
  | "11"
  | "fence"
  | "retired"
  | "none"

/**
 * One logical task. `abortedAt` is what makes it a tombstone: a record without
 * it was admitted and never stopped, so nothing is being replaced.
 *
 * `parentID` repeats the snapshot's own parent on purpose. A record read out of
 * the wrong store, or handed to the wrong evaluation, then cannot match.
 */
export interface TaskRecord {
  parentID: string
  fingerprint: string
  agent: string
  generation: number
  frontierAtAdmit: number
  frontierAtAbort?: number
  callKeys: string[]
  childIDs: string[]
  abortedAt?: number
  abortedBy?: AbortAuthority
  cause?: string
  retiredAt?: number | null
}

/**
 * A fence, with the kind that decides whether a human may lift it.
 *
 * `parent` is the session fence of a parent whose own run was stopped: it holds,
 * and a human approval for that exact call admits the approved generation.
 * `subtree` is the fence around the sessions bound to an aborted task: it denies,
 * and no approval or generation overrides it.
 */
export interface Fence {
  kind: "parent" | "subtree"
  atSeq: number
  cause: string
  at: number
}

/** What Jev saw of one `subagent` call, for window arithmetic after the fact. */
export interface CallRecord {
  mintAt: number
  boundAt?: number
  abortedAt?: number
}

/** Everything the table needs, and nothing that needs a host to gather. */
export interface AdmissionInput {
  parentID: string
  fingerprint: string
  callKey: string
  /** The `sessionID` the call asked for, when it asked for one. */
  resumeChildID?: string
  /**
   * The generation a human approved for this exact call, minted by
   * `nextGeneration(rec, "human")`. Absent means no approval: an answer without
   * a generation cannot admit anything.
   */
  approvedGeneration?: number
  /** `null` when the frontier cannot be computed. */
  frontierNow: number | null
  /** The parent's snapshot parsed cleanly. */
  stateOk: boolean
  /** What the audit log proves on its own. */
  audit: AuditEvidence
  now: number
}

export interface AdmissionDecision {
  effect: Verdict
  row: Row
  /** The matched tombstone is spent: the caller retires it. */
  retire: boolean
  /** The generation this decision admits, or null when it mints none. */
  generation: number | null
  reason: string
}

/**
 * The task key. NFKC, whitespace collapse, trim, then lower case, so noise
 * around the same instruction lands on one key and the builtin's constant child
 * prefix (added after the assert) cannot bias it.
 *
 * An empty prompt is refused rather than hashed: every empty prompt would
 * otherwise share one key and hold each other.
 */
export function fingerprint(prompt: string): string {
  if (typeof prompt !== "string") throw new TypeError("nospawn: prompt must be a string")
  const text = prompt.normalize("NFKC").replace(/\s+/g, " ").trim()
  if (!text) throw new TypeError("nospawn: an empty prompt has no task key")
  return createHash("sha256").update(LOWERCASE ? text.toLowerCase() : text, "utf8").digest("hex")
}

/**
 * The hold marker: the only string a `permission.asked` frame can be matched
 * on, since the host's frame carries no token of ours. The digest of the call
 * key, because two calls cannot share one, and the reason, because the marker
 * is also what the human reads on the prompt.
 */
export function holdMarker(callKey: string, reason: string): string {
  const digest = createHash("sha256").update(String(callKey), "utf8").digest("hex").slice(0, 12)
  return `nospawn hold ${digest}: ${reason}`
}

/** Whether a tombstone still blocks, expired by the wall backstop, or spent. */
export function tombstoneState(rec: TaskRecord, now: number, ttlMs = TTL_MS): TombstoneState {
  if (rec.abortedAt == null) return "none"
  if (rec.retiredAt != null) return "retired"
  return now < rec.abortedAt + ttlMs ? "live" : "expired"
}

/** Same turn, or a later one. The frontier is temporal scope, not identity. */
export function boundary(rec: TaskRecord, frontierNow: number): "same" | "later" {
  const at = rec.frontierAtAbort ?? rec.frontierAtAdmit ?? 0
  return frontierNow > at ? "later" : "same"
}

/**
 * A child created inside its call's admission window: at or after the call was
 * minted, at or before its binding plus grace (or the abort plus grace when no
 * binding was recorded), and never past the window cap.
 */
export function inAdmissionWindow(
  childAt: number,
  call: CallRecord,
  graceMs = BIND_GRACE_MS,
  capMs = ADMISSION_WINDOW_MS,
): boolean {
  if (!Number.isFinite(childAt) || !call || !Number.isFinite(call.mintAt)) return false
  if (childAt < call.mintAt) return false
  const anchor = call.boundAt ?? call.abortedAt
  if (anchor == null || !Number.isFinite(anchor)) return false
  return childAt <= Math.min(anchor + graceMs, call.mintAt + capMs)
}

/**
 * The generation a new record takes. Nothing is minted without a human: an
 * unapproved replacement stays on its current generation because it never runs.
 */
export function nextGeneration(rec?: TaskRecord, approvedBy?: "human"): number {
  if (!rec) return 1
  return approvedBy === "human" ? rec.generation + 1 : rec.generation
}

/**
 * The selective rule, in four passes:
 *
 * 1. Exact denies: rows 1, 6 and 2, before any evidence is read or any approval
 *    is consulted.
 * 2. The evidence gate: rows 9 and 10.
 * 3. The task table against this parent's records: rows 3, 4, 5, 7, 8 and the
 *    no-record case.
 * 4. The parent session fence, only over an allow, so it can never return a
 *    different verdict than the task table already justified.
 *
 * `records` may hold records of other parents: they are filtered out here, so a
 * caller cannot leak a tombstone onto an unrelated session.
 *
 * A human approval is consulted only at the hold rows (3, 4, 9) and at the
 * parent fence, and always against the newest record that could be the one being
 * replaced. Rows 1, 2 and 6 deny on exact evidence and never see an approval.
 */
export function verdict(input: AdmissionInput, records: TaskRecord[] = [], fence?: Fence): AdmissionDecision {
  const parentID = input.parentID
  const mine = records.filter((rec) => rec.parentID === parentID)
  const foreign = records.some((rec) => rec.parentID !== parentID)
  const resume = input.resumeChildID

  // 1. Exact denies. The row is "the aborted invocation replayed", so the
  // record has to be aborted: admission writes the call key into a live record,
  // and matching that would deny the first assert of every call.
  if (mine.some((rec) => rec.abortedAt != null && rec.callKeys.includes(input.callKey))) {
    return decide("deny", "1", false, null, "the aborted invocation replayed")
  }

  // Row 6 is the child subtree fence and is never approvable. An unknown kind
  // lands here too: a fence that cannot be read is not a fence to lift.
  if (fence && fence.kind !== "parent") {
    return decide("deny", "6", false, null, "the calling session is inside a fenced subtree")
  }

  if (resume && mine.some((rec) => rec.childIDs.includes(resume))) {
    return decide("deny", "2", false, null, "the child is bound to an aborted task")
  }

  // 2. The evidence gate, then 3. the task table over readable evidence.
  const live = mine.filter((rec) => tombstoneState(rec, input.now) === "live")
  const match = mine.find((rec) => rec.fingerprint === input.fingerprint)
  const frontierNow = input.frontierNow
  let decision: AdmissionDecision
  if (frontierNow === null || !input.stateOk) {
    // `clean` is the only audit value that can prove nothing was aborted here.
    if (live.length || input.audit !== "clean") {
      decision = hold(input, "9", "a tombstone is live or the audit is unreadable, and the evidence cannot be read", newest(live) ?? match)
    } else {
      decision = decide("allow", "10", false, null, "no tombstone was ever recorded for this parent")
    }
  } else if (resume && live.length) {
    decision = hold(input, "3", "an unknown child id while a tombstone is live", newest(live))
  } else if (!match) {
    if (mine.length) decision = decide("allow", "7", false, null, "a different task in the same parent")
    else if (foreign) decision = decide("allow", "8", false, null, "a record of another parent cannot match")
    else decision = decide("allow", "none", false, null, "this parent has no records")
  } else {
    const state = tombstoneState(match, input.now)
    if (state === "none") decision = decide("allow", "none", false, null, "the task was admitted and never aborted")
    else if (state !== "live") decision = decide("allow", "retired", false, null, "the tombstone is retired or expired")
    else if (boundary(match, frontierNow) === "same") decision = hold(input, "4", "the same task, before any user turn", match)
    else decision = decide("allow", "5", true, null, "the same task, after a user turn")
  }

  // 4. The parent fence, over an allow only. It cannot rescue a task hold: a
  // stale approval that fails row 4 must not pass through here instead.
  if (decision.effect !== "allow" || !fence) return decision
  // A call a human already answered for carries its own lift: the same record
  // and the same generation, so the fence has nothing left to ask.
  if (decision.generation !== null) return decision
  if (frontierNow === null) {
    // Without the frontier there is no proof a user item passed the fence, so
    // the fence holds whatever the evidence gate concluded.
    return hold(input, "fence", "the parent session is fenced and the frontier cannot be read", match)
  }
  if (frontierNow > fence.atSeq) return decision
  return hold(input, "fence", "the parent session is fenced", match)
}

/** The newest live record: the one an approval has to beat. */
function newest(records: TaskRecord[]): TaskRecord | undefined {
  return records.reduce<TaskRecord | undefined>((best, rec) => (!best || rec.generation > best.generation ? rec : best), undefined)
}

/**
 * A hold, unless a human approved this call. The approval must carry a positive
 * whole generation, and against a known record it must be newer than that
 * record, so a stale approval cannot admit a generation nobody answered for.
 * Used by rows 3, 4, 9 and the parent session fence, never by rows 1, 2 or 6.
 */
function hold(input: AdmissionInput, row: Row, reason: string, rec?: TaskRecord): AdmissionDecision {
  const approved = input.approvedGeneration
  if (approved == null || !Number.isInteger(approved) || approved < 1) return decide("hold", row, false, null, reason)
  if (rec && approved <= rec.generation) {
    return decide("hold", row, false, null, `${reason}; the approval predates generation ${rec.generation + 1}`)
  }
  return decide("allow", row, false, approved, `${reason}; a human approved generation ${approved}`)
}

function decide(
  effect: Verdict,
  row: Row,
  retire: boolean,
  generation: number | null,
  reason: string,
): AdmissionDecision {
  return { effect, row, retire, generation, reason }
}
