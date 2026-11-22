/**
 * One durable abort operation: the selected session, its owned descendant
 * subtree, and what the containment attempt actually stopped.
 *
 * The record is identity, scope and receipt. Enforcement is the durable subtree
 * session ban written to the session-ban store: a `subtree` ban has no expiry,
 * no approval and no user-turn retirement, and a restart reads it back. Records
 * are never removed here; `releaseOperation` owns release semantics.
 *
 * A record carries no prompt, no argument, no model reply and no secret. Steps
 * name fixed capabilities and counts, and session ids are the host's own. A step
 * that stopped less than asked is reported as `failed` or `unsupported`, never
 * as a stop that happened.
 *
 * The window between "the abort starts" and "the scan names the descendants" is
 * narrowed at every release that consults this module: the chain and the
 * question-card route hold their release for the length of the scan, then
 * re-check the cancelled set. The hold covers releases in flight; a call whose
 * execution already began, or one admitted after the scope is marked, is stopped
 * by the durable ban and the interrupt instead. It is not a global lock — a
 * surface that never asks does not wait — so a descendant's admission on such a
 * surface is covered only once discovery marks it.
 *
 * Nothing here can cancel a started transient generation: the pinned plugin
 * surface has no such primitive (capability report C3, closed enumeration), so
 * the started review is recorded unsupported and its late result is discarded by
 * the chain's own settle-once rule.
 *
 * A started deny is proven at the module seam only. While nonblocking timing
 * stays gated, the production gate always produces a queued deny, so no live
 * route reaches the started shape; started-deny containment is deferred to #19 /
 * execution-state work.
 */

import { readFileSync, writeFileSync, mkdirSync, renameSync, chmodSync } from "node:fs"
import { dirname, join } from "node:path"
import { chainStateHome } from "./chain.ts"
import type { DescendantScan } from "./tool-ban-actions.ts"

/** In the chain's state home, beside the gate and budget files. */
export const ABORT_FILE = "abort-operations.json"

/** Who asked. `chain` is a verdict or a card answer, `human` an operator action. */
export type AbortSource = "chain" | "human"

/**
 * The containment steps every abort attempts, in the order it runs them.
 * `scope` is discovery: without it the operation cannot say what the subtree is,
 * so a failed scan is incomplete containment rather than an empty subtree.
 * `receipt` is the operation's own record: an abort that cannot say what it did
 * has contained nothing it can vouch for.
 */
export type AbortStep = "scope" | "receipt" | "ban" | "interrupt" | "cards" | "approvals" | "reviews" | "tools" | "jobs"

/**
 * `done` is the host's own confirmation. `failed` is an attempt the host refused.
 * `unconfirmed` is a step whose result the host did not state either way.
 * `unsupported` is a step no primitive can perform at all.
 */
export type StepStatus = "done" | "failed" | "unconfirmed" | "unsupported"

export interface ContainmentRow {
  step: AbortStep
  status: StepStatus
  /** Fixed vocabulary and counts: never an id list, a prompt or an argument. */
  detail: string
}

export interface AbortOperation {
  /** Unique per abort, so two operations never merge. */
  id: string
  /** The selected session. */
  sessionID: string
  /** The selected session and its owned descendants at abort time. */
  scope: string[]
  source: AbortSource
  cause: string
  at: number
  /**
   * When the operator released this operation, if ever. Absent is active: the
   * operation's restrictions are in force and only its own release lifts them.
   */
  released?: number
  /** When a release's continuation prompt was confirmed sent, if ever. */
  continuedAt?: number
}

export interface AbortRecord {
  operation: AbortOperation
  containment: ContainmentRow[]
}

export interface AbortOutcome {
  /** The identity reached disk, so a restart still knows this operation. */
  ok: boolean
  /** The subtree is blocked: discovery ran, the record and its ban reached the store. */
  sealed: boolean
  /** The identity reached disk, so a restart still knows this operation. */
  durable: boolean
  /** The final receipt write landed: the record carries what ran. */
  receipt: boolean
  /** Durable ban coverage over the scope. */
  ban: { written: number; failed: number }
  operation: AbortOperation
  containment: ContainmentRow[]
  /** Steps that stopped less than asked, with their exact reason. */
  incomplete: ContainmentRow[]
}

/** What each open-prompt fact states, in the receipt's fixed vocabulary. */
const PROMPT_REASON: Record<OpenPromptFact["reason"], string> = {
  unnamed: "no prompt named",
  "in-flight": "a reply is still in flight",
  "no-outcome": "no reply outcome was observed",
  refused: "the host refused the reject",
  "skipped-pending": "the reject was skipped: another permission is pending",
  "skipped-unreadable": "the reject was skipped: the pending list could not be read",
  unsupported: "the host exposes no reply primitive",
}

/** What one interrupt attempt proved. Only `done` is a confirmed stop. */
export type InterruptStatus = "done" | "refused" | "unconfirmed" | "unsupported"

/**
 * What revoking one scope's native provider holds proved. Only `revoked` is a
 * confirmed release: the entry is denied in process either way, so no answer can
 * mint, and each field says what happened to the pending prompt behind it. A
 * prompt stays counted until a rejection or an answer is confirmed, so a later
 * receipt repeats what an earlier one could not close.
 */
export interface HoldRevocation {
  /**
   * Denied, and the prompt is closed: the host took this reject, or answered the
   * request itself while the reject waited.
   */
  revoked: number
  /** Denied, but the host refused to reject the pending prompt. */
  failed: number
  /** Denied, and the closure of its prompt was not observed. */
  unconfirmed: number
  /** Denied, and the host exposes no reply primitive to reject a prompt with. */
  unsupported: number
  /**
   * One fact per prompt that stayed open, so the receipt can name the state it is
   * in instead of one reason for all of them. A prompt whose request id is known
   * is never described as unnamed.
   */
  openDetail: OpenPromptFact[]
}

