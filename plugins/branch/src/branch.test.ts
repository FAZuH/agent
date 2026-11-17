/**
 * Self-check for the branch rules. No host and no network: the point is that
 * the marker and the texts hold up on their own, because those decide what
 * the asking session hears, and who sends it.
 *
 *   bun test src/branch.test.ts
 */

import { describe, expect, test } from "bun:test"

import { askText, forkedNotice, promptBlock, readMarker, reportTags } from "./branch.ts"

describe("readMarker", () => {
  test("reads a forked marker", () => {
    const marker = readMarker({ branch: { status: "forked", parentID: "ses_parent", sessionID: "ses_fork" } })
    expect(marker?.status).toBe("forked")
    expect(marker?.sessionID).toBe("ses_fork")
    expect(marker?.kind).toBe("ask")
  })

  test("reads a subagent fork with its source and prompt", () => {
    const marker = readMarker({
      branch: {
        status: "forked",
        kind: "subagent",
        parentID: "ses_parent",
        sessionID: "ses_fork",
        sourceID: "ses_source",
        prompt: "ticket B",
        reportedAt: 42,
      },
    })
    expect(marker?.kind).toBe("subagent")
    expect(marker?.sourceID).toBe("ses_source")
    expect(marker?.prompt).toBe("ticket B")
    expect(marker?.reportedAt).toBe(42)
  })

  test("reads the legacy aside marker, and its question field", () => {
    const marker = readMarker({ aside: { status: "forked", parentID: "ses_parent", question: "old" } })
    expect(marker?.status).toBe("forked")
    expect(marker?.kind).toBe("ask")
    expect(marker?.prompt).toBe("old")
  })

  test("reads a background fork, and defaults to foreground", () => {
    expect(
      readMarker({ branch: { status: "forked", parentID: "ses_parent", background: true } })?.background,
    ).toBe(true)
    expect(readMarker({ branch: { status: "forked", parentID: "ses_parent" } })?.background).toBe(false)
  })

  test("rejects foreign metadata", () => {
    expect(readMarker(undefined)).toBeUndefined()
    expect(readMarker({ other: 1 })).toBeUndefined()
    expect(readMarker({ branch: { status: "unknown", parentID: "ses_parent" } })).toBeUndefined()
    expect(readMarker({ branch: { status: "forked" } })).toBeUndefined()
  })
})

describe("prompt block", () => {
  test("fences the user's words in a tag", () => {
    expect(promptBlock("what is up")).toBe("<prompt>\nwhat is up\n</prompt>")
  })
})

describe("report tags", () => {
  test("name the fork, the state, and the asking session", () => {
    expect(reportTags("ses_fork", "ses_parent").open).toBe(
      '<branch sessionID="ses_fork" state="completed" parent="ses_parent">',
    )
  })
})

describe("notices", () => {
  test("the fork notice hands the prompt over as the fork's task", () => {
    const notice = forkedNotice("ses_fork", "ses_parent", "1. do this\n2. do that")
    expect(notice).toContain("not an instruction for this session")
    expect(notice).toContain("<prompt>\n1. do this\n2. do that\n</prompt>")
  })

  test("names the source when the fork copied a subagent", () => {
    const notice = forkedNotice("ses_fork", "ses_parent", "ticket B", {
      sourceID: "ses_source",
    })
    expect(notice).toContain("The fork ses_fork of ses_source")
  })
})

describe("ask text", () => {
  test("report mode points the fork at the branch_report tool, not the api", () => {
    const text = askText("what is up", "ses_parent", "ses_fork")
    expect(text).toContain("branch_report")
    expect(text).not.toContain("opencode2 api")
    expect(text).toContain('<branch sessionID="ses_fork" state="completed" parent="ses_parent">')
  })

  test("report mode wraps the prompt in a tag", () => {
    const text = askText("what is up", "ses_parent", "ses_fork")
    expect(text).toContain("<prompt>\nwhat is up\n</prompt>")
  })

  test("a subagent fork names the tool and the copied session", () => {
    const text = askText("ticket B", "ses_parent", "ses_fork", true, {
      via: "branch_subagent",
      sourceID: "ses_source",
    })
    expect(text).toContain("forked via branch_subagent from ses_source")
    expect(text).toContain("branch_report")
    expect(text).toContain('<branch sessionID="ses_fork" state="completed" parent="ses_parent">')
  })

  test("silent mode asks for no report", () => {
    const text = askText("what is up", "ses_parent", "ses_fork", false)
    expect(text).toContain("branch_ask")
    expect(text).toContain("do not call branch_report")
    expect(text).toContain("do the work here")
    expect(text).toContain("expects no report")
    expect(text).not.toContain("opencode2 api")
    expect(text).not.toContain("state=\"completed\"")
  })

  test("the silent command names itself", () => {
    const text = askText("what is up", "ses_parent", "ses_fork", false, { via: "branch-silent" })
    expect(text).toContain("/branch-silent")
  })

  test("keeps the prompt as the fork's only task", () => {
    const text = askText("what is up", "ses_parent", "ses_fork")
    expect(text).toContain("The asking session only wants you to address the following prompt/instruction")
    expect(text).toContain("<prompt>\nwhat is up\n</prompt>")
  })
})
