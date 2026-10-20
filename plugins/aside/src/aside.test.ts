/**
 * Self-check for the aside rules. No host and no network: the point is that
 * the marker and the finish decision hold up on their own, because those two
 * decide whether the original session hears about the fork, and when.
 *
 *   bun test src/aside.test.ts
 */

import { describe, expect, test } from "bun:test"

import { applyEvent, finished, newState, readMarker, type AsideState } from "./aside.ts"

const state = (over: Partial<AsideState> = {}): AsideState => ({ ...newState("ses_parent", "ses_fork"), ...over })

const event = (type: string, data: Record<string, unknown> = {}) => ({ type, data })

describe("readMarker", () => {
  test("reads a forked marker", () => {
    const marker = readMarker({ aside: { status: "forked", parentID: "ses_parent", sessionID: "ses_fork" } })
    expect(marker?.status).toBe("forked")
    expect(marker?.sessionID).toBe("ses_fork")
  })

  test("rejects foreign metadata", () => {
    expect(readMarker(undefined)).toBeUndefined()
    expect(readMarker({ other: 1 })).toBeUndefined()
    expect(readMarker({ aside: { status: "unknown", parentID: "ses_parent" } })).toBeUndefined()
    expect(readMarker({ aside: { status: "forked" } })).toBeUndefined()
  })
})

describe("finished", () => {
  test("a fork that never ran is not finished", () => {
    expect(finished(state())).toBe(false)
  })

  test("the fork's own turn ending finishes it", () => {
    const s = state()
    applyEvent(s, event("session.execution.started", { sessionID: "ses_fork" }))
    expect(finished(s)).toBe(false)
    applyEvent(s, event("session.execution.succeeded", { sessionID: "ses_fork" }))
    expect(finished(s)).toBe(true)
  })

  test("a running subagent keeps the fork open", () => {
    const s = state()
    applyEvent(s, event("session.execution.started", { sessionID: "ses_fork" }))
    applyEvent(s, event("session.created", { sessionID: "ses_child", parentID: "ses_fork" }))
    applyEvent(s, event("session.execution.started", { sessionID: "ses_child" }))
    applyEvent(s, event("session.execution.succeeded", { sessionID: "ses_fork" }))
    expect(finished(s)).toBe(false)
    applyEvent(s, event("session.execution.succeeded", { sessionID: "ses_child" }))
    expect(finished(s)).toBe(true)
  })

  test("a session outside the fork never blocks it", () => {
    const s = state()
    applyEvent(s, event("session.execution.started", { sessionID: "ses_parent" }))
    applyEvent(s, event("session.execution.succeeded", { sessionID: "ses_fork" }))
    expect(finished(s)).toBe(true)
  })

  test("an open shell keeps the fork open", () => {
    const s = state()
    applyEvent(s, event("session.execution.succeeded", { sessionID: "ses_fork" }))
    applyEvent(s, event("session.shell.started", { sessionID: "ses_fork" }))
    expect(finished(s)).toBe(false)
    applyEvent(s, event("session.shell.ended", { sessionID: "ses_fork" }))
    expect(finished(s)).toBe(true)
  })

  test("a queued prompt keeps the fork open", () => {
    const s = state()
    applyEvent(s, event("session.execution.succeeded", { sessionID: "ses_fork" }))
    applyEvent(s, event("session.inbox.enqueued", { sessionID: "ses_fork", inboxID: "msg_1" }))
    expect(finished(s)).toBe(false)
    applyEvent(s, event("session.inbox.delivered", { sessionID: "ses_fork", inboxID: "msg_1" }))
    expect(finished(s)).toBe(true)
  })

  test("a turn clears the input it consumed", () => {
    const s = state()
    applyEvent(s, event("session.inbox.enqueued", { sessionID: "ses_fork", inboxID: "msg_1" }))
    applyEvent(s, event("session.execution.started", { sessionID: "ses_fork" }))
    applyEvent(s, event("session.execution.succeeded", { sessionID: "ses_fork" }))
    expect(finished(s)).toBe(true)
  })
})

describe("answer text", () => {
  test("keeps the last assistant message, block by block", () => {
    const s = state()
    applyEvent(s, event("session.text.ended", { sessionID: "ses_fork", assistantMessageID: "msg_1", text: "first" }))
    applyEvent(s, event("session.text.ended", { sessionID: "ses_fork", assistantMessageID: "msg_1", text: "second" }))
    expect(s.lastText).toBe("first\nsecond")
    applyEvent(s, event("session.text.ended", { sessionID: "ses_fork", assistantMessageID: "msg_2", text: "answer" }))
    expect(s.lastText).toBe("answer")
  })

  test("ignores text from other sessions", () => {
    const s = state()
    applyEvent(s, event("session.text.ended", { sessionID: "ses_parent", assistantMessageID: "msg_1", text: "noise" }))
    expect(s.lastText).toBe("")
  })
})
