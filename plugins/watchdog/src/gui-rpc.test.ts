import { expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const scratch = mkdtempSync(join(tmpdir(), "jev-gui-rpc-"))
process.env.JEV_DATA_DIR = scratch
process.env.JEV_SECRET_DIR = join(scratch, "secrets")

const { jevRpcHandlers, logRows, setJevEmitter, statusSnapshot } = await import("./gui-rpc.ts")
const { STATE_FILE, LOG_FILE, APPROVALS_FILE, logCall } = await import("../../../lib/lib-jev/state.ts")

test("statusSnapshot projects safe config fields and masks the endpoint", () => {
  writeFileSync(
    STATE_FILE,
    JSON.stringify({
      enabled: true,
      toast: true,
      endpoint: "https://user:pass@api.example.com/v1/hooktoken",
      config: {
        hook_supervisor: {
          model: "commandcode/deepseek/deepseek-v4.1-flash",
          protocol: "opencode",
          endpoint: "https://user:pass@api.example.com/v1/hooktoken",
          timeoutMs: 60000,
          maxRounds: 3,
          maxEvidence: 6,
          askWaitMs: 5000,
        },
      },
    }),
  )
  const status = statusSnapshot()
  expect(status.enabled).toBe(true)
  expect(status.supervisor.model).toBe("commandcode/deepseek/deepseek-v4.1-flash")
  expect(status.supervisor.protocol).toBe("opencode")
  expect(status.supervisor.timeoutMs).toBe(60000)
  expect(status.supervisor.endpoint).not.toContain("pass@")
  expect(status.supervisor.endpoint).not.toContain("user@")
  expect(JSON.stringify(status)).not.toContain("hooktoken")
  expect(Array.isArray(status.features)).toBe(true)
  expect(status.features.every((f) => typeof f.on === "boolean")).toBe(true)
})

test("logRows keeps only allowlisted fields and never a payload", () => {
  writeFileSync(
    LOG_FILE,
    [
      JSON.stringify({
        ts: "2026-11-17T05:00:00.000Z",
        event: "supervisor_decision",
        verdict: "deny",
        detail: "shell: echo hi",
        endpoint: "https://secret.example.com/hook",
        sent: { credential: "TOP-SECRET" },
        received: "SECRET-REPLY",
      }),
      "not json\n",
    ].join("\n"),
  )
  const rows = logRows(10)
  expect(rows).toHaveLength(1)
  const row = rows[0]!
  expect(row.verdict).toBe("deny")
  expect(row.detail).toBe("shell: echo hi")
  expect("sent" in row).toBe(false)
  expect("received" in row).toBe(false)
  expect("endpoint" in row).toBe(false)
  expect(JSON.stringify(rows)).not.toContain("TOP-SECRET")
  expect(JSON.stringify(rows)).not.toContain("SECRET-REPLY")
})

test("logRows filters to one session's tagged rows and keeps sessionID", () => {
  writeFileSync(
    LOG_FILE,
    [
      JSON.stringify({ ts: "2026-11-17T05:00:00.000Z", hook: "hook_tool_risk", sessionID: "ses_one", verdict: "allow" }),
      JSON.stringify({ ts: "2026-11-17T05:01:00.000Z", hook: "hook_tool_risk", sessionID: "ses_two", verdict: "deny" }),
      JSON.stringify({ ts: "2026-11-17T05:02:00.000Z", hook: "hook_tool_risk", verdict: "allow" }), // untagged legacy row
    ].join("\n"),
  )
  const one = logRows(10, "ses_one")
  expect(one).toHaveLength(1)
  expect(one[0]!.sessionID).toBe("ses_one")
  expect(one[0]!.verdict).toBe("allow")
  expect(logRows(10, "ses_two")).toHaveLength(1)
  expect(logRows(10, "ses_missing")).toHaveLength(0)
  // No filter still returns every row, including the untagged one.
  expect(logRows(10)).toHaveLength(3)
})

test("the log handler forwards a sessionID filter", async () => {
  writeFileSync(
    LOG_FILE,
    [
      JSON.stringify({ ts: "2026-11-17T05:00:00.000Z", hook: "hook_tool_risk", sessionID: "ses_one", verdict: "allow" }),
      JSON.stringify({ ts: "2026-11-17T05:01:00.000Z", hook: "hook_tool_risk", sessionID: "ses_two", verdict: "deny" }),
    ].join("\n"),
  )
  const handlers = jevRpcHandlers()
  const log = await (handlers as any).log({ limit: 10, sessionID: "ses_two" })
  expect(log.rows).toHaveLength(1)
  expect(log.rows[0]!.verdict).toBe("deny")
})

test("the log handler attaches resolved session titles to rows", async () => {
  writeFileSync(
    LOG_FILE,
    [
      JSON.stringify({ ts: "2026-11-17T05:00:00.000Z", sessionID: "ses_one", verdict: "allow" }),
      JSON.stringify({ ts: "2026-11-17T05:01:00.000Z", sessionID: "ses_two", verdict: "deny" }),
    ].join("\n"),
  )
  const titles: Record<string, string> = { ses_one: "Work session" }
  const handlers = jevRpcHandlers({ sessionTitle: async (id) => titles[id] })
  const log = await (handlers as any).log({ limit: 10 })
  expect(log.rows).toHaveLength(2)
  const one = log.rows.find((r: any) => r.sessionID === "ses_one")
  const two = log.rows.find((r: any) => r.sessionID === "ses_two")
  expect(one.sessionTitle).toBe("Work session")
  expect(two.sessionTitle).toBeUndefined()
})

test("setFeature rejects an unknown key", async () => {
  const handlers = jevRpcHandlers()
  setJevEmitter(undefined)
  const result = await (handlers as any).setFeature({ key: "not_a_feature", on: true })
  expect(result.ok).toBe(false)
})

test("approve and reject act only on a matching pending call", async () => {
  const { recordApproval } = await import("../../../lib/lib-jev/approve.ts")
  const token = "abc123"
  const approval = {
    token,
    sessionID: "ses_test",
    action: "shell",
    resources: ["echo hi"],
    subject: "shell: echo hi",
    reason: "model wants a human",
    ts: new Date().toISOString(),
  }
  recordApproval(approval, 600)
  const handlers = jevRpcHandlers()
  setJevEmitter(undefined)
  expect((await (handlers as any).approvals()).approvals.some((a: any) => a.token === token)).toBe(true)
  // Wrong session cannot approve.
  expect((await (handlers as any).approve({ token, sessionID: "other" })).ok).toBe(false)
  expect((await (handlers as any).approve({ token, sessionID: "ses_test" })).ok).toBe(true)
  const { readGrants } = await import("../../../lib/lib-jev/approve.ts")
  expect(token in readGrants()).toBe(true)
  // A rejected token is gone from the pending list.
  expect((await (handlers as any).reject({ token })).ok).toBe(true)
  expect((await (handlers as any).approvals()).approvals.some((a: any) => a.token === token)).toBe(false)
})

test("status and log handlers agree with the direct projections", async () => {
  const handlers = jevRpcHandlers()
  setJevEmitter(undefined)
  const status = await (handlers as any).status()
  expect(status.enabled).toBe(statusSnapshot().enabled)
  const log = await (handlers as any).log({ limit: 5 })
  expect(Array.isArray(log.rows)).toBe(true)
})

test("approveAll grants every pending call with its own session and emits one change", async () => {
  rmSync(APPROVALS_FILE, { force: true })
  const { recordApproval, readGrants, rejectApproval } = await import("../../../lib/lib-jev/approve.ts")
  const ts = new Date().toISOString()
  recordApproval(
    { token: "bulk_ok_a", sessionID: "ses_a", action: "shell", resources: ["echo a"], subject: "shell: echo a", reason: "human", ts },
    600,
  )
  recordApproval(
    { token: "bulk_ok_b", sessionID: "ses_b", action: "webfetch", resources: ["https://example.com"], subject: "webfetch: example.com", reason: "human", ts },
    600,
  )
  const reasons: string[] = []
  setJevEmitter((event) => reasons.push(event.reason))
  const handlers = jevRpcHandlers()
  const result = await (handlers as any).approveAll({})
  expect(result.ok).toBe(true)
  expect(result.count).toBe(2)
  const grants = readGrants()
  expect(grants.bulk_ok_a?.sessionID).toBe("ses_a")
  expect(grants.bulk_ok_b?.sessionID).toBe("ses_b")
  expect(reasons.filter((reason) => reason === "approveAll")).toHaveLength(1)
  rejectApproval("bulk_ok_a")
  rejectApproval("bulk_ok_b")
})

test("rejectAll drops every pending call and emits one change", async () => {
  rmSync(APPROVALS_FILE, { force: true })
  const { recordApproval } = await import("../../../lib/lib-jev/approve.ts")
  const ts = new Date().toISOString()
  recordApproval(
    { token: "bulk_no_a", sessionID: "ses_a", action: "shell", resources: ["echo a"], subject: "shell: echo a", reason: "human", ts },
    600,
  )
  recordApproval(
    { token: "bulk_no_b", sessionID: "ses_b", action: "webfetch", resources: ["https://example.com"], subject: "webfetch: example.com", reason: "human", ts },
    600,
  )
  const reasons: string[] = []
  setJevEmitter((event) => reasons.push(event.reason))
  const handlers = jevRpcHandlers()
  const result = await (handlers as any).rejectAll({})
  expect(result.ok).toBe(true)
  expect(result.count).toBe(2)
  const tokens = (await (handlers as any).approvals()).approvals.map((item: any) => item.token)
  expect(tokens).not.toContain("bulk_no_a")
  expect(tokens).not.toContain("bulk_no_b")
  expect(reasons.filter((reason) => reason === "rejectAll")).toHaveLength(1)
})

test("a successful log write emits a changed event with reason log to RPC emitters", async () => {
  const reasons: string[] = []
  setJevEmitter((event) => reasons.push(event.reason))
  logCall({ hook: "hook_tool_risk", event: "pre_tool", verdict: "allow", sessionID: "ses_log_event", detail: "shell: echo hi" })
  expect(reasons).toContain("log")
})
