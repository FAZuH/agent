/** Source-level guard: the GUI RPC liftTool ban dep must reference an imported symbol.
 *  Fails against pre-fix index.ts, which called liftTool ban() without importing it. */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

const src = readFileSync(new URL("./index.ts", import.meta.url), "utf8")

describe("Jev RPC liftTool ban dependency", () => {
  test("index.ts imports liftTool ban from tool-ban-actions.ts", () => {
    expect(src).toMatch(/import\s*\{[^}]*\bliftToolBan\b[^}]*\}\s*from\s*"\.\/tool-ban-actions\.ts"/)
  })
})
