import { describe, expect, test } from "bun:test"
import { cursorKey, decodeCursorRecord, encodeCursorRecord, hydrateState } from "./persistence.ts"
import { emptyState } from "./shared.ts"

describe("cursorKey", () => {
  test("is stable for a url and channel and drops trailing slashes", () => {
    expect(cursorKey("http://board/api/", "wake")).toBe(cursorKey("http://board/api", "wake"))
    expect(cursorKey("http://board/api", "wake")).not.toBe(cursorKey("http://board/api", "ops"))
  })
})

describe("encodeCursorRecord", () => {
  test("keeps the cursor and caps the recent ids", () => {
    const state = emptyState()
    for (let i = 0; i < 250; i++) state.seen.set(`msg-${i}`, 1000)
    const record = encodeCursorRecord("42", state, 2000)
    expect(record.cursor).toBe("42")
    expect(record.at).toBe(2000)
    expect(record.seen).toHaveLength(200)
    expect(record.seen[0]).toBe("msg-50")
    expect(record.seen.at(-1)).toBe("msg-249")
  })
})

describe("decodeCursorRecord", () => {
  test("accepts a valid record", () => {
    expect(decodeCursorRecord({ cursor: "42", seen: ["a", "b"], at: 1000 })).toEqual({
      cursor: "42",
      seen: ["a", "b"],
      at: 1000,
    })
  })

  test("rejects malformed values", () => {
    for (const value of [null, "42", {}, { cursor: "", seen: [], at: 1 }, { cursor: "42", seen: [1], at: 1 }, { cursor: "42", seen: [], at: "now" }]) {
      expect(decodeCursorRecord(value)).toBeNull()
    }
  })
})

describe("hydrateState", () => {
  test("seeds seen ids from a saved record", () => {
    const state = emptyState()
    hydrateState(state, { cursor: "42", seen: ["a", "b"], at: 1000 })
    expect([...state.seen.entries()]).toEqual([["a", 1000], ["b", 1000]])
  })
})
