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
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const scratch = mkdtempSync(join(tmpdir(), "jev-test-"))
process.env.JEV_DATA_DIR = scratch
process.env.JEV_SECRET_DIR = join(scratch, "secrets")

const { blocksCall } = await import("./index.ts")
const { JevError, normalize, redact } = await import("./jev.ts")
const { DEFAULTS, FEATURES, featureMap, featureOn, featureStored, loadState, pluginEnabled, setEnabled, setFeature } = await import(
  "./state.ts"
)
type JevState = import("./state.ts").JevState

afterAll(() => rmSync(scratch, { recursive: true, force: true }))

const state: JevState = { ...DEFAULTS }

const choice = { type: "choice" as const, instructions: "pick", criteria: { a: "first", b: "second", c: "third" } }
const score = { type: "score" as const, instructions: "how much", criteria: ["none", "some", "lots"] }

describe("choice", () => {
  test("accepts a top-probability pick and reports the margin", () => {
    const d = normalize("p", choice, {
      type: "choice",
      choice: "b",
      probabilities: { a: 0.09, b: 0.85, c: 0.06 },
      confidence: 0.86,
    }, state)
    expect(d.value).toBe("b")
    expect(d.probability).toBeCloseTo(0.85)
    expect(d.margin).toBeCloseTo(0.76)
    expect(d.confident).toBe(true)
  })

  test("a clear winner still under the probability floor is held back", () => {
    // Both conditions must hold, so a 0.70 top over a 0.20 runner-up is
    // reported as low confidence and the agent decides for itself.
    const d = normalize("p", choice, { type: "choice", choice: "b", probabilities: { a: 0.2, b: 0.7, c: 0.1 } }, state)
    expect(d.margin).toBeCloseTo(0.5)
    expect(d.confident).toBe(false)
    expect(d.note).toMatch(/top probability/)
  })

  test("rejects a choice that is not the argmax", () => {
    expect(() =>
      normalize("p", choice, { type: "choice", choice: "c", probabilities: { a: 0.2, b: 0.7, c: 0.1 } }, state),
    ).toThrow(/not the highest-probability/)
  })

  test("rejects probabilities that do not cover the options", () => {
    expect(() =>
      normalize("p", choice, { type: "choice", choice: "a", probabilities: { a: 1, b: 0 } }, state),
    ).toThrow(/do not match/)
  })

  test("rejects a distribution that does not sum to about one", () => {
    expect(() =>
      normalize("p", choice, { type: "choice", choice: "a", probabilities: { a: 0.5, b: 0.4, c: 0.4 } }, state),
    ).toThrow(/sum to/)
  })

  test("rejects an unknown option label", () => {
    expect(() =>
      normalize("p", choice, { type: "choice", choice: "zzz", probabilities: { a: 0.2, b: 0.7, c: 0.1 } }, state),
    ).toThrow(/not one of the options/)
  })

  test("a near-tie is reported as low confidence, not as an error", () => {
    const d = normalize("p", choice, { type: "choice", choice: "a", probabilities: { a: 0.5, b: 0.49, c: 0.01 } }, state)
    expect(d.confident).toBe(false)
    expect(d.note).toMatch(/margin/)
  })

  test("a clear winner above the floor is confident", () => {
    const d = normalize("p", choice, { type: "choice", choice: "b", probabilities: { a: 0.05, b: 0.9, c: 0.05 } }, state)
    expect(d.confident).toBe(true)
  })

  test("a hand-back label is never confident", () => {
    const d = normalize("p", { ...choice, criteria: { a: "first", escalate: "give up" } },
      { type: "choice", choice: "escalate", probabilities: { a: 0.01, escalate: 0.99 } }, state)
    expect(d.value).toBe("escalate")
    expect(d.confident).toBe(false)
    expect(d.note).toMatch(/hand-back/)
  })
})

