/**
 * Self-check for the answer validator. No network: these are hand-built answer
 * objects, and the point is the shape checks, not Jev's judgement.
 *
 *   bun test src/jev.test.ts
 *
 * The data directory is redirected to a temp one before state.ts loads, because
 * several tests write settings and the real file is the user's, not the test's.
 */

import { afterAll, afterEach, describe, expect, test } from "bun:test"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const scratch = mkdtempSync(join(tmpdir(), "jev-test-"))
process.env.JEV_DATA_DIR = scratch
process.env.JEV_SECRET_DIR = join(scratch, "secrets")

const { actionsInScope, normalizeAction, propagateOutcome, runAbort, JEV_COMMANDS, stronger, undecidedOutcome, verdictOutcome } = await import("./index.ts")
const jevPlugin = (await import("./index.ts")).default
const { ask, answersOf, JevError, normalize, redact, signalFor } = await import("../../../lib/lib-jev/jev.ts")
const { callToken, consumeGrant, grant, readApprovals, recordApproval } = await import("../../../lib/lib-jev/approve.ts")
const { expandFileRefs, matchesPattern, parseRules, ruleApplies } = await import("./rules.ts")
type Rule = import("./rules.ts").Rule
const { autoAccept, CONFIG_PATH_ENV, CONTENT_ENV, parseConfig, resetAutoAcceptCache, stripTrailingCommas } = await import("./autopermit.ts")
const writeState = (value: unknown) => writeFileSync(STATE_FILE, JSON.stringify(value), "utf8")
const clearState = () => rmSync(STATE_FILE, { force: true })
const { DATA_FILE, DEFAULTS, FEATURES, FEATURE_DEFAULTS, STATE_FILE, cfgStr, featureConfig, featureConfigMap, featureMap, featureOn, featureStored, loadState, logCall, maskUrl, migrateDataFile, migrateLegacyLayout, migrateLocalState, migrateStatePath, newSince, pluginEnabled, pruneLog, readLog: readCallLog, saveData, saveState, setEnabled, setFeature, setFeatureConfig, sidebarLine, sidebarLines, toastLine, toastOutcomeAllowed, toastsOn } = await import(
  "../../../lib/lib-jev/state.ts"
)
type JevState = import("../../../lib/lib-jev/state.ts").JevState

afterAll(() => rmSync(scratch, { recursive: true, force: true }))

const thresholds = { minProbability: 0.8, minMargin: 0.15 }

const choice = { type: "choice" as const, instructions: "pick", criteria: { a: "first", b: "second", c: "third" } }
const score = { type: "score" as const, instructions: "how much", criteria: ["none", "some", "lots"] }

describe("choice", () => {
  test("accepts a top-probability pick and reports the margin", () => {
    const d = normalize("p", choice, {
      type: "choice",
      choice: "b",
      probabilities: { a: 0.09, b: 0.85, c: 0.06 },
      confidence: 0.86,
    }, thresholds)
    expect(d.value).toBe("b")
    expect(d.probability).toBeCloseTo(0.85)
    expect(d.margin).toBeCloseTo(0.76)
    expect(d.confident).toBe(true)
  })

  test("a clear winner still under the probability floor is held back", () => {
    // Both conditions must hold, so a 0.70 top over a 0.20 runner-up is
    // reported as low confidence and the agent decides for itself.
    const d = normalize("p", choice, { type: "choice", choice: "b", probabilities: { a: 0.2, b: 0.7, c: 0.1 } }, thresholds)
    expect(d.margin).toBeCloseTo(0.5)
    expect(d.confident).toBe(false)
    expect(d.note).toMatch(/top probability/)
  })

  test("rejects a choice that is not the argmax", () => {
    expect(() =>
      normalize("p", choice, { type: "choice", choice: "c", probabilities: { a: 0.2, b: 0.7, c: 0.1 } }, thresholds),
    ).toThrow(/not the highest-probability/)
  })

  test("rejects probabilities that do not cover the options", () => {
    expect(() =>
      normalize("p", choice, { type: "choice", choice: "a", probabilities: { a: 1, b: 0 } }, thresholds),
    ).toThrow(/do not match/)
  })

  test("rejects a distribution that does not sum to about one", () => {
    expect(() =>
      normalize("p", choice, { type: "choice", choice: "a", probabilities: { a: 0.5, b: 0.4, c: 0.4 } }, thresholds),
    ).toThrow(/sum to/)
  })

  test("rejects an unknown option label", () => {
    expect(() =>
      normalize("p", choice, { type: "choice", choice: "zzz", probabilities: { a: 0.2, b: 0.7, c: 0.1 } }, thresholds),
    ).toThrow(/not one of the options/)
  })

  test("a near-tie is reported as low confidence, not as an error", () => {
    const d = normalize("p", choice, { type: "choice", choice: "a", probabilities: { a: 0.5, b: 0.49, c: 0.01 } }, thresholds)
    expect(d.confident).toBe(false)
    expect(d.note).toMatch(/margin/)
  })

  test("a clear winner above the floor is confident", () => {
    const d = normalize("p", choice, { type: "choice", choice: "b", probabilities: { a: 0.05, b: 0.9, c: 0.05 } }, thresholds)
    expect(d.confident).toBe(true)
  })

  test("a hand-back label is never confident", () => {
    const d = normalize("p", { ...choice, criteria: { a: "first", propagate: "give up" } },
      { type: "choice", choice: "propagate", probabilities: { a: 0.01, propagate: 0.99 } }, thresholds)
    expect(d.value).toBe("propagate")
    expect(d.confident).toBe(false)
    expect(d.note).toMatch(/hand-back/)
  })
})

describe("noul", () => {
  const noul = { type: "noul" as const, instructions: "is it true" }

  test("treats the value as P(yes), not as the answer", () => {
    expect(normalize("v", noul, { type: "noul", noul: 0.95 }, thresholds).value).toBe(true)
    expect(normalize("v", noul, { type: "noul", noul: 0.05 }, thresholds).value).toBe(false)
  })

  test("a value near 0.5 is not confident", () => {
    expect(normalize("v", noul, { type: "noul", noul: 0.52 }, thresholds).confident).toBe(false)
    expect(normalize("v", noul, { type: "noul", noul: 0.97 }, thresholds).confident).toBe(true)
  })

  test("rejects an out-of-range probability", () => {
    expect(() => normalize("v", noul, { type: "noul", noul: 1.4 }, thresholds)).toThrow(JevError)
  })
})

describe("score", () => {
  test("accepts a level index with a complete legend", () => {
    const d = normalize("s", score, {
      type: "score", score: 2,
      probabilities: { "0": 0.1, "1": 0.2, "2": 0.7 },
      legend: { "0": "none", "1": "some", "2": "lots" },
    }, thresholds)
    expect(d.value).toBe(2)
    expect(d.margin).toBeCloseTo(0.5)
  })

  test("rejects a legend that misses a level", () => {
    expect(() => normalize("s", score, {
      type: "score", score: 1,
      probabilities: { "0": 0.4, "1": 0.6, "2": 0.0 },
      legend: { "0": "none", "1": "some" },
    }, thresholds)).toThrow(/legend/)
  })

  test("rejects a distribution whose level count is wrong", () => {
    expect(() => normalize("s", score, {
      type: "score", score: 1, probabilities: { "0": 0.4, "1": 0.6 },
      legend: { "0": "none", "1": "some" },
    }, thresholds)).toThrow(/score levels/)
  })

  test("rejects a score past the last level", () => {
    expect(() => normalize("s", score, {
      type: "score", score: 5, probabilities: { "0": 0.1, "1": 0.1, "2": 0.8 },
      legend: { "0": "none", "1": "some", "2": "lots" },
    }, thresholds)).toThrow(/outside/)
  })

  test("rejects a score question with fewer than two levels", () => {
    expect(() => normalize("s", { ...score, criteria: ["only"] }, {
      type: "score", score: 0, probabilities: { "0": 1 }, legend: { "0": "only" },
    }, thresholds)).toThrow(/at least 2/)
  })
})

