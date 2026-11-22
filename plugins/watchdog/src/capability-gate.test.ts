/**
 * The rollout gate writer: `chain-gate.json` records the real-host capability
 * verdicts and refuses enablement unless every required capability is
 * verified by real-host evidence. A synthetic probe never verifies anything.
 *
 *   bun test plugins/watchdog/src/capability-gate.test.ts
 */

import { afterAll, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const scratch = mkdtempSync(join(tmpdir(), "jev-capability-gate-"))
process.env.JEV_DATA_DIR = scratch
process.env.JEV_STATE_HOME = scratch
process.env.JEV_SECRET_DIR = join(scratch, "secrets")
process.env.OPENCODE_JEV_STATE_HOME = scratch

const { CHAIN_GATE_FILE, chainStateHome } = await import("./chain.ts")
const { REQUIRED_CAPABILITIES, writeCapabilityGate, gateFilePath } = await import("./capability-gate.ts")

const gatePath = () => join(chainStateHome(), CHAIN_GATE_FILE)
const clean = () => rmSync(gatePath(), { force: true })
const readGate = () => JSON.parse(readFileSync(gatePath(), "utf8"))

const REQUIRED_IDS = REQUIRED_CAPABILITIES.map((entry: { id: string }) => entry.id)

/** The report's verdicts as they stand, one item per required capability. */
const REPORT_SHEET = {
  source: { kind: "real-host", report: "CAPABILITY-REPORT.md attempt 6", date: "2026-11-21" },
  items: [
    {
      capability: "c1_busy_parent",
      verdict: "partial",
      note: "pass, narrow scope: a generate on a busy parent answered and the turn ended succeeded; tool-execution overlap and concurrent-review turn outcome unverified",
    },
    {
      capability: "c2_filtering",
      verdict: "partial",
      note: "tool-output visibility and the useronly filter measured on the ticket route; genuine-prompt separation and exact-input preservation unverified",
    },
    {
      capability: "c2_isolation",
      verdict: "unverified",
      note: "transcript isolation rests on one marker check; no new judge session, no fork, no judge tool execution unproven",
    },
    {
      capability: "c3_cancellation",
      verdict: "failed",
      note: "closed client enumeration has no primitive that cancels a started transient generate; incomplete-containment reporting unimplemented",
    },
    {
      capability: "c4_native_coverage",
      verdict: "partial",
      note: "observation holds for native, code-mode, plugin, subagent, and an MCP fixture; plugin-tool and code-mode calls have no deny point in this hook",
    },
    {
      capability: "c5_exact_reply_isolation",
      verdict: "partial",
      note: "per-request reply isolation and replay rejection verified on synthetic permission records; held real actions and a forced-allow override untested",
    },
    {
      capability: "c5b_human_only_absolute",
      verdict: "failed",
      note: "the host delegates asks, a plugin allow clears one; the Watchdog human-only enforcement is unimplemented",
    },
    {
      capability: "c6_no_wake_notices",
      verdict: "partial",
      note: "queue, no-wake delivery, delete, and next-turn flush verified; the host does not suppress after an interrupt; Watchdog cancel-on-abort unimplemented",
    },
  ],
}

const verifiedItem = (id: string) => ({
  capability: id,
  verdict: "verified",
  note: `real-host probe rerun passed: ${id}`,
})

const fullyVerifiedSheet = {
  source: { kind: "real-host", report: "run sheet 2026-11-23", date: "2026-11-23" },
  items: REQUIRED_IDS.map(verifiedItem),
}

afterAll(() => rmSync(scratch, { recursive: true, force: true }))

describe("the rollout gate writer", () => {
  test("requires one closed list of capabilities", () => {
    expect(REQUIRED_IDS).toEqual([
      "c1_busy_parent",
      "c2_filtering",
      "c2_isolation",
      "c3_cancellation",
      "c4_native_coverage",
      "c5_exact_reply_isolation",
      "c5b_human_only_absolute",
      "c6_no_wake_notices",
    ])
  })

  test("the report's own verdicts write a blocked gate with one limitation per gating capability", () => {
    clean()
    const result = writeCapabilityGate(JSON.stringify(REPORT_SHEET))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.gate).toBe("blocked")
    expect(result.limitations).toHaveLength(8)

    const gate = readGate()
    expect(gate.gate).toBe("blocked")
    expect(gate.source).toEqual(REPORT_SHEET.source)
    expect(Object.keys(gate.capabilities).sort()).toEqual([...REQUIRED_IDS].sort())
    const byID = new Map(gate.limitations.map((row: { capability: string }) => [row.capability, row]))
    expect(byID.get("c3_cancellation").state).toBe("failed")
    expect(byID.get("c5b_human_only_absolute").state).toBe("failed")
    expect(byID.get("c1_busy_parent").state).toBe("partial")
    expect(byID.get("c2_filtering").state).toBe("partial")
    expect(byID.get("c2_isolation").state).toBe("unverified")
    expect(byID.get("c4_native_coverage").state).toBe("partial")
    expect(byID.get("c5_exact_reply_isolation").state).toBe("partial")
    expect(byID.get("c6_no_wake_notices").state).toBe("partial")
    // The chain's own reader consumes exactly this file shape.
    expect(gate.gate === "passed").toBe(false)
  })

  test("a fully verified real-host sheet is the only thing that writes a passed gate", () => {
    clean()
    const result = writeCapabilityGate(JSON.stringify(fullyVerifiedSheet))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.gate).toBe("passed")
    expect(result.limitations).toEqual([])
    const gate = readGate()
    expect(gate.gate).toBe("passed")
    expect(gate.limitations).toEqual([])
    for (const entry of REQUIRED_CAPABILITIES) {
      expect(gate.capabilities[entry.id].verdict).toBe("verified")
    }
  })

  test("synthetic evidence never verifies a capability, whatever the sheet claims", () => {
    clean()
    const sheet = {
      source: { kind: "synthetic-probe", report: "bun test", date: "2026-11-23" },
      items: REQUIRED_IDS.map(verifiedItem),
    }
    const result = writeCapabilityGate(JSON.stringify(sheet))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.gate).toBe("blocked")
    expect(result.limitations).toHaveLength(8)
    expect(result.limitations.every((row: { state: string }) => row.state === "synthetic-evidence")).toBe(true)
    expect(readGate().gate).toBe("blocked")
  })

  test("a missing item records unverified; a failed item records failed; only those gate", () => {
    clean()
    const sheet = {
      source: { kind: "real-host", report: "partial rerun", date: "2026-11-23" },
      items: [verifiedItem("c1_busy_parent"), { capability: "c3_cancellation", verdict: "failed", note: "no host path cancels a started generate" }],
    }
    const result = writeCapabilityGate(JSON.stringify(sheet))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.gate).toBe("blocked")
    const byID = new Map(result.limitations.map((row: { capability: string; state: string }) => [row.capability, row.state]))
    expect(byID.has("c1_busy_parent")).toBe(false)
    expect(byID.get("c3_cancellation")).toBe("failed")
    expect(byID.get("c2_isolation")).toBe("unverified")
    expect(byID.size).toBe(7)
  })

  test("a blocked verdict overwrites a stale passed gate: closing is the only silent direction", () => {
    clean()
    writeCapabilityGate(JSON.stringify(fullyVerifiedSheet))
    expect(readGate().gate).toBe("passed")
    const result = writeCapabilityGate(JSON.stringify(REPORT_SHEET))
    expect(result.ok && result.gate).toBe("blocked")
    expect(readGate().gate).toBe("blocked")
    clean()
  })

  test("an unparseable sheet, an unknown capability id, and a violating note are each refused with no file written", () => {
    clean()
    expect(writeCapabilityGate("{not json")).toEqual({ ok: false, error: expect.stringContaining("parse") })
    expect(writeCapabilityGate(JSON.stringify({ source: { kind: "real-host" }, items: [{ capability: "c9_typo", verdict: "verified", note: "x" }] }))).toEqual({
      ok: false,
      error: expect.stringContaining("c9_typo"),
    })
    // An endpoint URL never belongs in a gate note, whatever it names.
    const urlSheet = {
      source: { kind: "real-host", date: "2026-11-23" },
      items: [verifiedItem("c1_busy_parent"), { capability: "c3_cancellation", verdict: "failed", note: "see https://hooks.example/wd for details" }],
    }
    const refused = writeCapabilityGate(JSON.stringify(urlSheet))
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.error).toContain("note")
    expect(existsSync(gatePath())).toBe(false)
  })

  test("a verified item without evidence naming is refused, never silently downgraded", () => {
    clean()
    const sheet = {
      source: { kind: "real-host", date: "2026-11-23" },
      items: [...REQUIRED_IDS.slice(0, 7).map(verifiedItem), { capability: "c6_no_wake_notices", verdict: "verified", note: "" }],
    }
    const result = writeCapabilityGate(JSON.stringify(sheet))
    expect(result.ok).toBe(false)
    expect(existsSync(gatePath())).toBe(false)
  })

  test("the written file carries only structured fields: sheet evidence text and secrets never reach it", () => {
    clean()
    const sheet = {
      source: { kind: "real-host", report: "run sheet", date: "2026-11-23" },
      items: REQUIRED_IDS.map((id: string, index: number) => ({
        capability: id,
        verdict: index === 0 ? "partial" : "verified",
        note: index === 0 ? "tool overlap unverified" : `probe rerun passed: ${id}`,
        evidence: "transcript: the judge said WEBHOOK https://secret.example/tk ABCDEF and TOOL_OUTPUT_SECRET",
      })),
    }
    const result = writeCapabilityGate(JSON.stringify(sheet))
    expect(result.ok).toBe(true)
    const text = readFileSync(gatePath(), "utf8")
    expect(text).not.toContain("evidence")
    expect(text).not.toContain("https://")
    expect(text).not.toContain("transcript")
    expect(text).not.toContain("TOOL_OUTPUT_SECRET")
    expect(text).not.toContain("ABCDEF")
    clean()
  })

  test("the CLI refuses garbage without writing and records the report sheet from the command line", () => {
    clean()
    const sheetPath = join(scratch, "sheet.json")
    writeFileSync(sheetPath, JSON.stringify(REPORT_SHEET))
    const run = (path: string) =>
      Bun.spawnSync({
        cmd: [process.execPath, join(import.meta.dir, "capability-gate.ts"), path],
        env: { ...process.env, JEV_STATE_HOME: scratch, OPENCODE_JEV_STATE_HOME: scratch },
        stdout: "pipe",
        stderr: "pipe",
      })
    const good = run(sheetPath)
    expect(good.exitCode).toBe(0)
    expect(readGate().gate).toBe("blocked")

    const badPath = join(scratch, "bad.json")
    writeFileSync(badPath, "{not json")
    const bad = run(badPath)
    expect(bad.exitCode).not.toBe(0)
    clean()
    rmSync(sheetPath, { force: true })
    rmSync(badPath, { force: true })
  })

  test("the writer resolves the same state home as the chain", () => {
    expect(gateFilePath()).toBe(gatePath())
  })
})