/**
 * Why one prompt's closure was not observed. The reason is what this process
 * saw, never a guess: `unnamed` means no request id was ever correlated, which is
 * a different fact from a named prompt whose reply it could not read.
 */
export interface OpenPromptFact {
  /** The host request id the provider correlated, or null when none ever was. */
  requestID: string | null
  /**
   * `unnamed`: no prompt was ever correlated.
   * `in-flight`: a reply this process did not start owns the prompt.
   * `no-outcome`: the attempt ran and reported no closure.
   * `refused`: the host took the reply and declined it.
   * `skipped-pending` / `skipped-unreadable`: no reject was sent, for a local
   * reason. These are never a host answer.
   * `unsupported`: the host exposes no reply primitive.
   */
  reason:
    | "unnamed"
    | "in-flight"
    | "no-outcome"
    | "refused"
    | "skipped-pending"
    | "skipped-unreadable"
    | "unsupported"
}

/** What the host and this process can do for one abort. */
export interface AbortIO {
  /** The selected session's owned descendants, by the host's own lineage. */
  subtree(sessionID: string): Promise<DescendantScan>
  /** Register a scope as cancelled before any restriction is written. */
  markAborted(sessionIDs: string[]): void
  /**
   * Hold every release already inside its final execution check, for the length
   * of the descendant scan. Descendants are unknown until the scan returns, so a
   * held release waits and then re-checks the cancelled set.
   */
  holdReleases(): () => void
  /** One session interrupt. Only `done` is the host's own confirmation. */
  interrupt(sessionID: string): Promise<InterruptStatus>
  /** Held cards this process can still answer, each with its own session. */
  cards(): Array<{ formID: string; sessionID: string }>
  /** True when the host accepted the removal. */
  cancelCard(sessionID: string, formID: string): Promise<boolean>
  /** Resolve a held card's waiter, so nothing waits on a card that is gone. */
  releaseCard(formID: string): void
  /** Settle this scope's queued reviews; report the already-started ones. */
  reviews(sessionIDs: string[]): { settled: number; started: number }
  /**
   * Revoke this scope's native provider holds: deny each held entry in process
   * and reject the pending prompt behind it where the host allows. The counts
   * report what was confirmed, so the receipt never claims a closed prompt it
   * could not close.
   */
  holds(sessionIDs: string[]): Promise<HoldRevocation>
  /**
   * Revoke this scope's pending approvals. Release never restores them: what
   * an abort revoked stays revoked past a release.
   */
  approvals(sessionIDs: string[]): { revoked: number; failed: number }
  /**
   * The durable subtree ban for the whole scope. `operation` attributes the
   * rows to this abort, so a later release lifts exactly these restrictions
   * and no other family's or operation's.
   */
  ban(sessionIDs: string[], cause: string, operation?: string): { written: number; failed: number }
  /** Persist a record: the first write seals identity, the last seals containment. */
  store: {
    append(record: AbortRecord): boolean
    replace(record: AbortRecord): boolean
  }
  now(): number
  audit(row: Record<string, unknown>): void
}

export interface AbortRequest {
  sessionID: string
  source: AbortSource
  cause: string
  /** Override the discovery bound. Tests only; production uses the default. */
  scanTimeoutMs?: number
}

/**
 * How long one descendant listing may hold the abort. Discovery is a single host
 * call, and every in-flight release waits on it, so a listing that never answers
 * must not pin them: past this the scan is unavailable and containment is
 * incomplete rather than unbounded.
 */
export const DESCENDANT_SCAN_MS = 5_000

/** The record file. Unreadable is an error: an empty list would read as "no abort". */
export function abortFile(): string {
  return join(chainStateHome(), ABORT_FILE)
}

export type AbortRead =
  | { ok: true; records: AbortRecord[] }
  | { ok: false; reason: "unreadable" | "corrupt" }

export function readAbortRecords(): AbortRead {
  let raw: string
  try {
    raw = readFileSync(abortFile(), "utf8")
  } catch (error) {
    return (error as NodeJS.ErrnoException)?.code === "ENOENT" ? { ok: true, records: [] } : { ok: false, reason: "unreadable" }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, reason: "corrupt" }
  }
  const rows = (parsed as { operations?: unknown })?.operations
  if (!Array.isArray(rows)) return { ok: false, reason: "corrupt" }
  const records: AbortRecord[] = []
  for (const row of rows) {
    const record = asRecord(row)
    if (!record) return { ok: false, reason: "corrupt" }
    records.push(record)
  }
  return { ok: true, records }
}

/** Append one operation. A rewrite keeps the whole set, so overlapping operations survive. */
export function appendAbortRecord(record: AbortRecord): boolean {
  const read = readAbortRecords()
  if (!read.ok) return false
  return writeAll([...read.records, record])
}

/** Replace one operation's record in place. Unknown ids are appended, never dropped. */
export function replaceAbortRecord(record: AbortRecord): boolean {
  const read = readAbortRecords()
  if (!read.ok) return false
  const at = read.records.findIndex((entry) => entry.operation.id === record.operation.id)
  const next = at < 0 ? [...read.records, record] : read.records.map((entry, index) => (index === at ? record : entry))
  return writeAll(next)
}

/** Steps that stopped less than asked. */
export function incompleteContainment(rows: ContainmentRow[]): ContainmentRow[] {
  return rows.filter((row) => row.status !== "done")
}

/** What startup recovery needs; a full `AbortIO` satisfies it. */
export type ReconcileIO = Pick<AbortIO, "ban" | "store" | "audit">

/**
 * Enforcement this recovery could not establish. Admissions for `sessions` are
 * refused; `null` means every session, because the whole store was unreadable.
 */
export interface RecoveryBlock {
  reason: "corrupt" | "unreadable" | "reassert-failed"
  sessions: string[] | null
}