describe("redact", () => {
  test("strips a bearer token but keeps the shape", () => {
    const out = redact("Authorization: Bearer sk-abcdefghijklmnopqrstuvwx") as string
    expect(out).not.toContain("sk-abcdefghijklmnopqrstuvwx")
    expect(out).toContain("Bearer")
  })

  test("strips a secret assignment, keeps the key name", () => {
    const out = redact('api_key = "hunter2000000"') as string
    expect(out).toContain("api_key")
    expect(out).not.toContain("hunter2000000")
  })

  test("strips a PEM private key block whole", () => {
    const pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIabc\ndef\n-----END RSA PRIVATE KEY-----"
    expect(redact(pem) as string).not.toContain("MIIabc")
  })

  test("walks nested structures and leaves ordinary text alone", () => {
    const out = redact({ note: "the parser opens files without encoding", list: ["ok", "ghp_abcdefghijklmnopqrstuvwxyz1234"] }) as any
    expect(out.note).toBe("the parser opens files without encoding")
    expect(out.list[0]).toBe("ok")
    expect(out.list[1]).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz1234")
  })
})

describe("answersOf", () => {
  test("accepts the native top-level envelope", () => {
    const { answers, inputTokens } = answersOf({ answers: { pick: { type: "choice" } }, usage: { input_tokens: 50 } })
    expect(answers.pick.type).toBe("choice")
    expect(inputTokens).toBe(50)
  })

  test("accepts the nested result envelope a gateway returns", () => {
    // Measured live 2026-10-12: this deployment's endpoint wraps the System
    // One payload as { result: { answers, usage }, success }.
    const { answers, inputTokens } = answersOf({
      result: {
        model: "clef-flash",
        answers: { pick: { type: "choice", choice: "commit", probabilities: { commit: 0.99 } } },
        usage: { input_tokens: 162, output_tokens: 0 },
      },
      success: true,
      errors: [],
      messages: [],
    })
    expect(answers.pick.choice).toBe("commit")
    expect(inputTokens).toBe(162)
  })

  test("refuses a body with neither shape", () => {
    expect(() => answersOf({ success: true })).toThrow(/no answers object/)
  })
})

describe("tool action scope", () => {
  test("tool names normalize to the action the host sends", () => {
    // The host sends a permission action, not a tool name: `bash` is the
    // older shell tool, `write` and `patch` are edits.
    expect(normalizeAction("bash")).toBe("shell")
    expect(normalizeAction("write")).toBe("edit")
    expect(normalizeAction("patch")).toBe("edit")
    expect(normalizeAction("shell")).toBe("shell")
    expect(normalizeAction("READ")).toBe("read")
  })

  test("only the configured actions are examined", () => {
    clearState()
    expect(actionsInScope("hook_tool_risk", "shell")).toBe(true)
    expect(actionsInScope("hook_tool_risk", "edit")).toBe(true)
    // A read is not judged, so the hook never spends on one.
    expect(actionsInScope("hook_tool_risk", "read")).toBe(false)
    expect(actionsInScope("hook_tool_risk", "webfetch")).toBe(false)
  })

  test("a tool name in the setting means the same action", () => {
    setFeatureConfig("hook_tool_risk", "actions", "write,bash")
    expect(actionsInScope("hook_tool_risk", "edit")).toBe(true)
    expect(actionsInScope("hook_tool_risk", "shell")).toBe(true)
    expect(actionsInScope("hook_tool_risk", "read")).toBe(false)
    setFeatureConfig("hook_tool_risk", "actions", "shell,edit")
  })

  test("an empty filter examines nothing", () => {
    setFeatureConfig("hook_tool_risk", "actions", "")
    expect(actionsInScope("hook_tool_risk", "shell")).toBe(false)
    setFeatureConfig("hook_tool_risk", "actions", "shell,edit")
  })
})

describe("verdict outcomes", () => {
  const info = {
    sessionID: "ses_x",
    action: "shell",
    resources: ["rm -rf ./build"],
    subject: {},
    text: "shell: rm -rf ./build",
    dir: scratch,
  }

  test("allow lets the call through, even one the host wanted to ask about", () => {
    expect(verdictOutcome("allow", 0.9, info)?.effect).toBe("allow")
  })

  test("deny blocks with a reason the agent reads", () => {
    const out = verdictOutcome("deny", 0.87, info)!
    expect(out.effect).toBe("deny")
    expect(out.message).toContain("P=0.87")
  })

  test("abort stops the session and notifies, distinct from deny", () => {
    const out = verdictOutcome("abort", 0.91, info)!
    expect(out.effect).toBe("abort")
    expect(out.message).toContain("P=0.91")
  })

  test("an unknown verdict fails closed to propagate, never allow", () => {
    const cli = join(scratch, "prompt-cli.json")
    writeFileSync(cli, `{"session":{"permissions":"prompt"}}`)
    process.env[CONFIG_PATH_ENV] = cli
    resetAutoAcceptCache()
    try {
      const out = verdictOutcome("alert" as any, 0.91, info)!
      expect(out.effect).toBe("propagate")
    } finally {
      delete process.env[CONFIG_PATH_ENV]
      resetAutoAcceptCache()
    }
  })

  test("the stronger outcome wins; abort beats deny", () => {
    expect(stronger({ effect: "propagate" }, { effect: "allow" })?.effect).toBe("propagate")
    expect(stronger({ effect: "deny" }, { effect: "propagate" })?.effect).toBe("deny")
    expect(stronger({ effect: "abort" }, { effect: "deny" })?.effect).toBe("abort")
    expect((verdictOutcome("allow", 0.9, info) as any).alert).toBeUndefined()
    expect(stronger(null, { effect: "deny" })?.effect).toBe("deny")
    expect(stronger({ effect: "deny" }, null)?.effect).toBe("deny")
  })
})

describe("an unsure verdict", () => {
  const info = {
    sessionID: "ses_unsure",
    action: "shell",
    resources: ["rm -rf ./build"],
    subject: {},
    text: "shell: rm -rf ./build",
  }

  afterEach(() => {
    delete process.env[CONFIG_PATH_ENV]
    resetAutoAcceptCache()
    setFeatureConfig("hook_tool_risk", "undecided", FEATURE_DEFAULTS.hook_tool_risk.undecided)
  })

  test("undecided=propagate hands a low-confidence verdict to the supervisor hold", () => {
    const file = join(scratch, "cli.json")
    writeFileSync(file, `{"session":{"permissions":"prompt"}}`)
    process.env[CONFIG_PATH_ENV] = file
    resetAutoAcceptCache()
    expect(FEATURE_DEFAULTS.hook_tool_risk.undecided).toBe("propagate")
    setFeatureConfig("hook_tool_risk", "undecided", "propagate")
    expect(undecidedOutcome(info as any)?.effect).toBe("propagate")
    setFeatureConfig("hook_tool_risk", "undecided", "allow")
    expect(undecidedOutcome(info as any)).toBeNull()
  })
})

describe("a propagate in auto-accept mode", () => {
  const info = {
    sessionID: "ses_prop",
    action: "shell",
    resources: ["rm -rf ./build"],
    subject: {},
    text: "shell: rm -rf ./build",
    dir: scratch,
  }

  afterEach(() => {
    delete process.env[CONFIG_PATH_ENV]
    resetAutoAcceptCache()
  })

  const clientMode = (mode: string) => {
    const file = join(scratch, "cli.json")
    writeFileSync(file, `{"session":{"permissions":"${mode}"}}`)
    process.env[CONFIG_PATH_ENV] = file
    resetAutoAcceptCache()
  }

  test("while the client prompts, a propagate is an ordinary propagate", () => {
    clientMode("prompt")
    const out = propagateOutcome(info, "why")
    expect(out.effect).toBe("propagate")
    expect(out.token).toBeUndefined()
  })

  test("while the client auto-accepts, a propagate blocks and records the call", () => {
    // The client answers its own permission requests in that mode, so a propagate
    // would never reach a human: the call is blocked and recorded instead.
    clientMode("autoaccept")
    const out = propagateOutcome(info, "why")
    expect(out.effect).toBe("deny")
    expect(out.token).toMatch(/^[0-9a-f]{6}$/)
    expect(out.message).toContain(`/jev-approve ${out.token}`)
    const pending = readApprovals(600)
    expect(pending.map((a) => a.token)).toContain(out.token)
  })
})

