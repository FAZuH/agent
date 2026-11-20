import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { FEATURE_DEFAULTS } from "../../../lib/jev/state.ts"
import { settingMeta } from "../../../lib/jev/setting-meta.ts"
import { filterSettings } from "./gui-search.ts"

const gui = readFileSync(new URL("./gui.tsx", import.meta.url), "utf8")

const RENDERED_FEATURE_FIELDS = 47
const search = (query: string) => filterSettings(query, FEATURE_DEFAULTS)

describe("Jev Settings search filter", () => {
  test("matches a friendly field label and keeps only that field in the group", () => {
    const result = search("minimum probability")
    const pick = result.groups.find((group) => group.feature === "hook_skill_pick")
    expect(pick?.fields.map((field) => field.key)).toEqual(["minProbability"])
  })

  test("matches a description whose text is absent from the label", () => {
    const result = search("runner-up")
    const pick = result.groups.find((group) => group.feature === "hook_skill_pick")
    expect(pick?.fields.map((field) => field.key)).toEqual(["minMargin"])
    expect(settingMeta("hook_skill_pick", "minMargin").label.toLowerCase()).not.toContain("runner-up")
  })

  test("case-insensitive query returns the same result as lowercase", () => {
    expect(search("WEBHOOK")).toEqual(search("webhook"))
    expect(search("webhook").secrets).toEqual(["alertWebhook"])
  })

  test("hides a whole section when none of its fields match", () => {
    const result = search("hold duration")
    expect(result.groups.map((group) => group.feature)).toEqual(["hook_session_ban"])
    expect(result.groups.find((group) => group.feature === "hook_skill_pick")).toBeUndefined()
  })

  test("returns an empty state when nothing matches", () => {
    const result = search("no-such-setting-zzz")
    expect(result.connection).toEqual([])
    expect(result.secrets).toEqual([])
    expect(result.groups).toEqual([])
    expect(result.empty).toBe(true)
  })

  test("a raw key matches even when the friendly label differs", () => {
    const result = search("minProbability")
    const pick = result.groups.find((group) => group.feature === "hook_skill_pick")
    expect(pick?.fields.map((field) => field.key)).toEqual(["minProbability"])
    expect(settingMeta("hook_skill_pick", "minProbability").label.toLowerCase()).not.toContain("minprobability")
  })

  test("matches a top-level friendly title", () => {
    expect(search("yolo").connection).toEqual(["yoloAsk"])
  })

  test("matches a top-level friendly description", () => {
    expect(search("comma-separated env").connection).toEqual(["keyEnv"])
  })

  test("matches a secret friendly title and description", () => {
    expect(search("API key").secrets).toEqual(["apiKey"])
    expect(search("write-only").secrets).toEqual(["apiKey"])
  })

  test("an empty query keeps every rendered row", () => {
    const result = search("")
    expect(result.connection).toHaveLength(12)
    expect(result.secrets).toHaveLength(4)
    expect(result.groups.flatMap((group) => group.fields)).toHaveLength(RENDERED_FEATURE_FIELDS)
    expect(result.empty).toBe(false)
  })

  test("secret fields shown in Secrets never reappear in a feature group", () => {
    const result = search("")
    const allFeatureKeys = result.groups.flatMap((group) => group.fields.map((field) => field.key))
    expect(allFeatureKeys).not.toContain("alertWebhook")
    const supervisor = result.groups.find((group) => group.feature === "hook_supervisor")
    expect(supervisor?.fields.map((field) => field.key)).not.toContain("endpoint")
  })

  test("groups are derived from the real feature defaults", () => {
    const result = search("")
    expect(result.groups.map((group) => group.feature)).toEqual(Object.keys(FEATURE_DEFAULTS))
  })
})

describe("Jev Settings search wiring and scroll gap", () => {
  test("the header renders an accessible search input with a clear affordance", () => {
    expect(gui).toMatch(/aria-label="Search settings"/)
    expect(gui).toMatch(/type="search"/)
    expect(gui).toMatch(/setSettingsQuery\(""\)/)
  })

  test("the view filters with the pure helper and shows an empty state", () => {
    expect(gui).toMatch(/filterSettings\(settingsQuery\(\), cfg\.config\)/)
    expect(gui).toContain("No settings match the search.")
  })

  test("settings root drops its top padding and meets the tab underline", () => {
    expect(gui).toMatch(/\.fazuh-jev-settings \{[^}]*padding: 0 2px 24px;[^}]*margin-top: -12px;/)
  })

  test("sticky header drops its top padding and keeps the opaque background", () => {
    expect(gui).toMatch(
      /\.fazuh-jev-settings-header \{[^}]*padding: 0 0 8px;[^}]*background: var\(--v2-background-bg-base, var\(--surface-base\)\);/,
    )
  })

  test("credential inputs stay password fields with presence flags", () => {
    expect(gui).toContain('type="password"')
    expect(gui).toContain('class="fazuh-jev-secret-state"')
  })
})
