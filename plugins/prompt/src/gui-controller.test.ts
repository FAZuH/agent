/**
 * RPC failures reach the GUI as plain objects. They must render as text, not
 * "[object Object]".
 *
 *   bun test src/gui-controller.test.ts
 */
import { describe, expect, test } from "bun:test"

import { errorText } from "./gui-controller.ts"

describe("errorText", () => {
  test("reads an Error message", () => {
    expect(errorText(new Error("boom"))).toBe("boom")
  })

  test("reads a plain RPC error object", () => {
    expect(errorText({ _tag: "RpcError", type: "rpc.invalid_input", message: "Expected object" })).toBe(
      "Expected object",
    )
  })

  test("reads a nested error object", () => {
    expect(errorText({ reason: { message: "server unreachable" } })).toBe("server unreachable")
  })

  test("falls back to String for unknown values", () => {
    expect(errorText(42)).toBe("42")
  })
})