describe("feature switches", () => {
  test("every feature is present after an old state file with no features key", () => {
    const migrated = featureMap({})
    expect(Object.keys(migrated).sort()).toEqual(FEATURES.map((f) => f.key).sort())
    // Every hook is opt-in.
    expect(migrated.hook_skill_pick).toBe(false)
    expect(migrated.hook_tool_risk).toBe(false)
    expect(migrated.hook_tool_standard).toBe(false)
  })

  test("a pre-features state file keeps its gate as the risk hook", () => {
    expect(featureMap(undefined, true).hook_tool_risk).toBe(true)
    expect(featureMap(undefined, false).hook_tool_risk).toBe(false)
    expect(featureMap(undefined).hook_tool_risk).toBe(false)
    // An explicit features map wins over the legacy key.
    expect(featureMap({ hook_tool_risk: false }, true).hook_tool_risk).toBe(false)
  })

  test("the old risk hook carries over to the new one", () => {
    expect(featureMap({ hook_risk: true }).hook_tool_risk).toBe(true)
    expect(featureMap({ risk_hook: true }).hook_tool_risk).toBe(true)
  })

  test("only known keys are honoured, so a typo cannot invent a switch", () => {
    const map = featureMap({ hook_skill_pick: true, bogus_feature: false })
    expect(map.hook_skill_pick).toBe(true)
    expect("bogus_feature" in map).toBe(false)
  })
})

describe("per-feature config", () => {
  test("defaults cover every feature's fields", () => {
    const cfg = featureConfigMap(undefined)
    for (const f of FEATURES) {
      expect(cfg[f.key]).toBeDefined()
      for (const [key, v] of Object.entries(FEATURE_DEFAULTS[f.key])) {
        expect(typeof cfg[f.key][key]).toBe(typeof v)
      }
    }
  })

  test("a stored partial config falls back per field, not per feature", () => {
    const cfg = featureConfigMap({ hook_skill_pick: { timeout: 500 } })
    expect(cfg.hook_skill_pick.timeout).toBe(500)
    // The sibling fields keep their defaults rather than vanishing.
    expect(cfg.hook_skill_pick.minProbability).toBe(FEATURE_DEFAULTS.hook_skill_pick.minProbability)
  })

  test("non-numeric and unknown values are dropped", () => {
    const cfg = featureConfigMap({ hook_skill_pick: { timeout: "fast", bogus: 1 }, hook_tool_risk: "nope" })
    expect(cfg.hook_skill_pick.timeout).toBe(FEATURE_DEFAULTS.hook_skill_pick.timeout)
    expect("bogus" in cfg.hook_skill_pick).toBe(false)
    expect(cfg.hook_tool_risk.timeout).toBe(FEATURE_DEFAULTS.hook_tool_risk.timeout)
  })

  test("legacy global thresholds seed the per-feature config", () => {
    writeState({ minProbability: 0.9, minMargin: 0.2, gateProbability: 0.6 })
    const s = loadState()
    expect(s.config.hook_skill_pick.minProbability).toBe(0.9)
    expect(s.config.hook_skill_pick.minMargin).toBe(0.2)
    // The old block bar becomes the new verdict bar.
    expect(s.config.hook_tool_risk.minProbability).toBe(0.6)
    // The old top-level keys are gone from the loaded state.
    expect((s as any).minProbability).toBeUndefined()
  })

  test("a pre-rename state file keeps its hooks on and its config", () => {
    writeState({
      features: { pick_skill: true, risk_hook: true },
      config: { pick_skill: { timeout: 777 }, risk_hook: { timeout: 999, gateProbability: 0.9, minProbability: 0.95 } },
    })
    const s = loadState()
    expect(s.features.hook_skill_pick).toBe(true)
    expect(s.features.hook_tool_risk).toBe(true)
    expect(s.config.hook_skill_pick.timeout).toBe(777)
    // The timeout carries over. The probability floors do not: the old hook
    // judged one binary question, the new one judges a four-way verdict, so
    // the same number would mean something else.
    expect(s.config.hook_tool_risk.timeout).toBe(999)
    expect(s.config.hook_tool_risk.minProbability).toBe(FEATURE_DEFAULTS.hook_tool_risk.minProbability)
  })

  test("a persisted session-ban key and its tuned config survive the rename", () => {
    writeState({
      features: { hook_no_respawn: true },
      config: { hook_no_respawn: { holdMs: 12345, bindGraceMs: 4321, admissionWindowMs: 6789, toast: false, toastOutcomes: "allow" } },
    })
    const s = loadState()
    expect(s.features.hook_session_ban).toBe(true)
    expect(s.config.hook_session_ban.holdMs).toBe(12345)
    expect(s.config.hook_session_ban.bindGraceMs).toBe(4321)
    expect(s.config.hook_session_ban.admissionWindowMs).toBe(6789)
    expect(s.config.hook_session_ban.toast).toBe(false)
    expect(s.config.hook_session_ban.toastOutcomes).toBe("allow")
    // A new key wins over the legacy one.
    writeState({
      features: { hook_no_respawn: true, hook_session_ban: false },
      config: { hook_no_respawn: { holdMs: 111 }, hook_session_ban: { holdMs: 222 } },
    })
    const explicit = loadState()
    expect(explicit.features.hook_session_ban).toBe(false)
    expect(explicit.config.hook_session_ban.holdMs).toBe(222)
  })

  test("the YOLO branch and the approval lifetime are global settings", () => {
    writeState({ yoloAsk: "no-op", approveTtl: 30 })
    const s = loadState()
    expect(s.yoloAsk).toBe("no-op")
    expect(s.approveTtl).toBe(30)
    // Anything else is the safe default.
    writeState({ yoloAsk: "nonsense" })
    expect(loadState().yoloAsk).toBe("block-notify")
    // The old spelling still reads: the field was renamed, not the meaning.
    writeState({ yoloPropagate: "no-op" })
    expect(loadState().yoloAsk).toBe("no-op")
  })

  test("logMax reads from state with a floor", () => {
    writeState({ logMax: 100 })
    expect(loadState().logMax).toBe(100)
    writeState({ logMax: 2 })
    expect(loadState().logMax).toBe(10)
  })

  test("a stored config value beats the legacy seed", () => {
    writeState({ minProbability: 0.9, config: { hook_skill_pick: { minProbability: 0.7 } } })
    expect(loadState().config.hook_skill_pick.minProbability).toBe(0.7)
  })

  test("setFeatureConfig writes one field and refuses unknown ones", () => {
    // The previous tests left their state file behind; start from defaults.
    clearState()
    setFeatureConfig("hook_skill_pick", "timeout", 2000)
    expect(featureConfig("hook_skill_pick").timeout).toBe(2000)
    // Sibling fields survive the write.
    expect(featureConfig("hook_skill_pick").minProbability).toBe(FEATURE_DEFAULTS.hook_skill_pick.minProbability)
    expect(() => setFeatureConfig("hook_skill_pick", "bogus", 1)).toThrow(/unknown/)
    expect(() => setFeatureConfig("bogus_feature", "timeout", 1)).toThrow(/unknown/)
    setFeatureConfig("hook_skill_pick", "timeout", FEATURE_DEFAULTS.hook_skill_pick.timeout)
  })

  test("a numeric setting takes the feature key, not the row label", () => {
    clearState()
    // The settings panel once passed the row label here ("Skill picker"), so
    // every numeric row threw "unknown jev feature" and saved nothing.
    setFeatureConfig("hook_skill_pick", "maxPicks", 2)
    expect(featureConfig("hook_skill_pick").maxPicks).toBe(2)
    expect(() => setFeatureConfig("Skill picker", "maxPicks", 3)).toThrow(/unknown jev feature/)
    clearState()
  })

  test("pruneLog keeps the tail at logMax", async () => {
    const { LOG_FILE } = await import("../../../lib/lib-jev/state.ts")
    clearState()
    rmSync(LOG_FILE, { force: true })
    setFeatureConfig("hook_skill_pick", "timeout", FEATURE_DEFAULTS.hook_skill_pick.timeout) // writes default state, logMax=500
    for (let i = 0; i < 600; i++) logCall({ i })
    // Prune fires every 16th write; 600 writes guarantee at least one pass.
    pruneLog()
    const lines = (await Bun.file(LOG_FILE).text()).split("\n").filter(Boolean)
    expect(lines.length).toBeLessThanOrEqual(500)
    // The tail survived: the last write is the newest entry.
    expect(JSON.parse(lines[lines.length - 1]).i).toBe(599)
    rmSync(LOG_FILE, { force: true })
  })
})

