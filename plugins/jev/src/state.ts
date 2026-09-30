/**
 * Runtime state for the jev plugin: endpoint, model, key location, thresholds.
 *
 * Nothing here names a provider. The defaults describe one working deployment,
 * but every field is a setting, because the wire model id and the endpoint path
 * are provider-specific and there is no portable default for either. Read fresh
 * on every call so a change takes effect without a restart.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

const DATA_DIR = join(homedir(), ".config", "fazuh-agent", "data")
const SECRET_DIR = join(homedir(), ".config", "fazuh-agent", "secrets")

export const STATE_FILE = join(DATA_DIR, "jev-state.json")
export const LOG_FILE = join(DATA_DIR, "jev-calls.jsonl")
/** Default key location, overridable so another provider can use another file. */
export const DEFAULT_SECRET_FILE = join(SECRET_DIR, "commandcode_api_key")

/**
 * A toggleable piece of behaviour. `key` is what lands in the state file and
 * what the code checks; `label` and `what` are the panel's rows. Keeping the
 * list here means the panel cannot drift from what the plugin honours.
 */
export interface Feature {
  key: string
  label: string
  what: string
}

export const FEATURES: Feature[] = [
  { key: "pick_skill", label: "Skill picker", what: "jev_pick_skill — which skill to load" },
  { key: "pick_control", label: "Control picker", what: "jev_pick_control — which on-page control to click" },
  { key: "review_rank", label: "Review ranking", what: "jev_review_rank — review priority per changed file" },
  { key: "check", label: "Yes/no check", what: "jev_check — one bounded question about a piece of text" },
  { key: "review_gates", label: "Review rule gates", what: "The seven rule checks inside jev_review_rank. Ranking still works without them." },
  { key: "risk_hook", label: "Risk hook", what: "Asks Jev whether each bash/edit/write is irreversible or leaks a secret" },
]

export interface JevState {
  /** Full URL of the decisions endpoint. */
  endpoint: string
  /** The provider's wire model id, which is not the host's namespaced id. */
  model: string
  /** Comma-separated env var names, checked in order before the key file. */
  keyEnv: string
  /** Key file, read when no env var matched. */
  keyFile: string
  /** Feature switches, keyed from FEATURES. Absent means on. */
  features: Record<string, boolean>
  /** A choice below this top probability is reported as low-confidence. */
  minProbability: number
  /** A choice below this gap to the runner-up is reported as low-confidence. */
  minMargin: number
  /**
   * The risk gate blocks a call at or above this probability, and the review
   * tool warns on a gate at or above it. One number, two uses, on purpose:
   * they are the same judgement at different scales. Only honoured when the
   * answer is also confident, so a weak high probability cannot block.
   */
  gateProbability: number
}

export const DEFAULTS: JevState = {
  endpoint: "https://api.commandcode.ai/provider/v1/systemone",
  model: "typesafe/jev",
  keyEnv: "CMD_API_KEY,JEV_API_KEY",
  keyFile: DEFAULT_SECRET_FILE,
  features: { risk_hook: false },
  minProbability: 0.8,
  minMargin: 0.15,
  gateProbability: 0.7,
}

const num = (raw: unknown, fallback: number): number =>
  typeof raw === "number" && Number.isFinite(raw) ? raw : fallback

/**
 * Fill every known feature, so an old or partial state file cannot silently
 * enable or disable one. Only keys in FEATURES are honoured — that is what
 * stops a typo in the JSON from inventing a switch.
 */
export function featureMap(raw: unknown, legacyGate?: unknown): Record<string, boolean> {
  // `gate` was the risk hook before it became a feature. An unmigrated file
  // still has it, and reading only `features` would silently drop an enabled
  // gate — the one switch that can stop a tool call.
  const stored = (raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}) as Record<string, unknown>
  if (typeof legacyGate === "boolean") stored.risk_hook ??= legacyGate
  return Object.fromEntries(FEATURES.map((f) => [f.key, stored[f.key] ?? DEFAULTS.features[f.key] ?? true]))
}

