/** Behavior guards for the authoritative Jev rewrite. Scratch state, no network. */
import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const scratch = mkdtempSync(join(tmpdir(), "jev-spec2-"))
process.env.JEV_STATE_HOME = scratch
process.env.XDG_STATE_HOME = scratch
mkdirSync(join(scratch, "opencode"), { recursive: true })
writeFileSync(join(scratch, "opencode", "service.json"), JSON.stringify({ url: "http://127.0.0.1:1", password: "dummy" }))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

const state = await import("../../../lib/lib-jev/state.ts")
const { Contract } = await import("../../../lib/lib-jev/rpc.ts")
const { verdictOutcome, gateEffect, hostEffect } = await import("./index.ts")
const { validateDecision, escalate, SUPERVISOR_VERDICTS } = await import("./supervisor.ts")
const { statusSnapshot } = await import("./gui-rpc.ts")
const { CONFIG_PATH_ENV, resetAutoAcceptCache } = await import("./autopermit.ts")

const info = {
  sessionID: "ses_spec",
  action: "shell",
  resources: ["src/config.ts"],
  subject: { action: "shell", resources: ["src/config.ts"] },
  text: "shell: cat src/config.ts",
} as any

describe("Jev outcome vocabulary", () => {
  test("an unknown verdict label fails closed to propagate", () => {
    const cli = join(scratch, "prompt-cli.json")
    writeFileSync(cli, `{"session":{"permissions":"prompt"}}`)
    process.env[CONFIG_PATH_ENV] = cli
    resetAutoAcceptCache()
    try {
      expect((verdictOutcome("allow", 0.9, info) as any).alert).toBeUndefined()
      expect(verdictOutcome("alert" as any, 0.9, info)?.effect).toBe("propagate")
    } finally {
      delete process.env[CONFIG_PATH_ENV]
      resetAutoAcceptCache()
    }
  })
  test("abort is distinct from deny", () => {
    expect(verdictOutcome("abort", 0.9, info)?.effect).toBe("abort")
    expect(verdictOutcome("deny", 0.9, info)?.effect).toBe("deny")
  })
})

describe("native host effect mapping", () => {
  test("outcomes map to host-valid effects", () => {
    expect(hostEffect({ effect: "allow" })).toBe("allow")
    expect(hostEffect({ effect: "propagate" })).toBe("ask")
    expect(hostEffect({ effect: "deny" })).toBe("deny")
    expect(hostEffect({ effect: "abort" })).toBe("deny")
  })
})

describe("state machine core: gateEffect", () => {
  test("supervisor enabled hands off every non-allow outcome with no other effect", () => {
    expect(gateEffect({ effect: "deny" }, "allow")).toBe("allow")
    expect(gateEffect({ effect: "abort" }, "allow")).toBe("allow")
    expect(gateEffect({ effect: "propagate" }, "allow")).toBe("allow")
    expect(gateEffect({ effect: "deny" }, "abort")).toBe("abort")
    expect(gateEffect({ effect: "abort" }, "propagate")).toBe("propagate")
  })
  test("supervisor disabled applies the outcome's own default effect", () => {
    expect(gateEffect({ effect: "propagate" }, null)).toBe("propagate")
    expect(gateEffect({ effect: "deny" }, null)).toBe("deny")
    expect(gateEffect({ effect: "abort" }, null)).toBe("abort")
  })
  test("allow always releases", () => {
    expect(gateEffect({ effect: "allow" }, null)).toBe("allow")
    expect(gateEffect(null, "abort")).toBe("allow")
  })
})

describe("supervisor fail-closed vocabulary", () => {
  test("verdicts are exactly allow, deny, abort, propagate", () => {
    expect([...SUPERVISOR_VERDICTS]).toEqual(["allow", "deny", "abort", "propagate"])
  })
  test("unknown, malformed and uncertain answers become propagate", () => {
    expect(validateDecision({ verdict: "surprise", confidence: 0.9, reason: "x" }).verdict).toBe("propagate")
    expect(validateDecision("not json").verdict).toBe("propagate")
    expect(validateDecision({ verdict: "allow", confidence: 0.2, reason: "x" }).verdict).toBe("propagate")
    expect(escalate("no evidence").verdict).toBe("propagate")
  })
})

describe("question-card default", () => {
  test("questionCards is on by default, including for an absent stored key", () => {
    expect(state.FEATURE_DEFAULTS.hook_tool_risk.questionCards).toBe(true)
    expect(state.featureConfig("hook_tool_risk").questionCards).toBe(true)
  })
})

describe("supervisor config surface", () => {
  test("the config key 'trial' is absent and rejected", () => {
    expect((state.FEATURE_DEFAULTS.hook_supervisor as Record<string, unknown>).trial).toBeUndefined()
    expect(() => state.setFeatureConfig("hook_supervisor", "trial", true)).toThrow(/unknown jev config key/)
    expect((state.featureConfig("hook_supervisor") as Record<string, unknown>).trial).toBeUndefined()
  })
  test("the RPC status schema and status snapshot omit 'trial'", () => {
    const supervisor = (Contract.methods.status.output.properties as any).supervisor
    expect(supervisor.properties.trial).toBeUndefined()
    expect(supervisor.required).not.toContain("trial")
    expect((statusSnapshot().supervisor as Record<string, unknown>).trial).toBeUndefined()
  })
})