describe("master switch", () => {
  test("on by default, and both hooks default to off", () => {
    expect(pluginEnabled()).toBe(true)
    expect(FEATURES.every((f) => !featureStored(f.key))).toBe(true)
  })

  test("turning the plugin off gates every feature without touching their settings", () => {
    setFeature("hook_skill_pick", true)
    setEnabled(false)
    for (const f of FEATURES) expect(featureOn(f.key)).toBe(false)
    // The stored settings are untouched, so turning it back on restores them.
    expect(featureStored("hook_skill_pick")).toBe(true)
    expect(featureStored("hook_tool_risk")).toBe(false)
    setEnabled(true)
    expect(featureOn("hook_skill_pick")).toBe(true)
    expect(featureOn("hook_tool_risk")).toBe(false)
  })

  test("a feature switched off stays off when the plugin comes back", () => {
    setFeature("hook_skill_pick", false)
    setEnabled(false)
    setEnabled(true)
    expect(featureStored("hook_skill_pick")).toBe(false)
    expect(featureOn("hook_skill_pick")).toBe(false)
  })
})

describe("rules file", () => {
  test("YAML and JSON both load, because YAML reads JSON", () => {
    const yaml = parseRules('rules:\n  - id: a\n    text: does a thing\n')
    expect(yaml).toHaveLength(1)
    expect(yaml[0].id).toBe("a")
    const json = parseRules('{"rules":[{"id":"a","text":"does a thing"}]}')
    expect(json[0].id).toBe("a")
  })

  test("a bare list is a rule list too", () => {
    expect(parseRules('- id: a\n  text: t\n')).toHaveLength(1)
  })

  test("a typo in a rule is loud, not silent", () => {
    expect(() => parseRules('rules:\n  - id: a\n    text: t\n    treshold: 0.5\n')).toThrow(/unknown field/)
    expect(() => parseRules('rules:\n  - id: a\n')).toThrow(/no text/)
    expect(() => parseRules('rules:\n  - text: t\n')).toThrow(/no id/)
    expect(() => parseRules('rules:\n  - id: a\n    text: t\n    threshold: 2\n')).toThrow(/probability/)
    expect(() => parseRules('rules:\n  - id: a\n    text: t\n    effect: maybe\n')).toThrow(/effect/)
    expect(() => parseRules('rules:\n  - id: a\n    text: t\n    match: { acton: shell }\n')).toThrow(/unknown match field/)
  })

  test("two rules cannot share an id", () => {
    expect(() => parseRules('rules:\n  - id: a\n    text: t\n  - id: a\n    text: u\n')).toThrow(/duplicate/)
  })

  test("the match is a whole-value wildcard", () => {
    expect(matchesPattern("curl *", "curl http://x")).toBe(true)
    // A pattern ending in " *" also matches the bare value.
    expect(matchesPattern("curl *", "curl")).toBe(true)
    expect(matchesPattern("curl *", "wget http://x")).toBe(false)
    expect(matchesPattern("*.env", "secrets/.env")).toBe(true)
    expect(matchesPattern("*.env", "secrets/.env.local")).toBe(false)
    expect(matchesPattern("?s", "ls")).toBe(true)
    expect(matchesPattern("?s", "lls")).toBe(false)
  })

  test("a rule applies to its action and any of its resources", () => {
    const rule: Rule = { id: "a", match: { action: "shell", resource: "curl *" }, text: "t" }
    expect(ruleApplies(rule, "shell", ["curl http://x"])).toBe(true)
    expect(ruleApplies(rule, "shell", ["ls"])).toBe(false)
    expect(ruleApplies(rule, "edit", ["curl http://x"])).toBe(false)
    const any: Rule = { id: "b", match: {}, text: "t" }
    expect(ruleApplies(any, "read", ["anything"])).toBe(true)
  })

  test("a {file:...} reference becomes the file's contents", () => {
    writeFileSync(join(scratch, "policy.md"), "no secrets in the logs")
    const out = expandFileRefs("the rule is in {file:policy.md}", scratch, 8000)
    expect(out.text).toContain("no secrets in the logs")
    expect(out.missing).toEqual([])
  })

  test("a file that cannot be read is reported, so its rule is skipped", () => {
    const out = expandFileRefs("see {file:nope.md}", scratch, 8000)
    expect(out.missing).toEqual(["nope.md"])
  })

  test("the injected contents are capped", () => {
    writeFileSync(join(scratch, "big.md"), "x".repeat(500))
    const out = expandFileRefs("{file:big.md}", scratch, 100)
    expect(out.text.length).toBeLessThan(200)
  })
})

describe("approve flow", () => {
  test("the token is the identity of the call", () => {
    const a = callToken("ses_x", "shell", ["ls", "pwd"])
    // The order of the resources does not change the call.
    expect(a).toBe(callToken("ses_x", "shell", ["pwd", "ls"]))
    expect(a).not.toBe(callToken("ses_y", "shell", ["ls", "pwd"]))
    expect(a).not.toBe(callToken("ses_x", "edit", ["ls", "pwd"]))
    expect(a).toMatch(/^[0-9a-f]{6}$/)
  })

  test("a grant lets one call through and is then gone", () => {
    grant("abc123", "ses_x")
    expect(consumeGrant("abc123")).toBe(true)
    expect(consumeGrant("abc123")).toBe(false)
  })

  test("a blocked call is recorded", () => {
    recordApproval(
      { token: "aaa111", sessionID: "ses_x", action: "shell", resources: ["rm -rf /"], subject: "shell: rm -rf /", reason: "why", ts: new Date().toISOString() },
      600,
    )
    expect(readApprovals(600).map((a) => a.token)).toContain("aaa111")
  })

  test("a blocked call past its lifetime is gone", () => {
    recordApproval(
      {
        token: "bbb222",
        sessionID: "ses_x",
        action: "shell",
        resources: [],
        subject: "",
        reason: "",
        ts: new Date(Date.now() - 3_600_000).toISOString(),
      },
      600,
    )
    expect(readApprovals(600).map((a) => a.token)).not.toContain("bbb222")
  })
})

describe("auto-accept detection", () => {
  const cli = join(scratch, "cli.json")

  afterEach(() => {
    delete process.env[CONTENT_ENV]
    delete process.env[CONFIG_PATH_ENV]
    resetAutoAcceptCache()
  })

  const writeCli = (text: string) => {
    writeFileSync(cli, text, "utf8")
    process.env[CONFIG_PATH_ENV] = cli
    resetAutoAcceptCache()
  }

  test("the palette toggle's value is the signal", () => {
    writeCli('{"session":{"permissions":"autoaccept"}}')
    expect(autoAccept()).toBe(true)
    writeCli('{"session":{"permissions":"prompt"}}')
    expect(autoAccept()).toBe(false)
  })

  test("prompt mode, an absent key, and junk all mean the check runs", () => {
    writeCli('{"session":{"permissions":"prompt"}}')
    expect(autoAccept()).toBe(false)
    writeCli('{"session":{}}')
    expect(autoAccept()).toBe(false)
    writeCli('{"permission":"allow"}')
    expect(autoAccept()).toBe(false)
    writeCli("{ not json")
    expect(autoAccept()).toBe(false)
    // No file at all: fail toward running the check.
    process.env[CONFIG_PATH_ENV] = join(scratch, "missing.json")
    resetAutoAcceptCache()
    expect(autoAccept()).toBe(false)
  })

  test("the host's own content override wins over the file", () => {
    writeCli('{"session":{"permissions":"prompt"}}')
    process.env[CONTENT_ENV] = '{"session":{"permissions":"autoaccept"}}'
    expect(autoAccept()).toBe(true)
  })

  test("a change to the file is picked up without a restart", () => {
    writeCli('{"session":{"permissions":"prompt"}}')
    expect(autoAccept()).toBe(false)
    writeCli('{"session":{"permissions":"autoaccept"}}')
    expect(autoAccept()).toBe(true)
  })

  test("cli.json is JSONC: a trailing comma parses, and a comma inside a string survives", () => {
    writeCli('{"plugins":["a",],"session":{"permissions":"autoaccept",},}')
    expect(autoAccept()).toBe(true)
    // A value holding ",]" keeps its comma: stripping there would corrupt JSON.
    expect(stripTrailingCommas('{"a":"x,]","b":1,}')).toBe('{"a":"x,]","b":1}')
    expect(parseConfig('{"a":"x,]","session":{"permissions":"prompt"}}')?.a).toBe("x,]")
  })

  test("an escaped quote does not end the string early", () => {
    // The value is q", — the comma is inside the string, and the one after the
    // closing quote is the trailing comma.
    expect(parseConfig('{"a":"q\\",","session":{"permissions":"autoaccept"}}')?.a).toBe('q",')
    expect(parseConfig('{"a":"q\\",","session":{"permissions":"autoaccept"}}')?.session.permissions).toBe("autoaccept")
  })
})

