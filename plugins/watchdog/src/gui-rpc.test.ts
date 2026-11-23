import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"

const scratch = mkdtempSync(join(tmpdir(), "jev-gui-rpc-"))
process.env.JEV_DATA_DIR = scratch
process.env.JEV_SECRET_DIR = join(scratch, "secrets")

const { jevRpcHandlers, logRows, pendingReviewsForKey, setJevEmitter, statusSnapshot } = await import("./gui-rpc.ts")
const { STATE_FILE, LOG_FILE, APPROVALS_FILE, GRANTS_FILE, DATA_FILE, logCall } = await import("../../../lib/jev/state.ts")
const { CHAIN_BUDGET_FILE, chainStateHome } = await import("./chain.ts")

/**
 * The operator's live state home. A desktop session exports
 * `XDG_STATE_HOME=$HOME/.local/state`, so the default XDG path *is* the live
 * home: a redirect naming it is refused like no redirect at all.
 */
const LIVE_STATE_HOME = join(homedir(), ".local", "state", "opencode", "jev")

/** The run's temporary root, normalized: an XDG state home must sit under it. */
const TEMPORARY = tmpdir().replace(/\/+$/, "")

/** The state home `XDG_STATE_HOME` names, if this run exported one. */
const XDG_HOME = process.env.XDG_STATE_HOME ? join(process.env.XDG_STATE_HOME, "opencode", "jev") : null

/**
 * The state homes this run redirected to, as far as this file can still see
 * them. `state.ts` fixes its paths at first import, so a run that imports it
 * before this file redirects hands the fixtures below that home; with no redirect
 * at all it hands them the operator's live home, which is never admitted. A write
 * path is therefore allowed only inside this file's scratch or a home whose env
 * this file still sees at load.
 *
 * That is narrower than "a home this run redirected to": an env a previous file
 * set and then deleted is refused, because `state.ts` stays fixed on the path it
 * resolved while this file can no longer see it. Refusing is the safe direction,
 * a false failure instead of a live write, so the check is deliberately not
 * widened to cover it.
 */
const RUN_HOMES = [
  process.env.OPENCODE_JEV_STATE_HOME,
  process.env.JEV_STATE_HOME,
  process.env.JEV_DATA_HOME,
  process.env.JEV_DATA_DIR,
  // `state.ts` nests the state home under XDG, and so does `chainStateHome()`.
  // That value is admitted only under the temporary root: anywhere else it may
  // name a real state directory (this host exports `$HOME/.local/state`, which
  // is the live home).
  ...(XDG_HOME && XDG_HOME.startsWith(`${TEMPORARY}/`) ? [XDG_HOME] : []),
].filter((home): home is string => typeof home === "string" && home.length > 0 && home !== LIVE_STATE_HOME)

function guard(path: string): string {
  const allowed = [scratch, ...RUN_HOMES].some((home) => path === home || path.startsWith(`${home}/`))
  if (!allowed) throw new Error(`refusing to write outside this run's scratch: ${path}`)
  return path
}

// Measured on bun 1.4.3, three runs each, argv order honoured:
//   bun test ./plugins/watchdog/src/chain.test.ts ./plugins/watchdog/src/gui-rpc.test.ts
//     -> red by design: `chain.test.ts` imports `state.ts` first with no redirect,
//        so this file inherits the operator's live homes and throws on the path
//        below before any test body runs. It must never be made green while that
//        file loads first; set the JEV homes (or put this file first) instead.
//   bun test ./plugins/watchdog/src/gui-rpc.test.ts ./plugins/watchdog/src/chain.test.ts
//     -> green: this file redirects first, so every write lands in its scratch.
// `chainStateHome()` is read per call, not fixed at import, so it is guarded
// beside the fixed files: a hook that mutates the env can move the ledger home
// while the fixed paths stay put.
for (const path of [STATE_FILE, LOG_FILE, APPROVALS_FILE, GRANTS_FILE, DATA_FILE]) guard(path)
guard(chainStateHome())

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
  // The error states the restriction and the one action that can lift it: the
  // release of the operation that wrote the ban, not this switch.
  expect(lifted.error).toContain("a durable abort ban is in place")
  expect(lifted.error).toContain("only that operation's release can lift it")
  expect(lifted.error).not.toContain("no operation that releases it")
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

