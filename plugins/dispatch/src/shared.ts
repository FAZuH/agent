/**
 * Shared rules for the dispatch plugin.
 *
 * The server half marks the background subagent with a metadata marker so
 * the desktop GUI can find it: a dispatch stays bound to the session that
 * asked (parentID), and the GUI lists the dispatches of whichever session
 * is on screen and switches the view to them. The marker is the only link
 * between a parent and its dispatches, same as branch's markers are the only
 * link between a parent and its forks.
 */

export const DISPATCH_KEY = "dispatch"

export interface DispatchedMarker {
  /** The session the command ran in. */
  parentID: string
  /** The dispatched subagent. */
  sessionID: string
  /** The task text, for lists and pills. */
  task: string
  /** When it was created. */
  at: number
}

/** Read the marker out of session metadata. Anything else is not ours. */
export function readDispatched(metadata: unknown): DispatchedMarker | undefined {
  if (!metadata || typeof metadata !== "object") return undefined
  const raw = (metadata as Record<string, unknown>)[DISPATCH_KEY]
  if (!raw || typeof raw !== "object") return undefined
  const value = raw as Record<string, unknown>
  if (typeof value.parentID !== "string" || typeof value.sessionID !== "string") return undefined
  return {
    parentID: value.parentID,
    sessionID: value.sessionID,
    task: typeof value.task === "string" ? value.task : "",
    at: typeof value.at === "number" ? value.at : 0,
  }
}