describe("call toasts", () => {
  test("a decision, a skip, and a failure each render under a hook title", () => {
    expect(
      toastLine({
        hook: "hook_tool_risk",
        decisions: [{ id: "verdict", kind: "choice", value: "deny", probability: 0.87, confident: true }],
        subject: "shell command: rm -rf ./build",
        inputTokens: 120,
      }),
    ).toEqual({
      title: "hook_tool_risk: deny (0.87)",
      message: "* shell command: rm -rf ./build\n* 120tok",
      variant: "info",
    })
    expect(toastLine({ hook: "hook_skill_pick", skipped: "low confidence: margin 0.05" })).toEqual({
      title: "hook_skill_pick",
      message: "* low confidence: margin 0.05",
      variant: "info",
    })
    expect(toastLine({ hook: "hook_tool_risk", error: "Jev HTTP 401" })).toEqual({
      title: "hook_tool_risk",
      message: "* Jev HTTP 401",
      variant: "error",
    })
    // No hook, no feature to attribute it to, so no toast.
    expect(toastLine({ decisions: [] })).toBeNull()
  })

  test("an explicit verdict names the toast", () => {
    const line = toastLine({ hook: "hook_tool_risk", verdict: "accept", confidence: 0.99 })!
    expect(line.title).toBe("hook_tool_risk: accept (0.99)")
  })

  test("a blocked call shows what to type to let it through", () => {
    const line = toastLine({
      hook: "hook_tool_risk",
      verdict: "deny",
      confidence: 0.87,
      blocked: "denied (P=0.87)",
      token: "a3f9c1",
      subject: "shell: rm -rf ./build",
    })!
    expect(line.title).toBe("hook_tool_risk: deny (0.87)")
    expect(line.message).toBe("* blocked: denied (P=0.87)\n* approve: /jev-approve a3f9c1\n* shell: rm -rf ./build")
    expect(line.variant).toBe("error")
  })

  test("only the rules that fired are listed", () => {
    const line = toastLine({
      hook: "hook_tool_standard",
      verdict: "block",
      confidence: 0.93,
      rules: [
        { id: "no-rm", probability: 0.93, violated: true },
        { id: "no-curl", probability: 0.04, violated: false },
      ],
    })!
    expect(line.title).toBe("hook_tool_standard: block (0.93)")
    expect(line.message).toBe("* no-rm=yes (0.93)")
  })

  test("a rule score reads as yes or no, with the rule's name", () => {
    const line = toastLine({ hook: "hook_tool_standard", decisions: [{ id: "no-exfil", kind: "noul", value: true, probability: 0.87, confident: true }] })!
    expect(line.title).toBe("hook_tool_standard: no-exfil=yes (0.87)")
  })

  test("a long tool call is clipped onto one line", () => {
    const line = toastLine({ hook: "hook_risk", decisions: [], subject: `bash -c ${"x".repeat(400)}` })!
    expect(line.message.startsWith("* bash -c ")).toBe(true)
    expect(line.message.endsWith("…")).toBe(true)
    expect(line.message.split("\n")).toHaveLength(1)
  })

  test("the tail returns new entries oldest-first and advances past them", () => {
    const rows = [
      { ts: "2026-10-15T10:00:03Z", hook: "hook_risk" },
      { ts: "2026-10-15T10:00:02Z", hook: "hook_skill_pick" },
      { ts: "2026-10-15T10:00:01Z", hook: "hook_skill_pick" },
    ]
    const { fresh, after } = newSince(rows, "2026-10-15T10:00:02Z")
    expect(fresh.map((r) => r.ts)).toEqual(["2026-10-15T10:00:03Z"])
    expect(after).toBe("2026-10-15T10:00:03Z")
    // Nothing new: the cursor holds, and an entry with no ts is never fresh.
    const idle = newSince([{ hook: "hook_risk" }, { ts: "2026-10-15T10:00:03Z" }], after)
    expect(idle.fresh).toEqual([])
    expect(idle.after).toBe(after)
  })

  test("a backwards clock jump moves the cursor back instead of muting", () => {
    const { fresh, after } = newSince([{ ts: "2020-01-01T00:00:00Z" }], "2026-10-15T10:00:00Z")
    expect(fresh).toEqual([])
    expect(after).toBe("2020-01-01T00:00:00Z")
  })

  test("a low-confidence answer is marked in the line", () => {
    const line = toastLine({ hook: "hook_skill_pick", decisions: [{ id: "pick", value: "commit", confident: false }] })!
    expect(line.title).toBe("hook_skill_pick: commit (low)")
  })

  test("the global switch, then the feature's own, gates a toast", () => {
    clearState()
    // Every feature defaults to toasting; the global switch is off by default.
    expect(FEATURES.every((f) => FEATURE_DEFAULTS[f.key].toast === true)).toBe(true)
    expect(toastsOn("hook_tool_risk")).toBe(false)
    saveState({ toast: true })
    expect(toastsOn("hook_tool_risk")).toBe(true)
    setFeatureConfig("hook_tool_risk", "toast", false)
    expect(toastsOn("hook_tool_risk")).toBe(false)
    // The other feature keeps its own value.
    expect(toastsOn("hook_skill_pick")).toBe(true)
    // An entry naming no known feature never toasts.
    expect(toastsOn("not_a_feature")).toBe(false)
    saveState({ toast: false })
    setFeatureConfig("hook_tool_risk", "toast", true)  })
})

describe("toast outcomes", () => {
  test("a routine call stays quiet and a blocked one does not", () => {
    clearState()
    expect(toastOutcomeAllowed({ hook: "hook_tool_risk", outcome: "deny", acted: true })).toBe(true)
    expect(toastOutcomeAllowed({ hook: "hook_tool_risk", outcome: "abort", acted: true })).toBe(true)
    expect(toastOutcomeAllowed({ hook: "hook_tool_risk", outcome: "allow", acted: true })).toBe(false)
    expect(toastOutcomeAllowed({ hook: "hook_tool_risk", outcome: "propagate", acted: true })).toBe(false)
    expect(toastOutcomeAllowed({ hook: "hook_tool_standard", outcome: "deny", acted: true })).toBe(true)
    expect(toastOutcomeAllowed({ hook: "hook_tool_standard", outcome: "allow", acted: true })).toBe(false)
  })

  test("the list is the feature's own setting", () => {
    setFeatureConfig("hook_tool_risk", "toastOutcomes", "all")
    expect(toastOutcomeAllowed({ hook: "hook_tool_risk", outcome: "allow", acted: true })).toBe(true)
    setFeatureConfig("hook_tool_risk", "toastOutcomes", "deny,abort")
    expect(toastOutcomeAllowed({ hook: "hook_tool_risk", outcome: "allow", acted: true })).toBe(false)
  })

  test("a skip is never announced: nothing was decided, so there is nothing to say", () => {
    expect(toastOutcomeAllowed({ hook: "hook_skill_pick", skipped: "low confidence: margin 0.05" })).toBe(false)
    expect(toastOutcomeAllowed({ hook: "hook_tool_risk", skipped: "cached verdict" })).toBe(false)
    // A call that was decided announces, and a feature with no list always does.
    expect(toastOutcomeAllowed({ hook: "hook_skill_pick", decisions: [{ id: "pick", value: "commit", confident: true }] })).toBe(true)
  })
})

