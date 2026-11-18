/**
 * The turn frontier: which user turn a session is on, and whether the evidence
 * for it can be read at all.
 *
 * A pure reducer over durable session events plus the repair schedule. The host
 * feeds it a subscription callback and a log catch-up read; this module decides
 * only what an event means for the counter.
 *
 * Only `session.inbox.enqueued` with `item.type === "user"` advances `seq`. A
 * synthetic item is a child report and compaction is context plumbing; neither
 * is a user decision, so neither retires a tombstone.
 */

import { DEGRADED_RETRY_MS } from "./nospawn.ts"

export const INBOX_ENQUEUED = "session.inbox.enqueued"
export const USER_ITEM = "user"

/** Last applied durable sequence, and the last user-turn sequence. */
export interface Frontier {
  seq: number
  cursor: number
}

export interface SessionEvent {
  type?: string
  durable?: { aggregateID?: string; seq?: number }
  data?: { item?: { type?: string } }
}

/** `ok` when the source answered, `failed` when it could not be read. */
export type FeedState = "ok" | "failed"

/**
 * Advance one parent's frontier. An event that belongs to another session is
 * rejected: its sequence comes from a different aggregate, so letting it through
 * would move this parent's counter and retire a tombstone nobody retried.
 */
export function applyEvent(frontier: Frontier, event: SessionEvent, parentID: string): Frontier {
  const aggregate = event?.durable?.aggregateID
  if (aggregate !== parentID) return frontier
  const seq = event?.durable?.seq
  // A durable event always carries its own sequence. Without one the event
  // cannot be ordered, and guessing zero would rewind the frontier.
  if (typeof seq !== "number" || !Number.isFinite(seq) || seq <= 0) return frontier
  const cursor = seq > frontier.cursor ? seq : frontier.cursor
  const isUser = event.type === INBOX_ENQUEUED && event.data?.item?.type === USER_ITEM
  const next = isUser && seq > frontier.seq ? seq : frontier.seq
  return { seq: next, cursor }
}

/** True when either evidence source failed, so no admission can be judged. */
export function degraded(subscription: FeedState, log: FeedState): boolean {
  return subscription !== "ok" || log !== "ok"
}

/** Backoff before attempt `attempt` (1-based), or null when the budget is spent. */
export function retrySchedule(attempt: number): number | null {
  if (!Number.isInteger(attempt) || attempt < 1 || attempt > DEGRADED_RETRY_MS.length) return null
  return DEGRADED_RETRY_MS[attempt - 1]
}

/** The frontier once both sources answer, or null while either still fails. */
export function repair(frontier: Frontier, subscription: FeedState, log: FeedState): Frontier | null {
  return degraded(subscription, log) ? null : frontier
}
