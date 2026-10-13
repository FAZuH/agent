/**
 * Self-check for the answer validator. No network: these are hand-built answer
 * objects, and the point is the shape checks, not Jev's judgement.
 *
 *   bun test src/jev.test.ts
 *
 * The data directory is redirected to a temp one before state.ts loads, because
 * several tests write settings and the real file is the user's, not the test's.
 */

import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const scratch = mkdtempSync(join(tmpdir(), "jev-test-"))
process.env.JEV_DATA_DIR = scratch
process.env.JEV_SECRET_DIR = join(scratch, "secrets")

const { blocksCall, firstSentence, hashDescription, optimizeCriteria, renderAdvice, resolveCriteria, rosterHash, stripCriterionPreamble } = await import("./index.ts")
const { answersOf, JevError, normalize, redact } = await import("./jev.ts")
const { DEFAULTS, FEATURES, FEATURE_DEFAULTS, cfgStr, featureConfig, featureConfigMap, featureMap, featureOn, featureStored, loadState, logCall, migrateLegacyLayout, pluginEnabled, pruneLog, setEnabled, setFeature, setFeatureConfig } = await import(
  "./state.ts"
)
type JevState = import("./state.ts").JevState

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
    const d = normalize("p", { ...choice, criteria: { a: "first", escalate: "give up" } },
      { type: "choice", choice: "escalate", probabilities: { a: 0.01, escalate: 0.99 } }, thresholds)
    expect(d.value).toBe("escalate")
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

describe("skill criteria", () => {
  test("firstSentence keeps the opening sentence", () => {
    expect(firstSentence("Do X. Then do Y. Then Z.")).toBe("Do X.")
    expect(firstSentence("No sentence boundary here")).toBe("No sentence boundary here")
    expect(firstSentence("  Spaced.  Out.  ")).toBe("Spaced.")
  })

  test("hashDescription is stable and keyed on content", () => {
    expect(hashDescription("abc")).toBe(hashDescription("abc"))
    expect(hashDescription("abc")).not.toBe(hashDescription("abd"))
  })

  test("stripCriterionPreamble drops the Pick label and re-capitalizes", () => {
    expect(stripCriterionPreamble("Pick for config, migration, plugins.")).toBe("Config, migration, plugins.")
    expect(stripCriterionPreamble("Pick when unsure which skill fits. Skip when obvious.")).toBe("Unsure which skill fits. Skip when obvious.")
    expect(stripCriterionPreamble("Pick to file a bug with repro steps.")).toBe("File a bug with repro steps.")
    expect(stripCriterionPreamble("Pick as the default filter on coding tasks.")).toBe("The default filter on coding tasks.")
    // Anything else passes through untouched.
    expect(stripCriterionPreamble("Edit or write any interface.")).toBe("Edit or write any interface.")
  })

  test("a cached criterion reads clean even when stored with the old prefix", async () => {
    const { setSkillCriterion: realSet, DATA_FILE } = await import("./state.ts")
    rmSync(DATA_FILE, { force: true })
    realSet("demo", hashDescription("Full description."), "Pick for demo work. Skip for prose.")
    const { entries } = resolveCriteria([{ id: "demo", meaning: "Full description." }])
    expect(entries[0].meaning).toBe("Demo work. Skip for prose.")
    rmSync(DATA_FILE, { force: true })
  })

  test("a matching cache entry wins; a changed description falls back", async () => {
    const { setSkillCriterion: realSet, DATA_FILE } = await import("./state.ts")
    rmSync(DATA_FILE, { force: true })
    const desc = "Full original description here."
    realSet("demo", hashDescription(desc), "Terse criterion.")
    const { entries, stale } = resolveCriteria([
      { id: "demo", meaning: desc },
      { id: "fresh", meaning: "A brand new skill. With two sentences." },
    ])
    expect(entries.find((e) => e.id === "demo")!.meaning).toBe("Terse criterion.")
    expect(entries.find((e) => e.id === "fresh")!.meaning).toBe("A brand new skill.")
    expect(stale.map((s) => s.id)).toEqual(["fresh"])

    // A description edit invalidates: same id, new hash, falls back to stale.
    const { entries: e2, stale: s2 } = resolveCriteria([{ id: "demo", meaning: "Edited description now." }])
    expect(e2[0].meaning).toBe("Edited description now.")
    expect(s2.map((s) => s.id)).toEqual(["demo"])
    rmSync(DATA_FILE, { force: true })
  })

  test("corrupt cache entries are dropped, not surfaced", async () => {
    const { skillCriteriaMap: realMap } = await import("./state.ts")
    const out = realMap({
      good: { origHash: "abc", terse: "Fine.", v: 1 },
      wrongVersion: { origHash: "abc", terse: "Old.", v: 0 },
      empty: { origHash: "abc", terse: "  ", v: 1 },
      huge: { origHash: "abc", terse: "x".repeat(500), v: 1 },
      shape: "nope",
      nullish: null,
    })
    expect(Object.keys(out)).toEqual(["good"])
  })
})