describe("sidebar line", () => {
  test("the hook, the verdict, and the call", () => {
    expect(sidebarLine({ hook: "hook_tool_risk", verdict: "deny", acted: true, subject: "shell: rm -rf ./build" })).toBe("risk deny rm -rf ./build")
    expect(sidebarLine({ hook: "hook_tool_standard", verdict: "block", acted: true, subject: "edit: secrets/.env" })).toBe("rules block secrets/.env")
    expect(
      sidebarLine({ hook: "hook_skill_pick", decisions: [{ id: "pick", value: "commit", confident: true }], subject: "review the plugin" }),
    ).toBe("pick commit review the plugin")
  })

  test("the call is clipped, the action prefix is not repeated", () => {
    const long = "shell: docker build -t registry.fazuh.com/9router:0.5.104-fazuh2 --build-arg APP_VERSION=0.5.104 ~/Projects/9router"
    const line = sidebarLine({ hook: "hook_tool_risk", verdict: "allow", acted: true, subject: long })!
    expect(line.startsWith("risk allow docker build")).toBe(true)
    expect(line.length).toBeLessThanOrEqual(36)
  })

  test("a row that decided nothing says nothing", () => {
    expect(sidebarLine({ hook: "hook_tool_risk", skipped: "cached verdict" })).toBeNull()
    expect(sidebarLine({ hook: "hook_tool_risk", error: "Jev HTTP 401" })).toBe("risk err 401")
  })

  test("a pick the model was not sure about is not shown", () => {
    // The skill picker injects advice only when it is sure, so a doubtful
    // pick is not a decision.
    expect(sidebarLine({ hook: "hook_skill_pick", decisions: [{ id: "pick", value: "commit", probability: 0.2, confident: false }] })).toBeNull()
    expect(sidebarLine({ hook: "hook_skill_pick", decisions: [{ id: "pick", value: "commit", probability: 0.8, confident: true }] })).toBe(
      "pick commit",
    )
  })

  test("a hook that did not act on the call shows nothing", () => {
    // The risk hook lets an unsure call through: that is no decision.
    expect(sidebarLine({ hook: "hook_tool_risk", verdict: "allow", confidence: 0.4, outcome: "allow", acted: false })).toBeNull()
    expect(sidebarLine({ hook: "hook_tool_risk", verdict: "allow", confidence: 0.9, outcome: "allow", acted: true })).toBe("risk allow")
  })

  test("a provider that fails on every call shows one line, not twenty", () => {
    const rows = [
      { hook: "hook_tool_risk", error: "Jev HTTP 429: quota (reset after 4m 10s)" },
      { hook: "hook_tool_risk", error: "Jev HTTP 429: quota (reset after 3m 54s)" },
      { hook: "hook_tool_risk", error: "Jev HTTP 429: quota (reset after 3m 33s)" },
    ]
    // The reset countdown moves, so the message differs every time; the kind
    // is what tells the failures apart.
    expect(sidebarLines(rows, 5)).toEqual(["risk err 429"])
  })

  test("the sidebar keeps the newest lines and drops what it does not show", () => {
    const rows = [
      { hook: "hook_tool_risk", verdict: "deny", acted: true, subject: "shell: rm -rf ./build" },
      { hook: "hook_tool_risk", skipped: "cached verdict" },
      { hook: "hook_tool_standard", verdict: "block", acted: true, subject: "edit: secrets/.env" },
      { hook: "unknown_hook", verdict: "allow", acted: true, subject: "x" },
    ]
    expect(sidebarLines(rows, 5)).toEqual(["risk deny rm -rf ./build", "rules block secrets/.env"])
    expect(sidebarLines(rows, 1)).toEqual(["risk deny rm -rf ./build"])
  })
})

describe("masked urls", () => {
  test("a webhook url shows the host and the tail, never the whole thing", () => {
    const url = "https://discord.com/api/webhooks/123456789/AbCdEf-secret-token"
    const masked = maskUrl(url)
    expect(masked).toBe("discord.com/…/AbCdEf")
    expect(masked).not.toContain("secret-token")
    expect(masked).not.toContain("123456789")
  })

  test("an empty or broken url is harmless", () => {
    expect(maskUrl("")).toBe("")
    expect(maskUrl("not a url")).toBe("not a url…")
  })
})

