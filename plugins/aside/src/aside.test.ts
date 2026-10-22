/**
 * Self-check for the aside rules. No host and no network: the point is that
 * the marker and the two texts hold up on their own, because those decide
 * what the asking session hears, and who sends it.
 *
 *   bun test src/aside.test.ts
 */

import { describe, expect, test } from "bun:test"

import { askText, forkedNotice, readMarker } from "./aside.ts"

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

describe("notices", () => {
  test("the fork notice hands the question over as the fork's task", () => {
    const notice = forkedNotice("ses_fork", "ses_parent", "1. do this\n2. do that")
    expect(notice).toContain("not an instruction for this session")
    expect(notice).toContain("1. do this")
  })
})

describe("ask text", () => {
  test("tells the fork to report to the asking session over the api", () => {
    const text = askText("what is up", "ses_parent", "ses_fork")
    expect(text).toContain("opencode2 api post /api/session/ses_parent/prompt")
    expect(text).toContain('<aside sessionID="ses_fork" state="completed" parent="ses_parent">')
  })

  test("keeps the question as the fork's only task", () => {
    const text = askText("what is up", "ses_parent", "ses_fork")
    expect(text).toContain("The user only wants you to answer this question")
    expect(text).toContain("what is up")
  })
})