export interface ReconcileOutcome {
  /** Operations whose restriction was rewritten. */
  restored: number
  /** Operations whose restriction or record rewrite failed. */
  failed: number
  /** Non-null when some enforcement is not in place: never read that as clean. */
  blocked: RecoveryBlock | null
  /**
   * The union of every readable record's scope, whatever its ban state. A live
   * abort mark inside this set is already carried by a durable record, so it can
   * be dropped; a mark outside it has no record and must be kept.
   */
  scopes: string[]
}

/**
 * True when the record's own ban row says the ban reached every scope member.
 *
 * The receipt row is deliberately not consulted: an abort can persist
 * `receipt: done` while a ban write failed, so a receipt-gated recovery would
 * leave that scope unbanned forever. Both writers in this module report the
 * counts as `X of Y sessions`; a row this code cannot read is not confirmed, and
 * the re-assert below is idempotent, so the only cost of a mismatch is one extra
 * ban write.
 */
function banCovers(record: AbortRecord): boolean {
  const row = record.containment.find((entry) => entry.step === "ban")
  if (!row || row.status !== "done") return false
  const counts = /(\d+) of (\d+) sessions/.exec(row.detail)
  if (!counts) return false
  const written = Number(counts[1])
  const total = Number(counts[2])
  return total === record.operation.scope.length && written === total
}

/**
 * True when this block covers `sessionID`. Written once so every admission path
 * applies the same scope rule: `null` is every session, a list is exactly its
 * members.
 */
export function recoveryCovers(block: RecoveryBlock, sessionID: string): boolean {
  return block.sessions === null || block.sessions.includes(sessionID)
}

/**
 * The one sentence every admission path refuses with. It names the failure, not
 * the caller, so the chain hook and the session-ban provider answer alike.
 */
export function recoveryReason(block: RecoveryBlock): string {
  const why =
    block.reason === "reassert-failed"
      ? "an unconfirmed abort's ban could not be restored at startup"
      : `the abort operation record is ${block.reason}`
  return `${why}, so this call is not admitted`
}

/**
 * Sessions an abort operation has selected in this process, recorded the moment
 * the operation starts. This is abort-level state, not the chain's: the durable
 * ban is only written after descendant discovery, and the review chain may be
 * off, so the early mark is the one signal that exists in that window. A mark
 * leaves only through that operation's release, and only when no other active
 * operation covers the session.
 */
const abortedSessions = new Set<string>()

/** Register an abort scope. Called before the first await of the operation. */
export function markAbortStarted(sessionIDs: string[]): void {
  for (const sessionID of sessionIDs) abortedSessions.add(sessionID)
}

/** True when an abort operation has selected this session in this process. */
export function abortStarted(sessionID: string): boolean {
  return abortedSessions.has(sessionID)
}

/**
 * Keep every mark no durable record covers. `setup` reconciles first and then
 * calls this with the scopes it recovered: a recovered record already carries
 * the ban, so its mark is redundant. A mark outside that set is the only trace
 * of an abort that is still discovering, or died before writing its identity: no
 * record will ever name it, so dropping it would open the exact window this
 * registry exists to close. It is kept, and a release is what clears it later.
 */
export function retainUncoveredAbortMarks(covered: Iterable<string>): void {
  for (const sessionID of covered) abortedSessions.delete(sessionID)
}

/** Clear the marks one released operation's uncovered scope leaves behind. */
export function clearAbortMarks(sessionIDs: string[]): void {
  for (const sessionID of sessionIDs) abortedSessions.delete(sessionID)
}

/**
 * Every active operation covering this session: its own direct scope, or an
 * ancestor's scope that names it. Effective blocked state is the truth of this
 * list, one entry or many.
 */
export function coveringOperations(records: AbortRecord[], sessionID: string): AbortOperation[] {
  return records.filter((record) => !record.operation.released && record.operation.scope.includes(sessionID)).map((record) => record.operation)
}

/**
 * Releases held while one abort discovers its scope, process-wide. Discovery is
 * a single host call and the descendants are unknown until it returns, so an
 * admission that runs during it must wait and then re-ask the gate: the chain is
 * not the only surface that admits calls, and with the chain off it is the card
 * route, which would otherwise allow a descendant that is not even marked yet.
 */
let holdDepth = 0
/**
 * Bumped on every hold open and every close. A waiter captures the promise that
 * was current when it called, so an abort that opens a hold between that capture
 * and the continuation would otherwise be invisible: the captured promise is
 * already resolved and the caller would admit a descendant the scan has not
 * named. The epoch is what makes "no hold opened or closed across my wait" a fact
 * the waiter can check, not an assumption about timing.
 */
let holdEpoch = 0
let openHolds: Promise<void> = Promise.resolve()
let closeHolds: (() => void) | null = null

/**
 * Resolve when no discovery hold is open, and when no hold opened or closed
 * across the wait. Seconds, not minutes: the scan itself is bounded, and a caller
 * that awaits this is admitting one tool call.
 *
 * The capture is deliberately re-checked after every await. `openHolds` is a
 * single promise that a new abort replaces synchronously with its own, so a
 * caller that read the resolved one just before that abort opened a hold would
 * resume before the hold's scope was named. Loop until the wait itself saw depth
 * zero with an unchanged epoch; only then is the following gate read current.
 */
export async function awaitReleaseHold(): Promise<void> {
  for (;;) {
    const epoch = holdEpoch
    const pending = openHolds
    // No yield between this read and the return, so no hold can open unseen.
    if (holdDepth === 0) return
    await pending
    // A hold in force, or one that opened/closed while this waited, outranks the
    // capture: wait on the current promise and look again.
    if (holdDepth === 0 && holdEpoch === epoch) return
  }
}

/**
 * True while a discovery hold is open. Synchronous by design: it is read in the
 * same block as the gate decision it guards, never across an await.
 */
export function releaseHoldOpen(): boolean {
  return holdDepth > 0
}

/**
 * How one caller waits for a discovery hold. Defaults to this module's
 * process-wide hold; the session-ban provider passes its own injected pair.
 */
