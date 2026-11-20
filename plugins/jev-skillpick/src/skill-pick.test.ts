/**
 * Skill-pick helpers, optimizer and routing hooks. No network: the model call
 * is injected at the generate.text seam, and state is redirected to a temp dir.
 *
 *   bun test src/skill-pick.test.ts
 */

import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const scratch = mkdtempSync(join(tmpdir(), "jev-skillpick-"))
process.env.JEV_DATA_DIR = scratch
process.env.JEV_SECRET_DIR = join(scratch, "secrets")

const { firstSentence, hashDescription, optimizeCriteria, optimizerModel, renderAdvice, resolveCriteria, rosterHash, stripCriterionPreamble } = await import("./index.ts")
const { DATA_FILE, FEATURE_DEFAULTS, STATE_FILE, cfgStr, featureConfigMap, setFeatureConfig } = await import("../../../lib/jev/state.ts")

afterAll(() => rmSync(scratch, { recursive: true, force: true }))

const clearState = () => rmSync(STATE_FILE, { force: true })

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
    const { setSkillCriterion: realSet, DATA_FILE } = await import("../../../lib/jev/state.ts")
    rmSync(DATA_FILE, { force: true })
    realSet("demo", hashDescription("Full description."), "Pick for demo work. Skip for prose.")
    const { entries } = resolveCriteria([{ id: "demo", meaning: "Full description." }])
    expect(entries[0].meaning).toBe("Demo work. Skip for prose.")
    rmSync(DATA_FILE, { force: true })
  })

  test("a matching cache entry wins; a changed description falls back", async () => {
    const { setSkillCriterion: realSet, DATA_FILE } = await import("../../../lib/jev/state.ts")
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
    const { skillCriteriaMap: realMap } = await import("../../../lib/jev/state.ts")
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
    clearState()
    expect(renderAdvice(winner())).toBe(
      "Jev routing: consider loading skills @commit (P=0.88) and @changelog (P=0.31). Advisory — if your own reading disagrees, decide yourself.",
    )
  })

  test("no qualifiers renders the single-pick line", () => {
    clearState()
    expect(renderAdvice(winner({ distribution: { commit: 0.88, terse: 0.01 } }))).toBe(
      "Jev routing: consider loading skill @commit (P=0.88). Advisory — if your own reading disagrees, decide yourself.",
    )
  })

  test("maxPicks caps the named skills", async () => {
    clearState()
    const state = await import("../../../lib/jev/state.ts")
    state.setFeatureConfig("hook_skill_pick", "maxPicks", 2)
    state.setFeatureConfig("hook_skill_pick", "alsoAbove", 0.01)
    expect(renderAdvice(winner())).toContain("@commit (P=0.88)")
    expect(renderAdvice(winner())).toContain("@changelog (P=0.31)")
    expect(renderAdvice(winner())).not.toContain("pr-creator")
    state.setFeatureConfig("hook_skill_pick", "maxPicks", -1)
    state.setFeatureConfig("hook_skill_pick", "alsoAbove", 0.25)
  })

  test("maxPicks 1 restores single-pick behavior", async () => {
    const state = await import("../../../lib/jev/state.ts")
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

describe("optimizer model choice", () => {
  const session = { id: "ses_x", model: { providerID: "9router", id: "oc/deepseek-v4.1-flash-free" } }
  const hostDefault = { location: {}, data: { providerID: "nvidia", id: "nvidia/nemotron-3.5-super-vl-120b-a12b" } }

  test("an override splits on the first slash, because ids contain slashes", () => {
    expect(optimizerModel("9router/oc/deepseek-v4.1-flash-free", null, null)).toEqual({
      providerID: "9router",
      id: "oc/deepseek-v4.1-flash-free",
    })
  })

  test("an override wins over every resolved model", () => {
    expect(optimizerModel("nvidia/z-ai/glm-5.3", session, hostDefault)).toEqual({ providerID: "nvidia", id: "z-ai/glm-5.3" })
  })

  test("no override prefers the session's model over the host default", () => {
    // The host default was the model answering 404; the session is running on
    // its own, so that one is the one known to work.
    expect(optimizerModel("  ", session, hostDefault)).toEqual({ providerID: "9router", id: "oc/deepseek-v4.1-flash-free" })
    expect(optimizerModel("", null, hostDefault)).toEqual({ providerID: "nvidia", id: "nvidia/nemotron-3.5-super-vl-120b-a12b" })
    expect(optimizerModel("", null, null)).toBeNull()
  })

  test("a runtime session without a model is not a model", () => {
    expect(optimizerModel("", { id: "ses_y" }, undefined)).toBeNull()
  })

  test("a malformed override is never silently replaced by another model", () => {
    expect(optimizerModel("9router", session, hostDefault)).toBeNull()
    expect(optimizerModel("/oc/x", session, hostDefault)).toBeNull()
    expect(optimizerModel("9router/", session, hostDefault)).toBeNull()
  })
})

describe("string config (optimizeModel)", () => {
  test("defaults to empty and cfgStr reads stored text", () => {
    clearState()
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

describe("optimizer", () => {
  const reset = () => {
    const self = optimizeCriteria as any
    self._noGenerate = false
    self._latched = false
    self._failures = 0
    clearState()
    rmSync(join(scratch, "jev-data.json"), { force: true })
  }
  const stale = [{ id: "demo", meaning: "Full description. Second sentence." }]
  // The host side of the model lookup: a session with a model, and a host
  // default. Both are what the optimizer resolves when no override is set.
  const hostDefault = { location: {}, data: { providerID: "9router", id: "oc/host-free" } }
  const host = (generate: any) => ({ generate, model: { default: async () => hostDefault } })

  test("sends a {prompt, model} payload, unwraps {text}, writes criteria", async () => {
    reset()
    let seen: any
    const ctx = host({
      text: async (payload: any) => {
        seen = payload
        return { text: JSON.stringify({ demo: "Use when doing demo." }) }
      },
    })
    const { done } = await optimizeCriteria(ctx, stale, { manual: true })
    expect(done).toBe(1)
    expect(typeof seen).toBe("object")
    expect(seen.prompt).toContain("- demo: Full description.")
    // No override and no session model: the host default is named explicitly.
    expect(seen.model).toEqual({ providerID: "9router", id: "oc/host-free" })
    const { loadData } = await import("../../../lib/jev/state.ts")
    expect(loadData().skillCriteria.demo.terse).toBe("Use when doing demo.")
  })

  test("the session's own model beats the host default", async () => {
    reset()
    let seen: any
    const ctx = {
      generate: { text: async (payload: any) => ((seen = payload), { text: JSON.stringify({ demo: "Criterion." }) }) },
      model: { default: async () => hostDefault },
      session: { get: async ({ sessionID }: any) => ({ id: sessionID, model: { providerID: "9router", id: "oc/deepseek-v4.1-flash-free" } }) },
    }
    await optimizeCriteria(ctx, stale, { manual: true, sessionID: "ses_demo" })
    expect(seen.model).toEqual({ providerID: "9router", id: "oc/deepseek-v4.1-flash-free" })
  })

  test("a missing model is a logged failure, not a host call", async () => {
    reset()
    let calls = 0
    const ctx = { generate: { text: async () => (calls++, { text: "{}" }) } }
    const { failed } = await optimizeCriteria(ctx, stale, { manual: true })
    expect(calls).toBe(0)
    expect(failed).toBe(1)
    const { readLog } = await import("../../../lib/jev/state.ts")
    expect(readLog(1)[0].skipped).toContain("no model to generate with")
    reset()
  })

  test("optimizeModel overrides the payload model as Model.Ref", async () => {
    reset()
    setFeatureConfig("hook_skill_pick", "optimizeModel", "9router/free")
    let seen: any
    const ctx = host({ text: async (payload: any) => ((seen = payload), { text: "{}" }) })
    await optimizeCriteria(ctx, stale, { manual: true })
    expect(seen.model).toEqual({ providerID: "9router", id: "free" })
    setFeatureConfig("hook_skill_pick", "optimizeModel", "")
  })

  test("three failures latch the auto path; manual still runs; success clears", async () => {
    reset()
    const failing = host({ text: async () => { throw Object.assign(new Error("Expected object"), { _tag: "InvalidRequestError", kind: "Payload" }) } })
    // Auto path: 1st and 2nd failures log, 3rd trips the latch.
    await optimizeCriteria(failing, stale)
    await optimizeCriteria(failing, stale)
    await optimizeCriteria(failing, stale)
    expect((optimizeCriteria as any)._latched).toBe(true)
    // Latched auto path never reaches the host.
    let calls = 0
    const counting = host({ text: async () => { calls++; return { text: "{}" } } })
    await optimizeCriteria(counting, stale)
    expect(calls).toBe(0)
    // Manual bypasses the latch.
    await optimizeCriteria(counting, stale, { manual: true })
    expect(calls).toBe(1)
    // A real success clears the latch and the counter.
    const working = host({ text: async () => ({ text: JSON.stringify({ demo: "Criterion." }) }) })
    await optimizeCriteria(working, stale, { manual: true })
    expect((optimizeCriteria as any)._latched).toBe(false)
    await optimizeCriteria(counting, stale)
    expect(calls).toBe(2)
    reset()
  })
})