export function loadState(): JevState {
  let raw: any
  try {
    raw = JSON.parse(readFileSync(STATE_FILE, "utf8"))
  } catch {
    return { ...DEFAULTS }
  }
  const str = (value: unknown, fallback: string) => (typeof value === "string" && value.trim() ? value : fallback)
  return {
    endpoint: str(raw.endpoint, DEFAULTS.endpoint),
    model: str(raw.model, DEFAULTS.model),
    keyEnv: str(raw.keyEnv, DEFAULTS.keyEnv),
    keyFile: str(raw.keyFile, DEFAULTS.keyFile),
    features: featureMap(raw.features, raw.gate),
    minProbability: num(raw.minProbability, DEFAULTS.minProbability),
    minMargin: num(raw.minMargin, DEFAULTS.minMargin),
    gateProbability: num(raw.gateProbability, DEFAULTS.gateProbability),
  }
}

/** Is a feature on? Read fresh per call, so a toggle takes effect at once. */
export function featureOn(key: string): boolean {
  return loadState().features[key] ?? true
}

export function setFeature(key: string, on: boolean): boolean {
  if (!FEATURES.some((f) => f.key === key)) throw new Error(`unknown jev feature: ${key}`)
  const next = loadState()
  next.features[key] = on
  saveState({ features: next.features })
  return on
}

export function saveState(patch: Partial<JevState>): JevState {
  const next = { ...loadState(), ...patch }
  mkdirSync(DATA_DIR, { recursive: true })
  writeFileSync(STATE_FILE, `${JSON.stringify(next, null, 2)}\n`, "utf8")
  return next
}

/** Where the key came from, for status output. The value is never returned. */
export function keySource(): { present: boolean; from: string } {
  const state = loadState()
  for (const name of state.keyEnv.split(",").map((s) => s.trim()).filter(Boolean)) {
    if ((process.env[name] ?? "").trim()) return { present: true, from: `$${name}` }
  }
  try {
    if (existsSync(state.keyFile) && readFileSync(state.keyFile, "utf8").trim()) {
      return { present: true, from: state.keyFile }
    }
  } catch {}
  return { present: false, from: "none" }
}

export function resolveKey(): string | null {
  const state = loadState()
  for (const name of state.keyEnv.split(",").map((s) => s.trim()).filter(Boolean)) {
    const value = (process.env[name] ?? "").trim()
    if (value) return value
  }
  try {
    if (existsSync(state.keyFile)) {
      const value = readFileSync(state.keyFile, "utf8").trim()
      if (value) return value
    }
  } catch {}
  return null
}

/** Write the key to the configured file at 0600. Used by /jev-key. */
export function writeKey(value: string): string {
  const target = loadState().keyFile
  mkdirSync(dirnameOf(target), { recursive: true })
  writeFileSync(target, `${value}\n`, { encoding: "utf8", mode: 0o600 })
  chmodSync(target, 0o600)
  return target
}

function dirnameOf(path: string): string {
  const i = path.lastIndexOf("/")
  return i > 0 ? path.slice(0, i) : "."
}

/** Append one line per call. Never records the key. */
export function logCall(entry: Record<string, unknown>): void {
  try {
    mkdirSync(DATA_DIR, { recursive: true })
    // 0600: a logged payload is a shell command or file body, redacted but not
    // secret-free, and this is the same directory as the key.
    writeFileSync(LOG_FILE, `${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`, { flag: "a", mode: 0o600 })
    chmodSync(LOG_FILE, 0o600)
  } catch {}
}

export function readLog(limit = 40): any[] {
  try {
    return readFileSync(LOG_FILE, "utf8")
      .split("\n")
      .filter(Boolean)
      .slice(-limit)
      .reverse()
      .flatMap((line) => {
        try {
          return [JSON.parse(line)]
        } catch {
          return []
        }
      })
  } catch {
    return []
  }
}

export function spend(): { calls: number; tokens: number; usd: number } {
  const rows = readLog(1000)
  const tokens = rows.reduce((sum, row: any) => sum + (row.inputTokens ?? 0), 0)
  return { calls: rows.length, tokens, usd: (tokens / 1_000_000) * 0.04 }
}
