/**
 * Self-check for the dispatch marker. No host and no network: the marker is
 * the only link between a parent and its dispatched subagent, so these
 * cases decide what the GUI lists and what it switches to.
 *
 *   bun test src/shared.test.ts
 */

import { describe, expect, test } from "bun:test"

import { readDispatched } from "./shared.ts"

describe("readDispatched", () => {
  test("reads a dispatched marker", () => {
    const marker = readDispatched({
      dispatch: { parentID: "ses_parent", sessionID: "ses_child", task: "run tests", at: 123 },
    })
    expect(marker?.parentID).toBe("ses_parent")
    expect(marker?.sessionID).toBe("ses_child")
    expect(marker?.task).toBe("run tests")
    expect(marker?.at).toBe(123)
  })

  test("rejects foreign metadata", () => {
    expect(readDispatched(undefined)).toBeUndefined()
    expect(readDispatched({ other: 1 })).toBeUndefined()
    expect(readDispatched({ dispatch: { parentID: "ses_parent" } })).toBeUndefined()
    expect(readDispatched({ dispatch: { sessionID: "ses_child" } })).toBeUndefined()
  })
})
