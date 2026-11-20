/**
 * The index seam: only a Jev propagate with a live, configured supervisor becomes a
 * supervised hold, and setup adds no third `permission.evaluate` writer.
 *
 *   bun test plugins/watchdog/src/index.test.ts
 */

import { afterAll, afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { SupervisorCall } from "./supervisor-host.ts"

const scratch = mkdtempSync(join(tmpdir(), "jev-index-"))
process.env.JEV_DATA_DIR = scratch
process.env.JEV_STATE_HOME = scratch
process.env.JEV_SECRET_DIR = join(scratch, "secrets")
process.env.OPENCODE_JEV_SESSION_BAN_DIR = join(scratch, "session-ban")

const { default: plugin, supervisorConfigured, supervisorState, formatAlert, buildAlertForm, alertUser, allResourcesTrusted, hostEffect } = await import("./index.ts")
const state = await import("../../../lib/lib-jev/state.ts")
const { supervisorHandoff } = await import("./supervisor-host.ts")
const { banTool, unbanTool } = await import("../../../lib/lib-jev/tool-ban.ts")
const { resetCardRoute, markCardRouteActive } = await import("./question-cards.ts")
const { jevRpcHandlers } = await import("./gui-rpc.ts")

afterAll(() => rmSync(scratch, { recursive: true, force: true }))

const CALL: SupervisorCall = {
  sessionID: "ses_index_01",
  action: "shell",
  resources: ["src/config.ts"],
  subject: { action: "shell", resources: ["src/config.ts"], input: "{}" },
  text: "shell: cat src/config.ts",
}

describe("supervisor handoff seam", () => {
  test("hands off every non-allow outcome, but only with a host and config", () => {
    expect(supervisorHandoff(CALL, "propagate", true, true)).toMatch(/^jev supervisor /)
    expect(supervisorHandoff(CALL, "deny", true, true)).toMatch(/^jev supervisor /)
    expect(supervisorHandoff(CALL, "abort", true, true)).toMatch(/^jev supervisor /)
    expect(supervisorHandoff(CALL, "allow", true, true)).toBeNull()
    expect(supervisorHandoff(CALL, "propagate", false, true)).toBeNull()
    expect(supervisorHandoff(CALL, "propagate", true, false)).toBeNull()
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

  const setBatchConfig = (patch: Record<string, state.ConfigValue>) => {
    const base = state.loadState()
    state.saveState({
      config: {
        ...base.config,
        hook_supervisor: { ...base.config.hook_supervisor, ...patch },
      },
    })
  }

  test("the four new config keys default to the current path", () => {
    expect(state.featureConfig("hook_supervisor").standalone).toBe(false)
    expect(state.featureConfig("hook_supervisor").nonBlocking).toBe(false)
    expect(state.featureConfig("hook_supervisor").batchMs).toBe(30000)
    expect(state.featureConfig("hook_supervisor").batchMax).toBe(10)
  })

  test("typed readers return stored mode and batch values", () => {
    setBatchConfig({ standalone: true, nonBlocking: true, batchMs: 250, batchMax: 3 })
    expect(state.supervisorStandalone()).toBe(true)
    expect(state.supervisorNonBlocking()).toBe(true)
    expect(state.supervisorBatchMs()).toBe(250)
    expect(state.supervisorBatchMax()).toBe(3)
    setBatchConfig({ standalone: false, nonBlocking: false, batchMs: 30000, batchMax: 10 })
  })

  test("typed readers reject wrong types and non-positive windows", () => {
    setBatchConfig({ standalone: 1 as any, nonBlocking: "yes" as any, batchMs: -5, batchMax: 0 })
    expect(state.supervisorStandalone()).toBe(true)
    expect(state.supervisorNonBlocking()).toBe(false)
    expect(state.supervisorBatchMs()).toBe(1)
    expect(state.supervisorBatchMax()).toBe(1)
    setBatchConfig({ standalone: false, nonBlocking: false, batchMs: 30000, batchMax: 10 })
  })

  test("flag ON: evaluate forces allow, never ask, no supervisor handoff", async () => {
    const base = state.loadState()
    state.saveState({
      enabled: true,
      features: { ...base.features, hook_tool_risk: true, hook_supervisor: true },
      config: {
        ...base.config,
        hook_tool_risk: { ...base.config.hook_tool_risk, questionCards: true, actions: "shell,edit" },
        hook_supervisor: { ...base.config.hook_supervisor, model: "supervisor-model", endpoint: "http://supervisor.local/v1" },
      },
    })
    let evaluate: any
    const ctx: any = {
      location: { directory: scratch },
      permission: { hook: async (name: string, cb: any) => { if (name === "evaluate") evaluate = cb }, reply: async () => {}, list: async () => [] },
      event: { subscribe: () => ({ async *[Symbol.asyncIterator]() {} }) },
      tool: { transform: async () => {}, hook: async () => {} },
      session: { hook: async () => {}, context: async () => [], interrupt: async () => {}, synthetic: async () => {}, get: async () => ({}) },
      command: { transform: async () => {} },
    }
    await plugin.setup(ctx)
    const event: any = { action: "shell", sessionID: "ses_flag", resources: ["src/x.ts"], effect: "ask" }
    await evaluate(event)
    expect(event.effect).toBe("allow")
    const base2 = state.loadState()
    state.saveState({ config: { ...base2.config, hook_tool_risk: { ...base2.config.hook_tool_risk, questionCards: false } } })
  })

  test("flag ON with no tool.execute.before hook leaves the native gate intact", async () => {
    const base = state.loadState()
    state.saveState({
      enabled: true,
      features: { ...base.features, hook_tool_risk: true },
      config: { ...base.config, hook_tool_risk: { ...base.config.hook_tool_risk, questionCards: true, actions: "shell,edit" } },
    })
    let evaluate: any
    const ctx: any = {
      location: { directory: scratch },
      permission: { hook: async (name: string, cb: any) => { if (name === "evaluate") evaluate = cb }, reply: async () => {}, list: async () => [] },
      event: { subscribe: () => ({ async *[Symbol.asyncIterator]() {} }) },
      tool: { transform: async () => {} },
      session: { hook: async () => {}, context: async () => [], interrupt: async () => {}, synthetic: async () => {}, get: async () => ({}) },
      command: { transform: async () => {} },
    }
    const { resetCardRoute } = await import("./question-cards.ts")
    resetCardRoute()
    await plugin.setup(ctx)
    const event: any = { action: "shell", sessionID: "ses_nohook", resources: ["src/x.ts"], effect: "ask" }
    await evaluate(event)
    expect(event.effect).toBe("ask")
    expect(state.readLog(20).some((row: any) => String(row.skipped ?? "").includes("tool.execute.before hook missing"))).toBe(true)
    const cur = state.loadState()
    state.saveState({ config: { ...cur.config, hook_tool_risk: { ...cur.config.hook_tool_risk, questionCards: false } } })
  })

  test("setup registers exactly the risk and session-ban evaluate writers", async () => {
    const base = state.loadState()
    state.saveState({
      enabled: true,
      features: { ...base.features, hook_session_ban: true, hook_supervisor: true, hook_tool_risk: true },
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

const { CONFIG_PATH_ENV: NATIVE_CFG_ENV, resetAutoAcceptCache: resetNativeAutoAccept } = await import("./autopermit.ts")

describe("supervisor mode wiring", () => {
  const setMode = (patch: Record<string, state.ConfigValue>, supervisorOn = true) => {
    const base = state.loadState()
    state.saveState({
      enabled: true,
      features: { ...base.features, hook_supervisor: supervisorOn },
      config: {
        ...base.config,
        hook_tool_risk: { ...base.config.hook_tool_risk, questionCards: true, actions: "shell,edit" },
        hook_supervisor: {
          ...base.config.hook_supervisor,
          protocol: "opencode",
          model: "supervisor-model",
          endpoint: "",
          standalone: false,
          nonBlocking: false,
          batchMs: 60000,
          batchMax: 10,
          ...patch,
        },
      },
    })
  }

  const harness = async (opts: { failLocation?: () => boolean } = {}) => {
    const { resetCardRoute } = await import("./question-cards.ts")
    resetCardRoute()
    let evaluate: any
    let beforeExecute: any
    const toolHooks: string[] = []
    const feed: any[] = []
    let wake = () => {}
    const feedStream = {
      async *[Symbol.asyncIterator]() {
        while (true) {
          while (feed.length) yield feed.shift()
          await new Promise<void>((resolve) => {
            wake = resolve
          })
        }
      },
    }
    const emptyStream = {
      async *[Symbol.asyncIterator]() {},
    }
    const ctx: any = {
      get location() {
        if (opts.failLocation?.()) throw new Error("no location")
        return { directory: scratch }
      },
      permission: { hook: async (name: string, cb: any) => { if (name === "evaluate" && !evaluate) evaluate = cb }, reply: async () => {}, list: async () => [] },
      event: { subscribe: ({ types }: any = {}) => (types?.includes?.("session.deleted") ? feedStream : emptyStream) },
      tool: {
        transform: async () => {},
        hook: async (name: string, cb: any) => {
          toolHooks.push(name)
          if (name === "execute.before") beforeExecute = cb
        },
      },
      session: { hook: async () => {}, context: async () => [], interrupt: async () => {}, synthetic: async () => {}, get: async () => ({}) },
      command: { transform: async () => {} },
    }
    await plugin.setup(ctx)
    return {
      evaluate: (...args: any[]) => evaluate(...args),
      toolHooks,
      invokeBefore: async (event: any) => {
        if (!beforeExecute) throw new Error("no execute.before hook was registered")
        await beforeExecute(event)
      },
      feedEvent: (event: any) => {
        feed.push(event)
        wake()
        wake = () => {}
      },
    }
  }

  const decisionRows = (sessionID: string) =>
    state.readLog(50).filter((row: any) => row.hook === "hook_supervisor" && row.event === "supervisor_decision" && row.sessionID === sessionID)
  const waitFor = async (predicate: () => boolean, timeoutMs = 2000) => {
    const deadline = Date.now() + timeoutMs
    while (!predicate()) {
      if (Date.now() >= deadline) throw new Error("waitFor timed out before the condition held")
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
  }

  test("supervisorMode resolves from config and needs an active supervisor", async () => {
    const { supervisorMode } = await import("./index.ts")
    setMode({})
    expect(supervisorMode()).toBe("default")
    setMode({ standalone: true })
    expect(supervisorMode()).toBe("standalone")
    setMode({ nonBlocking: true })
    expect(supervisorMode()).toBe("nonBlocking")
    setMode({ nonBlocking: true }, false)
    expect(supervisorMode()).toBe("default")
  })

  test("standalone holds every call for the supervisor without calling the Jev scorer", async () => {
    setMode({ standalone: true })
    const base = state.loadState()
    process.env.JEV_API_KEY = "test-key-standalone"
    state.saveState({
      features: { ...base.features, hook_tool_risk: false },
      endpoint: "http://jev.test/v1",
      protocol: "systemone",
      model: "test-model",
      keyEnv: "JEV_API_KEY",
      config: { ...base.config, hook_tool_risk: { ...base.config.hook_tool_risk, questionCards: false } },
    })
    const originalFetch = globalThis.fetch
    let fetches = 0
    globalThis.fetch = (async () => {
      fetches++
      throw new Error("Jev must not be called in standalone mode")
    }) as any
    try {
      const h = await harness()
      const event: any = { action: "shell", sessionID: "ses_standalone", resources: ["src/x.ts"], effect: "allow" }
      await h.evaluate(event)
      expect(event.effect).toBe("ask")
      expect(String(event.message)).toMatch(/^jev supervisor /)
      expect(fetches).toBe(0)
    } finally {
      globalThis.fetch = originalFetch
      delete process.env.JEV_API_KEY
      setMode({})
    }
  })

  test("non-blocking evaluate allows at once, registers no card route, and flushes at the cap", async () => {
    setMode({ nonBlocking: true, batchMax: 2 })
    try {
      const h = await harness()
      expect(h.toolHooks).not.toContain("execute.before")
      const first: any = { action: "shell", sessionID: "ses_batch", resources: ["src/a.ts"], effect: "ask" }
      await h.evaluate(first)
      expect(first.effect).toBe("allow")
      expect(first.message).toBeUndefined()
      const second: any = { action: "edit", sessionID: "ses_batch", resources: ["src/b.ts"], effect: "ask" }
      await h.evaluate(second)
      expect(second.effect).toBe("allow")
      await waitFor(() => decisionRows("ses_batch").length === 1)
      const decisions = decisionRows("ses_batch")
      expect(decisions).toHaveLength(1)
      expect(decisions[0].detail).toContain("non-blocking batch of 2 calls")
    } finally {
      setMode({})
    }
  })

  test("the batch window flushes after batchMs", async () => {
    setMode({ nonBlocking: true, batchMs: 15 })
    try {
      const h = await harness()
      const event: any = { action: "shell", sessionID: "ses_timer", resources: ["src/a.ts"], effect: "ask" }
      await h.evaluate(event)
      expect(event.effect).toBe("allow")
      await waitFor(() => decisionRows("ses_timer").some((row: any) => row.detail.includes("non-blocking batch of 1 call")))
    } finally {
      setMode({})
    }
  })

  test("session end flushes a pending batch", async () => {
    setMode({ nonBlocking: true })
    try {
      const h = await harness()
      const event: any = { action: "shell", sessionID: "ses_end", resources: ["src/a.ts"], effect: "ask" }
      await h.evaluate(event)
      expect(decisionRows("ses_end")).toHaveLength(0)
      h.feedEvent({ type: "session.deleted", data: { sessionID: "ses_end" } })
      await waitFor(() => decisionRows("ses_end").some((row: any) => row.detail.includes("non-blocking batch of 1 call")))
    } finally {
      setMode({})
    }
  })

  test("standalone fails closed when the host cannot be obtained after setup", async () => {
    setMode({ standalone: true, root: "" }, false)
    let failLocation = false
    try {
      const h = await harness({ failLocation: () => failLocation })
      failLocation = true
      setMode({ standalone: true, root: "" }, true)
      const event: any = { action: "shell", sessionID: "ses_no_host", resources: ["src/a.ts"], effect: "allow" }
      await h.evaluate(event)
      expect(event.effect).toBe("deny")
      expect(String(event.message)).toContain("supervisor")
      expect(decisionRows("ses_no_host")).toHaveLength(0)
      const logs = state.readLog(50).filter((row: any) => row.hook === "hook_supervisor" && row.sessionID === "ses_no_host")
      expect(logs.some((row: any) => String(row.detail).includes("denied"))).toBe(true)
    } finally {
      setMode({})
    }
  })

  test("a post-setup toggle to nonBlocking lazily creates a batch runner", async () => {
    setMode({ nonBlocking: false }, false)
    try {
      const h = await harness()
      setMode({ nonBlocking: true, batchMax: 2 })
      expect(h.toolHooks).toContain("execute.before")
      await expect(h.invokeBefore({ tool: "shell", sessionID: "ses_toggle", input: {}, id: "call_toggle" })).resolves.toBeUndefined()
      const first: any = { action: "shell", sessionID: "ses_toggle", resources: ["src/a.ts"], effect: "ask" }
      await h.evaluate(first)
      expect(first.effect).toBe("allow")
      const second: any = { action: "edit", sessionID: "ses_toggle", resources: ["src/b.ts"], effect: "ask" }
      await h.evaluate(second)
      expect(second.effect).toBe("allow")
      await waitFor(() => decisionRows("ses_toggle").length === 1)
      expect(decisionRows("ses_toggle")[0].detail).toContain("non-blocking batch of 2 calls")
    } finally {
      setMode({})
    }
  })

  test("a supervisor-mode exception fails closed at the evaluate wrapper", async () => {
    setMode({ nonBlocking: true })
    try {
      const h = await harness()
      const event: any = {
        get action() {
          throw new Error("bad event")
        },
        sessionID: "ses_exception",
        resources: ["src/a.ts"],
        effect: "allow",
      }
      await h.evaluate(event)
      expect(event.effect).toBe("deny")
      expect(String(event.message)).toContain("evaluation failed")
    } finally {
      setMode({})
    }
  })
})

describe("native evaluate path host effects", () => {
  async function drive(verdict: string) {
    const base = state.loadState()
    const cli = join(scratch, `cli-${verdict}.json`)
    writeFileSync(cli, `{"session":{"permissions":"prompt"}}`)
    process.env[NATIVE_CFG_ENV] = cli
    resetNativeAutoAccept()
    process.env.JEV_API_KEY = "test-key-for-native-path"
    state.saveState({
      enabled: true,
      endpoint: "http://jev.test/v1",
      protocol: "systemone",
      model: "test-model",
      keyEnv: "JEV_API_KEY",
      features: { ...base.features, hook_tool_risk: true, hook_supervisor: false },
      config: {
        ...base.config,
        hook_tool_risk: { ...base.config.hook_tool_risk, questionCards: false, actions: "shell,edit", minProbability: 0.5, minMargin: 0.1 },
      },
    })
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          answers: {
            verdict: {
              type: "choice",
              choice: verdict,
              probabilities: { allow: 0.01, propagate: 0.01, deny: 0.01, abort: 0.01, [verdict]: 0.96 },
              confidence: 0.95,
              reason: `verdict ${verdict}`,
            },
          },
        }),
    })) as any
    let evaluate: any
    const interrupted: string[] = []
    const notices: string[] = []
    const ctx: any = {
      location: { directory: scratch },
      permission: { hook: async (name: string, cb: any) => { if (name === "evaluate" && !evaluate) evaluate = cb }, reply: async () => {}, list: async () => [] },
      event: { subscribe: () => ({ async *[Symbol.asyncIterator]() {} }) },
      tool: { transform: async () => {}, hook: async () => {} },
      session: {
        hook: async () => {},
        context: async () => [{ info: { role: "user" }, parts: [{ type: "text", text: "delete the build output" }] }],
        interrupt: async (x: any) => { interrupted.push(x.sessionID) },
        synthetic: async (x: any) => { notices.push(String(x.text ?? "")) },
        get: async () => ({}),
      },
      command: { transform: async () => {} },
    }
    const { resetCardRoute } = await import("./question-cards.ts")
    resetCardRoute()
    try {
      await plugin.setup(ctx)
      const event: any = { action: "shell", sessionID: `ses_native_${verdict}`, resources: ["src/x.ts"], effect: "allow" }
      await evaluate(event)
      await new Promise((r) => setTimeout(r, 10))
      return { event, interrupted, notices }
    } finally {
      globalThis.fetch = originalFetch
      delete process.env[NATIVE_CFG_ENV]
      delete process.env.JEV_API_KEY
      resetNativeAutoAccept()
      resetCardRoute()
    }
  }

  test("propagate reaches the human as host ask", async () => {
    const { event } = await drive("propagate")
    expect(event.effect).toBe("ask")
  })

  test("abort blocks at the host, stops the tree and notifies", async () => {
    const { event, interrupted, notices } = await drive("abort")
    expect(event.effect).toBe("deny")
    expect(interrupted).toContain("ses_native_abort")
    expect(notices.some((n) => n.includes("jev abort"))).toBe(true)
  })
})

describe("trusted paths", () => {
  const setTrusted = (value: string) => {
    const base = state.loadState()
    state.saveState({ config: { ...base.config, hook_tool_risk: { ...base.config.hook_tool_risk, trustedPaths: value } } })
  }

  afterEach(() => setTrusted(""))

  test("a call fully under a trusted prefix is skipped and keeps its native effect", async () => {
    const base = state.loadState()
    state.saveState({
      enabled: true,
      features: { ...base.features, hook_tool_risk: true },
      config: { ...base.config, hook_tool_risk: { ...base.config.hook_tool_risk, trustedPaths: "/tmp/opencode" } },
    })
    let evaluate: any
    const ctx: any = {
      location: { directory: scratch },
      permission: {
        hook: async (name: string, fn?: any) => {
          if (name === "evaluate" && !evaluate) evaluate = fn
        },
        reply: async () => {},
        list: async () => [],
      },
      event: { subscribe: () => ({ async *[Symbol.asyncIterator]() {} }) },
      tool: { transform: async () => {}, hook: async () => {} },
      session: { hook: async () => {}, context: async () => [], interrupt: async () => {}, synthetic: async () => {}, get: async () => ({}) },
      command: { transform: async () => {} },
    }
    await plugin.setup(ctx)
    const event: any = { action: "shell", sessionID: "ses_trust", resources: ["/tmp/opencode/x.ts"], effect: "allow" }
    await evaluate(event)
    expect(event.effect).toBe("allow")
    expect(state.readLog(500).some((row: any) => row.skipped === "trusted path")).toBe(true)
  })

  test("a mixed call is not trusted", () => {
    expect(allResourcesTrusted(["/tmp/opencode/x.ts", "/etc/passwd"], "/tmp/opencode")).toBe(false)
  })

  test("an empty trustedPaths preserves evaluation", () => {
    expect(allResourcesTrusted(["/tmp/opencode/x.ts"], "")).toBe(false)
  })

  test("a wildcard resource matches its prefix", () => {
    expect(allResourcesTrusted(["/tmp/opencode/*"], "/tmp/opencode")).toBe(true)
  })
})

describe("v02 Discord abort notice", () => {
  const now = new Date(2026, 10, 17, 10, 54, 31)
  const outcome = {
    effect: "abort" as const,
    reason: "abort (P=0.95)",
    message: "jev: abort. This call is genuinely destructive (P=0.95). The session was stopped and the user was notified.",
  }
  const call = { sessionID: "ses_a1b2c3d4", action: "shell", text: "shell: echo hello" }

  test("normal payload has every v02 field and the held call", () => {
    const { body, attachment } = formatAlert(call, outcome, now)
    expect(attachment).toBeUndefined()
    expect(body.content).toBe("Supervisor alert: a tool call was held and did not run.")
    const embed = (body.embeds as any[])[0]
    expect(embed.title).toBe("Jev Alert (hook_tool_risk)")
    expect(embed.color).toBe(15158332)
    expect(embed.description).toContain("genuinely destructive")
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
    expect(fields[0].value).toBe("abort")
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

  test("a non-2xx webhook logs status only, never URL or body", async () => {
    const url = "https://discord.com/api/webhooks/999/Anothersecrettoken456"
    const base = state.loadState()
    state.saveState({ config: { ...base.config, hook_tool_risk: { ...base.config.hook_tool_risk, alertWebhook: url } } })
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => ({
      ok: false,
      status: 403,
      text: async () => "secret response body with " + url,
    })) as any
    try {
      await alertUser({ session: { interrupt: async () => {}, synthetic: async () => {} } }, call as any, outcome as any)
    } finally {
      globalThis.fetch = originalFetch
      state.saveState({ config: base.config })
    }
    const hit = state.readLog(50).find((row: any) => row.error === "alert webhook POST rejected")
    expect(hit).toBeDefined()
    expect(hit.status).toBe(403)
    const text = JSON.stringify(hit)
    expect(text).not.toContain(url)
    expect(text).not.toContain("Anothersecrettoken456")
    expect(text).not.toContain("secret response body")
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

describe("tool ban bypass + listTool bans", () => {
  test("listTool bans returns records with no secret fields", async () => {
    banTool("ses_lb", ["sub1"], "block reason")
    const handlers = jevRpcHandlers()
    const result: any = await (handlers as any).listToolBans({})
    expect(Array.isArray(result.toolBans)).toBe(true)
    const row = result.toolBans.find((b: any) => b.sessionID === "ses_lb")
    expect(row).toBeDefined()
    const text = JSON.stringify(row)
    expect(text).not.toMatch(/password|token|webhook|https?:/i)
    unbanTool("ses_lb")
  })
  test("evaluatePermission denies a tool ban while card route active", async () => {
    setFlagOn()
    resetCardRoute()
    markCardRouteActive()
    setTrusted("/tmp/opencode")
    banTool("ses_banned", ["subx"], "block")
    let evaluate: any
    const ctx: any = {
      location: { directory: scratch },
      permission: { hook: async (name: string, cb: any) => { if (name === "evaluate" && !evaluate) evaluate = cb }, reply: async () => {}, list: async () => [] },
      event: { subscribe: () => ({ async *[Symbol.asyncIterator]() {} }) },
      tool: { transform: async () => {}, hook: async () => {} },
      session: { hook: async () => {}, context: async () => [], interrupt: async () => {}, synthetic: async () => {}, get: async () => ({}) },
      command: { transform: async () => {} },
    }
    await plugin.setup(ctx)
    const event: any = { action: "shell", sessionID: "ses_banned", resources: ["/tmp/opencode/x.ts"], effect: "allow" }
    await evaluate(event)
    // Trusted path would have skipped, but tool ban must force deny.
    expect(event.effect).toBe("deny")
    unbanTool("ses_banned")
    resetCardRoute()
    setFlagOff()
  })
})

function setFlagOn() {
  const b = state.loadState()
  state.saveState({ enabled: true, features: { ...b.features, hook_tool_risk: true }, config: { ...b.config, hook_tool_risk: { ...b.config.hook_tool_risk, questionCards: true } } })
}
function setTrusted(v: string) {
  const b = state.loadState()
  state.saveState({ config: { ...b.config, hook_tool_risk: { ...b.config.hook_tool_risk, trustedPaths: v } } })
}
function setFlagOff() {
  const b = state.loadState()
  state.saveState({ config: { ...b.config, hook_tool_risk: { ...b.config.hook_tool_risk, questionCards: false, trustedPaths: "" } } })
}