describe("noul", () => {
  const noul = { type: "noul" as const, instructions: "is it true" }

  test("treats the value as P(yes), not as the answer", () => {
    expect(normalize("v", noul, { type: "noul", noul: 0.95 }, state).value).toBe(true)
    expect(normalize("v", noul, { type: "noul", noul: 0.05 }, state).value).toBe(false)
  })

  test("a value near 0.5 is not confident", () => {
    expect(normalize("v", noul, { type: "noul", noul: 0.52 }, state).confident).toBe(false)
    expect(normalize("v", noul, { type: "noul", noul: 0.97 }, state).confident).toBe(true)
  })

  test("rejects an out-of-range probability", () => {
    expect(() => normalize("v", noul, { type: "noul", noul: 1.4 }, state)).toThrow(JevError)
  })
})

describe("score", () => {
  test("accepts a level index with a complete legend", () => {
    const d = normalize("s", score, {
      type: "score", score: 2,
      probabilities: { "0": 0.1, "1": 0.2, "2": 0.7 },
      legend: { "0": "none", "1": "some", "2": "lots" },
    }, state)
    expect(d.value).toBe(2)
    expect(d.margin).toBeCloseTo(0.5)
  })

  test("rejects a legend that misses a level", () => {
    expect(() => normalize("s", score, {
      type: "score", score: 1,
      probabilities: { "0": 0.4, "1": 0.6, "2": 0.0 },
      legend: { "0": "none", "1": "some" },
    }, state)).toThrow(/legend/)
  })

  test("rejects a distribution whose level count is wrong", () => {
    expect(() => normalize("s", score, {
      type: "score", score: 1, probabilities: { "0": 0.4, "1": 0.6 },
      legend: { "0": "none", "1": "some" },
    }, state)).toThrow(/score levels/)
  })

  test("rejects a score past the last level", () => {
    expect(() => normalize("s", score, {
      type: "score", score: 5, probabilities: { "0": 0.1, "1": 0.1, "2": 0.8 },
      legend: { "0": "none", "1": "some", "2": "lots" },
    }, state)).toThrow(/outside/)
  })

  test("rejects a score question with fewer than two levels", () => {
    expect(() => normalize("s", { ...score, criteria: ["only"] }, {
      type: "score", score: 0, probabilities: { "0": 1 }, legend: { "0": "only" },
    }, state)).toThrow(/at least 2/)
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
    // Everything on except the risk hook, which stays opt-in.
    expect(migrated.risk_hook).toBe(false)
    expect(migrated.check).toBe(true)
  })

  test("a pre-features state file keeps its gate as the risk hook", () => {
    expect(featureMap(undefined, true).risk_hook).toBe(true)
    expect(featureMap(undefined, false).risk_hook).toBe(false)
    expect(featureMap(undefined).risk_hook).toBe(false)
    // An explicit features map wins over the legacy key.
    expect(featureMap({ risk_hook: false }, true).risk_hook).toBe(false)
  })

  test("only known keys are honoured, so a typo cannot invent a switch", () => {
    const map = featureMap({ check: false, bogus_feature: false })
    expect(map.check).toBe(false)
    expect("bogus_feature" in map).toBe(false)
  })
})

describe("master switch", () => {
  test("on by default, and the features default to on except the risk hook", () => {
    expect(pluginEnabled()).toBe(true)
    expect(featureStored("risk_hook")).toBe(false)
    expect(FEATURES.filter((f) => f.key !== "risk_hook").every((f) => featureStored(f.key))).toBe(true)
  })

  test("turning the plugin off gates every feature without touching their settings", () => {
    setFeature("check", true)
    setEnabled(false)
    for (const f of FEATURES) expect(featureOn(f.key)).toBe(false)
    // The stored settings are untouched, so turning it back on restores them.
    expect(featureStored("check")).toBe(true)
    expect(featureStored("risk_hook")).toBe(false)
    setEnabled(true)
    expect(featureOn("check")).toBe(true)
    expect(featureOn("risk_hook")).toBe(false)
  })

  test("a feature switched off stays off when the plugin comes back", () => {
    setFeature("review_rank", false)
    setEnabled(false)
    setEnabled(true)
    expect(featureStored("review_rank")).toBe(false)
    expect(featureOn("review_rank")).toBe(false)
    setFeature("review_rank", true)
  })
})
