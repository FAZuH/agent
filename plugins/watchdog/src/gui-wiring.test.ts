/** Source-level guard for the GUI view/controller wiring that unit mocks hide.
 *  Both assertions fail against the pre-fix gui.tsx (blank-panel bugs). */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

const src = readFileSync(new URL("./gui.tsx", import.meta.url), "utf8")

describe("Jev Desktop panel first render", () => {
  test("initial view state declares every field read with .length or <For each>", () => {
    // state().bans.length and <For each={state().bans}> must not hit undefined.
    expect(src).toMatch(/bans:\s*\[\]\s*as\s*SessionBanInfo\[\]/)
    for (const field of ["rows", "approvals", "bans"]) {
      expect(src, `initial state must declare ${field}`).toMatch(new RegExp(`${field}:\\s*\\[\\]`))
    }
  })
  test("RPC wrapper forwards listBans/stopSession/unblockSession to the shared contract", () => {
    for (const m of ["listBans", "stopSession", "unblockSession"]) {
      expect(src, `wrapper must forward ${m}`).toMatch(new RegExp(`${m}:\\s*\\(input\\)\\s*=>\\s*rpc\\.${m}\\(input\\)`))
    }
    expect(src, "Contract must be the shared lib-jev one").toContain('from "../../../lib/lib-jev/rpc.ts"')
  })
})
