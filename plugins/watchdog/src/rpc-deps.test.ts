/** Source-level guard: the GUI RPC unblock dep must reference an imported symbol.
 *  Fails against pre-fix index.ts, which called unblockSession() without importing it. */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

const src = readFileSync(new URL("./index.ts", import.meta.url), "utf8")

describe("Jev RPC unblock dependency", () => {
  test("index.ts imports unblockSession from session-stop.ts", () => {
    expect(src).toMatch(/import\s*\{[^}]*\bunblockSession\b[^}]*\}\s*from\s*"\.\/session-stop\.ts"/)
  })
})
