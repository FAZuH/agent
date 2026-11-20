/** Question-card gate: V-PROPAGATE / V-ABORT flow. Scratch state, no live service. */
import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const scratch = mkdtempSync(join(tmpdir(), "jev-cards-"))
process.env.JEV_STATE_HOME = scratch
process.env.XDG_STATE_HOME = scratch
mkdirSync(join(scratch, "opencode"), { recursive: true })
writeFileSync(join(scratch, "opencode", "service.json"), JSON.stringify({ url: "http://127.0.0.1:1", password: "dummy" }))

const { loadState, saveState } = await import("../../../lib/lib-jev/state.ts")
const { readToolBans, banTool, setToolBanCard, unbanTool, toolBanForForm } = await import("../../../lib/lib-jev/tool-ban.ts")
const { resetCardRoute, markCardRouteActive, onBeforeExecute, handleCardReply, buildAskCard, ASK_OPTIONS } = await import("./question-cards.ts")
type CardDeps = import("./question-cards.ts").CardDeps
type DecideFn = import("./question-cards.ts").DecideFn

function setFlag(on: boolean) {
  const base = loadState()
  saveState({ config: { ...base.config, hook_tool_risk: { ...base.config.hook_tool_risk, questionCards: on } } })
}
function activate() {
  setFlag(true)
  resetCardRoute()
  markCardRouteActive()
}
function deactivate() {
  setFlag(false)
  resetCardRoute()
}
function stubFetch() {
  const original = globalThis.fetch
  const calls: Array<{ method: string; url: string }> = []
  const formIDs: string[] = []
  globalThis.fetch = (async (input: any, init: any) => {
    const method = String(init?.method ?? "")
    calls.push({ method, url: String(input ?? "") })
    if (method === "POST") {
      try { formIDs.push(String(JSON.parse(init?.body ?? "{}").id ?? "")) } catch {}
    }
    return { status: 200, ok: true, text: async () => "{}" }
  }) as any
  return { calls, formIDs, restore: () => (globalThis.fetch = original) }
}
function deps(stopped: string[] = []): CardDeps & { toolBanned: any[]; cards: any[]; changedEvents: any[]; notices: any[] } {
  const toolBanned: any[] = []
  const cards: any[] = []
  const changedEvents: any[] = []
  const notices: any[] = []
  return {
    stopTree: async (sessionID) => {
      stopped.push(sessionID)
      return ["sub_a", "sub_b"]
    },
    toolBan: (sessionID, subagents, reason) => toolBanned.push({ sessionID, subagents, reason }),
    staleCard: () => undefined,
    setCard: (sessionID, formID, tool) => cards.push({ sessionID, formID, tool }),
    unbanTool: (sessionID) => 1,
    changed: (reason) => changedEvents.push(reason),
    notifyAbort: async (sessionID, text) => { notices.push({ sessionID, text }) },
    toolBanned,
    cards,
    changedEvents,
    notices,
  }
}
const allow: DecideFn = async () => ({ effect: "allow", resources: ["x"] })
const propagate: DecideFn = async () => ({ effect: "propagate", message: "jev: held for you", resources: ["x"] })
const deny: DecideFn = async () => ({ effect: "deny", message: "jev: denied", resources: ["x"] })
const abort: DecideFn = async () => ({ effect: "abort", message: "jev: abort", resources: ["x"] })
const event = { sessionID: "ses_block", tool: "bash", id: "call_1", input: {} }

async function answer(formIDs: string[], decision: string) {
  await new Promise((r) => setTimeout(r, 10))
  handleCardReply(formIDs[0], { decision })
}

describe("card gate API", () => {
  test("opens a card with exactly the three user options, including abort", async () => {
    const card = buildAskCard("bash", "nonce1", "review notice")
    expect(card.card.fields[0].options).toEqual([
      { value: "allow", label: "Allow" },
      { value: "deny", label: "Deny" },
      { value: "abort", label: "Abort session" },
    ])
    expect(card.card.metadata).toMatchObject({ kind: "question", jevTool: "bash", reviewNotice: "review notice" })
    expect(ASK_OPTIONS.map((o) => o.value)).toEqual(["allow", "deny", "abort"])
  })
  test("exports the gate without hold machinery", async () => {
    const m = await import("./question-cards.ts")
    expect(typeof m.onBeforeExecute).toBe("function")
    expect((m as any).awaitCard).toBeUndefined()
  })
})

describe("gate effects", () => {
  test("route inactive: onBeforeExecute is a no-op", async () => {
    deactivate()
    const f = stubFetch()
    const d = deps()
    try {
      await onBeforeExecute({}, event, propagate, d)
      expect(f.calls.length).toBe(0)
      expect(d.cards.length).toBe(0)
    } finally {
      f.restore()
    }
  })
  test("allow: tool runs, no stop, no card, no notify", async () => {
    activate()
    const d = deps()
    try {
      await onBeforeExecute({}, event, allow, d)
      expect(d.cards.length).toBe(0)
      expect(d.notices.length).toBe(0)
    } finally {
      deactivate()
    }
  })
  test("deny skips only this call: no tree stop, no tool ban, no card", async () => {
    activate()
    const f = stubFetch()
    const stopped: string[] = []
    const d = deps(stopped)
    try {
      await expect(onBeforeExecute({}, event, deny, d)).rejects.toThrow(/denied/)
      expect(stopped).toEqual([])
      expect(d.toolBanned.length).toBe(0)
      expect(d.cards.length).toBe(0)
      expect(f.calls.length).toBe(0)
    } finally {
      f.restore()
      deactivate()
    }
  })
  test("abort stops the tree and notifies", async () => {
    activate()
    const stopped: string[] = []
    const d = deps(stopped)
    try {
      await expect(onBeforeExecute({}, event, abort, d)).rejects.toThrow(/abort/)
      expect(stopped).toContain("ses_block")
      expect(d.notices.length).toBe(1)
      expect(d.notices[0].sessionID).toBe("ses_block")
      expect(d.changedEvents).toContain("abort")
    } finally {
      deactivate()
    }
  })
})

