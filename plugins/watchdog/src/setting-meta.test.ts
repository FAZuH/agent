import { describe, expect, test } from "bun:test"
import { FEATURE_DEFAULTS, FEATURES } from "../../../lib/lib-jev/state.ts"
import { friendlyGroup, friendlyLabel, groupLabel, settingMeta } from "../../../lib/lib-jev/setting-meta.ts"

const rendered = Object.entries(FEATURE_DEFAULTS).flatMap(([feature, fields]) =>
  Object.entries(fields).map(([key]) => ({ feature, key })),
)

const noRawKey = /hook_|_|[a-z][A-Z]/

describe("Jev Settings display metadata", () => {
  test.each(rendered)("$feature.$key has a friendly title", ({ feature, key }) => {
    expect(settingMeta(feature, key).label.length).toBeGreaterThan(0)
  })

  test.each(rendered)("$feature.$key has a description", ({ feature, key }) => {
    expect(settingMeta(feature, key).description.length).toBeGreaterThan(0)
  })

  test.each(rendered)("$feature.$key title has no raw key text", ({ feature, key }) => {
    expect(settingMeta(feature, key).label).not.toMatch(noRawKey)
  })

  test.each(FEATURES)("$key uses the feature's friendly group title", (feature) => {
    expect(groupLabel(feature.key)).toBe(feature.label)
  })

  test.each(FEATURES)("$key group title has no raw feature text", (feature) => {
    expect(groupLabel(feature.key)).not.toMatch(noRawKey)
  })

  test("an unmapped key title splits camelCase and drops a hook prefix", () => {
    expect(friendlyLabel("hook_someNewKey")).toBe("Some new key")
  })

  test("an unmapped feature title splits underscores and drops a hook prefix", () => {
    expect(friendlyGroup("hook_future_feature")).toBe("Future feature")
  })

  test("a fallback key keeps a description from the metadata", () => {
    expect(settingMeta("hook_future", "timeout").description).toBe(
      settingMeta("hook_skill_pick", "timeout").description,
    )
  })
})
