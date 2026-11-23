/**
 * Snapshot and writers for the Watchdog page's settings and status (#18).
 * Server-side only: this module reads state files and never crosses into the
 * GUI bundle.
 *
 * Credentials stay write-only here. The abort-receipts webhook carries a
 * delivery token, so the page treats it as a secret: the snapshot returns a
 * presence boolean, the stored value never enters a returned object, an error
 * message, a migration report, or a log line.
 *
 * The migration is fill-on-read (the loadState precedent): a state file
 * written before this page existed reads with the off-by-default scope and
 * the chain's own default values, and gains the scope on disk only when a
 * value is actually saved. Ban files, abort records, delivery rows, and the
 * approvals store are never touched by anything here.
 */

import { cfgStr, loadState, readRawState, saveState, setFeatureConfig, watchdogMap, type WatchdogSettings } from "../../../lib/jev/state.ts"
import { nextWatchdogSettings, watchdogAskMode, watchdogChain, watchdogEnvOverrides, watchdogLimits, watchdogNodes } from "./watchdog-config.ts"

export interface WatchdogSettingsResult {
  ok: boolean
  error?: string
}

export interface SetWatchdogSettingInput {
  key: string
  value: unknown
}

export type SetWatchdogSecretKey = "receiptsWebhook" | "supervisorEndpoint"

export interface SetWatchdogSecretInput {
  key: SetWatchdogSecretKey
  value: string
}

/** Every key the page may write, in one place for the contract and the tests. */
export const WATCHDOG_SETTING_KEYS = [
  "on",
  "nodes",
  "timing",
  "sessionCap",
  "jevBatchMax",
  "jevBatchMs",
  "supervisorBatchMax",
  "supervisorBatchMs",
  "chain",
  "askMode",
] as const

/** The receipts webhook's presence, never its value. */
export function receiptsWebhookPresent(): boolean {
  return cfgStr("hook_abort_receipts", "webhook").trim().length > 0
}

/** The supervisor endpoint's presence, never its value. */
export function supervisorEndpointPresent(): boolean {
  return cfgStr("hook_supervisor", "endpoint").trim().length > 0
}

/**
 * The editable picture: persisted values, the effective enforcement values
 * (env wins, and the page marks which fields an env override owns), and the
 * receipts webhook's presence. No credential value is ever included.
 */
export function watchdogSnapshot() {
  const state = loadState()
  const stored = state.watchdog
  const effective = watchdogLimits()
  const nodes = watchdogNodes()
  return {
    on: stored.on,
    persisted: {
      nodes: stored.nodes.join(","),
      timing: stored.timing,
      sessionCap: stored.sessionCap,
      jevBatchMax: stored.jevBatchMax,
      jevBatchMs: stored.jevBatchMs,
      supervisorBatchMax: stored.supervisorBatchMax,
      supervisorBatchMs: stored.supervisorBatchMs,
      chain: stored.chain,
      askMode: stored.askMode,
    },
    effective: {
      timing: effective.timing,
      sessionCap: effective.sessionCap,
      jevBatchMax: effective.jevBatch.max,
      jevBatchMs: effective.jevBatch.ms,
      supervisorBatchMax: effective.supervisorBatch.max,
      supervisorBatchMs: effective.supervisorBatch.ms,
      nodes: { jev: nodes.jev, parent: nodes.parent, supervisor: nodes.supervisor, human: nodes.human },
      chain: watchdogChain(),
      askMode: watchdogAskMode(),
    },
    envOverrides: watchdogEnvOverrides(),
    receiptsWebhookPresent: receiptsWebhookPresent(),
    supervisorEndpointPresent: supervisorEndpointPresent(),
    migration: watchdogMigrationReport(readRawState()?.watchdog),
  }
}

/**
 * What the migration reader did with the raw persisted scope, as a report the
 * page and the audit log can carry: counts and field names only, never a
 * value, never a secret.
 */
export function watchdogMigrationReport(raw: unknown): { present: boolean; stored: number; defaulted: number; invalid: number } {
  const stored = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const migrated = watchdogMap(raw)
  const fields = Object.keys(migrated) as Array<keyof WatchdogSettings>
  let kept = 0
  let invalid = 0
  for (const field of fields) {
    const value = stored[field]
    if (value === undefined) continue
    if (JSON.stringify(migrated[field]) === JSON.stringify(value)) kept++
    else invalid++
  }
  return { present: raw !== undefined, stored: kept, defaulted: fields.length - kept - invalid, invalid }
}

/** Write one page field. Errors never contain the value. */
export function applyWatchdogSetting(input: SetWatchdogSettingInput): WatchdogSettingsResult {
  if (!input || typeof input !== "object") return { ok: false, error: "Invalid setting." }
  const { key, value } = input
  if (!(WATCHDOG_SETTING_KEYS as readonly string[]).includes(key)) return { ok: false, error: "Unknown setting." }
  const next = nextWatchdogSettings(loadState().watchdog, key, value)
  if (!next) return { ok: false, error: `Wrong type for ${key}.` }
  saveState({ watchdog: next })
  return { ok: true }
}

/** Write a Watchdog credential without ever returning or logging its value. */
export function applyWatchdogSecret(input: SetWatchdogSecretInput): WatchdogSettingsResult {
  if (!input || typeof input !== "object") return { ok: false, error: "Invalid secret." }
  if (input.key !== "receiptsWebhook" && input.key !== "supervisorEndpoint") return { ok: false, error: "Unknown secret." }
  const value = typeof input.value === "string" ? input.value.trim() : ""
  if (input.key === "supervisorEndpoint") {
    if (!value) {
      try {
        setFeatureConfig("hook_supervisor", "endpoint", "")
        return { ok: true }
      } catch {
        return { ok: false, error: "Could not clear the endpoint." }
      }
    }
    try {
      setFeatureConfig("hook_supervisor", "endpoint", value)
      return { ok: true }
    } catch {
      return { ok: false, error: "Could not save the endpoint." }
    }
  }
  if (!value) {
    // Clearing is a legitimate write: an empty webhook is the documented
    // "no-endpoint" posture, not a refusal.
    try {
      setFeatureConfig("hook_abort_receipts", "webhook", "")
      return { ok: true }
    } catch {
      return { ok: false, error: "Could not clear the webhook." }
    }
  }
  try {
    setFeatureConfig("hook_abort_receipts", "webhook", value)
  } catch {
    return { ok: false, error: "Could not save the webhook." }
  }
  return { ok: true }
}
