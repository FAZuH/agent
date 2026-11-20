/** Behavior tests for the Settings snapshot and write-only secret handlers.
 *  Fails against pre-change source: jev-settings.ts does not exist. */
import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const scratch = mkdtempSync(join(tmpdir(), "jev-settings-"))
process.env.JEV_DATA_DIR = scratch
process.env.JEV_SECRET_DIR = join(scratch, "secrets")

const state = await import("../../../lib/jev/state.ts")
const { settingsSnapshot, applySetting, applySecret } = await import("./jev-settings.ts")

const KEY_VALUE = "sk-live-secret-DO-NOT-LOG"
const WEBHOOK_VALUE = "https://discord.com/api/webhooks/secretTOKEN123"
const ENDPOINT_WITH_CREDS = "https://user:pass@api.example.com/v1/hooktoken"

function freshState(): void {
  writeFileSync(
    state.STATE_FILE,
    JSON.stringify({
      endpoint: ENDPOINT_WITH_CREDS,
      model: "provider/model",
      protocol: "chat",
      keyFile: join(scratch, "key"),
      config: {
        hook_tool_risk: { alertWebhook: WEBHOOK_VALUE },
        hook_supervisor: { endpoint: ENDPOINT_WITH_CREDS },
      },
    }),
  )
}

describe("settingsSnapshot", () => {
  test("returns only allowlisted fields and never a secret value", () => {
    rmSync(state.STATE_FILE, { force: true })
    freshState()
    writeFileSync(join(scratch, "key"), `${KEY_VALUE}\n`)
    const snapshot: any = settingsSnapshot()
    expect(snapshot.protocol).toBe("chat")
    expect(snapshot.model).toBe("provider/model")
    expect(snapshot.endpoint).toBeUndefined()
    expect(snapshot.secrets.keyPresent).toBe(true)
    expect(snapshot.secrets.webhookPresent).toBe(true)
    expect(snapshot.secrets.supervisorEndpointPresent).toBe(true)
    expect(Object.values(snapshot.secrets).every((v) => typeof v === "boolean")).toBe(true)
    expect(snapshot.config.hook_tool_risk.alertWebhook).toBe("")
    expect(snapshot.config.hook_supervisor.endpoint).toBe("")
    expect(typeof snapshot.features.hook_tool_risk).toBe("boolean")
    const text = JSON.stringify(snapshot)
    expect(text).not.toContain(KEY_VALUE)
    expect(text).not.toContain(WEBHOOK_VALUE)
    expect(text).not.toContain("pass@")
    expect(text).not.toContain("hooktoken")
  })
})

describe("applySetting", () => {
  test("rejects an unknown state key without echoing the value", () => {
    const result = applySetting({ scope: "state", key: "notAKey", value: "secret-value-XYZ" })
    expect(result.ok).toBe(false)
    expect(result.error).toBeTruthy()
    expect(JSON.stringify(result)).not.toContain("secret-value-XYZ")
  })

  test("rejects a wrong type and an invalid enum for state scope", () => {
    expect(applySetting({ scope: "state", key: "think", value: "yes" }).ok).toBe(false)
    expect(applySetting({ scope: "state", key: "protocol", value: "bogus" }).ok).toBe(false)
    expect(applySetting({ scope: "state", key: "yoloAsk", value: "bogus" }).ok).toBe(false)
  })

  test("writes a valid state field including the write-only endpoint", () => {
    writeFileSync(state.STATE_FILE, JSON.stringify({ endpoint: "" }))
    expect((settingsSnapshot() as any).secrets.endpointPresent).toBe(false)
    expect(applySetting({ scope: "state", key: "model", value: "new/model" }).ok).toBe(true)
    expect(state.loadState().model).toBe("new/model")
    expect(applySetting({ scope: "state", key: "endpoint", value: ENDPOINT_WITH_CREDS }).ok).toBe(true)
    const snapshot: any = settingsSnapshot()
    expect(snapshot.secrets.endpointPresent).toBe(true)
    expect(JSON.stringify(snapshot)).not.toContain("hooktoken")
  })

  test("rejects unknown feature/key, wrong type, and the write-only webhook", () => {
    rmSync(state.STATE_FILE, { force: true })
    freshState()
    expect(applySetting({ scope: "feature", feature: "bogus", key: "timeout", value: 5 }).ok).toBe(false)
    expect(applySetting({ scope: "feature", feature: "hook_skill_pick", key: "bogus", value: 5 }).ok).toBe(false)
    expect(applySetting({ scope: "feature", feature: "hook_skill_pick", key: "timeout", value: "5" }).ok).toBe(false)
    expect(applySetting({ scope: "feature", feature: "hook_tool_risk", key: "alertWebhook", value: WEBHOOK_VALUE }).ok).toBe(false)
  })

  test("writes a valid feature field through setFeatureConfig", () => {
    rmSync(state.STATE_FILE, { force: true })
    freshState()
    expect(applySetting({ scope: "feature", feature: "hook_skill_pick", key: "timeout", value: 2500 }).ok).toBe(true)
    expect(state.loadState().config.hook_skill_pick?.timeout).toBe(2500)
  })
})