test("the release answer is the operation's own receipt plus the live posture", async () => {
  const reasons: string[] = []
  setJevEmitter((event) => reasons.push(event.reason))
  const handlers = jevRpcHandlers({
    enforcedBy: () => ["chain", "cards"],
    releaseOperation: async () => ({
      ok: true,
      durable: true,
      receipt: true,
      already: false,
      ban: { cleared: 1, kept: 1, failed: 0 },
      covered: ["ses_rpc_rel_child"],
      continued: "sent",
      incomplete: [],
    }),
  })
  const result = await (handlers as any).releaseOperation({ operationID: "op_rpc_rel", continue: true })
  expect(result).toEqual({
    ok: true,
    durable: true,
    receipt: true,
    already: false,
    operationID: "op_rpc_rel",
    ban: { cleared: 1, kept: 1, failed: 0 },
    covered: ["ses_rpc_rel_child"],
    continued: "sent",
    incomplete: [],
    enforcedBy: ["chain", "cards"],
  })
  // The panel refreshes off the same event the release emits.
  expect(reasons).toContain("releaseOperation op_rpc_rel")
  setJevEmitter(undefined)
})

test("a release with no route or no id says nothing ran", async () => {
  const noRoute = jevRpcHandlers({})
  const refused = await (noRoute as any).releaseOperation({ operationID: "op_rpc_no_route", continue: true })
  expect(refused.ok).toBe(false)
  expect(refused.reason).toContain("no release operation is available")
  expect(refused.continued).toBe("prevented")

  const handlers = jevRpcHandlers({
    releaseOperation: async () => ({
      ok: true,
      durable: true,
      receipt: true,
      already: false,
      ban: { cleared: 0, kept: 0, failed: 0 },
      covered: [],
      continued: "not-requested",
      incomplete: [],
    }),
  })
  const noId = await (handlers as any).releaseOperation({ operationID: "", continue: false })
  expect(noId.ok).toBe(false)
  expect(noId.reason).toContain("no abort operation was named")
  expect(noId.continued).toBe("not-requested")
  expect(noId.enforcedBy).toEqual([])
})

test("a release that throws reports its state as unverifiable, never a clean negative", async () => {
  const handlers = jevRpcHandlers({
    releaseOperation: async () => {
      throw new Error("the host vanished")
    },
  })
  const result = await (handlers as any).releaseOperation({ operationID: "op_rpc_rel_throw", continue: true })
  expect(result.ok).toBe(false)
  // The release may have landed before the throw: the answer claims nothing.
  expect(result.reason).toContain("cannot be verified")
  expect(result.continued).toBe("prevented")
  expect(JSON.stringify(result)).not.toContain("vanished")
})

test("the operations list carries a release and its continuation", async () => {
  const { abortFile } = await import("./abort.ts")
  writeFileSync(
    abortFile(),
    JSON.stringify({
      v: 1,
      operations: [
        {
          operation: { id: "op_rows_live", sessionID: "ses_rows_live", scope: ["ses_rows_live"], source: "human", cause: "operator abort", at: 5 },
          containment: [{ step: "receipt", status: "done", detail: "the operation record carries this receipt" }],
        },
        {
          operation: { id: "op_rows_rel", sessionID: "ses_rows_rel", scope: ["ses_rows_rel"], source: "human", cause: "operator abort", at: 6, released: 7, continuedAt: 8 },
          containment: [{ step: "receipt", status: "done", detail: "the operation record carries this receipt" }],
        },
      ],
    }),
  )
  const handlers = jevRpcHandlers({})
  const result = await (handlers as any).abortOperations({})
  expect(result.ok).toBe(true)
  const released = result.operations.find((operation: any) => operation.id === "op_rows_rel")
  expect(released.released).toBe(7)
  expect(released.continuedAt).toBe(8)
  const live = result.operations.find((operation: any) => operation.id === "op_rows_live")
  expect(live.released).toBeUndefined()
  expect(live.continuedAt).toBeUndefined()
})

test("an unreadable delivery queue is its own state on the listing, never queued-absence", async () => {
  const { abortFile } = await import("./abort.ts")
  const { DELIVERY_FILE } = await import("./delivery.ts")
  writeFileSync(
    abortFile(),
    JSON.stringify({
      v: 1,
      operations: [
        {
          operation: { id: "op_rows_unreadable", sessionID: "ses_rows_unreadable", scope: ["ses_rows_unreadable"], source: "human", cause: "operator abort", at: 5 },
          containment: [{ step: "receipt", status: "done", detail: "the operation record carries this receipt" }],
        },
      ],
    }),
  )
  // A delivery file that cannot be parsed is unreadable, not an empty queue.
  writeFileSync(join(chainStateHome(), DELIVERY_FILE), "{ not json")
  const handlers = jevRpcHandlers({})
  const result = await (handlers as any).abortOperations({})
  expect(result.ok).toBe(true)
  expect(result.deliveryReadable).toBe(false)
  // No row invents a receipt status: the unreadable state is the listing's
  // own field, and a row without delivery stays absent rather than faked.
  expect(result.operations).toHaveLength(1)
  expect(result.operations[0].delivery).toBeUndefined()

  // A readable store with no row for this operation is honest absence: the
  // feature never queued it, and the listing says so by omission, not by
  // collapsing an error.
  rmSync(join(chainStateHome(), DELIVERY_FILE), { force: true })
  const again = await (handlers as any).abortOperations({})
  expect(again.deliveryReadable).toBe(true)
  expect(again.operations[0].delivery).toBeUndefined()
})

