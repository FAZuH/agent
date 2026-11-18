/** Stop and ban mechanics. Scratch state, fabricated ctx, no host. */
import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const scratch = mkdtempSync(join(tmpdir(), "jev-stop-"))
process.env.JEV_STATE_HOME = scratch
process.env.XDG_STATE_HOME = scratch
mkdirSync(scratch, { recursive: true })

const { isBanned, readBans, unbanSession } = await import("../../../lib/lib-jev/ban.ts")
const { banSession } = await import("../../../lib/lib-jev/ban.ts")
const { subagentsOf, stopSessionTree, unblockSession } = await import("./session-stop.ts")

function ctx(children: Array<{ id: string; parentID: string }> = []) {
  const interrupted: any[] = []
  const notices: any[] = []
  return {
    interrupted,
    notices,
    api: {
      session: {
        list: async () => children,
        interrupt: async (input: any) => interrupted.push(input),
        synthetic: async (input: any) => notices.push(input),
      },
    },
  }
}

describe("subagent enumeration", () => {
  test("BFS finds children and descendants, not unrelated sessions", async () => {
    const c = ctx([
      { id: "sub1", parentID: "main" },
      { id: "sub2", parentID: "main" },
      { id: "sub1a", parentID: "sub1" },
      { id: "other", parentID: "elsewhere" },
    ])
    const found = await subagentsOf(c.api, "main")
    expect(found).toContain("sub1")
    expect(found).toContain("sub2")
    expect(found).toContain("sub1a")
    expect(found).not.toContain("other")
    expect(found).not.toContain("main")
  })
})

describe("stopSessionTree", () => {
  test("interrupts parent (resume:false) + subagents and leaves a notice", async () => {
    const c = ctx([{ id: "sub1", parentID: "main" }])
    await stopSessionTree(c.api, "main")
    expect(c.interrupted.some((i) => i.sessionID === "main" && i.resume === false)).toBe(true)
    expect(c.interrupted.some((i) => i.sessionID === "sub1" && i.resume === false)).toBe(true)
    expect(c.notices.length).toBe(1)
  })
  test("reuses the injected abortSession when provided", async () => {
    const c = ctx([])
    let aborted = 0
    await stopSessionTree(c.api, "main", { abortSession: async () => { aborted++ } })
    expect(aborted).toBe(1)
  })
})

describe("ban lifecycle", () => {
  test("ban covers session + subagents; unblock lifts all with no restart", async () => {
    banSession("main", ["sub1", "sub2"], "jev block")
    expect(isBanned("main")).toBe(true)
    expect(isBanned("sub1")).toBe(true)
    expect(isBanned("sub2")).toBe(true)
    const c = ctx([{ id: "sub1", parentID: "main" }])
    const count = await unblockSession(c.api, "main")
    expect(count).toBeGreaterThan(0)
    expect(isBanned("main")).toBe(false)
    expect(isBanned("sub1")).toBe(false)
    // No restart: interrupt is never called by unblock.
    expect(c.interrupted.length).toBe(0)
  })
  test("stale ban persists until unblock (no silent TTL expiry)", () => {
    banSession("stale", [], "old block")
    const record = readBans().find((b) => b.sessionID === "stale")
    expect(record?.bannedAt).toBeDefined()
    expect(isBanned("stale")).toBe(true)
    unbanSession("stale")
    expect(isBanned("stale")).toBe(false)
  })
})
