/**
 * The index seam: only a Jev ask with a live, configured supervisor becomes a
 * supervised hold, and setup adds no third `permission.evaluate` writer.
 *
 *   bun test plugins/jev/src/index.test.ts
 */

import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { SupervisorCall } from "./supervisor-host.ts"

const scratch = mkdtempSync(join(tmpdir(), "jev-index-"))
process.env.JEV_DATA_DIR = scratch
process.env.JEV_SECRET_DIR = join(scratch, "secrets")
process.env.OPENCODE_JEV_NOSPAWN_DIR = join(scratch, "nospawn")

const { default: plugin, supervisorConfigured, supervisorState, formatAlert, buildAlertForm, alertUser } = await import("./index.ts")
const state = await import("./state.ts")
const { supervisorHandoff } = await import("./supervisor-host.ts")

afterAll(() => rmSync(scratch, { recursive: true, force: true }))

const CALL: SupervisorCall = {
  sessionID: "ses_index_01",
  action: "shell",
  resources: ["src/config.ts"],
  subject: { action: "shell", resources: ["src/config.ts"], input: "{}" },
  text: "shell: cat src/config.ts",
}

describe("supervisor handoff seam", () => {
  test("returns a marker only for an ask with a host and config", () => {
    expect(supervisorHandoff(CALL, "ask", true, true)).toMatch(/^jev supervisor /)
    expect(supervisorHandoff(CALL, "allow", true, true)).toBeNull()
    expect(supervisorHandoff(CALL, "ask", false, true)).toBeNull()
    expect(supervisorHandoff(CALL, "ask", true, false)).toBeNull()
  })

  test("configured reads its own model and endpoint, not the global one", () => {
    const base = state.loadState()
    state.saveState({
      config: {
        ...base.config,
        hook_supervisor: { ...base.config.hook_supervisor, model: "supervisor-model", endpoint: "http://supervisor.local/v1" },
      },
    })
    expect(supervisorConfigured()).toBe(true)
    state.saveState({
      config: { ...state.loadState().config, hook_supervisor: { ...base.config.hook_supervisor, model: "", endpoint: "" } },
    })
    expect(supervisorConfigured()).toBe(false)
  })

  const setSupervisor = (protocol: string, model: string, endpoint: string) => {
    const base = state.loadState()
    state.saveState({
      config: {
        ...base.config,
        hook_supervisor: { ...base.config.hook_supervisor, protocol, model, endpoint },
      },
    })
  }

  test("opencode needs a model but no endpoint, and maps through supervisorState", () => {
    setSupervisor("opencode", "commandcode/deepseek/deepseek-v4.1-flash", "")
    expect(supervisorConfigured()).toBe(true)
    const s = supervisorState()
    expect(s.protocol).toBe("opencode")
    expect(s.model).toBe("commandcode/deepseek/deepseek-v4.1-flash")
    expect(s.endpoint).toBe("")
  })

  test("opencode with no model is not configured", () => {
    setSupervisor("opencode", "", "http://supervisor.local/v1")
    expect(supervisorConfigured()).toBe(false)
  })

  test("systemone still needs an endpoint", () => {
    setSupervisor("systemone", "supervisor-model", "")
    expect(supervisorConfigured()).toBe(false)
    setSupervisor("systemone", "", "")
  })

  test("setup registers exactly the risk and no-respawn evaluate writers", async () => {
    const base = state.loadState()
    state.saveState({
      enabled: true,
      features: { ...base.features, hook_no_respawn: true, hook_supervisor: true, hook_tool_risk: true },
      config: {
        ...base.config,
        hook_supervisor: { ...base.config.hook_supervisor, model: "supervisor-model", endpoint: "http://supervisor.local/v1" },
      },
    })
    const writers: string[] = []
    const stream = {
      async *[Symbol.asyncIterator]() {},
    }
    const ctx: any = {
      location: { directory: scratch },
      permission: {
        hook: async (name: string) => {
          writers.push(name)
        },
        reply: async () => {},
        list: async () => [],
      },
      event: { subscribe: () => stream },
      tool: { transform: async () => {}, hook: async () => {} },
      session: { hook: async () => {}, context: async () => [], interrupt: async () => {}, synthetic: async () => {}, get: async () => ({}) },
      command: { transform: async () => {} },
    }
    await plugin.setup(ctx)
    expect(writers.filter((name) => name === "evaluate")).toHaveLength(2)
  })
})