describe("V-PROPAGATE", () => {
  test("holds the call and lets the tool run when the user allows", async () => {
    activate()
    const f = stubFetch()
    const d = deps()
    try {
      const p = onBeforeExecute({}, event, propagate, d)
      await answer(f.formIDs, "allow")
      await expect(p).resolves.toBeUndefined()
      expect(d.staleCard).toBeDefined()
      expect(d.cards.length).toBe(1)
      expect(d.changedEvents).toContain("propagate")
    } finally {
      f.restore()
      deactivate()
    }
  })
  test("user deny skips the call without stopping the tree", async () => {
    activate()
    const f = stubFetch()
    const stopped: string[] = []
    const d = deps(stopped)
    try {
      const p = onBeforeExecute({}, event, propagate, d)
      await answer(f.formIDs, "deny")
      await expect(p).rejects.toThrow(/denied/)
      expect(stopped).toEqual([])
      expect(d.notices.length).toBe(0)
    } finally {
      f.restore()
      deactivate()
    }
  })
  test("user abort triggers V-ABORT: stop tree and notify", async () => {
    activate()
    const f = stubFetch()
    const stopped: string[] = []
    const d = deps(stopped)
    try {
      const p = onBeforeExecute({}, event, propagate, d)
      await answer(f.formIDs, "abort")
      await expect(p).rejects.toThrow(/aborted/)
      expect(stopped).toContain("ses_block")
      expect(d.notices.length).toBe(1)
      expect(d.notices[0].text).toContain("aborted")
    } finally {
      f.restore()
      deactivate()
    }
  })
  test("times out to deny when the user never answers", async () => {
    activate()
    const f = stubFetch()
    const d = deps()
    d.askTimeoutMs = 5
    try {
      await expect(onBeforeExecute({}, event, propagate, d)).rejects.toThrow(/denied/)
    } finally {
      f.restore()
      deactivate()
    }
  })
  test("a second reply after the first is harmless", async () => {
    activate()
    const f = stubFetch()
    const d = deps()
    try {
      const p = onBeforeExecute({}, event, propagate, d)
      await answer(f.formIDs, "allow")
      await expect(p).resolves.toBeUndefined()
      expect(handleCardReply(f.formIDs[0], { decision: "abort" })).toBe(false)
    } finally {
      f.restore()
      deactivate()
    }
  })
})

describe("card records", () => {
  test("a 409 on first create stores the retry card id", async () => {
    activate()
    const original = globalThis.fetch
    let postCount = 0
    const created: string[] = []
    globalThis.fetch = (async (_input: any, init: any) => {
      if (String(init?.method) === "POST") {
        postCount++
        let id = ""
        try { id = String(JSON.parse(init?.body ?? "{}").id ?? "") } catch {}
        created.push(id)
        return postCount === 1
          ? ({ status: 409, ok: false, text: async () => "{}" } as any)
          : ({ status: 200, ok: true, text: async () => "{}" } as any)
      }
      return { status: 200, ok: true, text: async () => "{}" } as any
    }) as any
    const cards: any[] = []
    const d: CardDeps = {
      stopTree: async () => [],
      toolBan: (sid, subs, reason) => banTool(sid, subs, reason),
      staleCard: (sid) => readToolBans().find((b) => b.sessionID === sid)?.formID,
      setCard: (sid, formID, tool) => { setToolBanCard(sid, formID, tool); cards.push({ sid, formID }) },
      unbanTool: (sid) => unbanTool(sid),
      changed: () => {},
    }
    try {
      const p = onBeforeExecute({}, event, propagate, d)
      await new Promise((r) => setTimeout(r, 10))
      handleCardReply(created[1], { decision: "allow" })
      await expect(p).resolves.toBeUndefined()
      expect(postCount).toBe(2)
      expect(created[0]).not.toBe(created[1])
      expect(cards[0].formID).toBe(created[1])
    } finally {
      globalThis.fetch = original
      deactivate()
      unbanTool("ses_block")
    }
  })
  test("the tool ban card reply lifts the tool ban", async () => {
    banTool("ses_reply", ["sub_x"], "block")
    const fid = "frm_jev_block_reply1"
    setToolBanCard("ses_reply", fid, "bash")
    ;(globalThis as any).__jevCardLiftToolBan = (id: string) => unbanTool(id)
    expect(handleCardReply(fid, { decision: "lift-tool-ban" })).toBe(true)
    expect(toolBanForForm(fid)).toBeUndefined()
    expect(handleCardReply(fid, { decision: "lift-tool-ban" })).toBe(false)
    delete (globalThis as any).__jevCardLiftToolBan
  })
})
