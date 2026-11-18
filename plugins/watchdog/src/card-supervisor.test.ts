/** Supervisor verdict -> resolution mapping (card mode). Scratch state, no host. */
import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const scratch = mkdtempSync(join(tmpdir(), "jev-cardsup-"))
process.env.JEV_STATE_HOME = scratch
process.env.XDG_STATE_HOME = scratch
mkdirSync(join(scratch, "opencode"), { recursive: true })
writeFileSync(join(scratch, "opencode", "service.json"), JSON.stringify({ url: "http://127.0.0.1:1", password: "dummy" }))

const { attachSupervisor } = await import("./supervisor-host.ts")
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

const CALL = {
  sessionID: "ses_sup",
  action: "shell",
  resources: ["src/config.ts"],
  subject: { action: "shell", resources: ["src/config.ts"] },
  text: "shell: cat src/config.ts",
}

function supervise(verdict: string) {
  const host = attachSupervisor({
    ctx: {
      session: { context: async () => [{ role: "user", text: "delete build" }] },
      location: { directory: scratch },
    },
    config: {
      state: () => ({}) as any,
      limits: () => ({ timeoutMs: 30_000, maxRounds: 1, maxEvidenceCalls: 0 }),
      evidenceRoot: () => scratch,
      askWaitMs: () => 5,
    },
    model: async () => ({
      decisions: [{ value: verdict, probability: 0.9, confident: true, note: "reviewed the call" }],
      model: "supervisor-model", inputTokens: 1, elapsedMs: 1, sent: {},
    }),
    cardMode: () => true,
  })
  return host.supervise({ ...CALL })
}

describe("supervisor verdict -> resolution (card mode)", () => {
  test("allow always releases", async () => {
    expect(await supervise("allow")).toBe("allow")
  })
  test("deny hands back to the user", async () => {
    expect(await supervise("deny")).toBe("propagate")
  })
  test("abort stops the session", async () => {
    expect(await supervise("abort")).toBe("abort")
  })
  test("propagate maps to propagate (hand back to the human)", async () => {
    expect(await supervise("propagate")).toBe("propagate")
  })
  test("unknown verdict fails closed to propagate", async () => {
    expect(await supervise("surprise")).toBe("propagate")
  })
  test("card mode does not call permission.reply or wait on permission.asked", async () => {
    let replied = 0
    const host = attachSupervisor({
      ctx: {
        session: { context: async () => [{ role: "user", text: "delete build" }] },
        permission: { reply: async () => { replied++ } },
        location: { directory: scratch },
      },
      config: {
        state: () => ({}) as any,
        limits: () => ({ timeoutMs: 30_000, maxRounds: 1, maxEvidenceCalls: 0 }),
        evidenceRoot: () => scratch, askWaitMs: () => 5,
      },
      model: async () => ({
        decisions: [{ value: "allow", probability: 0.9, confident: true, note: "reviewed" }],
        model: "m", inputTokens: 1, elapsedMs: 1, sent: {},
      }),
      cardMode: () => true,
    })
    expect(await host.supervise({ ...CALL })).toBe("allow")
    expect(replied).toBe(0)
  })
})
