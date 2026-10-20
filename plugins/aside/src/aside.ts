/**
 * Shared rules for the aside plugin.
 *
 * The server half (./index.ts) forks the session, marks the fork with a
 * metadata marker, prompts it, and watches the fork's subtree for the moment
 * it has no active work left. The TUI half (./tui.ts) reads the same marker
 * to move the view to the fork, or to toast a fork that never started.
 *
 * A fork inherits the parent's metadata, agent and model, and it stays out of
 * the session family (its parent id is null), so the marker is the only link
 * between a fork and the session that made it.
 */

export const ASIDE_KEY = "aside"

export type AsideStatus = "forked" | "failed"

export interface AsideMarker {
  status: AsideStatus
  /** The session the command ran in. */
  parentID: string
  /** The fork, when there is one. */
  sessionID?: string
  question?: string
  error?: string
}

/** Read the marker out of session metadata. Anything else is not ours. */
export function readMarker(metadata: unknown): AsideMarker | undefined {
  if (!metadata || typeof metadata !== "object") return undefined
  const raw = (metadata as Record<string, unknown>)[ASIDE_KEY]
  if (!raw || typeof raw !== "object") return undefined
  const value = raw as Record<string, unknown>
  if (value.status !== "forked" && value.status !== "failed") return undefined
  if (typeof value.parentID !== "string") return undefined
  return {
    status: value.status,
    parentID: value.parentID,
    sessionID: typeof value.sessionID === "string" ? value.sessionID : undefined,
    question: typeof value.question === "string" ? value.question : undefined,
    error: typeof value.error === "string" ? value.error : undefined,
  }
}

/** The question the fork answers. The fork's history is context, not a task. */
export function askText(question: string, parentID: string): string {
  return `This session was forked via /aside from ${parentID} by the user. Do not resume previous task. Prior history is context only. The user only wants you to answer this question, nothing else:\n\n${question}`
}

/** Notices mirror OpenCode's own subagent delivery: a tag, then the payload. */
export function forkedNotice(sessionID: string, parentID: string, question: string): string {
  return `<aside sessionID="${sessionID}" state="forked" parent="${parentID}">\n${question}\n</aside>`
}

export function finishedNotice(sessionID: string, parentID: string, answer: string): string {
  return `<aside sessionID="${sessionID}" state="completed" parent="${parentID}">\n${answer}\n</aside>`
}

export function failedNotice(parentID: string, error: string): string {
  return `<aside sessionID="${parentID}" state="failed" parent="${parentID}">\n${error}\n</aside>`
}

export interface AsideEvent {
  type: string
  data?: Record<string, unknown>
}

export interface AsideState {
  parentID: string
  forkID: string
  /** Sessions spawned under the fork: subagents and their own children. */
  children: Set<string>
  /** Sessions with a turn in flight. */
  busy: Set<string>
  /** Sessions with a running shell. */
  shells: Set<string>
  /** Pending inbox items per session. */
  inbox: Map<string, Set<string>>
  /** The fork has run a turn and it ended. */
  turnEnded: boolean
  /** The last assistant message of the fork, block by block. */
  lastMessageID: string
  lastText: string
}

export function newState(parentID: string, forkID: string): AsideState {
  return {
    parentID,
    forkID,
    children: new Set(),
    busy: new Set(),
    shells: new Set(),
    inbox: new Map(),
    turnEnded: false,
    lastMessageID: "",
    lastText: "",
  }
}

/** The fork and everything spawned under it. The parent is not in scope. */
export function inScope(state: AsideState, sessionID: string): boolean {
  return sessionID === state.forkID || state.children.has(sessionID)
}

/**
 * Fold one server event into the state. Returns true when the event touched
 * the fork's subtree, so the caller knows a finish check is worth running.
 */
export function applyEvent(state: AsideState, event: AsideEvent): boolean {
  const data = event.data ?? {}
  const sessionID = typeof data.sessionID === "string" ? data.sessionID : undefined
  if (!sessionID) return false
  switch (event.type) {
    case "session.execution.started": {
      if (!inScope(state, sessionID)) return false
      state.busy.add(sessionID)
      // A turn starting means the pending input was promoted into it.
      state.inbox.delete(sessionID)
      return true
    }
    case "session.execution.succeeded":
    case "session.execution.failed":
    case "session.execution.interrupted": {
      if (!inScope(state, sessionID)) return false
      state.busy.delete(sessionID)
      if (sessionID === state.forkID) state.turnEnded = true
      return true
    }
    case "session.shell.started": {
      if (!inScope(state, sessionID)) return false
      state.shells.add(sessionID)
      return true
    }
    case "session.shell.ended": {
      if (!inScope(state, sessionID)) return false
      state.shells.delete(sessionID)
      return true
    }
    case "session.created": {
      const parentID = typeof data.parentID === "string" ? data.parentID : undefined
      if (!parentID || !inScope(state, parentID)) return false
      state.children.add(sessionID)
      return true
    }
    case "session.inbox.enqueued": {
      if (!inScope(state, sessionID)) return false
      const inboxID = typeof data.inboxID === "string" ? data.inboxID : undefined
      if (!inboxID) return false
      const ids = state.inbox.get(sessionID) ?? new Set<string>()
      ids.add(inboxID)
      state.inbox.set(sessionID, ids)
      return true
    }
    case "session.inbox.delivered":
    case "session.inbox.cancelled": {
      if (!inScope(state, sessionID)) return false
      const inboxID = typeof data.inboxID === "string" ? data.inboxID : undefined
      if (inboxID) state.inbox.get(sessionID)?.delete(inboxID)
      return true
    }
    case "session.text.ended": {
      if (sessionID !== state.forkID) return false
      const text = typeof data.text === "string" ? data.text : ""
      const messageID = typeof data.assistantMessageID === "string" ? data.assistantMessageID : ""
      if (messageID && messageID !== state.lastMessageID) {
        state.lastMessageID = messageID
        state.lastText = text
      } else {
        state.lastText = state.lastText ? `${state.lastText}\n${text}` : text
      }
      return false
    }
    default:
      return false
  }
}

/**
 * A fork is done when it ran a turn, and nothing under it still works: no
 * chat in flight, no subagent running, no shell open, no queued prompt.
 */
export function finished(state: AsideState): boolean {
  if (!state.turnEnded) return false
  for (const id of state.busy) if (inScope(state, id)) return false
  for (const id of state.shells) if (inScope(state, id)) return false
  for (const [id, ids] of state.inbox) if (ids.size > 0 && inScope(state, id)) return false
  return true
}
