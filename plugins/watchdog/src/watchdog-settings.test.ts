/**
 * The Watchdog page's settings surface (#18): the fill-on-read migration, the
 * validated writers, and the write-only credential contract. Every path points
 * at a scratch home; the live state file is never touched.
 */
import { afterAll, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { WatchdogSettings } from "../../../lib/jev/state.ts"

const scratch = mkdtempSync(join(tmpdir(), "jev-watchdog-settings-"))
const STATE_HOME = join(scratch, "state")
const BAN_DIR = join(scratch, "ban")
mkdirSync(STATE_HOME, { recursive: true })
mkdirSync(BAN_DIR, { recursive: true })
process.env.JEV_DATA_DIR = join(scratch, "data")
process.env.JEV_STATE_HOME = STATE_HOME
process.env.JEV_SECRET_DIR = join(scratch, "secrets")
process.env.OPENCODE_JEV_NOSPAWN_DIR = BAN_DIR
process.env.OPENCODE_JEV_STATE_HOME = STATE_HOME
process.env.OPENCODE_JEV_SESSION_BAN_DIR = BAN_DIR

const { loadState, saveState, readRawState, STATE_FILE, APPROVALS_FILE, DEFAULTS } = await import("../../../lib/jev/state.ts")
const { recordApproval, readApprovals } = await import("../../../lib/jev/approve.ts")
const { watchdogSnapshot, applyWatchdogSetting, applyWatchdogSecret, watchdogMigrationReport } = await import("./watchdog-settings.ts")
const { watchdogLimits, watchdogNodes, watchdogEnvOverrides, watchdogChain, watchdogAskMode } = await import("./watchdog-config.ts")

afterAll(() => rmSync(scratch, { recursive: true, force: true }))

/** A state file as the pre-#18 world wrote it: tuned fields, no watchdog scope. */
function preEighteenState() {
  writeFileSync(
    STATE_FILE,
    JSON.stringify({
      enabled: false,
      protocol: "chat",
      logMax: 99,
      approveTtl: 1234,
      features: { hook_skill_pick: true, hook_tool_risk: true },
      config: { hook_tool_risk: { minProbability: 0.7 } },
    }),
  )
}

test("a pre-#18 state file migrates with no loss: every stored field survives, the scope fills off-by-default", () => {
  preEighteenState()
  const state = loadState()
  expect(state.enabled).toBe(false)
  expect(state.protocol).toBe("chat")
  expect(state.logMax).toBe(99)
  expect(state.approveTtl).toBe(1234)
  expect(state.features.hook_skill_pick).toBe(true)
  expect(state.config.hook_tool_risk.minProbability).toBe(0.7)
  expect(state.watchdog).toEqual(DEFAULTS.watchdog)
  expect(state.watchdog.on).toBe(false)
})

test("a stored watchdog scope is read back exactly as saved", () => {
  const tuned: WatchdogSettings = {
    on: true,
    nodes: ["jev", "supervisor"],
    timing: "nonblocking",
    sessionCap: 9,
    jevBatchMax: 2,
    jevBatchMs: 50,
    supervisorBatchMax: 3,
    supervisorBatchMs: 60,
    chain: true,
    askMode: "immediate",
  }
  saveState({ watchdog: tuned })
  expect(loadState().watchdog).toEqual(tuned)
})

test("a corrupt or partial watchdog object defaults per field and never throws the state read", () => {
  writeFileSync(
    STATE_FILE,
    JSON.stringify({
      enabled: true,
      watchdog: { on: "yes", nodes: "jev", timing: "weird", sessionCap: -4, jevBatchMax: "two", supervisorBatchMs: 12.4 },
    }),
  )
  const state = loadState()
  expect(state.enabled).toBe(true)
  expect(state.watchdog.on).toBe(false)
  expect(state.watchdog.nodes).toEqual([])
  expect(state.watchdog.timing).toBe("blocking")
  expect(state.watchdog.sessionCap).toBe(DEFAULTS.watchdog.sessionCap)
  expect(state.watchdog.jevBatchMax).toBe(DEFAULTS.watchdog.jevBatchMax)
  expect(state.watchdog.jevBatchMs).toBe(DEFAULTS.watchdog.jevBatchMs)
  // The one field stated validly keeps its rounded value.
  expect(state.watchdog.supervisorBatchMs).toBe(12)
})

test("unknown node names are dropped by the migration reader", () => {
  saveState({ watchdog: { ...DEFAULTS.watchdog, nodes: ["jev", "robot"] } })
  expect(loadState().watchdog.nodes).toEqual(["jev"])
})

test("settings writes leave bans and pending approvals byte-identical, without duplicating pending items", () => {
  preEighteenState()
  writeFileSync(join(BAN_DIR, "ses_kept.json"), JSON.stringify({ banned: true, reason: "abort covers this session" }))
  recordApproval(
    { token: "tok_pending", sessionID: "ses_kept", action: "shell", resources: [], subject: "ls", reason: "review", ts: new Date().toISOString() },
    600,
  )
  const banBefore = readFileSync(join(BAN_DIR, "ses_kept.json"), "utf8")
  const approvalsBefore = readFileSync(APPROVALS_FILE, "utf8")

  expect(applyWatchdogSetting({ key: "on", value: true }).ok).toBe(true)
  expect(applyWatchdogSetting({ key: "sessionCap", value: 6 }).ok).toBe(true)
  expect(applyWatchdogSecret({ key: "receiptsWebhook", value: "https://hooks.example/wmt" }).ok).toBe(true)
  expect(applyWatchdogSecret({ key: "supervisorEndpoint", value: "https://sup.example/call" }).ok).toBe(true)

  expect(readFileSync(join(BAN_DIR, "ses_kept.json"), "utf8")).toBe(banBefore)
  expect(readFileSync(APPROVALS_FILE, "utf8")).toBe(approvalsBefore)
  const pending = readApprovals(600)
  expect(pending).toHaveLength(1)
  expect(pending[0].token).toBe("tok_pending")
})

test("the snapshot never carries a secret value, only presence booleans", () => {
  applyWatchdogSecret({ key: "receiptsWebhook", value: "https://hooks.example/secrettoken123" })
  applyWatchdogSecret({ key: "supervisorEndpoint", value: "https://sup.example/secretendpoint456" })
  const snapshot = watchdogSnapshot()
  expect(snapshot.receiptsWebhookPresent).toBe(true)
  expect(snapshot.supervisorEndpointPresent).toBe(true)
  const text = JSON.stringify(snapshot)
  expect(text).not.toContain("secrettoken123")
  expect(text).not.toContain("secretendpoint456")
  expect(text).not.toContain("hooks.example")
})

test("validated writes: unknown keys and wrong types are refused, and the state file gains the scope only on save", () => {
  preEighteenState()
  expect(readRawState()?.watchdog).toBeUndefined()
  expect(applyWatchdogSetting({ key: "nope", value: 1 }).ok).toBe(false)
  expect(applyWatchdogSetting({ key: "sessionCap", value: "four" }).ok).toBe(false)
  expect(applyWatchdogSetting({ key: "sessionCap", value: 0 }).ok).toBe(false)
  expect(applyWatchdogSetting({ key: "on", value: "true" }).ok).toBe(false)
  expect(applyWatchdogSetting({ key: "timing", value: "sometimes" }).ok).toBe(false)
  expect(applyWatchdogSetting({ key: "jevBatchMs", value: -5 }).ok).toBe(false)
  // Nothing above wrote: the file still carries no scope.
  expect(readRawState()?.watchdog).toBeUndefined()

  expect(applyWatchdogSetting({ key: "on", value: true }).ok).toBe(true)
  expect(applyWatchdogSetting({ key: "timing", value: "nonblocking" }).ok).toBe(true)
  expect(applyWatchdogSetting({ key: "nodes", value: "jev, robot ,SUPERVISOR" }).ok).toBe(true)
  expect(applyWatchdogSetting({ key: "jevBatchMs", value: 0 }).ok).toBe(true)
  const stored = loadState().watchdog
  expect(stored.on).toBe(true)
  expect(stored.timing).toBe("nonblocking")
  expect(stored.nodes).toEqual(["jev", "supervisor"])
  expect(readRawState()?.watchdog).toBeDefined()
})

test("clearing a secret is a documented write, not a refusal", () => {
  applyWatchdogSecret({ key: "receiptsWebhook", value: "https://hooks.example/wmt" })
  expect(applyWatchdogSecret({ key: "receiptsWebhook", value: "" }).ok).toBe(true)
  expect(watchdogSnapshot().receiptsWebhookPresent).toBe(false)
  expect(applyWatchdogSecret({ key: "supervisorEndpoint", value: "" }).ok).toBe(true)
  expect(watchdogSnapshot().supervisorEndpointPresent).toBe(false)
})

test("the migration report carries counts only: no values, no secrets", () => {
  expect(watchdogMigrationReport(undefined)).toEqual({ present: false, stored: 0, defaulted: 10, invalid: 0 })
  const tuned = { ...DEFAULTS.watchdog, sessionCap: 9 }
  expect(watchdogMigrationReport(tuned)).toEqual({ present: true, stored: 10, defaulted: 0, invalid: 0 })
  expect(watchdogMigrationReport({ sessionCap: 9 })).toEqual({ present: true, stored: 1, defaulted: 9, invalid: 0 })
  expect(watchdogMigrationReport({ sessionCap: -4, on: "yes" })).toEqual({ present: true, stored: 0, defaulted: 8, invalid: 2 })
})

test("effective values: env wins when set, the persisted value takes over when it is unset", () => {
  saveState({ watchdog: { ...DEFAULTS.watchdog, sessionCap: 5, nodes: ["jev"] } })
  expect(watchdogLimits().sessionCap).toBe(5)
  expect(watchdogNodes().jev).toBe(true)
  expect(watchdogNodes().supervisor).toBe(false)
  expect(watchdogEnvOverrides()).toEqual([])

  process.env.WATCHDOG_CHAIN_CAP = "7"
  process.env.WATCHDOG_CHAIN_NODES = "jev,supervisor"
  try {
    expect(watchdogLimits().sessionCap).toBe(7)
    expect(watchdogNodes().supervisor).toBe(true)
    expect(watchdogEnvOverrides()).toContain("sessionCap")
    expect(watchdogEnvOverrides()).toContain("nodes")
  } finally {
    delete process.env.WATCHDOG_CHAIN_CAP
    delete process.env.WATCHDOG_CHAIN_NODES
  }
  expect(watchdogLimits().sessionCap).toBe(5)
})

test("an empty migrated node list means every default node is on, never zero nodes", () => {
  // The migrated default carries an empty list; an armed deployment that
  // never configured nodes must keep the all-on posture, and an explicit
  // env list still narrows it.
  saveState({ watchdog: { ...DEFAULTS.watchdog } })
  const defaults = watchdogNodes()
  expect(defaults.jev).toBe(true)
  expect(defaults.parent).toBe(true)
  expect(defaults.supervisor).toBe(true)
  expect(defaults.human).toBe(true)

  process.env.WATCHDOG_CHAIN_NODES = "jev"
  try {
    const narrowed = watchdogNodes()
    expect(narrowed.jev).toBe(true)
    expect(narrowed.parent).toBe(false)
    expect(narrowed.supervisor).toBe(false)
    expect(narrowed.human).toBe(false)
  } finally {
    delete process.env.WATCHDOG_CHAIN_NODES
  }
})

test("timing precedence: a set environment value wins over the persisted value for both literals", () => {
  saveState({ watchdog: { ...DEFAULTS.watchdog, timing: "nonblocking" } })
  expect(watchdogLimits().timing).toBe("nonblocking")

  process.env.WATCHDOG_CHAIN_TIMING = "blocking"
  try {
    expect(watchdogLimits().timing).toBe("blocking")
  } finally {
    delete process.env.WATCHDOG_CHAIN_TIMING
  }
  expect(watchdogLimits().timing).toBe("nonblocking")

  process.env.WATCHDOG_CHAIN_TIMING = "nonblocking"
  try {
    expect(watchdogLimits().timing).toBe("nonblocking")
  } finally {
    delete process.env.WATCHDOG_CHAIN_TIMING
  }

  // An unusable value falls through to the persisted value, as documented.
  process.env.WATCHDOG_CHAIN_TIMING = "sometimes"
  try {
    expect(watchdogLimits().timing).toBe("nonblocking")
  } finally {
    delete process.env.WATCHDOG_CHAIN_TIMING
  }
})

test("chain activation persists as a boolean, defaults off, and validates its type", () => {
  preEighteenState()
  expect(readRawState()?.watchdog).toBeUndefined()
  expect(loadState().watchdog.chain).toBe(false)
  expect(applyWatchdogSetting({ key: "chain", value: "yes" }).ok).toBe(false)
  expect(readRawState()?.watchdog).toBeUndefined()
  expect(applyWatchdogSetting({ key: "chain", value: true }).ok).toBe(true)
  expect(loadState().watchdog.chain).toBe(true)
  expect(applyWatchdogSetting({ key: "chain", value: false }).ok).toBe(true)
  expect(loadState().watchdog.chain).toBe(false)
})

test("ask routing persists as judged or immediate, defaults judged, and refuses other values", () => {
  preEighteenState()
  expect(loadState().watchdog.askMode).toBe("judged")
  expect(applyWatchdogSetting({ key: "askMode", value: "sometimes" }).ok).toBe(false)
  expect(applyWatchdogSetting({ key: "askMode", value: true }).ok).toBe(false)
  expect(applyWatchdogSetting({ key: "askMode", value: "immediate" }).ok).toBe(true)
  expect(loadState().watchdog.askMode).toBe("immediate")
  expect(applyWatchdogSetting({ key: "askMode", value: "judged" }).ok).toBe(true)
  expect(loadState().watchdog.askMode).toBe("judged")
})

test("chain and askMode migrate per field from a partial or corrupt scope", () => {
  writeFileSync(
    STATE_FILE,
    JSON.stringify({ enabled: true, watchdog: { chain: "yes", askMode: "sometimes", sessionCap: 6 } }),
  )
  const watchdog = loadState().watchdog
  expect(watchdog.chain).toBe(false)
  expect(watchdog.askMode).toBe("judged")
  expect(watchdog.sessionCap).toBe(6)
  writeFileSync(
    STATE_FILE,
    JSON.stringify({ enabled: true, watchdog: { chain: true, askMode: "immediate" } }),
  )
  const kept = loadState().watchdog
  expect(kept.chain).toBe(true)
  expect(kept.askMode).toBe("immediate")
})

test("chain activation precedence: a set environment value wins, the persisted value takes over when unset", () => {
  saveState({ watchdog: { ...DEFAULTS.watchdog, chain: true } })
  expect(watchdogChain()).toBe(true)
  expect(watchdogEnvOverrides()).not.toContain("chain")

  try {
    // Any set value wins: only the literal "1" means on.
    process.env.WATCHDOG_CHAIN = "0"
    expect(watchdogChain()).toBe(false)
    process.env.WATCHDOG_CHAIN = ""
    expect(watchdogChain()).toBe(false)
    expect(watchdogEnvOverrides()).toContain("chain")
    process.env.WATCHDOG_CHAIN = "1"
    expect(watchdogChain()).toBe(true)
  } finally {
    delete process.env.WATCHDOG_CHAIN
  }
  expect(watchdogChain()).toBe(true)

  saveState({ watchdog: { ...DEFAULTS.watchdog, chain: false } })
  expect(watchdogChain()).toBe(false)
})

test("ask routing precedence: a set environment literal wins, an unusable value falls to the persisted one", () => {
  saveState({ watchdog: { ...DEFAULTS.watchdog, askMode: "immediate" } })
  expect(watchdogAskMode()).toBe("immediate")

  try {
    process.env.WATCHDOG_CHAIN_ASK_MODE = "judged"
    expect(watchdogAskMode()).toBe("judged")
    expect(watchdogEnvOverrides()).toContain("askMode")
    process.env.WATCHDOG_CHAIN_ASK_MODE = "sometimes"
    expect(watchdogAskMode()).toBe("immediate")
  } finally {
    delete process.env.WATCHDOG_CHAIN_ASK_MODE
  }
  expect(watchdogAskMode()).toBe("immediate")
})

test("the snapshot carries chain and askMode, persisted and effective, and marks their env overrides", () => {
  saveState({ watchdog: { ...DEFAULTS.watchdog, chain: true, askMode: "immediate" } })
  const snapshot = watchdogSnapshot()
  expect(snapshot.persisted.chain).toBe(true)
  expect(snapshot.persisted.askMode).toBe("immediate")
  expect(snapshot.effective.chain).toBe(true)
  expect(snapshot.effective.askMode).toBe("immediate")
  expect(snapshot.envOverrides).not.toContain("chain")
  expect(snapshot.envOverrides).not.toContain("askMode")

  try {
    process.env.WATCHDOG_CHAIN = "0"
    process.env.WATCHDOG_CHAIN_ASK_MODE = "judged"
    const overridden = watchdogSnapshot()
    expect(overridden.effective.chain).toBe(false)
    expect(overridden.effective.askMode).toBe("judged")
    expect(overridden.envOverrides).toContain("chain")
    expect(overridden.envOverrides).toContain("askMode")
  } finally {
    delete process.env.WATCHDOG_CHAIN
    delete process.env.WATCHDOG_CHAIN_ASK_MODE
  }
})

test("the snapshot's migration report matches what the state file actually holds", () => {
  preEighteenState()
  expect(watchdogSnapshot().migration).toEqual({ present: false, stored: 0, defaulted: 10, invalid: 0 })
})
