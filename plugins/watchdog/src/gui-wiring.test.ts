/** Source-level guard for the GUI view/controller wiring that unit mocks hide.
 *  Both assertions fail against the pre-fix gui.tsx (blank-panel bugs). */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

const src = readFileSync(new URL("./gui.tsx", import.meta.url), "utf8")

describe("Jev Desktop panel first render", () => {
  test("initial view state declares every field read with .length or <For each>", () => {
    // state().tool bans.length and <For each={state().tool bans}> must not hit undefined.
    expect(src).toMatch(/toolBans:\s*\[\]\s*as\s*ToolBanInfo\[\]/)
    for (const field of ["rows", "approvals", "toolBans"]) {
      expect(src, `initial state must declare ${field}`).toMatch(new RegExp(`${field}:\\s*\\[\\]`))
    }
  })
  test("RPC wrapper forwards listTool bans/stopSession/liftTool ban/liftTool banAndResume to the shared contract", () => {
    for (const m of ["listToolBans", "stopSession", "liftToolBan", "liftToolBanAndResume"]) {
      expect(src, `wrapper must forward ${m}`).toMatch(new RegExp(`${m}:\\s*\\(input\\)\\s*=>\\s*rpc\\.${m}\\(input\\)`))
    }
    expect(src, "Contract must be the shared jev one").toContain('from "../../../lib/jev/rpc.ts"')
  })
})