describe("applySecret", () => {
  test("writes the API key at 0600 and never returns or echoes the value", () => {
    rmSync(state.STATE_FILE, { force: true })
    const keyPath = join(scratch, "key")
    writeFileSync(state.STATE_FILE, JSON.stringify({ keyFile: keyPath }))
    const result = applySecret({ key: "apiKey", value: KEY_VALUE })
    expect(result.ok).toBe(true)
    expect(JSON.stringify(result)).not.toContain(KEY_VALUE)
    const written = state.loadState().keyFile
    expect(statSync(written).mode & 0o777).toBe(0o600)
    const snapshot: any = settingsSnapshot()
    expect(snapshot.secrets.keyPresent).toBe(true)
    expect(JSON.stringify(snapshot)).not.toContain(KEY_VALUE)
    expect(applySecret({ key: "apiKey", value: "   " }).ok).toBe(false)
  })

  test("stores the webhook server-side but never returns or renders its value", () => {
    rmSync(state.STATE_FILE, { force: true })
    freshState()
    const result = applySecret({ key: "alertWebhook", value: WEBHOOK_VALUE })
    expect(result.ok).toBe(true)
    expect(JSON.stringify(result)).not.toContain("secretTOKEN123")
    expect(state.loadState().config.hook_tool_risk?.alertWebhook).toBe(WEBHOOK_VALUE)
    const snapshot: any = settingsSnapshot()
    expect(snapshot.config.hook_tool_risk.alertWebhook).toBe("")
    expect(snapshot.secrets.webhookPresent).toBe(true)
    expect(JSON.stringify(snapshot)).not.toContain("secretTOKEN123")
    expect(applySecret({ key: "bogus", value: "x" }).ok).toBe(false)
  })
})

describe("settings RPC handlers", () => {
  test("expose the snapshot and emit settings only on successful mutations", async () => {
    writeFileSync(state.STATE_FILE, JSON.stringify({ endpoint: "" }))
    const { jevRpcHandlers, setJevEmitter } = await import("./gui-rpc.ts")
    const reasons: string[] = []
    setJevEmitter((event) => reasons.push(event.reason))
    const handlers = jevRpcHandlers()
    const snapshot: any = await (handlers as any).getSettings({})
    expect(snapshot.protocol).toBe("systemone")
    expect((await (handlers as any).setSetting({ scope: "state", key: "model", value: "rpc/model" })).ok).toBe(true)
    expect(state.loadState().model).toBe("rpc/model")
    expect((await (handlers as any).setSecret({ key: "alertWebhook", value: "https://x.example/token" })).ok).toBe(true)
    expect(state.loadState().config.hook_tool_risk?.alertWebhook).toBe("https://x.example/token")
    expect((await (handlers as any).setSetting({ scope: "state", key: "bogus", value: "x" })).ok).toBe(false)
    expect(reasons.filter((reason) => reason === "settings")).toHaveLength(2)
  })
})
