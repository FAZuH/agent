/** Stop and tool ban mechanics. Scratch state, fabricated ctx, no host. */
import { afterAll, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const scratch = mkdtempSync(join(tmpdir(), "jev-stop-"))
process.env.JEV_STATE_HOME = scratch
process.env.XDG_STATE_HOME = scratch
mkdirSync(scratch, { recursive: true })

const { isToolBanned, readToolBans, unbanTool } = await import("../../../lib/jev/tool-ban.ts")
const { banTool } = await import("../../../lib/jev/tool-ban.ts")
const { subagentsOf, stopSessionTree, liftToolBan } = await import("./tool-ban-actions.ts")

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

describe("tool ban lifecycle", () => {
  test("tool ban covers session + subagents; liftTool ban lifts all with no restart", async () => {
    banTool("main", ["sub1", "sub2"], "jev block")
    expect(isToolBanned("main")).toBe(true)
    expect(isToolBanned("sub1")).toBe(true)
    expect(isToolBanned("sub2")).toBe(true)
    const c = ctx([{ id: "sub1", parentID: "main" }])
    const count = await liftToolBan(c.api, "main")
    expect(count).toBeGreaterThan(0)
    expect(isToolBanned("main")).toBe(false)
    expect(isToolBanned("sub1")).toBe(false)
    // No restart: interrupt is never called by liftTool ban.
    expect(c.interrupted.length).toBe(0)
  })
  test("stale tool ban persists until liftTool ban (no silent TTL expiry)", () => {
    banTool("stale", [], "old block")
    const record = readToolBans().find((b) => b.sessionID === "stale")
    expect(record?.toolBannedAt).toBeDefined()
    expect(isToolBanned("stale")).toBe(true)
    unbanTool("stale")
    expect(isToolBanned("stale")).toBe(false)
  })
})

describe("tool ban file migration", () => {
  const previous = process.env.OPENCODE_JEV_STATE_HOME
  const root = mkdtempSync(join(tmpdir(), "jev-ban-file-"))
  const legacyPath = join(root, "jev-bans.json")
  const newPath = join(root, "jev-tool-bans.json")
  const row = (sessionID: string) => ({ sessionID, subagents: [], reason: "old block", toolBannedAt: "2026-11-19T00:00:00.000Z" })

  beforeEach(() => {
    process.env.OPENCODE_JEV_STATE_HOME = root
    rmSync(newPath, { force: true })
    rmSync(legacyPath, { force: true })
  })

  afterAll(() => {
    if (previous === undefined) delete process.env.OPENCODE_JEV_STATE_HOME
    else process.env.OPENCODE_JEV_STATE_HOME = previous
    rmSync(root, { recursive: true, force: true })
  })

  test("an old ban file is read when the new one is absent", () => {
    writeFileSync(legacyPath, JSON.stringify([row("ses_legacy")]), "utf8")
    expect(readToolBans().map((r) => r.sessionID)).toEqual(["ses_legacy"])
  })

  test("the new ban file wins when both exist", () => {
    writeFileSync(legacyPath, JSON.stringify([row("ses_legacy")]), "utf8")
    writeFileSync(newPath, JSON.stringify([row("ses_current")]), "utf8")
    expect(readToolBans().map((r) => r.sessionID)).toEqual(["ses_current"])
  })

  test("an empty new file still wins over an old one", () => {
    writeFileSync(legacyPath, JSON.stringify([row("ses_legacy")]), "utf8")
    writeFileSync(newPath, "[]", "utf8")
    expect(readToolBans()).toEqual([])
  })
})
