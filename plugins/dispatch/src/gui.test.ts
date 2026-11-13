/**
 * The GUI bundle exists and ships as-is (sync copies the whole directory);
 * the app provides `@opencode/plugin/gui` at runtime, so the bundle cannot be
 * imported from a test.
 *
 * Bundle staleness is `./dev.sh gui`'s job, not this test's.
 *
 *   bun test src/gui.test.ts
 */

import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

const root = join(import.meta.dir, "..")

describe("gui bundle", () => {
  test("bundle exists", () => {
    expect(existsSync(join(root, "dist/gui-experimental.cjs"))).toBe(true)
  })

  test("bundle exports a setup", () => {
    const code = readFileSync(join(root, "dist/gui-experimental.cjs"), "utf8")
    expect(code).toContain("@opencode/plugin/gui")
    expect(code).toContain("setup")
    expect(code).toContain("dispatched")
  })
})
