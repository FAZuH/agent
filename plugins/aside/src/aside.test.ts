/**
 * Self-check for the aside rules. No host and no network: the point is that
 * the marker and the texts hold up on their own, because those decide what
 * the asking session hears, and who sends it.
 *
 *   bun test src/aside.test.ts
 */

import { describe, expect, test } from "bun:test"

import { askText, forkedNotice, questionBlock, readMarker, reportTags } from "./aside.ts"

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

describe("question block", () => {
  test("fences the user's words in a tag", () => {
    expect(questionBlock("what is up")).toBe("<question>\nwhat is up\n</question>")
  })
})

describe("report tags", () => {
  test("name the fork, the state, and the asking session", () => {
    expect(reportTags("ses_fork", "ses_parent").open).toBe(
      '<aside sessionID="ses_fork" state="completed" parent="ses_parent">',
    )
  })
})

describe("notices", () => {
  test("the fork notice hands the question over as the fork's task", () => {
    const notice = forkedNotice("ses_fork", "ses_parent", "1. do this\n2. do that")
    expect(notice).toContain("not an instruction for this session")
    expect(notice).toContain("<question>\n1. do this\n2. do that\n</question>")
  })
})

describe("ask text", () => {
  test("report mode points the fork at the aside_report tool, not the api", () => {
    const text = askText("what is up", "ses_parent", "ses_fork")
    expect(text).toContain("aside_report")
    expect(text).not.toContain("opencode2 api")
    expect(text).toContain('<aside sessionID="ses_fork" state="completed" parent="ses_parent">')
  })

  test("report mode wraps the question in a tag", () => {
    const text = askText("what is up", "ses_parent", "ses_fork")
    expect(text).toContain("<question>\nwhat is up\n</question>")
  })

  test("silent mode asks for no report", () => {
    const text = askText("what is up", "ses_parent", "ses_fork", false)
    expect(text).toContain("/aside-silent")
    expect(text).toContain("do not call aside_report")
    expect(text).not.toContain("opencode2 api")
    expect(text).not.toContain("state=\"completed\"")
  })

  test("keeps the question as the fork's only task", () => {
    const text = askText("what is up", "ses_parent", "ses_fork")
    expect(text).toContain("The user only wants you to answer this question")
    expect(text).toContain("<question>\nwhat is up\n</question>")
  })
})