export interface ReleaseHold {
  wait: () => Promise<void>
  inForce: () => boolean
}

const processHold: ReleaseHold = { wait: awaitReleaseHold, inForce: releaseHoldOpen }

/**
 * Release one call: wait out every hold, then read the restriction and run
 * `release` in the same synchronous block, so the answer never travels.
 *
 * Both halves matter. The wait ends with a yield, and a queued abort marks its
 * selected session and opens its hold inside that gap, so the hold is re-probed
 * after the wait and only a zero depth lets the read happen at all. The read and
 * the release are then one step: `abortSubtree` marks its session synchronously
 * with its start, so an abort that began before the read is in the answer, and
 * one that begins after the release cannot overtake a call that is already out.
 * A caller that awaits the read and then applies it leaves a microtask in which
 * an abort can start unseen, which is what this shape removes: the release is
 * passed in, never returned.
 */
export async function releaseWhenClear<T>(
  blocked: () => string | null,
  release: (refusal: string | null) => T,
  hold: ReleaseHold = processHold,
): Promise<T> {
  for (;;) {
    await hold.wait()
    if (hold.inForce()) continue
    return release(blocked())
  }
}

/** Open one hold. The returned function closes it, and is idempotent. */
function openReleaseHold(): () => void {
  holdDepth += 1
  holdEpoch += 1
  if (holdDepth === 1) {
    openHolds = new Promise<void>((resolve) => {
      closeHolds = resolve
    })
  }
  let open = true
  return () => {
    if (!open) return
    open = false
    holdDepth -= 1
    holdEpoch += 1
    if (holdDepth > 0 || !closeHolds) return
    const done = closeHolds
    // Cleared before the resolve: a release that starts after this point must
    // not be told to wait on a hold that is already over.
    closeHolds = null
    openHolds = Promise.resolve()
    done()
  }
}


/**
 * Drop every mark unconditionally. Test suites only: production clears a mark by
 * the coverage rule above, never wholesale.
 */
export function resetAbortMarks(): void {
  abortedSessions.clear()
}

/**
 * Re-assert enforcement for every record whose ban is not confirmed. Enforcement
 * is the ban, so the ban row decides: a record that says `receipt: done` beside
 * `ban: failed` has no restriction and is retried like any other. The record's
 * own scope is the source; nothing outside it is touched. It runs before any
 * call is admitted and stays idempotent, so it re-asserts the ban even after an
 * outside edit.
 *
 * A store that cannot be read is a recovery failure, never a clean result: the
 * scopes it held are unknowable, so every session is blocked. A readable store
 * whose ban write fails is blocked for the affected scope: that record's
 * enforcement is missing and its sessions must not be admitted. A scope whose
 * ban landed but whose record could not be rewritten is not blocked, because the
 * ban already covers it and the rewrite is retried at the next start.
 */
export function reconcileAbortRecords(io: ReconcileIO): ReconcileOutcome {
  const read = readAbortRecords()
  if (!read.ok) {
    io.audit({
      event: "abort_recovery_blocked",
      reason: read.reason,
      all: true,
      detail: "the abort operation record cannot be read, so recovery is unavailable",
    })
    return { restored: 0, failed: 0, blocked: { reason: read.reason, sessions: null }, scopes: [] }
  }
  let restored = 0
  let failed = 0
  let blocked: string[] | null = null
  const scopes: string[] = []
  for (const record of read.records) {
    // A released operation owns no restriction: its scope is not re-asserted,
    // not marked, and never blocks a restart. Active operations are untouched.
    if (record.operation.released) continue
    const scope = record.operation.scope
    for (const sessionID of scope) if (!scopes.includes(sessionID)) scopes.push(sessionID)
    if (banCovers(record)) continue
    const ban = io.ban(scope, "recovery: the abort ban was not confirmed", record.operation.id)
    const row: ContainmentRow = {
      step: "ban",
      status: ban.failed ? "failed" : "done",
      detail: `recovery wrote the durable subtree ban for ${ban.written} of ${scope.length} sessions`,
    }
    const containment = [...record.containment.filter((entry) => entry.step !== "ban"), row]
    const replaced = io.store.replace({ operation: record.operation, containment })
    if (replaced && !ban.failed) restored++
    else failed++
    if (ban.failed) blocked = [...new Set([...(blocked ?? []), ...scope])]
    io.audit({
      event: "abort_recovery",
      operationID: record.operation.id,
      sessionID: record.operation.sessionID,
      scope: scope.length,
      written: ban.written,
      failed: ban.failed,
      receipt: replaced,
    })
  }
  if (blocked) {
    io.audit({
      event: "abort_recovery_blocked",
      reason: "reassert-failed",
      scope: blocked.length,
      all: false,
      detail: "an unconfirmed abort's ban could not be restored, so its sessions are not admitted",
    })
    return { restored, failed, blocked: { reason: "reassert-failed", sessions: blocked }, scopes }
  }
  return { restored, failed, blocked: null, scopes }
}

/**
 * One discovery call, bounded. A listing that never answers would pin every
 * release waiting on this abort, so past `ms` the scan is unavailable: the
 * selected session is still held by its ban and interrupt, and the scope step
 * records that discovery is incomplete. A late answer is dropped; it never
 * extends a scope that is already recorded.
 */
function boundedScan(work: Promise<DescendantScan>, ms: number): Promise<DescendantScan> {
  return new Promise<DescendantScan>((resolve) => {
    const bound = Math.max(1, ms)
    const timer = setTimeout(() => {
      resolve({ ok: false, reason: `the session listing did not answer within ${bound}ms` })
    }, bound)
    work.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      () => {
        clearTimeout(timer)
        resolve({ ok: false, reason: "the session listing failed" })
      },
    )
  })
}

/**
 * The whole abort: the scope registered first, then identity, then the durable
 * ban, then the containment it can actually perform. Steps run in one order so
 * the restriction exists before anything is interrupted or cancelled.
 */
