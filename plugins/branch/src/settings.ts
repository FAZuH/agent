/**
 * Machine settings for the branch plugin, read fresh on every call so
 * /branch-settings and a hand edit both take effect without a restart.
 *
 * maxForks caps reporting forks in flight per parent. A silent fork never
 * reports, so it is not counted: its slot would never free.
 * reportBatchMs batches reports to one parent into one prompt inside the
 * window; 0 delivers each report immediately.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

export interface BranchSettings {
  maxForks: number
  reportBatchMs: number
}

export const DEFAULT_SETTINGS: BranchSettings = { maxForks: 0, reportBatchMs: 1500 }

const STATE_HOME =
  process.env.OPENCODE_BRANCH_STATE_HOME ??
  join(process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"), "opencode", "branch")

export const SETTINGS_FILE = join(STATE_HOME, "branch-state.json")

const wholeNumber = (value: unknown, fallback: number): number => {
  const parsed =
    typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value) : NaN
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback
}

export function normalizeSettings(raw: unknown): BranchSettings {
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  return {
    maxForks: wholeNumber(value.maxForks, DEFAULT_SETTINGS.maxForks),
    reportBatchMs: wholeNumber(value.reportBatchMs, DEFAULT_SETTINGS.reportBatchMs),
  }
}

export function readSettings(path = SETTINGS_FILE): BranchSettings {
  try {
    return normalizeSettings(JSON.parse(readFileSync(path, "utf8")))
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function writeSettings(settings: BranchSettings, path = SETTINGS_FILE): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 })
}

const KEYS = ["maxForks", "reportBatchMs"] as const

export function parseSettingsArgs(text: string): { settings?: Partial<BranchSettings>; error?: string } {
  const settings: Partial<BranchSettings> = {}
  for (const token of text.trim().split(/\s+/)) {
    if (!token) continue
    const at = token.indexOf("=")
    const key = at < 0 ? token : token.slice(0, at)
    const raw = at < 0 ? "" : token.slice(at + 1)
    if (!KEYS.includes(key as (typeof KEYS)[number])) {
      return { error: `unknown setting ${key}; use ${KEYS.join(" or ")}` }
    }
    if (!/^\d+$/.test(raw)) return { error: `${key} takes a whole number, got ${raw || "nothing"}` }
    settings[key as (typeof KEYS)[number]] = Number(raw)
  }
  if (!Object.keys(settings).length) return { error: "no settings given" }
  return { settings }
}

export function settingsText(settings: BranchSettings): string {
  const max = settings.maxForks === 0 ? "unlimited" : `${settings.maxForks} reporting fork(s)`
  const batch = settings.reportBatchMs === 0 ? "off, each report immediately" : `one prompt per ${settings.reportBatchMs}ms`
  return [
    `maxForks=${settings.maxForks} (${max} in flight; silent forks are not counted)`,
    `reportBatchMs=${settings.reportBatchMs} (${batch})`,
    `stored in ${SETTINGS_FILE}`,
  ].join("\n")
}
