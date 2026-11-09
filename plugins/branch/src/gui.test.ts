/**
 * The GUI bundle exists, came from the GUI sources, and is at least as new
 * as them: it ships as-is (sync copies the whole directory), and the app
 * provides `@opencode/plugin/gui` at runtime, so the bundle cannot be
 * imported from a test. Rebuild with `bun run build:gui` (or ./dev.sh gui).
 *
 *   bun test src/gui.test.ts
 */

import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

const root = join(import.meta.dir, "..")

describe("gui bundle", () => {
  test("bundle exists and is newer than the GUI sources", () => {
    const bundle = join(root, "dist/gui-experimental.cjs")
    expect(existsSync(bundle)).toBe(true)
    const built = statSync(bundle).mtimeMs
    for (const source of ["src/gui.tsx", "src/branch.ts", "src/rpc.ts"]) {
      expect(built >= statSync(join(root, source)).mtimeMs).toBe(true)
    }
  })

  test("bundle exports a setup", () => {
    const code = readFileSync(join(root, "dist/gui-experimental.cjs"), "utf8")
    expect(code).toContain("@opencode/plugin/gui")
    expect(code).toContain("setup")
  })
})
