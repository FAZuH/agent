/** Controller and log-filter behaviour for the Jev panel. No host, no network. */
import { describe, expect, test } from "bun:test"
import { createJevView, type JevRPC, type JevViewState, type StopSessionResult } from "./gui-controller.ts"
import { filterRows, rowBadge, distinctHooks, distinctBadges } from "./gui-filter.ts"

const row = (over: Record<string, unknown> = {}) => ({ hook: "hook_tool_risk", verdict: "DENY", ts: "2026-01-01T00:00:00Z", subject: "shell: rm -rf build", ...over })

/** A stop result as the RPC returns it; overrides name what a case inspects. */
function stopResult(over: Partial<StopSessionResult> = {}): StopSessionResult {
  return {
    ok: true,
    sealed: true,
    durable: true,
    receipt: true,
    ban: { written: 2, failed: 0 },
    operationID: "op_1",
    scope: ["ses_block", "ses_child"],
    incomplete: [],
    outcome: "known",
    enforcedBy: ["chain"],
    ...over,
  }
}

function harness() {
  let listener: (() => void) | undefined
  const calls: Array<{ limit: number; sessionID?: string }> = []
  let statusCalls = 0
  let approvalCalls = 0
  let states: JevViewState[] = []
  const rpc: JevRPC = {
    status: async () => { statusCalls++; return {} as any },
    log: async (input) => { calls.push(input); return { rows: [row()] } },
    approvals: async () => { approvalCalls++; return { approvals: [] } },
    approve: async () => ({ ok: true }),
    reject: async () => ({ ok: true }),
    approveAll: async () => ({ ok: true, count: 0 }),
    rejectAll: async () => ({ ok: true, count: 0 }),
    setEnabled: async () => ({ ok: true }),
    setFeature: async () => ({ ok: true }),
    liftToolBan: async () => ({ ok: true, count: 0 }),
    liftToolBanAndResume: async () => ({ ok: true, count: 0 }),
    stopSession: async () => stopResult(),
    subscribe: (fn) => { listener = fn; return () => { listener = undefined } },
  }
  const warnings: string[] = []
  const errors: string[] = []
  const view = createJevView(rpc, {
    update: (s) => states.push(s),
    error: (message) => errors.push(message),
    warning: (message) => warnings.push(message),
  })
  return {
    view,
    rpc,
    calls,
    warnings,
    errors,
    fire: () => listener?.(),
    states: () => states,
    counts: () => ({ status: statusCalls, approvals: approvalCalls, log: calls.length }),
  }
}

describe("filterRows", () => {
  test("filters by hook and badge", () => {
    const rows = [row(), row({ hook: "hook_tool_standard", verdict: "ALLOW" })]
    expect(filterRows(rows, { hook: "hook_tool_standard", badge: "all", query: "" })).toHaveLength(1)
    expect(filterRows(rows, { hook: "all", badge: rowBadge(rows[0]), query: "" })).toHaveLength(1)
  })
  test("query matches subject case-insensitively but never payload fields", () => {
    const rows = [row({ subject: "shell: echo SECRET", sent: "TOPSECRET" })]
    expect(filterRows(rows, { hook: "all", badge: "all", query: "ECHO" })).toHaveLength(1)
    expect(filterRows(rows, { hook: "all", badge: "all", query: "TOPSECRET" })).toHaveLength(0)
  })
  test("all/empty means no filter", () => {
    const rows = [row(), row({ hook: "other" })]
    expect(filterRows(rows, { hook: "all", badge: "all", query: "" })).toHaveLength(2)
  })
})

describe("empty option derivation", () => {
  test("empty rows yield no options; churn derives options from current rows", () => {
    expect(distinctHooks([])).toEqual([])
    expect(distinctBadges([])).toEqual([])
    const rows = [row(), row({ hook: "hook_tool_standard", verdict: "ALLOW" })]
    expect(distinctHooks(rows)).toEqual(["hook_tool_risk", "hook_tool_standard"])
    expect(distinctBadges(rows)).toEqual(["ALLOW", "DENY"])
  })
})