describe("watchdogStatus durable ledger honesty", () => {
  const ledgerPath = () => join(chainStateHome(), CHAIN_BUDGET_FILE)

  test("a missing ledger is zero pending, readable", async () => {
    rmSync(ledgerPath(), { force: true })
    const handlers = jevRpcHandlers({})
    const status = await (handlers as any).watchdogStatus({})
    expect(status.pending.durable).toBe(0)
    expect(status.pending.durableUnreadable).toBe(false)
  })

  test("a valid ledger counts its unresolved entries", async () => {
    writeFileSync(
      ledgerPath(),
      JSON.stringify({ sessions: { keyOne: [{ id: "wd_a" }, { id: "wd_b" }], keyTwo: [{ id: "wd_c" }] } }),
    )
    const handlers = jevRpcHandlers({})
    const status = await (handlers as any).watchdogStatus({})
    expect(status.pending.durable).toBe(3)
    expect(status.pending.durableUnreadable).toBe(false)
  })

  test("a corrupt ledger is reported unreadable, never as a silent zero", async () => {
    writeFileSync(ledgerPath(), "{not json")
    const handlers = jevRpcHandlers({})
    const status = await (handlers as any).watchdogStatus({})
    expect(status.pending.durableUnreadable).toBe(true)
  })

  test("a ledger that exists but cannot be opened is reported unreadable", async () => {
    // A directory where the file should be: every read fails with EISDIR,
    // which is an unreadable ledger, not a missing one.
    rmSync(ledgerPath(), { force: true })
    mkdirSync(ledgerPath(), { recursive: true })
    const handlers = jevRpcHandlers({})
    const status = await (handlers as any).watchdogStatus({})
    expect(status.pending.durableUnreadable).toBe(true)
    rmSync(ledgerPath(), { recursive: true, force: true })
  })
})

describe("watchdogStatus pending human reviews (#22)", () => {
  const ledgerPath = () => join(chainStateHome(), CHAIN_BUDGET_FILE)
  const key = (hex: string) => `sess_${hex.repeat(24).slice(0, 24)}`
  const live = (over: Record<string, unknown> = {}) => ({
    key: key("a"),
    id: "wd_live.1",
    sessionID: "ses_live",
    tool: "shell",
    action: "shell",
    stage: "human",
    at: 1000,
    reported: false,
    ...over,
  })

  test("no live review and no ledger is an empty list, readable", async () => {
    rmSync(ledgerPath(), { force: true })
    const handlers = jevRpcHandlers({})
    const status = await handlers.watchdogStatus({})
    expect(status.pending.reviews).toEqual([])
    expect(status.pending.durableUnreadable).toBe(false)
  })

  test("a live review and the ledger row for the same call are one row, and the live row wins", async () => {
    const k = key("a")
    writeFileSync(ledgerPath(), JSON.stringify({ sessions: { [k]: [{ id: "wd_live.1", stage: "human", tool: "shell", action: "shell", at: 1000 }] } }))
    const handlers = jevRpcHandlers({ pendingReviews: () => [live()] as any })
    const status = await handlers.watchdogStatus({})
    expect(status.pending.durable).toBe(1)
    expect(status.pending.reviews).toHaveLength(1)
    const row = status.pending.reviews[0]
    expect(row.sessionID).toBe("ses_live")
    expect(row.interrupted).toBe(false)
    expect(row.id).toBe("wd_live.1")
  })

  test("a ledger row a restart reported is interrupted, under the ledger's short key", async () => {
    const k = key("b")
    writeFileSync(ledgerPath(), JSON.stringify({ sessions: { [k]: [{ id: "wd_restored.1", stage: "human", tool: "shell", action: "shell", at: 500 }] } }))
    const handlers = jevRpcHandlers({ pendingReviews: () => [] })
    const status = await handlers.watchdogStatus({})
    expect(status.pending.reviews).toHaveLength(1)
    const row = status.pending.reviews[0]
    expect(row.interrupted).toBe(true)
    expect(row.sessionID).toBe(`${k.slice(0, 9)}…`)
    expect(row.tool).toBe("shell")
    expect(row.stage).toBe("human")
  })

  test("a ledger row still inside an automated stage counts, but is not a pending human review", async () => {
    const k = key("c")
    writeFileSync(
      ledgerPath(),
      JSON.stringify({
        sessions: { [k]: [{ id: "wd_jev.1", stage: "jev", tool: "shell", action: "shell" }, { id: "wd_human.1", stage: "human", tool: "shell", action: "shell" }] },
      }),
    )
    const handlers = jevRpcHandlers({ pendingReviews: () => [] })
    const status = await handlers.watchdogStatus({})
    expect(status.pending.durable).toBe(2)
    expect(status.pending.reviews).toHaveLength(1)
    expect(status.pending.reviews[0].id).toBe("wd_human.1")
  })

  test("an unreadable ledger still lists the live reviews and says unreadable, never empty", async () => {
    writeFileSync(ledgerPath(), "{not json")
    const handlers = jevRpcHandlers({ pendingReviews: () => [live()] as any })
    const status = await handlers.watchdogStatus({})
    expect(status.pending.durableUnreadable).toBe(true)
    expect(status.pending.reviews).toHaveLength(1)
    expect(status.pending.reviews[0].id).toBe("wd_live.1")
  })

  test("a row is the display fields and an age, and nothing of the call's input", async () => {
    rmSync(ledgerPath(), { force: true })
    const now = Date.now()
    const handlers = jevRpcHandlers({ pendingReviews: () => [live({ at: now - 5000 }), live({ id: "wd_live.2", at: null })] as any })
    const status = await handlers.watchdogStatus({})
    const rows = status.pending.reviews
    expect(rows.map((row) => Object.keys(row).sort())).toEqual([
      ["action", "ageMs", "id", "interrupted", "sessionID", "stage", "tool"],
      ["action", "ageMs", "id", "interrupted", "sessionID", "stage", "tool"],
    ])
    expect(rows[0].ageMs).toBeGreaterThanOrEqual(5000)
    expect(rows[1].ageMs).toBeNull()
  })
})

