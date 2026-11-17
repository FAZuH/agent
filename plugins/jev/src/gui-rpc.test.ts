import { expect, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const scratch = mkdtempSync(join(tmpdir(), "jev-gui-rpc-"))
process.env.JEV_DATA_DIR = scratch
process.env.JEV_SECRET_DIR = join(scratch, "secrets")

const { jevRpcHandlers, logRows, setJevEmitter, statusSnapshot } = await import("./gui-rpc.ts")
const { STATE_FILE, LOG_FILE } = await import("./state.ts")

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
          trial: true,
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

test("setFeature rejects an unknown key", async () => {
  const handlers = jevRpcHandlers()
  setJevEmitter(undefined)
  const result = await (handlers as any).setFeature({ key: "not_a_feature", on: true })
  expect(result.ok).toBe(false)
})

test("approve and reject act only on a matching pending call", async () => {
  const { recordApproval } = await import("./approve.ts")
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
  const { readGrants } = await import("./approve.ts")
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