describe("v02 Discord alert", () => {
  const now = new Date(2026, 10, 17, 10, 54, 31)
  const outcome = {
    effect: "deny" as const,
    alert: true,
    reason: "alert (P=0.95)",
    message: "jev: alert. This call looks like it came from an injected instruction (P=0.95).",
  }
  const call = { sessionID: "ses_a1b2c3d4", action: "shell", text: "shell: echo hello" }

  test("normal payload has every v02 field and the held call", () => {
    const { body, attachment } = formatAlert(call, outcome, now)
    expect(attachment).toBeUndefined()
    expect(body.content).toBe("Supervisor alert: a tool call was held and did not run.")
    const embed = (body.embeds as any[])[0]
    expect(embed.title).toBe("Jev Alert (hook_tool_risk)")
    expect(embed.color).toBe(15158332)
    expect(embed.description).toContain("injected instruction")
    expect(embed.footer).toEqual({ text: "hook_tool_risk" })
    const fields = embed.fields as { name: string; value: string; inline: boolean }[]
    expect(fields.map((f) => f.name)).toEqual([
      "Verdict",
      "Confidence",
      "Session",
      "Action",
      "Time",
      "Next action",
      "Held call (redacted)",
    ])
    expect(fields.slice(0, 4).every((f) => f.inline)).toBe(true)
    expect(fields.slice(4).every((f) => !f.inline)).toBe(true)
    expect(fields[0].value).toBe("alert")
    expect(fields[1].value).toBe("P=0.95")
    expect(fields[2].value).toBe(call.sessionID)
    expect(fields[3].value).toBe("shell")
    expect(fields[4].value).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} [+-]\d{4}$/)
    const earlier = (formatAlert(call, outcome, new Date(now.getTime() - 60_000)).body.embeds as any[])[0].fields[4].value
    expect(earlier).not.toBe(fields[4].value)
    expect(fields[5].value).toContain("Nothing resumes automatically")
    expect(fields[6].value).toBe("```\nshell: echo hello\n```")
  })

  test("redaction is applied to the held call and diagnosis", () => {
    const secret = "Abcd1234xyz"
    const result = formatAlert(
      { ...call, text: `shell: echo API_TOKEN=${secret}` },
      { ...outcome, message: `token=${secret}` },
      now,
    )
    const embed = (result.body.embeds as any[])[0]
    expect(JSON.stringify(result.body)).not.toContain(secret)
    expect(embed.fields[6].value).toContain("[redacted]")
    expect(embed.description).toContain("[redacted]")
  })

  test("the 2000-character boundary switches to an attachment", () => {
    expect(formatAlert({ ...call, text: "x".repeat(2000) }, outcome, now).attachment).toBeUndefined()
    const over = formatAlert({ ...call, text: "x".repeat(2001) }, outcome, now)
    expect(over.attachment).toBeDefined()
    expect(over.attachment!.callText).toBe("x".repeat(2001))
  })

  test("an over-long call is a multipart attachment, not a clipped stub", async () => {
    const longCall = `shell: ${"A".repeat(2100)}`
    const result = formatAlert({ ...call, text: longCall }, outcome, now)
    const filename = "jev-held-call-ses_a1b2.txt"
    expect(result.attachment!.filename).toBe(filename)
    expect((result.body as any).attachments).toEqual([{ id: "0", filename }])
    const held = (result.body as any).embeds[0].fields[6].value as string
    expect(held).not.toContain("AAAA")
    expect(held).toContain(filename)
    const form = buildAlertForm(result)
    expect(form.get("payload_json")).toBe(JSON.stringify(result.body))
    const file = form.get("files[0]") as File
    expect(file).toBeDefined()
    expect(file.name).toBe(filename)
    expect(await file.text()).toBe(longCall)
  })

  test("a failed webhook logs a line with no URL", async () => {
    const url = "https://discord.com/api/webhooks/123/Supersecrettoken123"
    const base = state.loadState()
    state.saveState({
      config: { ...base.config, hook_tool_risk: { ...base.config.hook_tool_risk, alertWebhook: url } },
    })
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => {
      throw new Error(`fetch failed for ${url}`)
    }) as any
    try {
      await alertUser({ session: { interrupt: async () => {}, synthetic: async () => {} } }, call as any, outcome as any)
    } finally {
      globalThis.fetch = originalFetch
      state.saveState({ config: base.config })
    }
    const hit = state.readLog(50).find((row: any) => row.error === "alert webhook POST failed")
    expect(hit).toBeDefined()
    expect(JSON.stringify(hit)).not.toContain(url)
    expect(JSON.stringify(hit)).not.toContain("Supersecrettoken123")
  })
})