describe("multi-pick advice", () => {
  const winner = (overrides: Record<string, unknown> = {}) => ({
    value: "commit",
    probability: 0.88,
    distribution: { commit: 0.88, changelog: 0.31, "pr-creator": 0.05, terse: 0.01 },
    ...overrides,
  })

  test("winner plus qualifiers render in rank order", () => {
    rmSync(join(scratch, "jev-state.json"), { force: true })
    expect(renderAdvice(winner())).toBe(
      "Jev routing: consider loading skills @commit (P=0.88) and @changelog (P=0.31). Advisory — if your own reading disagrees, decide yourself.",
    )
  })

  test("no qualifiers renders the single-pick line", () => {
    rmSync(join(scratch, "jev-state.json"), { force: true })
    expect(renderAdvice(winner({ distribution: { commit: 0.88, terse: 0.01 } }))).toBe(
      "Jev routing: consider loading skill @commit (P=0.88). Advisory — if your own reading disagrees, decide yourself.",
    )
  })

  test("maxPicks caps the named skills", async () => {
    rmSync(join(scratch, "jev-state.json"), { force: true })
    const state = await import("./state.ts")
    state.setFeatureConfig("hook_skill_pick", "maxPicks", 2)
    state.setFeatureConfig("hook_skill_pick", "alsoAbove", 0.01)
    expect(renderAdvice(winner())).toContain("@commit (P=0.88)")
    expect(renderAdvice(winner())).toContain("@changelog (P=0.31)")
    expect(renderAdvice(winner())).not.toContain("pr-creator")
    state.setFeatureConfig("hook_skill_pick", "maxPicks", -1)
    state.setFeatureConfig("hook_skill_pick", "alsoAbove", 0.25)
  })

  test("maxPicks 1 restores single-pick behavior", async () => {
    const state = await import("./state.ts")
    state.setFeatureConfig("hook_skill_pick", "maxPicks", 1)
    expect(renderAdvice(winner())).toBe(
      "Jev routing: consider loading skill @commit (P=0.88). Advisory — if your own reading disagrees, decide yourself.",
    )
    state.setFeatureConfig("hook_skill_pick", "maxPicks", -1)
  })

  test("rosterHash is order-independent and content-sensitive", () => {
    const a = [{ id: "x" }, { id: "y" }]
    const b = [{ id: "y" }, { id: "x" }]
    expect(rosterHash(a)).toBe(rosterHash(b))
    expect(rosterHash(a)).not.toBe(rosterHash([{ id: "x" }, { id: "z" }]))
  })
})

describe("risk gate", () => {
  const at = 0.7

  test("blocks a confident answer over the threshold", () => {
    expect(blocksCall({ confident: true, probability: 0.96 }, at)).toBe(true)
  })

  test("a high probability the plugin calls low confidence never blocks", () => {
    // The whole point: requirement 3 says low confidence proceeds. A noul at
    // 0.79 is not confident, so it must not stop the agent even though it is
    // above the threshold.
    expect(blocksCall({ confident: false, probability: 0.79 }, at)).toBe(false)
    expect(blocksCall({ confident: false, probability: 0.99 }, at)).toBe(false)
  })

  test("a confident answer below the threshold is allowed", () => {
    expect(blocksCall({ confident: true, probability: 0.4 }, at)).toBe(false)
  })

  test("a missing probability does not block", () => {
    expect(blocksCall({ confident: true }, at)).toBe(false)
  })
})

