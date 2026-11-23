/**
 * The Watchdog page's effective configuration (#18): persisted settings with
 * the environment still winning, the feature-family split, and the names of
 * any active env overrides.
 *
 * Precedence is env → persisted → chain defaults. An env-armed deployment
 * keeps behaving exactly as before the page existed (the no-loss migration
 * rule); a persisted value takes effect the moment the operator removes the
 * env override; nothing configured anywhere can fall below the enforcement
 * clamps chain.ts applies on read.
 *
 * This module is the one place both surfaces read from: index.ts's chain
 * wiring (enforcement) and the page's server module (display and writes). It
 * imports only the shared state library and chain.ts's own types, so the
 * page never depends on Jev's provider or hooks.
 */

import { loadState, type WatchdogSettings } from "../../../lib/jev/state.ts"
import { normalizeAction } from "./actions.ts"
import { CHAIN_DEFAULTS, CHAIN_ENABLE_SWITCH, type ChainLimits, type ChainNodes } from "./chain.ts"

/** Admission pacing, from the environment until the Watchdog page (#18) owns it. */
export const CHAIN_CAP_ENV = "WATCHDOG_CHAIN_CAP"
export const CHAIN_TIMING_ENV = "WATCHDOG_CHAIN_TIMING"
export const CHAIN_BATCH_MAX_ENV = "WATCHDOG_CHAIN_BATCH_MAX"
export const CHAIN_BATCH_MS_ENV = "WATCHDOG_CHAIN_BATCH_MS"
export const CHAIN_JEV_BATCH_MAX_ENV = "WATCHDOG_CHAIN_JEV_BATCH_MAX"
export const CHAIN_JEV_BATCH_MS_ENV = "WATCHDOG_CHAIN_JEV_BATCH_MS"
export const CHAIN_REPAIR_MAX_ENV = "WATCHDOG_CHAIN_REPAIR_MAX"
export const CHAIN_TRANSPORT_ATTEMPTS_ENV = "WATCHDOG_CHAIN_TRANSPORT_ATTEMPTS"
export const CHAIN_TRANSPORT_BACKOFF_ENV = "WATCHDOG_CHAIN_TRANSPORT_BACKOFF_MS"
export const CHAIN_NODES_ENV = "WATCHDOG_CHAIN_NODES"
export const CHAIN_ASK_MODE_ENV = "WATCHDOG_CHAIN_ASK_MODE"

/**
 * The chain's pacing settings. An unset or unusable variable falls to the
 * persisted page value, and an unusable persisted value to the conservative
 * default: a guessed cap or window would silently change admission behavior,
 * so only a value the operator actually wrote is used.
 */
export function watchdogLimits(): ChainLimits {
  const stored = loadState().watchdog
  const num = (name: string, fallback: number, min: number): number => {
    const raw = Number(process.env[name])
    return Number.isFinite(raw) && raw >= min ? Math.floor(raw) : fallback
  }
  // Both literals are honored: a set env value wins over the persisted page
  // value for blocking and nonblocking alike, and only an unset or unusable
  // variable falls through.
  const envTiming = process.env[CHAIN_TIMING_ENV]?.trim()
  return {
    sessionCap: num(CHAIN_CAP_ENV, stored.sessionCap, 1),
    jevBatch: {
      max: num(CHAIN_JEV_BATCH_MAX_ENV, stored.jevBatchMax, 1),
      ms: num(CHAIN_JEV_BATCH_MS_ENV, stored.jevBatchMs, 0),
    },
    supervisorBatch: {
      max: num(CHAIN_BATCH_MAX_ENV, stored.supervisorBatchMax, 1),
      ms: num(CHAIN_BATCH_MS_ENV, stored.supervisorBatchMs, 0),
    },
    repair: {
      max: num(CHAIN_REPAIR_MAX_ENV, CHAIN_DEFAULTS.repair.max, 0),
    },
    transport: {
      attempts: num(CHAIN_TRANSPORT_ATTEMPTS_ENV, CHAIN_DEFAULTS.transport.attempts, 1),
      backoffMs: num(CHAIN_TRANSPORT_BACKOFF_ENV, CHAIN_DEFAULTS.transport.backoffMs, 0),
    },
    timing: envTiming === "blocking" || envTiming === "nonblocking" ? envTiming : stored.timing,
  }
}

/**
 * The chain's node controls. Every node is on unless a configured source
 * names a subset: the env list wins over the persisted page list, and an
 * unconfigured page (empty list) means every node on. `humanOnly` stays
 * environment-only: it is an action allowlist, not one of the page's controls.
 */