describe("JevView controller", () => {
  test("un-pause resumes full loading", async () => {
    const h = harness()
    await h.view.load()
    h.view.setPaused(true)
    h.view.setPaused(false)
    await new Promise((r) => setTimeout(r, 0))
    expect(h.calls.length).toBeGreaterThanOrEqual(2)
  })
  test("paused + setLimit still fetches the new limit", async () => {
    const h = harness()
    await h.view.load()
    h.view.setPaused(true)
    h.view.setLimit(100)
    await new Promise((r) => setTimeout(r, 0))
    expect(h.calls[h.calls.length - 1]!.limit).toBe(100)
  })
  test("subscribe while paused refreshes approvals/status but not rows", async () => {
    const h = harness()
    await h.view.load()
    const first = h.states()[h.states().length - 1]!
    const before = h.counts()
    h.view.setPaused(true)
    h.fire()
    await new Promise((r) => setTimeout(r, 0))
    const last = h.states()[h.states().length - 1]!
    const after = h.counts()
    expect(after.status).toBeGreaterThan(before.status)
    expect(after.approvals).toBeGreaterThan(before.approvals)
    expect(after.log).toBe(before.log)
    expect(last.rows).toEqual(first.rows)
  })
  test("subscribe after un-pausing refreshes rows", async () => {
    const h = harness()
    await h.view.load()
    h.view.setPaused(true)
    h.view.setPaused(false)
    const before = h.counts().log
    h.fire()
    await new Promise((r) => setTimeout(r, 0))
    expect(h.counts().log).toBeGreaterThan(before)
  })
  test("setLimit fetches the requested number of rows", async () => {
    const h = harness()
    await h.view.load()
    h.view.setLimit(100)
    await new Promise((r) => setTimeout(r, 0))
    expect(h.calls[h.calls.length - 1]!.limit).toBe(100)
  })
  test("subscribe does not load while paused, refresh does", async () => {
    const h = harness()
    await h.view.load()
    const before = h.calls.length
    h.view.setPaused(true)
    h.fire()
    expect(h.calls.length).toBe(before)
    h.view.refresh()
    await new Promise((r) => setTimeout(r, 0))
    expect(h.calls.length).toBe(before + 1)
  })
  test("a stop that is not sealed, stopped short, or enforced says so", async () => {
    const h = harness()
    // The receipt is ok, but three facts the user needs are not: durability, one
    // containment step, and the enforcement posture.
    h.rpc.stopSession = async () =>
      stopResult({
        sealed: false,
        durable: false,
        incomplete: [{ step: "interrupt", status: "unconfirmed", detail: "the host did not confirm" }],
        enforcedBy: [],
      })
    await h.view.stopSession("ses_block")
    expect(h.errors).toEqual([])
    expect(h.warnings.length).toBe(1)
    const text = h.warnings[0]!
    expect(text).toContain("not sealed")
    expect(text).toContain("interrupt did not stop as asked")
    expect(text).toContain("no admission hook is active")
    expect(text).toContain("the abort record did not reach disk")
  })

  test("a fully enforced sealed stop warns about nothing", async () => {
    const h = harness()
    await h.view.stopSession("ses_block")
    expect(h.warnings).toEqual([])
    expect(h.errors).toEqual([])
  })

  test("a stop that never ran or may have run is not reported as a failed no-op", async () => {
    const h = harness()
    h.rpc.stopSession = async () =>
      stopResult({ ok: false, sealed: false, durable: false, outcome: "unknown", error: "the bridge dropped" })
    await h.view.stopSession("ses_block")
    expect(h.warnings.length).toBe(1)
    expect(h.warnings[0]).toContain("may have run before it failed")
    expect(h.warnings[0]).toContain("the bridge dropped")
    expect(h.errors).toEqual([])
  })

  test("a stop that throws says its effects are unconfirmed, not that nothing ran", async () => {
    const h = harness()
    h.rpc.stopSession = async () => {
      throw new Error("socket closed")
    }
    await h.view.stopSession("ses_block")
    expect(h.warnings).toEqual([])
    expect(h.errors.length).toBe(1)
    expect(h.errors[0]).toContain("socket closed")
    expect(h.errors[0]).toContain("could not be confirmed")
  })

  test("liftTool banAndResume forwards the session once", async () => {
    const seen: string[] = []
    const rpc: JevRPC = {
      status: async () => ({}) as any,
      log: async () => ({ rows: [] }),
      approvals: async () => ({ approvals: [] }),
      approve: async () => ({ ok: true }),
      reject: async () => ({ ok: true }),
      approveAll: async () => ({ ok: true, count: 0 }),
      rejectAll: async () => ({ ok: true, count: 0 }),
      setEnabled: async () => ({ ok: true }),
      setFeature: async () => ({ ok: true }),
      stopSession: async () => stopResult(),
      liftToolBan: async () => ({ ok: true, count: 0 }),
      liftToolBanAndResume: async (input) => { seen.push(input.sessionID); return { ok: true, count: 1 } },
      listToolBans: async () => ({ toolBans: [] }),
      subscribe: () => () => {},
    }
    const view = createJevView(rpc, { update: () => {}, error: () => {}, warning: () => {} })
    await (view as any).liftToolBanAndResume("ses_batch_01")
    expect(seen).toEqual(["ses_batch_01"])
  })
})