describe("pendingReviewsForKey (#22)", () => {
  const ledgerPath = () => join(chainStateHome(), CHAIN_BUDGET_FILE)
  const key = (hex: string) => `sess_${hex.repeat(24).slice(0, 24)}`

  test("one session's rows from both sources, and no other session's", async () => {
    const a = key("a")
    const b = key("b")
    writeFileSync(
      ledgerPath(),
      JSON.stringify({
        sessions: {
          [a]: [{ id: "wd_a.ledger", stage: "human", tool: "shell", action: "shell" }],
          [b]: [{ id: "wd_b.ledger", stage: "human", tool: "shell", action: "shell" }],
        },
      }),
    )
    const live = [{ key: a, id: "wd_a.live", sessionID: "ses_a", tool: "shell", action: "shell", stage: "human", at: 1000, reported: false }]
    const rows = pendingReviewsForKey(live as any, a)
    expect(rows.map((row) => row.id).sort()).toEqual(["wd_a.ledger", "wd_a.live"])
    // The key is not a page field: it exists to filter, never to render.
    expect(rows.every((row) => !("key" in row))).toBe(true)
  })

  test("a live row replaces its ledger twin for the same call", async () => {
    const a = key("d")
    writeFileSync(ledgerPath(), JSON.stringify({ sessions: { [a]: [{ id: "wd_d.1", stage: "human", tool: "shell", action: "shell" }] } }))
    const live = [{ key: a, id: "wd_d.1", sessionID: "ses_live", tool: "shell", action: "shell", stage: "human", at: 1000, reported: false }]
    const rows = pendingReviewsForKey(live as any, a)
    expect(rows).toHaveLength(1)
    expect(rows[0].sessionID).toBe("ses_live")
    expect(rows[0].interrupted).toBe(false)
  })
})

describe("reopenPendingReview (#22)", () => {
  test("a reopened review reports ok, and the runtime received the exact item", async () => {
    const seen: string[] = []
    const handlers = jevRpcHandlers({
      reopenReview: async (itemID: string) => {
        seen.push(itemID)
        return "reopened"
      },
    })
    expect(await (handlers as any).reopenPendingReview({ itemID: "wd_x.1" })).toEqual({ ok: true, reopened: true })
    expect(seen).toEqual(["wd_x.1"])
  })

  test("an interrupted review is refused with that reason, never as reopened", async () => {
    const handlers = jevRpcHandlers({ reopenReview: async () => "interrupted" })
    const result = await (handlers as any).reopenPendingReview({ itemID: "wd_x.1" })
    expect(result.ok).toBe(false)
    expect(result.reopened).toBe(false)
    expect(String(result.reason)).toContain("interrupted")
  })

  test("a review that is no longer pending is refused, and no id is refused as nothing to reopen", async () => {
    const gone = await (jevRpcHandlers({ reopenReview: async () => "not-pending" }) as any).reopenPendingReview({ itemID: "wd_x.1" })
    expect(gone.ok).toBe(false)
    expect(String(gone.reason)).toContain("no longer pending")
    const empty = await (jevRpcHandlers({}) as any).reopenPendingReview({})
    expect(empty.ok).toBe(false)
    expect(empty.reopened).toBe(false)
  })
})
