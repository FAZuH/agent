import { expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const scratch = mkdtempSync(join(tmpdir(), "jev-gui-rpc-"))
process.env.JEV_DATA_DIR = scratch
process.env.JEV_SECRET_DIR = join(scratch, "secrets")

const { jevRpcHandlers, logRows, setJevEmitter, statusSnapshot } = await import("./gui-rpc.ts")
const { STATE_FILE, LOG_FILE, APPROVALS_FILE, logCall } = await import("../../../lib/jev/state.ts")

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
  const { recordApproval } = await import("../../../lib/jev/approve.ts")
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
  const { readGrants } = await import("../../../lib/jev/approve.ts")
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
  const { recordApproval, readGrants, rejectApproval } = await import("../../../lib/jev/approve.ts")
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
  const { recordApproval } = await import("../../../lib/jev/approve.ts")
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

test("logRows exposes the new audit fields but never a call payload", () => {
  writeFileSync(
    LOG_FILE,
    JSON.stringify({
      ts: "2026-11-19T05:00:00.000Z",
      event: "supervisor_abort",
      rawVerdict: "deny",
      decisionNote: "api_key=[redacted] destructive rm",
      sent: "TOP-SECRET-PAYLOAD",
    }),
  )
  const row = logRows(10)[0] as any
  expect(row.rawVerdict).toBe("deny")
  expect(row.decisionNote).toBe("api_key=[redacted] destructive rm")
  expect("sent" in row).toBe(false)
})

test("liftTool ban clears the tool ban and the session ban", async () => {
  const cleared: string[] = []
  const handlers = jevRpcHandlers({
    liftToolBan: async () => 2,
    clearSessionBan: (sessionID) => { cleared.push(sessionID); return "cleared" },
  })
  const result = await (handlers as any).liftToolBan({ sessionID: "ses_batch_01" })
  expect(result).toEqual({ ok: true, count: 2 })
  expect(cleared).toEqual(["ses_batch_01"])
})

test("liftTool banAndResume clears both bans then resumes once with the Continue text", async () => {
  const order: string[] = []
  const resumed: string[] = []
  const handlers = jevRpcHandlers({
    liftToolBan: async () => 1,
    clearSessionBan: () => { order.push("clearSessionBan"); return "cleared" },
    resumeSession: async (sessionID, text) => { order.push("resumeSession"); resumed.push(`${sessionID}|${text}`) },
  })
  const result = await (handlers as any).liftToolBanAndResume({ sessionID: "ses_batch_02" })
  expect(result).toEqual({ ok: true, count: 1 })
  expect(order).toEqual(["clearSessionBan", "resumeSession"])
  expect(resumed).toEqual(["ses_batch_02|Continue the interrupted task."])
})

test("liftToolBanAndResume still clears both bans when no resume dep is wired", async () => {
  const cleared: string[] = []
  const handlers = jevRpcHandlers({
    liftToolBan: async () => 1,
    clearSessionBan: (sessionID) => { cleared.push(sessionID); return "cleared" },
  })
  const result = await (handlers as any).liftToolBanAndResume({ sessionID: "ses_no_resume" })
  expect(result).toEqual({ ok: true, count: 1 })
  expect(cleared).toEqual(["ses_no_resume"])
})

test("an abort operation reports coverage, durability and incompleteness separately", async () => {
  const handlers = jevRpcHandlers({
    enforcedBy: () => ["chain", "cards"],
    abortSession: async () => ({
      ok: true,
      sealed: false,
      durable: true,
      receipt: false,
      ban: { written: 1, failed: 1 },
      operation: { id: "op_rpc1", scope: ["ses_rpc_root", "ses_rpc_child"] },
      incomplete: [
        { step: "scope", status: "failed", detail: "the session listing failed" },
        { step: "receipt", status: "failed", detail: "the receipt write failed" },
      ],
    }),
  })
  const result = await (handlers as any).abortOperation({ sessionID: "ses_rpc_root" })
  // No single flag stands for "contained": each one says what actually held.
  expect(result).toEqual({
    ok: true,
    sealed: false,
    durable: true,
    receipt: false,
    ban: { written: 1, failed: 1 },
    operationID: "op_rpc1",
    scope: ["ses_rpc_root", "ses_rpc_child"],
    incomplete: [
      { step: "scope", status: "failed", detail: "the session listing failed" },
      { step: "receipt", status: "failed", detail: "the receipt write failed" },
    ],
    outcome: "known",
    enforcedBy: ["chain", "cards"],
  })
})

test("an abort with every admission path off names that nothing enforces it", async () => {
  const handlers = jevRpcHandlers({
    enforcedBy: () => [],
    abortSession: async () => ({
      ok: true,
      sealed: true,
      durable: true,
      receipt: true,
      ban: { written: 1, failed: 0 },
      operation: { id: "op_rpc_off", scope: ["ses_rpc_off"] },
      incomplete: [],
    }),
  })
  const result = await (handlers as any).abortOperation({ sessionID: "ses_rpc_off" })
  // Sealed stays factual about the record; the posture says nobody reads it.
  expect(result.sealed).toBe(true)
  expect(result.enforcedBy).toEqual([])
  expect(result.warning).toContain("not enforced")
})

test("an active surface is listed and carries no warning", async () => {
  const handlers = jevRpcHandlers({
    enforcedBy: () => ["chain"],
    abortSession: async () => ({
      ok: true,
      sealed: true,
      durable: true,
      receipt: true,
      ban: { written: 1, failed: 0 },
      operation: { id: "op_rpc_on", scope: ["ses_rpc_on"] },
      incomplete: [],
    }),
  })
  const result = await (handlers as any).abortOperation({ sessionID: "ses_rpc_on" })
  expect(result.enforcedBy).toEqual(["chain"])
  expect(result.warning).toBeUndefined()
})

test("the posture is sampled after the operation, so a mid-abort change is what the answer reports", async () => {
  let posture = ["chain"]
  const handlers = jevRpcHandlers({
    enforcedBy: () => posture,
    abortSession: async () => {
      // The gate file is removed while the abort runs: by the time it answers,
      // nothing consults the ban any more.
      posture = []
      return {
        ok: true,
        sealed: true,
        durable: true,
        receipt: true,
        ban: { written: 1, failed: 0 },
        operation: { id: "op_rpc_flip", scope: ["ses_rpc_flip"] },
        incomplete: [],
      }
    },
  })
  const result = await (handlers as any).abortOperation({ sessionID: "ses_rpc_flip" })
  expect(result.enforcedBy).toEqual([])
  expect(result.warning).toContain("not enforced")
})

test("the panel's stop is the unified operation and reports a failed discovery, never a clean success", async () => {
  const handlers = jevRpcHandlers({
    enforcedBy: () => ["chain"],
    abortSession: async () => ({
      ok: true,
      sealed: false,
      durable: true,
      receipt: true,
      ban: { written: 1, failed: 0 },
      operation: { id: "op_rpc_stop", scope: ["ses_rpc_stop"] },
      incomplete: [{ step: "scope", status: "failed", detail: "the session listing failed" }],
    }),
  })
  const result = await (handlers as any).stopSession({ sessionID: "ses_rpc_stop" })
  // The stop no longer answers from a swallowed helper: the rows are the report.
  expect(result.ok).toBe(true)
  expect(result.operationID).toBe("op_rpc_stop")
  expect(result.sealed).toBe(false)
  expect(result.incomplete).toEqual([{ step: "scope", status: "failed", detail: "the session listing failed" }])
})

test("an abort that throws reports its outcome as unknown, never as a clean negative", async () => {
  const handlers = jevRpcHandlers({
    abortSession: async () => {
      throw new Error("the host vanished")
    },
  })
  const result = await (handlers as any).abortOperation({ sessionID: "ses_rpc_throw" })
  expect(result.ok).toBe(false)
  // The operation may have written identity or a ban before it threw, so the
  // flags and counts are placeholders and the answer says so.
  expect(result.outcome).toBe("unknown")
  expect(result.error).toContain("cannot be verified")
  expect(result.error).toContain("identity")
  // The host's own message never travels.
  expect(JSON.stringify(result)).not.toContain("vanished")
})

test("an abort with no session or no route says nothing ran", async () => {
  const handlers = jevRpcHandlers({})
  const result = await (handlers as any).abortOperation({ sessionID: "ses_rpc_none" })
  expect(result.outcome).toBe("none")
  expect(result.ok).toBe(false)
  // Nothing ran, so no ban exists to enforce and no warning is owed.
  expect(result.enforcedBy).toEqual([])
  expect(result.warning).toBeUndefined()
})

test("an unreadable operation store is reported, never an empty list", async () => {
  const { abortFile } = await import("./abort.ts")
  writeFileSync(abortFile(), "{ not json")
  const handlers = jevRpcHandlers({})
  const result = await (handlers as any).abortOperations({})
  expect(result.ok).toBe(false)
  expect(result.reason).toBe("corrupt")
  expect(result.operations).toEqual([])
})

test("a durable abort ban makes the lift a reported refusal, not a success", async () => {
  const resumed: string[] = []
  let toolLifts = 0
  const handlers = jevRpcHandlers({
    liftToolBan: async () => {
      toolLifts++
      return 1
    },
    clearSessionBan: () => "refused",
    resumeSession: async (sessionID, text) => resumed.push(`${sessionID}|${text}`),
  })
  const lifted = await (handlers as any).liftToolBan({ sessionID: "ses_lift_refused" })
  expect(lifted.ok).toBe(false)
  // Nothing was lifted: the tool ban stays because the ban state is not clear.
  expect(lifted.count).toBe(0)
  // The error states the restriction and this version's limitation: the release
  // operation it used to name does not exist, so it must not direct anyone to it.
  expect(lifted.error).toContain("a durable abort ban is in place")
  expect(lifted.error).toContain("no operation that releases it")
  expect(lifted.error).not.toContain("#16")
  expect(lifted.error).not.toContain("clears it")

  // The resume route refuses too, and sends no continuation on top of the ban.
  const resumedResult = await (handlers as any).liftToolBanAndResume({ sessionID: "ses_lift_refused" })
  expect(resumedResult.ok).toBe(false)
  expect(resumed).toEqual([])
  expect(toolLifts).toBe(0)
})

test("an unreadable session ban store refuses the lift and names the read failure", async () => {
  const resumed: string[] = []
  let toolLifts = 0
  const handlers = jevRpcHandlers({
    liftToolBan: async () => {
      toolLifts++
      return 0
    },
    clearSessionBan: () => "unreadable",
    resumeSession: async (sessionID, text) => resumed.push(`${sessionID}|${text}`),
  })
  const result = await (handlers as any).liftToolBanAndResume({ sessionID: "ses_lift_unreadable" })
  expect(result.ok).toBe(false)
  expect(result.count).toBe(0)
  expect(result.error).toContain("cannot be read")
  expect(resumed).toEqual([])
  // An unreadable state lifts nothing at all: the tool ban is still there.
  expect(toolLifts).toBe(0)
})

test("a session-ban host that is off reports unknown, and nothing is lifted or resumed", async () => {
  const resumed: string[] = []
  let toolLifts = 0
  const handlers = jevRpcHandlers({
    liftToolBan: async () => {
      toolLifts++
      return 2
    },
    clearSessionBan: () => "unknown",
    resumeSession: async (sessionID, text) => resumed.push(`${sessionID}|${text}`),
  })
  const lifted = await (handlers as any).liftToolBan({ sessionID: "ses_lift_unknown" })
  expect(lifted.ok).toBe(false)
  expect(lifted.count).toBe(0)
  expect(lifted.error).toContain("not available")
  // Not `absent`: an off host proves nothing about the ban, so no tool ban goes.
  expect(toolLifts).toBe(0)
  const resumedResult = await (handlers as any).liftToolBanAndResume({ sessionID: "ses_lift_unknown" })
  expect(resumedResult.ok).toBe(false)
  expect(resumed).toEqual([])
})

test("an abort landing between the lift and the send suppresses the continuation", async () => {
  const resumed: string[] = []
  let lifts = 0
  const handlers = jevRpcHandlers({
    liftToolBan: async () => {
      lifts++
      return 1
    },
    clearSessionBan: () => "cleared",
    // The check is taken after the lift, which is where a concurrent abort lands.
    sessionBlocked: () => lifts > 0,
    resumeSession: async (sessionID, text) => resumed.push(`${sessionID}|${text}`),
  })
  const result = await (handlers as any).liftToolBanAndResume({ sessionID: "ses_lift_raced" })
  expect(result.ok).toBe(false)
  expect(result.error).toContain("an abort covers this session")
  expect(resumed).toEqual([])
})

test("an abort queued during the awaited check still suppresses the continuation", async () => {
  const resumed: string[] = []
  let marked = false
  const handlers = jevRpcHandlers({
    liftToolBan: async () => 1,
    clearSessionBan: () => "cleared",
    // The heavier read yields; the queued microtask is the abort marking its own
    // session in that gap, before the RPC resumes.
    sessionBlocked: async () => {
      queueMicrotask(() => {
        marked = true
      })
      return false
    },
    sessionBlockedNow: () => marked,
    resumeSession: async (sessionID, text) => resumed.push(`${sessionID}|${text}`),
  })
  const result = await (handlers as any).liftToolBanAndResume({ sessionID: "ses_lift_queued" })
  expect(result.ok).toBe(false)
  expect(result.error).toContain("an abort covers this session")
  expect(resumed).toEqual([])
})

test("a session with no ban lifts cleanly", async () => {
  const handlers = jevRpcHandlers({ liftToolBan: async () => 0, clearSessionBan: () => "absent" })
  expect(await (handlers as any).liftToolBan({ sessionID: "ses_lift_absent" })).toEqual({ ok: true, count: 0 })
})