describe("legacy layout migration", () => {
  test("moves the state file into data/, where machine-local files belong", () => {
    const root = mkdtempSync(join(tmpdir(), "jev-statepath-"))
    try {
      const oldPath = join(root, "jev-state.json")
      const newPath = join(root, "data", "jev-state.json")
      writeFileSync(oldPath, JSON.stringify({ endpoint: "https://host/v1" }), "utf8")
      expect(migrateStatePath(oldPath, newPath)).toBe("migrated")
      expect(JSON.parse(readFileSync(newPath, "utf8")).endpoint).toBe("https://host/v1")
      // The old file stays as the rollback path.
      expect(existsSync(oldPath)).toBe(true)
      // A second run is a no-op, and so is a missing old file.
      expect(migrateStatePath(oldPath, newPath)).toBe("skipped")
      expect(migrateStatePath(join(root, "nope.json"), newPath)).toBe("skipped")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("splits the combined state file and moves the log", () => {
    const oldDir = join(scratch, "legacy", "data")
    mkdirSync(oldDir, { recursive: true })
    writeFileSync(
      join(oldDir, "jev-state.json"),
      JSON.stringify({
        endpoint: "https://host/v1/systemone",
        model: "m",
        logMax: 700,
        skillCriteria: { demo: { origHash: "abc", terse: "T.", v: 1 } },
        rosterHash: "deadbeef",
      }),
    )
    writeFileSync(join(oldDir, "jev-calls.jsonl"), '{"ts":"x","hook":"hook_skill_pick"}\n')
    const target = {
      state: join(scratch, "legacy", "jev-state.json"),
      data: join(scratch, "legacy", "jev-data.json"),
      log: join(scratch, "legacy", "jev-calls.jsonl"),
    }
    expect(migrateLegacyLayout(oldDir, target)).toBe("migrated")
    const state = JSON.parse(readFileSync(target.state, "utf8"))
    expect(state.endpoint).toBe("https://host/v1/systemone")
    expect(state.skillCriteria).toBeUndefined()
    expect(state.rosterHash).toBeUndefined()
    const data = JSON.parse(readFileSync(target.data, "utf8"))
    expect(data.skillCriteria.demo.terse).toBe("T.")
    expect(data.rosterHash).toBe("deadbeef")
    expect(readFileSync(target.log, "utf8")).toContain("hook_skill_pick")
    // Second run is a no-op: target.state exists now.
    expect(migrateLegacyLayout(oldDir, target)).toBe("skipped")
    rmSync(join(scratch, "legacy"), { recursive: true, force: true })
  })

  test("a missing old file or a corrupt one skips", () => {
    const target = { state: join(scratch, "m2-state.json"), data: join(scratch, "m2-data.json"), log: join(scratch, "m2-log.jsonl") }
    expect(migrateLegacyLayout(join(scratch, "nope"), target)).toBe("skipped")
    const badDir = join(scratch, "bad")
    mkdirSync(badDir, { recursive: true })
    writeFileSync(join(badDir, "jev-state.json"), "{corrupt")
    expect(migrateLegacyLayout(badDir, target)).toBe("skipped")
    rmSync(badDir, { recursive: true, force: true })
  })

  test("moves the cache and the local files into the opencode state root", () => {
    const old = join(scratch, "old-home")
    const home = join(scratch, "new-home")
    mkdirSync(old, { recursive: true })
    writeFileSync(join(old, "jev-data.json"), '{"rosterHash":"h"}')
    const data = join(home, "jev-data.json")
    expect(migrateDataFile(join(old, "jev-data.json"), data)).toBe("migrated")
    expect(JSON.parse(readFileSync(data, "utf8")).rosterHash).toBe("h")
    expect(migrateDataFile(join(old, "jev-data.json"), data)).toBe("skipped")

    writeFileSync(join(old, "jev-approvals.json"), "{}")
    writeFileSync(join(old, "jev-calls.jsonl"), '{"ts":"x"}\n')
    writeFileSync(join(old, "jev-tui.log"), "log")
    const target = {
      approvals: join(home, "jev-approvals.json"),
      grants: join(home, "jev-grants.json"),
      log: join(home, "jev-calls.jsonl"),
      tuiLog: join(home, "jev-tui.log"),
    }
    expect(migrateLocalState(old, target)).toBe("migrated")
    expect(existsSync(target.approvals)).toBe(true)
    expect(existsSync(target.grants)).toBe(false)
    expect(readFileSync(target.log, "utf8")).toContain('"ts":"x"')
    expect(migrateLocalState(old, target)).toBe("skipped")
    rmSync(old, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
  })
})

// ——— /jev-abort ———

/**
 * The plugin's command closures with the host's command draft captured, so a
 * test can call one the way a client does. The synthetic route is the only
 * host capability these closures reach.
 */
const commandContext = (synthetic?: (message: any) => Promise<void>) => {
  const commands: Record<string, any> = {}
  const ctx: any = {
    command: {
      transform: async (fn: any) =>
        fn({
          add: (command: any) => {
            commands[command.name] = command
          },
        }),
    },
  }
  if (synthetic) ctx.session = { synthetic }
  return { ctx, commands }
}

/**
 * The command's body, with its three dependencies injected: the flag, the
 * snapshot read and the host handle. No state directory is touched, so these
 * are pure refusal and routing checks; the abort itself is tested in
 * `session-ban-host.test.ts`.
 */
describe("jev-abort command", () => {
  const KEY = "a".repeat(64)
  const OTHER = "b".repeat(64)

  const record = (over: Record<string, unknown> = {}) => ({
    parentID: "ses_x",
    fingerprint: KEY,
    agent: "general",
    generation: 1,
    frontierAtAdmit: 0,
    callKeys: [],
    childIDs: [],
    retiredAt: null,
    ...over,
  })

  const snapshot = (rows: any[]) => ({
    ok: true,
    reason: "ok",
    audit: "clean",
    snap: { v: 1, parentID: "ses_x", frontierSeq: 0, eventCursor: 0, tasks: Object.fromEntries(rows.map((row) => [row.fingerprint, row])) },
  }) as any

  const fakeHost = (receipt: any = { sealed: true, durable: true, revoked: [], interrupted: [], preserved: [] }) => {
    const calls: any[] = []
    return {
      calls,
      abort: async (request: any) => {
        calls.push(["abort", request])
        return { sessionBanned: 0, sessionBanFailures: [], notified: false, ...receipt }
      },
      abortSession: async (parentID: string, by: string, cause: string) => {
        calls.push(["session", parentID, by, cause])
        return { sealed: true, durable: true, revoked: [], interrupted: [parentID], preserved: [], sessionBanned: 0, sessionBanFailures: [], notified: false }
      },
    }
  }

  test("is registered with the other text commands", () => {
    expect(typeof JEV_COMMANDS["jev-abort"]).toBe("string")
    expect(JEV_COMMANDS["jev-abort"]).toContain("/jev-abort")
  })

  test("refuses while the feature is off, without reading or writing state", async () => {
    let reads = 0
    const host = fakeHost()
    const message = await runAbort("ses_x", "", {
      enabled: () => false,
      read: (() => {
        reads += 1
        return snapshot([])
      }) as any,
      host,
    })
    expect(message).toContain("off")
    expect(reads).toBe(0)
    expect(host.calls).toEqual([])
    expect(existsSync(join(scratch, "session-ban"))).toBe(false)
  })

  test("lists the session's tasks when no target is given", async () => {
    const message = await runAbort(
      "ses_x",
      "",
      { enabled: () => true, read: (() => snapshot([record({ childIDs: ["ses_c"] }), record({ fingerprint: OTHER, agent: "explore", abortedAt: 1 })])) as any, host: fakeHost() },
    )
    expect(message).toContain(KEY.slice(0, 12))
    expect(message).toContain("general")
    expect(message).toContain("gen 1")
    expect(message).toContain("admitted")
    expect(message).toContain("aborted")
    expect(message).toContain("1 child")
  })

  test("refuses a prefix that names nothing and prints the list", async () => {
    const host = fakeHost()
    const message = await runAbort("ses_x", "ffff", { enabled: () => true, read: (() => snapshot([record()])) as any, host })
    expect(message).toContain("no task with that prefix")
    expect(message).toContain(KEY.slice(0, 12))
    expect(host.calls).toEqual([])
  })

  test("refuses an ambiguous prefix and aborts nothing", async () => {
    const host = fakeHost()
    const message = await runAbort("ses_x", "a", {
      enabled: () => true,
      read: (() => snapshot([record(), record({ fingerprint: `a${OTHER.slice(1)}` })])) as any,
      host,
    })
    expect(message).toContain("ambiguous")
    expect(host.calls).toEqual([])
  })

  test("aborts the one task a unique prefix names", async () => {
    const host = fakeHost()
    const message = await runAbort("ses_x", KEY.slice(0, 6), { enabled: () => true, read: (() => snapshot([record()])) as any, host })
    expect(host.calls.length).toBe(1)
    expect(host.calls[0][1]).toMatchObject({ parentID: "ses_x", fingerprint: KEY, scope: "task", by: "user", cause: "user command" })
    expect(message).toContain(KEY.slice(0, 12))
    expect(message).toContain("Unrelated work continues")
  })

  test("reports an already aborted task and the replacement it cancelled", async () => {
    const host = fakeHost({ sealed: true, durable: true, revoked: ["k"], interrupted: [], preserved: [], reason: "already aborted" })
    const message = await runAbort("ses_x", KEY.slice(0, 6), {
      enabled: () => true,
      read: (() => snapshot([record({ abortedAt: 1 })])) as any,
      host,
    })
    expect(message).toContain("already aborted")
    expect(message).toContain("cancelled 1 held call")
  })

  test("says a memory-only seal is not durable", async () => {
    const host = fakeHost({ sealed: true, durable: false, revoked: [], interrupted: [], preserved: [] })
    const message = await runAbort("ses_x", KEY.slice(0, 6), { enabled: () => true, read: (() => snapshot([record()])) as any, host })
    expect(message).toContain("NOT DURABLE")
  })

  test("carries the durability of a seal that was already aborted", async () => {
    const host = fakeHost({ sealed: true, durable: false, revoked: [], interrupted: [], preserved: [], reason: "already aborted" })
    const message = await runAbort("ses_x", KEY.slice(0, 6), {
      enabled: () => true,
      read: (() => snapshot([record({ abortedAt: 1 })])) as any,
      host,
    })
    // The seal is old, not new: a bare "already aborted" would read as durable.
    expect(message).toContain("already aborted")
    expect(message).toContain("NOT DURABLE")
  })

  test("says a retired or expired task was not sealed", async () => {
    const retired = await runAbort("ses_x", KEY.slice(0, 6), {
      enabled: () => true,
      read: (() => snapshot([record({ abortedAt: 1, retiredAt: 2 })])) as any,
      host: fakeHost({ sealed: false, durable: false, revoked: [], interrupted: [], preserved: [], reason: "already_retired" }),
    })
    expect(retired).toContain("already retired")
    expect(retired).toContain("nothing was sealed")

    const expired = await runAbort("ses_x", KEY.slice(0, 6), {
      enabled: () => true,
      read: (() => snapshot([record({ abortedAt: 1 })])) as any,
      host: fakeHost({ sealed: false, durable: false, revoked: [], interrupted: [], preserved: [], reason: "already_expired" }),
    })
    expect(expired).toContain("already expired")
    expect(expired).toContain("nothing was sealed")
  })

  test("reports a child session the subtree session ban missed", async () => {
    const missed = await runAbort("ses_x", KEY.slice(0, 6), {
      enabled: () => true,
      read: (() => snapshot([record()])) as any,
      host: fakeHost({ sealed: true, durable: true, revoked: [], interrupted: ["ses_c"], preserved: [], sessionBanned: 0, sessionBanFailures: ["ses_c"] }),
    })
    expect(missed).toContain("NOT SESSION_BANNED")
    expect(missed).toContain("ses_c")

    const sessionBanned = await runAbort("ses_x", KEY.slice(0, 6), {
      enabled: () => true,
      read: (() => snapshot([record()])) as any,
      host: fakeHost({ sealed: true, durable: true, revoked: [], interrupted: ["ses_c"], preserved: [], sessionBanned: 1, sessionBanFailures: [] }),
    })
    expect(sessionBanned).toContain("1 child session session-banned")
    expect(sessionBanned).not.toContain("NOT SESSION_BANNED")
  })

  test("refuses an unreadable store", async () => {
    const host = fakeHost()
    const message = await runAbort("ses_x", KEY.slice(0, 6), {
      enabled: () => true,
      read: (() => ({ ok: false, reason: "unreadable", audit: "unreadable", snap: null })) as any,
      host,
    })
    expect(message).toContain("unreadable")
    expect(message).toContain("nothing was aborted")
    expect(host.calls).toEqual([])
  })

  test("aborts the session on the session target", async () => {
    const host = fakeHost()
    const message = await runAbort("ses_x", "session", { enabled: () => true, read: (() => snapshot([])) as any, host })
    expect(host.calls[0][0]).toBe("session")
    expect(host.calls[0].slice(1)).toEqual(["ses_x", "user", "user command"])
    expect(message).toContain("session")
    expect(message).toContain("1 session interrupted")
  })

  test("refuses when the host handle is missing", async () => {
    const message = await runAbort("ses_x", KEY.slice(0, 6), { enabled: () => true, read: (() => snapshot([record()])) as any, host: null })
    expect(message).toContain("not registered")
  })

  test("sends its refusal through the synthetic route and still returns it", async () => {
    clearState()
    const sent: any[] = []
    const { ctx, commands } = commandContext(async (message) => {
      sent.push(message)
    })
    await jevPlugin.setup(ctx)
    const result = await commands["jev-abort"].execute({ sessionID: "ses_cmd", prompt: { text: "" } })
    expect(result.content).toContain("hook_session_ban is off")
    expect(sent.length).toBe(1)
    expect(sent[0]).toMatchObject({ sessionID: "ses_cmd", resume: false })
    expect(sent[0].text).toBe(result.content)
  })

  test("sends one message for an abort: the host's own notice", async () => {
    clearState()
    setFeature("hook_session_ban", true)
    const sent: any[] = []
    const { ctx, commands } = commandContext(async (message) => {
      sent.push(message)
    })
    try {
      await jevPlugin.setup(ctx)
      const result = await commands["jev-abort"].execute({ sessionID: "ses_cmd", prompt: { text: "session" } })
      expect(result.content).toContain("ses_cmd stopped")
      expect(result.content).not.toContain("hook_session_ban is off")
      // The host already told the session, so the command stays quiet: one
      // message, and it is not the returned line.
      expect(sent.length).toBe(1)
      expect(sent[0].delivery).toBe("queue")
      expect(sent[0].text).toContain("Jev aborted this session")
      expect(sent[0].text).not.toBe(result.content)
    } finally {
      setFeature("hook_session_ban", false)
      clearState()
      rmSync(join(scratch, "session-ban"), { recursive: true, force: true })
    }
  })

  test("the receipt says whether the host spoke", async () => {
    const { register } = await import("./session-ban-host.ts")
    const notices: any[] = []
    const wired = await register({ session: { synthetic: async (message: any) => { notices.push(message) } } })
    const mute = await register({})
    try {
      const heard = await wired.abortSession("ses_receipt", "user", "test")
      expect(heard.notified).toBe(true)
      expect(notices.length).toBe(1)
      const silent = await mute.abortSession("ses_mute", "user", "test")
      expect(silent.notified).toBe(false)
    } finally {
      wired.dispose()
      mute.dispose()
      rmSync(join(scratch, "session-ban"), { recursive: true, force: true })
    }
  })

  test("a throttled synthetic route keeps the content and logs the failure", async () => {
    clearState()
    const { LOG_FILE } = await import("../../../lib/lib-jev/state.ts")
    rmSync(LOG_FILE, { force: true })
    const { ctx, commands } = commandContext(async () => {
      throw new Error("synthetic refused")
    })
    await jevPlugin.setup(ctx)
    const result = await commands["jev-abort"].execute({ sessionID: "ses_cmd", prompt: { text: "" } })
    expect(result.content).toContain("hook_session_ban is off")
    const [entry] = readCallLog(1)
    expect(entry.hook).toBe("jev-abort")
    expect(entry.error).toContain("synthetic refused")
    rmSync(LOG_FILE, { force: true })
    clearState()
  })
})

describe("jev-status command", () => {
  test("sends its report through the synthetic route and still returns it", async () => {
    clearState()
    const sent: any[] = []
    const { ctx, commands } = commandContext(async (message) => {
      sent.push(message)
    })
    await jevPlugin.setup(ctx)
    const result = await commands["jev-status"].execute({ sessionID: "ses_cmd", prompt: { text: "" } })
    expect(result.content).toContain("endpoint")
    expect(sent.length).toBe(1)
    expect(sent[0]).toMatchObject({ sessionID: "ses_cmd", resume: false })
    expect(sent[0].text).toBe(result.content)
    clearState()
  })
})

describe("state file modes", () => {
  const modeOf = (path: string) => statSync(path).mode & 0o777

  test("a fresh state and data file are written 0600", () => {
    rmSync(STATE_FILE, { force: true })
    rmSync(DATA_FILE, { force: true })
    saveState({ logMax: 200 })
    saveData({ rosterHash: "fresh" })
    expect(modeOf(STATE_FILE)).toBe(0o600)
    expect(modeOf(DATA_FILE)).toBe(0o600)
    clearState()
    rmSync(DATA_FILE, { force: true })
  })

  test("a write over an existing 0644 file ends at 0600", () => {
    writeFileSync(STATE_FILE, JSON.stringify({ logMax: 100 }), "utf8")
    writeFileSync(DATA_FILE, JSON.stringify({ rosterHash: "" }), "utf8")
    chmodSync(STATE_FILE, 0o644)
    chmodSync(DATA_FILE, 0o644)
    expect(modeOf(STATE_FILE)).toBe(0o644)
    saveState({ logMax: 300 })
    saveData({ rosterHash: "rewritten" })
    expect(modeOf(STATE_FILE)).toBe(0o600)
    expect(modeOf(DATA_FILE)).toBe(0o600)
    clearState()
    rmSync(DATA_FILE, { force: true })
  })
})

describe("opencode protocol", () => {
  const MODEL = "commandcode/deepseek/deepseek-v4.1-flash"

  const openState = (over: Partial<JevState> = {}): JevState => ({
    ...DEFAULTS,
    protocol: "opencode",
    model: MODEL,
    endpoint: "",
    ...over,
  })

  const host = (answers: Record<string, any>) => {
    const calls: any[] = []
    const ctx: any = {
      experimental: {
        generate: {
          text: async (payload: any) => {
            calls.push(payload)
            return { text: JSON.stringify({ answers, prompt_eval_count: 42 }) }
          },
        },
      },
    }
    return { ctx, calls }
  }

  test("loadState preserves opencode and known values, defaulting the rest", () => {
    writeState({ protocol: "opencode" })
    expect(loadState().protocol).toBe("opencode")
    writeState({ protocol: "chat" })
    expect(loadState().protocol).toBe("chat")
    writeState({ protocol: "bogus" })
    expect(loadState().protocol).toBe("systemone")
    clearState()
  })

  test("calls generate.text with a parsed Model.Ref and reuses answer validation", async () => {
    const { ctx, calls } = host({
      pick: { type: "choice", choice: "b", probabilities: { a: 0.09, b: 0.85, c: 0.06 } },
    })
    const result = await ask({ task: "which skill fits" }, { pick: choice }, { ctx, state: openState(), log: false, thresholds })
    expect(calls).toHaveLength(1)
    expect(calls[0].model).toEqual({ providerID: "commandcode", id: "deepseek/deepseek-v4.1-flash" })
    expect(calls[0].prompt).toContain("- pick:")
    expect(calls[0].prompt).toContain('"task":"which skill fits"')
    expect(result.decisions[0].value).toBe("b")
    expect(result.decisions[0].confident).toBe(true)
    expect(result.inputTokens).toBe(42)
  })

  test("accepts a host that returns the generated text directly", async () => {
    const ctx: any = {
      experimental: {
        generate: {
          text: async () =>
            JSON.stringify({ answers: { pick: { type: "choice", choice: "b", probabilities: { a: 0.09, b: 0.85, c: 0.06 } } } }),
        },
      },
    }
    const result = await ask({ task: "x" }, { pick: choice }, { ctx, state: openState(), log: false, thresholds })
    expect(result.decisions[0].value).toBe("b")
  })

  test("synthesizes a score legend and reads the token count", async () => {
    const { ctx } = host({ level: { type: "score", score: 2, probabilities: { "0": 0.1, "1": 0.2, "2": 0.7 } } })
    const result = await ask({ task: "how much" }, { level: score }, { ctx, state: openState(), log: false, thresholds })
    expect(result.decisions[0].kind).toBe("score")
    expect(result.decisions[0].value).toBe(2)
    expect(result.inputTokens).toBe(42)
  })

  test("refuses a malformed model ref with a /jev-settings hint before calling the host", async () => {
    const { ctx, calls } = host({})
    await expect(
      ask({ task: "x" }, { pick: choice }, { ctx, state: openState({ model: "no-slash" }), log: false }),
    ).rejects.toThrow(/providerID\/modelID/)
    expect(calls).toHaveLength(0)
  })

  test("fails closed with a clear JevError when the generate.text API is missing", async () => {
    const partial: any = { experimental: {} }
    await expect(ask({ task: "x" }, { pick: choice }, { ctx: partial, state: openState(), log: false })).rejects.toThrow(JevError)
    await expect(ask({ task: "x" }, { pick: choice }, { state: openState(), log: false })).rejects.toThrow(/generate\.text/)
  })

  test("requires a model but not an endpoint", async () => {
    const { ctx } = host({ pick: { type: "choice", choice: "b", probabilities: { a: 0.09, b: 0.85, c: 0.06 } } })
    await expect(
      ask({ task: "x" }, { pick: choice }, { ctx, state: openState({ model: "" }), log: false }),
    ).rejects.toThrow(/\/jev-model/)
  })
})
