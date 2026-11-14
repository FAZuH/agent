/**
 * Self-check for the fork access rules: which session may use branch_ask, and
 * which subagent branch_subagent may target. No host and no network.
 *
 *   bun test src/access.test.ts
 */

import { describe, expect, test } from "bun:test"

import { isDescendant, isPrimarySession, subagentTargetError, type SessionFacts } from "./access.ts"

describe("isPrimarySession", () => {
  test("a root session with a primary agent", () => {
    expect(isPrimarySession({ parentID: null }, "primary")).toBe(true)
    expect(isPrimarySession({}, "all")).toBe(true)
  })

  test("a subagent session", () => {
    expect(isPrimarySession({ parentID: "ses_parent" }, "subagent")).toBe(false)
    expect(isPrimarySession({ parentID: "ses_parent" }, "primary")).toBe(false)
  })

  test("a root fork of a subagent is not primary", () => {
    expect(isPrimarySession({ parentID: null }, "subagent")).toBe(false)
  })

  test("an unknown agent mode falls back to the session tree", () => {
    expect(isPrimarySession({ parentID: null })).toBe(true)
    expect(isPrimarySession({ parentID: "ses_parent" })).toBe(false)
  })
})

describe("isDescendant", () => {
  const tree: Record<string, SessionFacts> = {
    ses_root: { parentID: null },
    ses_child: { parentID: "ses_root" },
    ses_grandchild: { parentID: "ses_child" },
    ses_other: { parentID: null },
    ses_orphan: {},
  }
  const lookup = async (id: string) => tree[id]

  test("a child and a grandchild are in the tree", async () => {
    expect(await isDescendant(lookup, "ses_root", "ses_child")).toBe(true)
    expect(await isDescendant(lookup, "ses_root", "ses_grandchild")).toBe(true)
    expect(await isDescendant(lookup, "ses_child", "ses_grandchild")).toBe(true)
  })

  test("a parent, a stranger, the caller, and a missing session are not", async () => {
    expect(await isDescendant(lookup, "ses_grandchild", "ses_child")).toBe(false)
    expect(await isDescendant(lookup, "ses_root", "ses_other")).toBe(false)
    expect(await isDescendant(lookup, "ses_root", "ses_root")).toBe(false)
    expect(await isDescendant(lookup, "ses_root", "ses_missing")).toBe(false)
  })

  test("a session without a parent is not a descendant", async () => {
    expect(await isDescendant(lookup, "ses_root", "ses_orphan")).toBe(false)
  })
})

describe("subagentTargetError", () => {
  test("accepts a finished subagent", () => {
    expect(
      subagentTargetError({ parentID: "ses_root", outcome: "succeeded" }, "ses_root", "ses_child"),
    ).toBeUndefined()
  })

  test("refuses the caller, a root session, a busy target, and a missing target", () => {
    expect(subagentTargetError({ parentID: "ses_root", outcome: "succeeded" }, "ses_root", "ses_root")).toContain(
      "not the caller",
    )
    expect(subagentTargetError({ parentID: null, outcome: "succeeded" }, "ses_root", "ses_child")).toContain(
      "not a subagent",
    )
    expect(subagentTargetError({ parentID: "ses_root", outcome: null }, "ses_root", "ses_child")).toContain(
      "still running",
    )
    expect(subagentTargetError(undefined, "ses_root", "ses_child")).toContain("was not found")
  })
})
