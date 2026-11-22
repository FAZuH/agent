/**
 * Operator receipts and parent notices for one abort operation.
 *
 * One logical receipt per operation, keyed on the operation's own identity:
 * a re-queue answers "deduplicated", a retry re-POSTs the same body with the
 * same operationID, and a receiver that dedups on it sees one receipt. The
 * sender never promises transport-level exactly-once: a lost ack can re-POST.
 *
 * Delivery is strictly post-containment and best-effort. The queue write
 * happens after the abort's own steps, the pump is fired and never awaited by
 * the abort, and every failure is a status on the row, never a delay, a
 * block or a reversal of what the containment already did.
 *
 * The receipt summarizes the operation's own containment rows — successes,
 * unsupported cancellation, exact failures — and never replaces them with an
 * all-stopped claim. The row reports the scope as a count, not a session id
 * list, and the notice text is fixed vocabulary over the same row: no
 * credential, no raw judge transcript, no fork history, no unexamined
 * payload reaches either.
 */

import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { abortStarted, coveringOperations, readAbortRecords, type AbortOutcome, type ContainmentRow } from "./abort.ts"
import { chainStateHome } from "./chain.ts"

export const DELIVERY_FILE = "abort-delivery.json"

export type ReceiptStatus = "queued" | "delivered" | "failed" | "no-endpoint"

/**
 * `absent` is no host-recorded parent. `suppressed` is a parent that was
 * itself being aborted when delivery looked: an aborted parent must never be
 * resumed by a notice about its child. `failed` is a host that refused the
 * queue write.
 */
export type NoticeStatus = "queued" | "absent" | "suppressed" | "delivered" | "failed"

export interface DeliveryRow {
  operationID: string
  /** The selected session. The scope is a count on the row, never an id list. */
  sessionID: string
  scope: number
  source: string
  cause: string
  at: number
  containment: ContainmentRow[]
  receipt: { status: ReceiptStatus; attempts: number; lastAt?: number }
  notice: NoticeStatus
}

/** What the host and this process can do for one delivery pass. */
export interface DeliveryIO {
  /** The host-recorded direct parent of the selected session, or null. */
  parentOf(sessionID: string): Promise<string | null>
  /**
   * Queue one informational write on the parent. True only when the host took
   * it. This is the no-wake write: the caller never uses a turn-starting
   * primitive for it.
   */
  notice(parentID: string, text: string): Promise<boolean>
  /** One webhook POST. True only on a 2xx; a throw is a failed attempt. */
  post(url: string, body: string): Promise<boolean>
  /** The configured receipt webhook; empty means nothing to deliver to. */
  endpoint(): string
  /** Bounded retries; the pump clamps this to at least one attempt. */
  maxAttempts(): number
  retryDelayMs(): number
  schedule(run: () => Promise<void>, ms: number): void
  now(): number
  audit(row: Record<string, unknown>): void
}

/** The receipt body: the operation's own rows, and nothing else. */
export function receiptBody(row: DeliveryRow): string {
  return JSON.stringify({
    event: "abort_receipt",
    operationID: row.operationID,
    sessionID: row.sessionID,
    source: row.source,
    cause: row.cause,
    scope: row.scope,
    incomplete: incompleteOf(row),
    containment: row.containment.map((entry) => ({ step: entry.step, status: entry.status, detail: entry.detail })),
    at: row.at,
  })
}

/** The notice text: fixed vocabulary over the row, and the no-action sentence. */
export function noticeText(row: DeliveryRow): string {
  const stoppedShort = incompleteOf(row)
  return [
    `jev notice: a child session (${row.sessionID}) was stopped by a ${row.source} abort.`,
    `Operation ${row.operationID} covered ${row.scope} session${row.scope === 1 ? "" : "s"}.`,
    stoppedShort.length ? `Containment stopped short of: ${stoppedShort.join(", ")}.` : "Every containment step reported done.",
    "This notice is informational: no turn was started and nothing was resumed.",
  ].join(" ")
}

/**
 * Queue one operation's delivery. Sync and post-containment by contract: the
 * caller runs it after the abort's own steps and never awaits the pump.
 */
export function queueAbortDelivery(io: DeliveryIO, outcome: AbortOutcome): "queued" | "deduplicated" | "unavailable" {
  const read = readDeliveryRows()
  if (!read.ok) {
    io.audit({ event: "abort_delivery_queue", operationID: outcome.operation.id, result: "unavailable" })
    return "unavailable"
  }
  if (read.rows.some((row) => row.operationID === outcome.operation.id)) return "deduplicated"
  const row: DeliveryRow = {
    operationID: outcome.operation.id,
    sessionID: outcome.operation.sessionID,
    scope: outcome.operation.scope.length,
    source: outcome.operation.source,
    cause: outcome.operation.cause,
    at: outcome.operation.at,
    containment: outcome.containment,
    receipt: { status: io.endpoint() ? "queued" : "no-endpoint", attempts: 0 },
    notice: "queued",
  }
  if (!writeDeliveryRows([...read.rows, row])) {
    io.audit({ event: "abort_delivery_queue", operationID: outcome.operation.id, result: "unavailable" })
    return "unavailable"
  }
  io.audit({ event: "abort_delivery_queue", operationID: row.operationID, result: "queued", receipt: row.receipt.status, scope: row.scope })
  return "queued"
}

