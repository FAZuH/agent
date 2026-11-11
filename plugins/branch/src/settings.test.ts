/**
 * Self-check for the branch settings file. No host: the settings decide when a
 * fork is refused and whether reports batch, so parsing and defaults are the
 * parts worth pinning.
 *
 *   bun test src/settings.test.ts
 */

import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  parseSettingsArgs,
  readSettings,
  settingsText,
  writeSettings,
} from "./settings.ts"

describe("normalizeSettings", () => {
  test("falls back to the defaults for anything unusable", () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS)
    expect(normalizeSettings({ maxForks: -2, reportBatchMs: "soon" })).toEqual(DEFAULT_SETTINGS)
  })

  test("keeps whole numbers", () => {
    expect(normalizeSettings({ maxForks: 3, reportBatchMs: 0 })).toEqual({ maxForks: 3, reportBatchMs: 0 })
    expect(normalizeSettings({ maxForks: "2" })).toEqual({ maxForks: 2, reportBatchMs: 1500 })
    expect(normalizeSettings({ maxForks: "2.9" })).toEqual({ maxForks: 0, reportBatchMs: 1500 })
  })
})

describe("parseSettingsArgs", () => {
  test("reads both settings", () => {
    expect(parseSettingsArgs("maxForks=4 reportBatchMs=0")).toEqual({
      settings: { maxForks: 4, reportBatchMs: 0 },
    })
  })

  test("rejects unknown keys, missing values, and empty input", () => {
    expect(parseSettingsArgs("maxFork=4").error).toContain("unknown setting maxFork")
    expect(parseSettingsArgs("maxForks=").error).toContain("takes a whole number")
    expect(parseSettingsArgs("   ").error).toContain("no settings given")
  })
})

describe("the settings file", () => {
  test("missing or broken files read as defaults", () => {
    const dir = mkdtempSync(join(tmpdir(), "branch-settings-"))
    try {
      expect(readSettings(join(dir, "missing.json"))).toEqual(DEFAULT_SETTINGS)
      const broken = join(dir, "broken.json")
      writeFileSync(broken, "{not json")
      expect(readSettings(broken)).toEqual(DEFAULT_SETTINGS)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("a write reads back as written", () => {
    const dir = mkdtempSync(join(tmpdir(), "branch-settings-"))
    try {
      const path = join(dir, "nested", "branch-state.json")
      writeSettings({ maxForks: 2, reportBatchMs: 500 }, path)
      expect(readSettings(path)).toEqual({ maxForks: 2, reportBatchMs: 500 })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("settingsText", () => {
  test("names the unlimited and off cases", () => {
    const text = settingsText({ maxForks: 0, reportBatchMs: 0 })
    expect(text).toContain("maxForks=0 (unlimited")
    expect(text).toContain("reportBatchMs=0 (off")
  })
})