export async function abortSubtree(io: AbortIO, request: AbortRequest): Promise<AbortOutcome> {
  const at = io.now()
  // The selected session is in scope by definition, so it is registered before
  // the first await: a call already inside its final execution check cannot be
  // allowed during descendant discovery. Discovery only extends the set.
  io.markAborted([request.sessionID])
  // Descendants are unknown until the scan returns, so every release already
  // inside its check waits for it and then re-checks the cancelled set. Two
  // holds: the chain's own, and the process-wide one the card route asks. Both
  // are one host call wide and are released before the ban write.
  const unhold = io.holdReleases()
  const unholdProcess = openReleaseHold()
  let scan: DescendantScan = { ok: false, reason: "the session listing failed" }
  let scope: string[] = [request.sessionID]
  try {
    scan = await boundedScan(io.subtree(request.sessionID), request.scanTimeoutMs ?? DESCENDANT_SCAN_MS)
    scope = scoped([request.sessionID, ...(scan.ok ? scan.ids : [])])
    // Discovery finished: the whole known subtree joins the cancelled set.
    io.markAborted(scope)
  } finally {
    unholdProcess()
    unhold()
  }
  const operation: AbortOperation = {
    id: operationID(at),
    sessionID: request.sessionID,
    scope,
    source: request.source,
    cause: clip(request.cause, 160),
    at,
  }

  // Identity first, with a receipt that says nothing is confirmed yet: a record
  // that outlives a failed receipt write must not read as full containment.
  const durable = io.store.append({
    operation,
    containment: [
      { step: "receipt", status: "unsupported", detail: "the containment receipt was not written; treat every step as unconfirmed" },
    ],
  })

  const rows: ContainmentRow[] = []
  rows.push(
    scan.ok
      ? { step: "scope", status: "done", detail: `discovered ${scope.length - 1} owned descendants` }
      : {
          step: "scope",
          status: "failed",
          detail: `${scan.reason}; this session's descendants are unknown, so only the selected session is held`,
        },
  )

  const ban = io.ban(scope, operation.cause, operation.id)
  rows.push({
    step: "ban",
    status: ban.failed ? "failed" : "done",
    detail: `durable subtree ban written for ${ban.written} of ${scope.length} sessions`,
  })

  // The selected session last, as the tool-ban path does: a child that is still
  // running must not be promoted by its parent's stop.
  const confirmed: string[] = []
  const refused = { refused: 0, unconfirmed: 0, unsupported: 0 }
  for (const sessionID of [...scope.slice(1), operation.sessionID]) {
    const status = await io.interrupt(sessionID)
    if (status === "done") confirmed.push(sessionID)
    else refused[status]++
  }
  rows.push({
    step: "interrupt",
    status: refused.refused ? "failed" : refused.unconfirmed ? "unconfirmed" : refused.unsupported ? "unsupported" : "done",
    detail: [
      `interrupted ${confirmed.length} of ${scope.length} sessions`,
      ...(refused.refused ? [`${refused.refused} refused`] : []),
      ...(refused.unconfirmed ? [`${refused.unconfirmed} unconfirmed`] : []),
      ...(refused.unsupported ? [`${refused.unsupported} could not be attempted`] : []),
    ].join("; "),
  })

  const held = io.cards().filter((card) => scope.includes(card.sessionID))
  let removed = 0
  for (const card of held) {
    // Release first: a card the host will not delete is still not a hold.
    io.releaseCard(card.formID)
    if (await io.cancelCard(card.sessionID, card.formID)) removed++
  }
  rows.push({
    step: "cards",
    status: held.length === 0 || removed === held.length ? "done" : "failed",
    detail: held.length
      ? `cancelled ${removed} of ${held.length} held cards`
      : "no question cards in scope",
  })

  // A native provider hold is a hold too, and it is not a card: it waits in the
  // session-ban provider's own table with a pending permission prompt behind it.
  // This row counts both, so it can never read as "no holds" while one is open.
  const holds = await io.holds(scope)
  const approvals = io.approvals(scope)
  // A named prompt and an unnamed one are different facts, and a recovery reader
  // needs the request id to act on the first: the count alone would report a
  // prompt this process can name as one it never saw.
  const open = holds.openDetail
  const namedWith = (...reasons: OpenPromptFact["reason"][]) =>
    open.filter((fact) => fact.requestID !== null && reasons.includes(fact.reason))
  const unnamed = open.filter((fact) => fact.requestID === null).length
  // Every host-declined or locally skipped reject is a prompt left open, and the
  // fact says which of the two it is: a skip is never attributed to the host.
  const refusedPrompts = namedWith("refused", "skipped-pending", "skipped-unreadable")
  const unconfirmedNamed = namedWith("in-flight", "no-outcome")
  const nameFacts = (facts: OpenPromptFact[]) =>
    ` (${facts.map((fact) => `request ${fact.requestID}: ${PROMPT_REASON[fact.reason]}`).join("; ")})`
  const holdsDetail =
    holds.revoked + holds.failed + holds.unconfirmed + holds.unsupported === 0
      ? "no native provider holds in scope"
      : [
          `native provider holds: ${holds.revoked} released`,
          ...(holds.failed ? [`${holds.failed} left open${refusedPrompts.length ? nameFacts(refusedPrompts) : ""}`] : []),
          ...(unnamed ? [`${unnamed} with no prompt named`] : []),
          ...(unconfirmedNamed.length
            ? [`${unconfirmedNamed.length} unconfirmed${nameFacts(unconfirmedNamed)}`]
            : []),
          ...(holds.unsupported ? [`${holds.unsupported} not cancellable`] : []),
        ].join("; ")
  rows.push({
    step: "approvals",
    status: approvals.failed || holds.failed
      ? "failed"
      : holds.unsupported
        ? "unsupported"
        : holds.unconfirmed
          ? "unconfirmed"
          : "done",
    detail: `revoked ${approvals.revoked} pending approvals${approvals.failed ? `; ${approvals.failed} refused` : ""}; ${holdsDetail}`,
  })

  const reviews = io.reviews(scope)
  rows.push({
    step: "reviews",
    status: reviews.started ? "unsupported" : "done",
    detail: reviews.started
      ? `settled ${reviews.settled} queued reviews; ${reviews.started} started generation(s) cannot be cancelled and their late results are discarded`
      : `settled ${reviews.settled} queued reviews`,
  })

  rows.push({
    step: "tools",
    status: "unsupported",
    detail: "the pinned plugin surface has no per-tool cancellation; a started tool is stopped only by the session interrupt",
  })
  rows.push({
    step: "jobs",
    status: "unsupported",
    detail: "no background-job cancellation primitive; a started job is not observed and may still run",
  })

  // The receipt row travels with the write that carries it, so the record on disk
  // either names its containment or is the identity-only one. A refused write
  // rewrites the row in the returned outcome; it never reads as done.
  const receiptRow: ContainmentRow = { step: "receipt", status: "done", detail: "the operation record carries this receipt" }
  rows.push(receiptRow)
  const recorded = io.store.replace({ operation, containment: rows })
  if (!recorded) {
    receiptRow.status = "failed"
    receiptRow.detail = "the receipt write failed; the identity-only record stands and every step is unconfirmed"
  }
  const incomplete = incompleteContainment(rows)
  io.audit({
    event: "abort_operation",
    operationID: operation.id,
    sessionID: operation.sessionID,
    scope: scope.length,
    source: operation.source,
    cause: operation.cause,
    // The linearization boundary: the selected session stopped being admissible
    // at this time, before the first await. Descendants join at discovery.
    linearizedAt: at,
    incomplete: incomplete.map((row) => `${row.step}:${row.status}`).join(","),
  })
  // Sealed means the subtree is blocked: discovery ran, the ban reached every
  // scope member and the receipt is on disk. It never means every step stopped.
  const sealed = durable && recorded && scan.ok && ban.failed === 0 && ban.written === scope.length
  return {
    ok: durable,
    sealed,
    durable,
    receipt: recorded,
    ban: { written: ban.written, failed: ban.failed },
    operation,
    containment: rows,
    incomplete,
  }
}