/**
 * One delivery pass. Receipts with an endpoint and attempts left POST once;
 * a failure stays queued until the cap, then reads `failed`. Notices resolve
 * the parent, suppress on a parent that is itself being aborted, and write
 * the queue notice only past that check. A pass that owes another attempt
 * schedules its own successor; the cap is the bound.
 */
export async function pumpAbortDelivery(io: DeliveryIO): Promise<void> {
  const read = readDeliveryRows()
  if (!read.ok) return
  const rows = read.rows
  if (rows.length === 0) return
  const endpoint = io.endpoint()
  const max = Math.max(1, Math.round(io.maxAttempts()))
  const now = io.now()
  let owed = 0
  let wrote = false
  for (const row of rows) {
    if (row.receipt.status === "queued" && endpoint && row.receipt.attempts < max) {
      row.receipt = { ...row.receipt, attempts: row.receipt.attempts + 1, lastAt: now }
      // A transport that throws is one failed attempt, never an escaped pass:
      // the row must still record its attempt, settle, and schedule its bound.
      let ok = false
      try {
        ok = await io.post(endpoint, receiptBody(row))
      } catch {
        ok = false
      }
      row.receipt.status = ok ? "delivered" : row.receipt.attempts >= max ? "failed" : "queued"
      wrote = true
      io.audit({ event: "abort_receipt_delivery", operationID: row.operationID, status: row.receipt.status, attempts: row.receipt.attempts })
      if (row.receipt.status === "queued") owed++
    }
    if (row.notice === "queued") {
      // A lookup that throws is a failed notice, never an absent parent and
      // never an escaped pass; the receipt side settles either way.
      let parent: string | null = null
      let failed = false
      try {
        parent = await io.parentOf(row.sessionID)
      } catch {
        failed = true
      }
      if (failed) {
        row.notice = "failed"
        wrote = true
        io.audit({ event: "abort_notice", operationID: row.operationID, status: "failed" })
      } else if (!parent) {
        row.notice = "absent"
        wrote = true
        io.audit({ event: "abort_notice", operationID: row.operationID, status: "absent" })
      } else if (parentAborted(parent)) {
        // The boundary check: a parent that is itself being aborted is never
        // resumed by a notice about its child, whatever landed in the queue.
        row.notice = "suppressed"
        wrote = true
        io.audit({ event: "abort_notice", operationID: row.operationID, status: "suppressed" })
      } else {
        let sent = false
        try {
          sent = await io.notice(parent, noticeText(row))
        } catch {
          sent = false
        }
        row.notice = sent ? "delivered" : "failed"
        wrote = true
        io.audit({ event: "abort_notice", operationID: row.operationID, status: row.notice })
      }
    }
  }
  if (wrote && !mergeDeliveryRows(rows)) {
    // The statuses this pass produced live in memory only; the next pass
    // re-reads the file and re-derives them. A lost write is a repeated
    // attempt, never a lost containment fact.
    io.audit({ event: "abort_delivery_write_failed", rows: rows.length })
  }
  if (owed > 0) io.schedule(() => enqueueAbortDelivery(io), Math.max(0, Math.round(io.retryDelayMs())))
}

/**
 * Overlay this pass's rows onto a fresh read. A row queued while the pass was
 * in flight is not in the pass's own list, and a blind write-back would drop
 * it; the merge keeps every row the file gained and replaces only the ones
 * this pass touched. The read and the write are one sync section, so a queue
 * cannot land between them.
 */
function mergeDeliveryRows(touched: DeliveryRow[]): boolean {
  const read = readDeliveryRows()
  if (!read.ok) return false
  const byID = new Map<string, DeliveryRow>()
  for (const row of read.rows) byID.set(row.operationID, row)
  for (const row of touched) byID.set(row.operationID, row)
  return writeDeliveryRows([...byID.values()])
}

/**
 * Pump passes serialize on one chain. Two aborts can queue rows while another
 * pass is mid-flight, and a pass writes back the row list it read, so
 * overlapping passes would drop or revert each other's rows. A queued pass
 * re-reads at its own start, so it always sees the previous pass's statuses.
 */
let pumpChain: Promise<void> = Promise.resolve()

