/** Controller and log-filter behaviour for the Jev panel. No host, no network. */
import { describe, expect, test } from "bun:test"
import { createJevView, type JevRPC, type JevViewState } from "./gui-controller.ts"
import { filterRows, rowBadge, distinctHooks, distinctBadges } from "./gui-filter.ts"

const row = (over: Record<string, unknown> = {}) => ({ hook: "hook_tool_risk", verdict: "DENY", ts: "2026-01-01T00:00:00Z", subject: "shell: rm -rf build", ...over })

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
    subscribe: (fn) => { listener = fn; return () => { listener = undefined } },
  }
  const view = createJevView(rpc, { update: (s) => states.push(s), error: () => {} })
  return {
    view,
    calls,
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
})