export function watchdogNodes(): ChainNodes {
  const envList = process.env[CHAIN_NODES_ENV]
  const names = envList?.trim()
    ? envList
    : loadState().watchdog.nodes.join(",")
  // A blank list is an unconfigured page, and unconfigured is the documented
  // all-on default: only a list that actually names nodes narrows them.
  const on = new Set(
    String(names?.trim() ? names : "jev,parent,supervisor,human")
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  )
  return {
    jev: on.has("jev"),
    parent: on.has("parent"),
    supervisor: on.has("supervisor"),
    human: on.has("human"),
    humanOnly: String(process.env.WATCHDOG_CHAIN_HUMAN_ONLY ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map(normalizeAction),
  }
}

/**
 * The chain's activation switch (#21). A set environment value wins — only the
 * literal "1" means on, anything else set means off — and an unset variable
 * falls to the persisted page value. The gate file stays the second condition
 * and is read by the caller, not here.
 */
export function watchdogChain(): boolean {
  if (process.env[CHAIN_ENABLE_SWITCH] !== undefined) return process.env[CHAIN_ENABLE_SWITCH] === "1"
  return loadState().watchdog.chain
}

/**
 * Ask routing (#21): judged runs jev, then the parent or supervisor stage, then
 * the human card; immediate sends a host ask straight to the card. A set
 * environment literal wins, an unusable value falls to the persisted page
 * value, and the default routes every host ask through the stages.
 */
export function watchdogAskMode(): "judged" | "immediate" {
  const env = process.env[CHAIN_ASK_MODE_ENV]?.trim()
  if (env === "immediate" || env === "judged") return env
  return loadState().watchdog.askMode
}

/** The env override names active right now, so the page can mark them. */
export function watchdogEnvOverrides(): string[] {
  const pairs: Array<[string, string]> = [
    [CHAIN_CAP_ENV, "sessionCap"],
    [CHAIN_TIMING_ENV, "timing"],
    [CHAIN_JEV_BATCH_MAX_ENV, "jevBatchMax"],
    [CHAIN_JEV_BATCH_MS_ENV, "jevBatchMs"],
    [CHAIN_BATCH_MAX_ENV, "supervisorBatchMax"],
    [CHAIN_BATCH_MS_ENV, "supervisorBatchMs"],
    [CHAIN_NODES_ENV, "nodes"],
    [CHAIN_ASK_MODE_ENV, "askMode"],
  ]
  const on = pairs.filter(([env]) => process.env[env]?.trim()).map(([, field]) => field)
  // The switch wins whenever it is set, whatever it holds, so its marker is a
  // defined check, not the trim check every value-carrying variable uses.
  if (process.env[CHAIN_ENABLE_SWITCH] !== undefined) on.push("chain")
  return on
}

/** The feature families. The Watchdog page owns these feature toggles. */
export { WATCHDOG_FEATURES, JEV_FEATURES } from "./feature-families.ts"

/** A stored list normalized exactly the way the migration reader stores it. */
export function normalizeNodes(raw: string): string[] {
  return String(raw ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => ["jev", "parent", "supervisor", "human"].includes(entry))
}

/** The persisted scope as the page saves it: clamped and validated on write. */
export function nextWatchdogSettings(stored: WatchdogSettings, key: string, value: unknown): WatchdogSettings | null {
  const count = (raw: unknown, min: number): number | null => {
    const num = Math.round(Number(raw))
    return Number.isFinite(num) && num >= min ? num : null
  }
  switch (key) {
    case "on":
      return typeof value === "boolean" ? { ...stored, on: value } : null
    case "nodes":
      return typeof value === "string" ? { ...stored, nodes: normalizeNodes(value) } : null
    case "timing":
      return value === "blocking" || value === "nonblocking" ? { ...stored, timing: value } : null
    case "chain":
      return typeof value === "boolean" ? { ...stored, chain: value } : null
    case "askMode":
      return value === "judged" || value === "immediate" ? { ...stored, askMode: value } : null
    case "sessionCap":
    case "jevBatchMax":
    case "jevBatchMs":
    case "supervisorBatchMax":
    case "supervisorBatchMs": {
      const min = key.endsWith("Ms") ? 0 : 1
      const num = count(value, min)
      return num === null ? null : { ...stored, [key]: num }
    }
    default:
      return null
  }
}