describe("feature switches", () => {
  test("every feature is present after an old state file with no features key", () => {
    const migrated = featureMap({})
    expect(Object.keys(migrated).sort()).toEqual(FEATURES.map((f) => f.key).sort())
    // Both hooks are opt-in.
    expect(migrated.hook_risk).toBe(false)
    expect(migrated.hook_skill_pick).toBe(false)
  })

  test("a pre-features state file keeps its gate as the risk hook", () => {
    expect(featureMap(undefined, true).hook_risk).toBe(true)
    expect(featureMap(undefined, false).hook_risk).toBe(false)
    expect(featureMap(undefined).hook_risk).toBe(false)
    // An explicit features map wins over the legacy key.
    expect(featureMap({ hook_risk: false }, true).hook_risk).toBe(false)
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
    const cfg = featureConfigMap({ hook_skill_pick: { timeout: "fast", bogus: 1 }, hook_risk: "nope" })
    expect(cfg.hook_skill_pick.timeout).toBe(FEATURE_DEFAULTS.hook_skill_pick.timeout)
    expect("bogus" in cfg.hook_skill_pick).toBe(false)
    expect(cfg.hook_risk.gateProbability).toBe(FEATURE_DEFAULTS.hook_risk.gateProbability)
  })

  test("legacy global thresholds seed the per-feature config", () => {
    writeFileSync(join(scratch, "jev-state.json"), JSON.stringify({ minProbability: 0.9, minMargin: 0.2, gateProbability: 0.6 }))
    const s = loadState()
    expect(s.config.hook_skill_pick.minProbability).toBe(0.9)
    expect(s.config.hook_skill_pick.minMargin).toBe(0.2)
    expect(s.config.hook_risk.gateProbability).toBe(0.6)
    // The old top-level keys are gone from the loaded state.
    expect((s as any).minProbability).toBeUndefined()
  })

  test("a pre-rename state file keeps its hooks on and its config", () => {
    writeFileSync(
      join(scratch, "jev-state.json"),
      JSON.stringify({
        features: { pick_skill: true, risk_hook: true },
        config: { pick_skill: { timeout: 777 }, risk_hook: { gateProbability: 0.9 } },
      }),
    )
    const s = loadState()
    expect(s.features.hook_skill_pick).toBe(true)
    expect(s.features.hook_risk).toBe(true)
    expect(s.config.hook_skill_pick.timeout).toBe(777)
    expect(s.config.hook_risk.gateProbability).toBe(0.9)
  })

  test("logMax reads from state with a floor", () => {
    writeFileSync(join(scratch, "jev-state.json"), JSON.stringify({ logMax: 100 }))
    expect(loadState().logMax).toBe(100)
    writeFileSync(join(scratch, "jev-state.json"), JSON.stringify({ logMax: 2 }))
    expect(loadState().logMax).toBe(10)
  })

  test("a stored config value beats the legacy seed", () => {
    writeFileSync(
      join(scratch, "jev-state.json"),
      JSON.stringify({ minProbability: 0.9, config: { hook_skill_pick: { minProbability: 0.7 } } }),
    )
    expect(loadState().config.hook_skill_pick.minProbability).toBe(0.7)
  })

  test("setFeatureConfig writes one field and refuses unknown ones", () => {
    // The previous tests left their state file behind; start from defaults.
    rmSync(join(scratch, "jev-state.json"), { force: true })
    setFeatureConfig("hook_skill_pick", "timeout", 2000)
    expect(featureConfig("hook_skill_pick").timeout).toBe(2000)
    // Sibling fields survive the write.
    expect(featureConfig("hook_skill_pick").minProbability).toBe(FEATURE_DEFAULTS.hook_skill_pick.minProbability)
    expect(() => setFeatureConfig("hook_skill_pick", "bogus", 1)).toThrow(/unknown/)
    expect(() => setFeatureConfig("bogus_feature", "timeout", 1)).toThrow(/unknown/)
    setFeatureConfig("hook_skill_pick", "timeout", FEATURE_DEFAULTS.hook_skill_pick.timeout)
  })

  test("pruneLog keeps the tail at logMax", async () => {
    const { LOG_FILE } = await import("./state.ts")
    rmSync(join(scratch, "jev-state.json"), { force: true })
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
    expect(featureStored("hook_risk")).toBe(false)
    setEnabled(true)
    expect(featureOn("hook_skill_pick")).toBe(true)
    expect(featureOn("hook_risk")).toBe(false)
  })

  test("a feature switched off stays off when the plugin comes back", () => {
    setFeature("hook_skill_pick", false)
    setEnabled(false)
    setEnabled(true)
    expect(featureStored("hook_skill_pick")).toBe(false)
    expect(featureOn("hook_skill_pick")).toBe(false)
  })
})