/** What a release asks: one operation, and whether to continue its session. */
export interface ReleaseRequest {
  operationID: string
  /** Send one continuation prompt to the selected session if it is effectively unblocked. */
  continue?: boolean
}

/**
 * What one release proved, in the abort family's receipt vocabulary. `ok` is
 * the released record on disk; failed restriction clears and a prevented
 * continuation are `incomplete` rows and statuses, never a silent success.
 */
export interface ReleaseOutcome {
  /** The operation is released: this call marked it, or it was released before. */
  ok: boolean
  /** The released record reached disk. */
  durable: boolean
  /** The final record write landed: the release, plus `continuedAt` when a prompt was sent. */
  receipt: boolean
  /** The operation was already released when this call arrived. */
  already: boolean
  operation: AbortOperation | null
  ban: { cleared: number; kept: number; failed: number }
  /** Scope sessions another active operation still covers. */
  covered: string[]
  continued: "sent" | "prevented" | "not-requested" | "unsupported" | "already"
  incomplete: ContainmentRow[]
  reason?: string
}

/** What the host and this process can do for one release. */
export interface ReleaseIO {
  /**
   * Lift one operation's own restriction row. `kept` is another operation's or
   * another family's row; `failed` leaves the session blocked.
   */
  unban(sessionID: string, operation: string): "cleared" | "kept" | "absent" | "failed"
  /** Clear the in-process abort marks and the review chain's cancelled marks. */
  unmark(sessionIDs: string[]): void
  /** Start one new turn on the selected session. `refused` is a host throw or decline. */
  continue(sessionID: string, text: string): Promise<"sent" | "refused" | "unsupported">
  store: AbortIO["store"]
  now(): number
  audit(row: Record<string, unknown>): void
}

/** The one continuation text a release can send. Fixed wording, no arguments. */
export const RELEASE_CONTINUE_TEXT =
  "The operator released the abort that stopped this session. No approval or past work was restored. Continue the task if it is still current."

/**
 * Release one operation, and nothing else. Coverage is re-derived from the
 * records at every step: a session another active operation covers keeps its
 * restriction, its marks and its row, so a child's release never overrides an
 * ancestor's coverage and an ancestor's release never clears a child's own
 * operation. The row clear is idempotent, so a retried release finishes what a
 * crashed one left; the continuation is not: it fires once per operation, and a
 * retry answers `already` instead of a second prompt. Release alone resumes
 * nothing: no approval, no job, no descendant. Only the selected session can
 * get the one prompt, and only while it is effectively unblocked at the send
 * boundary.
 */