export function enqueueAbortDelivery(io: DeliveryIO): Promise<void> {
  const run = pumpChain.then(() => pumpAbortDelivery(io))
  pumpChain = run.catch(() => {})
  return run
}

/** True when a live mark or an active durable operation covers the parent. */
function parentAborted(parentID: string): boolean {
  if (abortStarted(parentID)) return true
  const read = readAbortRecords()
  return read.ok && coveringOperations(read.records, parentID).length > 0
}

function incompleteOf(row: DeliveryRow): string[] {
  return row.containment.filter((entry) => entry.status !== "done").map((entry) => `${entry.step}:${entry.status}`)
}

function deliveryFile(): string {
  return join(chainStateHome(), DELIVERY_FILE)
}

type DeliveryRead = { ok: true; rows: DeliveryRow[] } | { ok: false }

/**
 * The queue is its own file, beside the operation records. A missing file is
 * the only empty queue; a file that cannot be read is unavailable, never
 * "nothing owed", and a file that cannot be parsed is unavailable too.
 */
export function readDeliveryRows(): DeliveryRead {
  let raw: string
  try {
    raw = readFileSync(deliveryFile(), "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return { ok: true, rows: [] }
    return { ok: false }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false }
  }
  const rows = (parsed as { rows?: unknown })?.rows
  if (!Array.isArray(rows)) return { ok: false }
  const out: DeliveryRow[] = []
  for (const row of rows) {
    const entry = asRow(row)
    if (!entry) return { ok: false }
    out.push(entry)
  }
  return { ok: true, rows: out }
}

function asRow(value: unknown): DeliveryRow | null {
  if (!value || typeof value !== "object") return null
  const row = value as Record<string, unknown>
  const operationID = typeof row.operationID === "string" ? row.operationID : ""
  const sessionID = typeof row.sessionID === "string" ? row.sessionID : ""
  const scope = typeof row.scope === "number" && Number.isFinite(row.scope) ? row.scope : -1
  const source = typeof row.source === "string" ? row.source : ""
  const cause = typeof row.cause === "string" ? row.cause : ""
  const at = typeof row.at === "number" && Number.isFinite(row.at) ? row.at : -1
  if (!operationID || !sessionID || scope < 0 || at < 0) return null
  if (!Array.isArray(row.containment)) return null
  const containment: ContainmentRow[] = []
  for (const entry of row.containment) {
    if (!entry || typeof entry !== "object") return null
    const step = (entry as Record<string, unknown>).step
    const status = (entry as Record<string, unknown>).status
    const detail = (entry as Record<string, unknown>).detail
    if (typeof step !== "string" || typeof status !== "string" || typeof detail !== "string") return null
    containment.push({ step: step as ContainmentRow["step"], status: status as ContainmentRow["status"], detail })
  }
  const receipt = row.receipt as Record<string, unknown> | undefined
  const receiptStatus = receipt?.status
  const attempts = receipt?.attempts
  if (
    (receiptStatus !== "queued" && receiptStatus !== "delivered" && receiptStatus !== "failed" && receiptStatus !== "no-endpoint") ||
    typeof attempts !== "number"
  ) {
    return null
  }
  const notice = row.notice
  if (notice !== "queued" && notice !== "absent" && notice !== "suppressed" && notice !== "delivered" && notice !== "failed") return null
  return {
    operationID,
    sessionID,
    scope,
    source,
    cause,
    at,
    containment,
    receipt: { status: receiptStatus, attempts, ...(typeof receipt?.lastAt === "number" ? { lastAt: receipt.lastAt as number } : {}) },
    notice,
  }
}

function writeDeliveryRows(rows: DeliveryRow[]): boolean {
  const path = deliveryFile()
  const temp = `${path}.${process.pid}.tmp`
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(temp, `${JSON.stringify({ v: 1, rows }, null, 2)}\n`, { mode: 0o600 })
    renameSync(temp, path)
    chmodSync(path, 0o600)
    return true
  } catch {
    return false
  }
}

/**
 * The webhook transport. Tests replace it through `setReceiptTransport`; the
 * default keeps the alert-webhook discipline: one bounded POST, status only,
 * and the URL or a response body never travels anywhere but the call itself.
 */
export type ReceiptTransport = (url: string, body: string) => Promise<boolean>

export async function defaultReceiptTransport(url: string, body: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(5000),
    })
    return response.ok
  } catch {
    return false
  }
}

let activeReceiptTransport: ReceiptTransport = defaultReceiptTransport

/** The transport seam tests drive; `null` restores the default. */
export function setReceiptTransport(next: ReceiptTransport | null): void {
  activeReceiptTransport = next ?? defaultReceiptTransport
}

export function receiptTransport(): ReceiptTransport {
  return activeReceiptTransport
}