describe("string config (optimizeModel)", () => {
  test("defaults to empty and cfgStr reads stored text", () => {
    rmSync(join(scratch, "jev-state.json"), { force: true })
    expect(FEATURE_DEFAULTS.hook_skill_pick.optimizeModel).toBe("")
    expect(cfgStr("hook_skill_pick", "optimizeModel")).toBe("")
    setFeatureConfig("hook_skill_pick", "optimizeModel", "9router/free")
    expect(cfgStr("hook_skill_pick", "optimizeModel")).toBe("9router/free")
    setFeatureConfig("hook_skill_pick", "optimizeModel", "")
  })

  test("setFeatureConfig refuses a number for a string key", () => {
    expect(() => setFeatureConfig("hook_skill_pick", "optimizeModel", 5 as any)).toThrow(/takes text/)
  })

  test("a non-string stored value falls back to the default", () => {
    const cfg = featureConfigMap({ hook_skill_pick: { optimizeModel: 42 } })
    expect(cfg.hook_skill_pick.optimizeModel).toBe("")
  })
})

describe("legacy layout migration", () => {
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
})

describe("optimizer", () => {
  const reset = () => {
    const self = optimizeCriteria as any
    self._noGenerate = false
    self._latched = false
    self._failures = 0
    rmSync(join(scratch, "jev-state.json"), { force: true })
    rmSync(join(scratch, "jev-data.json"), { force: true })
  }
  const stale = [{ id: "demo", meaning: "Full description. Second sentence." }]

  test("sends a {prompt, model} payload, unwraps {text}, writes criteria", async () => {
    reset()
    let seen: any
    const ctx = {
      generate: {
        text: async (payload: any) => {
          seen = payload
          return { text: JSON.stringify({ demo: "Use when doing demo." }) }
        },
      },
    }
    const { done } = await optimizeCriteria(ctx, stale, { manual: true })
    expect(done).toBe(1)
    expect(typeof seen).toBe("object")
    expect(seen.prompt).toContain("- demo: Full description.")
    expect(seen.model).toBeNull()
    const { loadData } = await import("./state.ts")
    expect(loadData().skillCriteria.demo.terse).toBe("Use when doing demo.")
  })

  test("optimizeModel overrides the payload model as Model.Ref", async () => {
    reset()
    setFeatureConfig("hook_skill_pick", "optimizeModel", "9router/free")
    let seen: any
    const ctx = { generate: { text: async (payload: any) => ((seen = payload), { text: "{}" }) } }
    await optimizeCriteria(ctx, stale, { manual: true })
    expect(seen.model).toEqual({ providerID: "9router", id: "free" })
    setFeatureConfig("hook_skill_pick", "optimizeModel", "")
  })

  test("three failures latch the auto path; manual still runs; success clears", async () => {
    reset()
    const failing = { generate: { text: async () => { throw Object.assign(new Error("Expected object"), { _tag: "InvalidRequestError", kind: "Payload" }) } } }
    // Auto path: 1st and 2nd failures log, 3rd trips the latch.
    await optimizeCriteria(failing, stale)
    await optimizeCriteria(failing, stale)
    await optimizeCriteria(failing, stale)
    expect((optimizeCriteria as any)._latched).toBe(true)
    // Latched auto path never reaches the host.
    let calls = 0
    const counting = { generate: { text: async () => { calls++; return { text: "{}" } } } }
    await optimizeCriteria(counting, stale)
    expect(calls).toBe(0)
    // Manual bypasses the latch.
    await optimizeCriteria(counting, stale, { manual: true })
    expect(calls).toBe(1)
    // A real success clears the latch and the counter.
    const working = { generate: { text: async () => ({ text: JSON.stringify({ demo: "Criterion." }) }) } }
    await optimizeCriteria(working, stale, { manual: true })
    expect((optimizeCriteria as any)._latched).toBe(false)
    await optimizeCriteria(counting, stale)
    expect(calls).toBe(2)
    reset()
  })
})