export async function releaseOperation(io: ReleaseIO, request: ReleaseRequest): Promise<ReleaseOutcome> {
  const operationID = String(request?.operationID ?? "")
  const refuse = (reason: string): ReleaseOutcome => ({
    ok: false,
    durable: false,
    receipt: false,
    already: false,
    operation: null,
    ban: { cleared: 0, kept: 0, failed: 0 },
    covered: [],
    continued: request?.continue ? "prevented" : "not-requested",
    incomplete: [],
    reason,
  })
  const read = readAbortRecords()
  if (!read.ok) return refuse("the abort operation record cannot be read, so nothing was released")
  const index = read.records.findIndex((record) => record.operation.id === operationID)
  if (index < 0) return refuse("no abort operation has this id")
  const record = read.records[index]
  const operation = record.operation
  const already = typeof operation.released === "number"
  // One timestamp for every place the release names itself: the record write,
  // the continuation write, and the returned receipt, so a retry or a reader
  // never sees the same release at two different times.
  const releasedAt = already ? operation.released : io.now()
  const remaining = read.records.filter((entry) => entry !== record && !entry.operation.released)
  const covered = operation.scope.filter((sessionID) => remaining.some((entry) => entry.operation.scope.includes(sessionID)))
  const uncovered = operation.scope.filter((sessionID) => !covered.includes(sessionID))

  // Identity first, as the abort does: a released record with rows still in
  // place leaves those sessions blocked, the safe direction, and a retry
  // finishes the clear. An already-released operation skips the rewrite.
  let durable = already
  if (!already) {
    durable = io.store.replace({ operation: { ...operation, released: releasedAt }, containment: record.containment })
  }

  const ban = { cleared: 0, kept: 0, failed: 0 }
  const incomplete: ContainmentRow[] = []
  // The selected session's own row state decides continuation eligibility: a
  // row that failed to clear, or one another family still owns, keeps it
  // effectively blocked whatever this operation did.
  let targetRow: "cleared" | "kept" | "absent" | "failed" | "uncovered-unknown" = "uncovered-unknown"
  for (const sessionID of uncovered) {
    const status = io.unban(sessionID, operation.id)
    if (sessionID === operation.sessionID) targetRow = status
    if (status === "failed") {
      ban.failed++
      continue
    }
    if (status === "kept") ban.kept++
    else ban.cleared++
  }
  if (ban.failed) {
    incomplete.push({
      step: "ban",
      status: "failed",
      detail: `${ban.failed} restriction row(s) could not be cleared; those sessions stay blocked`,
    })
  }
  // Marks follow the rows, not the coverage: a session the records still cover
  // keeps every in-process signal, and an uncovered one keeps none.
  io.unmark(uncovered)

  let continued: ReleaseOutcome["continued"] = request?.continue ? "prevented" : "not-requested"
  let receipt = durable
  let continuedAt: number | undefined
  let reason: string | undefined
  if (request?.continue) {
    if (already && typeof operation.continuedAt === "number") {
      continued = "already"
    } else {
      // The send boundary re-derives coverage from a fresh read: another
      // operation can have landed since the rows were cleared, and an abort
      // marks its selected session before any await, so the live mark is asked
      // too. Either fact prevents the prompt.
      const fresh = readAbortRecords()
      const target = operation.sessionID
      if (!fresh.ok) {
        reason = "the abort operation record cannot be read, so nothing was continued"
      } else if (
        coveringOperations(fresh.records, target).some((entry) => entry.id !== operation.id) ||
        abortStarted(target) ||
        targetRow === "failed" ||
        targetRow === "kept"
      ) {
        reason = "the selected session is still effectively blocked; no continuation was sent"
      } else {
        const sent = await io.continue(target, RELEASE_CONTINUE_TEXT)
        if (sent === "unsupported") {
          continued = "unsupported"
          reason = "the host exposes no primitive to start a turn, so no continuation was sent"
        } else if (sent === "refused") {
          continued = "prevented"
          reason = "the host refused the continuation prompt"
        } else {
          continued = "sent"
          // The send happened; the marker makes a retry answer `already`
          // instead of a second prompt. A crash between the two leaves the
          // one-window race the receipt cannot close: the retry may send once
          // more.
          continuedAt = io.now()
          receipt = io.store.replace({
            operation: { ...operation, released: releasedAt, continuedAt },
            containment: record.containment,
          })
        }
      }
    }
  }

  io.audit({
    event: "abort_release",
    operationID: operation.id,
    sessionID: operation.sessionID,
    scope: operation.scope.length,
    cleared: ban.cleared,
    kept: ban.kept,
    failed: ban.failed,
    continued,
    durable,
    already,
  })
  return {
    ok: durable,
    durable,
    receipt,
    already,
    operation: durable ? { ...operation, released: releasedAt, ...(continuedAt ? { continuedAt } : {}) } : operation,
    ban,
    covered,
    continued,
    incomplete,
    ...(reason ? { reason } : {}),
  }
}

/**
 * One factual operator notice, built from the operation's own receipt. Fixed
 * vocabulary and counts only: no ids, no prompts, no call text. It states what
 * the record shows — what the scope covers, whether the ban landed, what the
 * interrupt proved and every step that stopped short — so it can never read as
 * a blanket claim that the whole subtree stopped.
 *
 * Durability is three facts, not one: whether the operation record reached disk,
 * whether the durable ban landed over the whole scope, and whether anything
 * enforces either. `durabilitySentence` owns that vocabulary so no route can call
 * an unrecorded stop "recorded", hide a written ban behind a failed record, or
 * call a record nothing enforces "durable".
 */
export function abortNotice(outcome: AbortOutcome, cause: string, enforced: boolean): string {
  const scopeRow = outcome.containment.find((row) => row.step === "scope")
  const interruptRow = outcome.containment.find((row) => row.step === "interrupt")
  const covered = outcome.operation.scope.length
  const sessions = covered === 1 ? "session" : "sessions"
  const lines: string[] = [`jev: ${cause}.`]
  lines.push(
    scopeRow?.status === "done"
      ? `Covered ${covered} ${sessions}: the selected one and its owned descendants.`
      : `Discovery failed (${scopeRow?.detail ?? "the scope step did not run"}), so only the selected session is covered and its descendants are unknown.`,
  )
  if (interruptRow) lines.push(`Interrupt: ${interruptRow.detail}.`)
  const short = outcome.incomplete.map((row) => `${row.step} ${row.status}`)
  lines.push(short.length ? `Containment incomplete: ${short.join(", ")}.` : "No containment step stopped short.")
  lines.push(durabilitySentence(outcome, enforced))
  return lines.join(" ")
}

/**
 * The one durability sentence, composed from three facts that do not imply one
 * another. The operation record and the durable ban are separate writes: a
 * refused record write does not unwrite a ban that landed, and a written ban does
 * not make an unwritten record readable, so neither may speak for the other. The
 * posture is the third fact — a sealed record nothing enforces blocks nothing.
 */
export function durabilitySentence(outcome: AbortOutcome, enforced: boolean): string {
  const covered = outcome.operation.scope.length
  const sessions = covered === 1 ? "session" : "sessions"
  const unaccounted = covered - outcome.ban.written - outcome.ban.failed
  const fullBan = outcome.ban.failed === 0 && unaccounted === 0
  const settled = outcome.durable && outcome.sealed && fullBan && enforced
  // Track 1, the operation record: what a restart can read about this operation.
  const record = settled
    ? "The stop is durable: an ordinary user turn and a restart do not release it."
    : outcome.durable
      ? "The operation record was written."
      : "The session's abort record could not be written, so a restart cannot tell this operation ran."
  // Track 2, the durable ban, counted from its own rows. Stated unless the
  // settled sentence above already covers it: it is what still refuses the calls
  // when the record is missing, and the count is the fact when it fell short.
  const ban = settled
    ? ""
    : fullBan
      ? `The durable ban was written for all ${covered} ${sessions}.`
      : unaccounted > 0
        ? `The durable ban was written for ${outcome.ban.written} of ${covered} ${sessions}; its outcome for the other ${unaccounted} is unknown.`
        : `The durable ban was written for ${outcome.ban.written} of ${covered} ${sessions}; ${outcome.ban.failed} could not be written.`
  // Track 3, the posture: whether anything here reads either write.
  const posture = settled
    ? ""
    : enforced
      ? "The stop is not fully durable against a restart."
      : "No admission hook is active in this process, so calls are not refused here."
  return [record, ban, posture].filter(Boolean).join(" ")
}

/** A deny that arrives while its call is queued is not a containment event. */
export type DenyShape = "queued" | "started"
export interface DenyOutcome {
  aborted: boolean
  operation?: AbortOperation
}

/**
 * The chain's deny, recorded as the verdict it is and — only when the call had
 * already started — followed by the selected-session subtree abort. The two rows
 * are separate: the source deny never doubles as the containment report.
 */
export async function containDeny(
  io: AbortIO,
  request: { sessionID: string; itemID: string; shape: DenyShape },
): Promise<DenyOutcome> {
  const started = request.shape === "started"
  io.audit({
    event: "chain_deny",
    itemID: request.itemID,
    sessionID: request.sessionID,
    shape: request.shape,
    detail: started
      ? "the deny arrived after the call started; it aborts the selected session and its owned descendants"
      : "the deny arrived while the call was queued; only that call is cancelled",
  })
  if (!started) return { aborted: false }
  const outcome = await abortSubtree(io, {
    sessionID: request.sessionID,
    source: "chain",
    cause: "a deny arrived after the call started",
  })
  return { aborted: true, operation: outcome.operation }
}

function operationID(at: number): string {
  return `op_${at.toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

/** The selected session first, then its descendants, each id once. */
function scoped(ids: string[]): string[] {
  const out: string[] = []
  for (const id of ids) {
    const value = typeof id === "string" ? id.trim() : ""
    if (value && !out.includes(value)) out.push(value)
  }
  return out
}

/**
 * A cause reaches the record, the audit and the RPC allowlist, so only printable
 * ASCII survives and the text is clipped: no control byte, no escape, no length
 * a consumer has to defend against.
 */
function clip(text: string, max: number): string {
  const one = String(text ?? "")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  return one.length > max ? `${one.slice(0, Math.max(0, max - 3))}...` : one
}

const STEPS: AbortStep[] = ["scope", "receipt", "ban", "interrupt", "cards", "approvals", "reviews", "tools", "jobs"]
const STATUSES: StepStatus[] = ["done", "failed", "unconfirmed", "unsupported"]
const SOURCES: AbortSource[] = ["chain", "human"]

function asRecord(value: unknown): AbortRecord | null {
  if (!value || typeof value !== "object") return null
  const operation = (value as { operation?: unknown }).operation
  if (!operation || typeof operation !== "object") return null
  const raw = operation as Record<string, unknown>
  const id = typeof raw.id === "string" ? raw.id : ""
  const sessionID = typeof raw.sessionID === "string" ? raw.sessionID : ""
  const scope = Array.isArray(raw.scope) ? raw.scope.filter((entry): entry is string => typeof entry === "string") : []
  const source = SOURCES.includes(raw.source as AbortSource) ? (raw.source as AbortSource) : null
  const at = typeof raw.at === "number" && Number.isFinite(raw.at) ? raw.at : null
  if (!id || !sessionID || !scope.length || !source || at === null) return null
  const rows = (value as { containment?: unknown }).containment
  if (!Array.isArray(rows)) return null
  const containment: ContainmentRow[] = []
  for (const row of rows) {
    if (!row || typeof row !== "object") return null
    const entry = row as Record<string, unknown>
    if (!STEPS.includes(entry.step as AbortStep)) return null
    if (!STATUSES.includes(entry.status as StepStatus)) return null
    if (typeof entry.detail !== "string") return null
    containment.push({ step: entry.step as AbortStep, status: entry.status as StepStatus, detail: entry.detail })
  }
  // `released` and `continuedAt` ride along when present: a read that dropped
  // them would resurrect a released operation's restrictions at the next start.
  const released = typeof raw.released === "number" && Number.isFinite(raw.released) ? raw.released : undefined
  const continuedAt = typeof raw.continuedAt === "number" && Number.isFinite(raw.continuedAt) ? raw.continuedAt : undefined
  return {
    operation: {
      id,
      sessionID,
      scope,
      source,
      cause: typeof raw.cause === "string" ? raw.cause : "",
      at,
      ...(released !== undefined ? { released } : {}),
      ...(continuedAt !== undefined ? { continuedAt } : {}),
    },
    containment,
  }
}

function writeAll(records: AbortRecord[]): boolean {
  const path = abortFile()
  const temp = `${path}.${process.pid}.tmp`
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(temp, `${JSON.stringify({ v: 1, operations: records }, null, 2)}\n`, { mode: 0o600 })
    renameSync(temp, path)
    chmodSync(path, 0o600)
    return true
  } catch {
    return false
  }
}
