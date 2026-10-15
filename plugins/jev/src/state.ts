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

// Three homes, three syncabilities. Config syncs between machines; data is
// expensive to rebuild (every entry cost an LLM call) so it stays local;
// the log is local history. Each has an env override for tests and odd
// setups. JEV_DATA_DIR is the previous single-dir override and still
// redirects all three, so existing test setups keep working.
const CONFIG_DIR = process.env.JEV_CONFIG_DIR ?? process.env.JEV_DATA_DIR ?? join(homedir(), ".config", "fazuh-agent")
const DATA_HOME =
  process.env.JEV_DATA_HOME ?? process.env.JEV_DATA_DIR ?? join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "fazuh-agent")
const STATE_HOME =
  process.env.JEV_STATE_HOME ?? process.env.JEV_DATA_DIR ?? join(process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"), "fazuh-agent")
const SECRET_DIR = process.env.JEV_SECRET_DIR ?? join(CONFIG_DIR, "secrets")

/** Syncable settings. Moved up from data/ so the whole dir syncs cleanly. */
export const STATE_FILE = join(CONFIG_DIR, "jev-state.json")
/** Local optimizer cache: skillCriteria plus the rosterHash it was built from. */
export const DATA_FILE = join(DATA_HOME, "jev-data.json")
/** Local call history. */
export const LOG_FILE = join(STATE_HOME, "jev-calls.jsonl")
/** TUI diagnostics. */
export const TUI_LOG_FILE = join(STATE_HOME, "jev-tui.log")
/** Default key location, overridable so another provider can use another file. */
export const DEFAULT_SECRET_FILE = join(SECRET_DIR, "jev_api_key")

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
  { key: "hook_skill_pick", label: "Skill picker hook", what: "Asks Jev which skill fits each prompt and advises it in context" },
  { key: "hook_risk", label: "Risk hook", what: "Asks Jev whether each bash/edit/write is irreversible or leaks a secret" },
]

/**
 * Per-feature settings. Each feature carries its own numbers because they
 * judge different things: the skill hook weighs a choice among ~90 candidates
 * and needs a timeout, the risk hook blocks on a noul. A field absent from a
 * stored config falls back to the default here.
 */
export type ConfigValue = number | boolean | string

export const FEATURE_DEFAULTS: Record<string, Record<string, ConfigValue>> = {
  // Probability floor fits the truncated criteria (measured P=0.89 on a
  // correct pick); the margin gate still rejects near-ties underneath it.
  // Timeout fits the measured ~2.5s full-roster call with headroom for a slow
  // provider. maxPicks caps the advised skills (-1 = every qualifier);
  // alsoAbove is the runner-up floor, the same 0.25 the TypeSafe triage
  // example uses for its second-team copy. autoOptimize warms the optimizer
  // cache when the installed id set changes. optimizeModel overrides the
  // model for the optimizer's generate.text call; empty means the host model.
  // toast is per feature; the global switch still has to be on.
  hook_skill_pick: { timeout: 5000, minProbability: 0.75, minMargin: 0.2, maxCandidates: 150, maxPicks: -1, alsoAbove: 0.25, autoOptimize: true, optimizeModel: "", toast: true },
  hook_risk: { gateProbability: 0.7, minProbability: 0.8, timeout: 5000, toast: true },
}

export interface JevState {
  /**
   * The wire protocol. "systemone" posts state plus questions and reads an
   * answers object. "chat" speaks an Ollama-style /api/chat, turns the same
   * questions into a prompt, and parses the reply back into the same answers,
   * so the validation and the confidence maths are unchanged.
   */
  protocol: "systemone" | "chat"
  /** Full URL of the decisions or chat endpoint. Empty until configured. */
  endpoint: string
  /** The provider's wire model id, which is not the host's namespaced id. */
  model: string
  /** Comma-separated env var names, checked in order before the key file. */
  keyEnv: string
  /** Key file, read when no env var matched. */
  keyFile: string
  /**
   * Whether the model reasons before answering. Some chat models spend
   * ~50s a call with it on and 3-12s without, so it ships off.
   */
  think: boolean
  /** The master switch. Off means the plugin does nothing at all. */
  enabled: boolean
  /**
   * Master switch for the TUI toasts. Off means no call is announced, whatever
   * the per-feature `toast` fields say. Only the TUI plugin can draw a toast,
   * so this does nothing on a host with no TUI module (the desktop app).
   */
  toast: boolean
  /** Feature switches, keyed from FEATURES. Absent means on. */
  features: Record<string, boolean>
  /**
   * Per-feature settings, keyed from FEATURE_DEFAULTS: timeouts in ms,
   * probabilities 0-1, counts, the autoOptimize flag, and the optimizeModel
   * override. A field absent here falls back to FEATURE_DEFAULTS, so an old
   * or partial file cannot unconfigure a feature.
   */
  config: Record<string, Record<string, ConfigValue>>
  /** Call-log cap: logCall keeps at most this many lines, pruned to the tail. */
  logMax: number
  // skillCriteria and rosterHash live in jev-data.json, not here. See
  // loadData/saveData: this interface stays syncable-only.
}

/**
 * Endpoint and model are empty on purpose. Both are provider-specific and
 * neither has a portable default, so a fresh install configures them once in
 * `/jev-settings` rather than shipping someone else's billing details.
 */
export const DEFAULTS: JevState = {
  protocol: "systemone",
  endpoint: "",
  model: "",
  keyEnv: "JEV_API_KEY",
  keyFile: DEFAULT_SECRET_FILE,
  think: false,
  enabled: true,
  toast: false,
  features: { hook_skill_pick: false, hook_risk: false },
  config: FEATURE_DEFAULTS,
  logMax: 500,
}

/**
 * Local optimizer cache. skillCriteria maps skill id → terse choice
 * criterion, keyed by hash of the original description so a body edit that
 * leaves the description alone never invalidates. rosterHash is the installed
 * id set the cache was built from; auto warm-up fires only when the live set
 * differs. Entries carry a format version so a future change invalidates
 * cleanly. Expensive to rebuild, so this file stays local, never synced.
 */
export interface JevData {
  skillCriteria: Record<string, { origHash: string; terse: string; v: number }>
  rosterHash: string
}

export const DATA_DEFAULTS: JevData = { skillCriteria: {}, rosterHash: "" }

/** Current cache-entry format. Bump to invalidate every stored criterion. */
export const SKILL_CRITERIA_VERSION = 1

const num = (raw: unknown, fallback: number): number =>
  typeof raw === "number" && Number.isFinite(raw) ? raw : fallback

/**
 * Fill every known feature, so an old or partial state file cannot silently
 * enable or disable one. Only keys in FEATURES are honoured — that is what
 * stops a typo in the JSON from inventing a switch.
 */
export function featureMap(raw: unknown, legacyGate?: unknown): Record<string, boolean> {
  // `gate` was the risk hook before it became a feature, and `pick_skill`/
  // `risk_hook` were renamed to `hook_skill_pick`/`hook_risk`. An unmigrated
  // file still carries the old spellings, and reading only the new keys would
  // silently flip configured hooks off — including the one that can stop a
  // tool call.
  const stored = (raw && typeof raw === "object" ? { ...(raw as Record<string, unknown>) } : {}) as Record<string, unknown>
  if (typeof legacyGate === "boolean") stored.hook_risk ??= legacyGate
  stored.hook_skill_pick ??= stored.pick_skill
  stored.hook_risk ??= stored.risk_hook
  return Object.fromEntries(FEATURES.map((f) => [f.key, stored[f.key] ?? DEFAULTS.features[f.key] ?? true]))
}

/**
 * Per-feature settings, merged over FEATURE_DEFAULTS so an old or partial
 * state file cannot unconfigure a feature. Unknown features and wrong-typed
 * values are dropped the same way featureMap drops unknown switches.
 */
export function featureConfigMap(raw: unknown): Record<string, Record<string, ConfigValue>> {
  const stored = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  return Object.fromEntries(
    FEATURES.map((f) => {
      const defaults = FEATURE_DEFAULTS[f.key] ?? {}
      // The pre-rename keys live under the old names in an unmigrated file.
      const oldKey = f.key === "hook_skill_pick" ? "pick_skill" : f.key === "hook_risk" ? "risk_hook" : f.key
      const own = ((stored[f.key] ?? stored[oldKey]) && typeof (stored[f.key] ?? stored[oldKey]) === "object"
        ? (stored[f.key] ?? stored[oldKey])
        : {}) as Record<string, unknown>
      return [
        f.key,
        Object.fromEntries(
          Object.entries(defaults).map(([k, v]) => [
            k,
            typeof v === "boolean" ? toBool(own[k], v) : typeof v === "string" ? asStr(own[k], v) : num(own[k], v),
          ]),
        ),
      ]
    }),
  )
}

const asStr = (value: unknown, fallback: string) => (typeof value === "string" ? value : fallback)

/** Stored booleans, plus the 1/0 the previous schema wrote, nothing else. */
export function toBool(raw: unknown, fallback: boolean): boolean {
  if (typeof raw === "boolean") return raw
  if (raw === 1) return true
  if (raw === 0) return false
  return fallback
}

/** One feature's settings. The only read path the call sites use. */
export function featureConfig(feature: string): Record<string, ConfigValue> {
  const state = loadState()
  return { ...(FEATURE_DEFAULTS[feature] ?? {}), ...(state.config[feature] ?? {}) }
}

/** Number field with its default; booleans and garbage fall back. */
export function cfgNum(feature: string, key: string): number {
  const fallback = FEATURE_DEFAULTS[feature]?.[key]
  const raw = featureConfig(feature)[key] ?? fallback
  return typeof raw === "number" && Number.isFinite(raw) ? raw : typeof fallback === "number" ? fallback : 0
}

/** Boolean field with its default; the legacy 1/0 still reads correctly. */
export function cfgBool(feature: string, key: string): boolean {
  const fallback = FEATURE_DEFAULTS[feature]?.[key]
  const raw = featureConfig(feature)[key] ?? fallback
  return toBool(raw, fallback === true)
}

/** String field with its default; anything else falls back. */
export function cfgStr(feature: string, key: string): string {
  const fallback = FEATURE_DEFAULTS[feature]?.[key]
  const raw = featureConfig(feature)[key] ?? fallback
  return typeof raw === "string" ? raw : typeof fallback === "string" ? fallback : ""
}

export function loadState(): JevState {
  let raw: any
  try {
    raw = JSON.parse(readFileSync(STATE_FILE, "utf8"))
  } catch {
    // A fresh object each time: DEFAULTS.features is module-level, and
    // setFeature mutates what loadState returns, which would otherwise rewrite
    // the defaults themselves in memory.
    return { ...DEFAULTS, features: featureMap(DEFAULTS.features), config: featureConfigMap(DEFAULTS.config) }
  }
  const str = (value: unknown, fallback: string) => (typeof value === "string" && value.trim() ? value : fallback)
  // Migration: the global minProbability/minMargin/gateProbability seeded the
  // per-feature config, so an unmigrated file keeps its tuned thresholds
  // instead of snapping back to defaults on the first load after upgrade.
  const legacy: Record<string, Record<string, number>> = {
    hook_skill_pick: {
      minProbability: num(raw.minProbability, FEATURE_DEFAULTS.hook_skill_pick.minProbability),
      minMargin: num(raw.minMargin, FEATURE_DEFAULTS.hook_skill_pick.minMargin),
    },
    hook_risk: {
      gateProbability: num(raw.gateProbability, FEATURE_DEFAULTS.hook_risk.gateProbability),
      minProbability: num(raw.minProbability, FEATURE_DEFAULTS.hook_risk.minProbability),
    },
  }
  const storedConfig = raw.config && typeof raw.config === "object" ? raw.config : {}
  // Deep-merge per feature: a stored partial config (say, only timeout) must
  // not wipe the legacy threshold seeds for the same feature. A file written
  // before the rename carries the config under the old feature keys.
  const merged: Record<string, Record<string, number>> = {}
  for (const f of FEATURES) {
    const fromLegacy = legacy[f.key] ?? {}
    const oldKey = f.key === "hook_skill_pick" ? "pick_skill" : f.key === "hook_risk" ? "risk_hook" : f.key
    const fromStored = (storedConfig as Record<string, unknown>)[f.key] ?? (storedConfig as Record<string, unknown>)[oldKey]
    merged[f.key] = { ...fromLegacy, ...(fromStored && typeof fromStored === "object" ? fromStored : {}) }
  }
  return {
    endpoint: str(raw.endpoint, DEFAULTS.endpoint),
    model: str(raw.model, DEFAULTS.model),
    keyEnv: str(raw.keyEnv, DEFAULTS.keyEnv),
    keyFile: str(raw.keyFile, DEFAULTS.keyFile),
    protocol: raw.protocol === "chat" ? "chat" : "systemone",
    think: raw.think === true,
    enabled: raw.enabled !== false,
    toast: raw.toast === true,
    features: featureMap(raw.features, raw.gate),
    config: featureConfigMap(merged),
    logMax: Math.max(10, Math.round(num(raw.logMax, DEFAULTS.logMax))),
  }
}

/** Read the local optimizer cache. A missing or corrupt file is empty cache. */
export function loadData(): JevData {
  let raw: any
  try {
    raw = JSON.parse(readFileSync(DATA_FILE, "utf8"))
  } catch {
    return { skillCriteria: {}, rosterHash: "" }
  }
  return {
    skillCriteria: skillCriteriaMap(raw.skillCriteria),
    rosterHash: typeof raw.rosterHash === "string" ? raw.rosterHash : "",
  }
}

export function saveData(patch: Partial<JevData>): JevData {
  const next = { ...loadData(), ...patch }
  mkdirSync(dirnameOf(DATA_FILE), { recursive: true })
  writeFileSync(DATA_FILE, `${JSON.stringify(next, null, 2)}\n`, "utf8")
  return next
}

/**
 * Stored optimizer cache. Only entries matching the current version with a
 * non-empty terse string survive; anything else is dropped so a corrupt or
 * foreign-format entry can never poison the roster.
 */
export function skillCriteriaMap(raw: unknown): JevData["skillCriteria"] {
  const stored = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  const out: JevData["skillCriteria"] = {}
  for (const [id, entry] of Object.entries(stored)) {
    if (!entry || typeof entry !== "object") continue
    const e = entry as Record<string, unknown>
    if (e.v !== SKILL_CRITERIA_VERSION) continue
    if (typeof e.origHash !== "string" || !e.origHash) continue
    if (typeof e.terse !== "string" || !e.terse.trim() || e.terse.length > 400) continue
    out[id] = { origHash: e.origHash, terse: e.terse.trim(), v: SKILL_CRITERIA_VERSION }
  }
  return out
}

export function setSkillCriterion(id: string, origHash: string, terse: string): void {
  const next = loadData()
  next.skillCriteria[id] = { origHash, terse: terse.trim().slice(0, 400), v: SKILL_CRITERIA_VERSION }
  saveData({ skillCriteria: next.skillCriteria })
}

export function setFeatureConfig(feature: string, key: string, value: ConfigValue): void {
  if (!(feature in FEATURE_DEFAULTS)) throw new Error(`unknown jev feature: ${feature}`)
  const known = FEATURE_DEFAULTS[feature]?.[key]
  if (known === undefined) throw new Error(`unknown jev config key: ${feature}.${key}`)
  if (typeof known === "boolean") {
    if (typeof value !== "boolean") throw new Error(`${feature}.${key} takes true/false`)
  } else if (typeof known === "string") {
    if (typeof value !== "string") throw new Error(`${feature}.${key} takes text`)
  } else if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${feature}.${key} takes a number`)
  }
  const next = loadState()
  next.config[feature] = { ...(next.config[feature] ?? {}), [key]: value }
  saveState({ config: next.config })
}

export function setLogMax(value: number): number {
  const max = Math.max(10, Math.round(value))
  saveState({ logMax: max })
  return max
}

/** The master switch. Off means nothing leaves the machine and nothing spends. */
export function pluginEnabled(): boolean {
  return loadState().enabled
}

export function setEnabled(on: boolean): boolean {
  saveState({ enabled: on })
  return on
}

/**
 * The feature's own setting, ignoring the master switch. For display: you
 * configure the features while the plugin is off, and they keep their values.
 */
export function featureStored(key: string): boolean {
  return loadState().features[key] ?? true
}

/**
 * Whether a feature may actually run: the master switch, and then the feature.
 * Every call site uses this, so turning the plugin off needs no other change.
 */
export function featureOn(key: string): boolean {
  return pluginEnabled() && featureStored(key)
}

/**
 * Whether a logged call is announced as a toast: the global switch, then the
 * feature's own `toast` field. Read fresh, so flipping either takes effect on
 * the next poll without a restart.
 */
export function toastsOn(hook: string): boolean {
  if (!pluginEnabled() || !loadState().toast) return false
  if (!FEATURES.some((f) => f.key === hook)) return false
  return cfgBool(hook, "toast")
}

/**
 * The entries newer than `after`, oldest first, plus the timestamp to pass on
 * the next read. Takes log rows newest-first, as `readLog` returns them. A
 * backwards clock jump moves `after` back to the newest entry rather than
 * leaving it in the future, where it would mute every later toast.
 */
export function newSince(rows: any[], after: string): { fresh: any[]; after: string } {
  const fresh = rows.filter((r) => typeof r?.ts === "string" && r.ts > after)
  if (fresh.length) {
    fresh.reverse()
    return { fresh, after: fresh[0].ts }
  }
  const newest = rows[0]?.ts
  return { fresh: [], after: typeof newest === "string" && newest < after ? newest : after }
}

/** The tool call a hook judged, in one clipped line. What the log already stores, shortened for a toast. */
const TOOL_CLIP = 120

function clip(text: string, max: number): string {
  const one = text.replace(/\s+/g, " ").trim()
  return one.length > max ? `${one.slice(0, max)}…` : one
}

/**
 * One decision as `risky (0.87)`: the label a person reads first, then the
 * probability, because the number is what the gate compares and a bare boolean
 * hides it. A weak answer says so, because a confident-looking 0.51 is a lie.
 */
function describe(d: any): string {
  const pct = typeof d?.probability === "number" ? ` (${d.probability.toFixed(2)})` : ""
  const low = d?.confident ? "" : " (low)"
  if (d?.kind === "noul") return `${d.value ? "risky" : "not risky"}${pct}${low}`
  return `${d?.id}=${JSON.stringify(d?.value)}${pct}${low}`
}

/**
 * The toast for a logged call: a `jev (<hook>)` title over one bullet per fact.
 * A title plus bullets instead of one crowded line, so the hook, the verdict,
 * and the cost each get their own row instead of being flattened into a
 * sentence. Null when the entry names no hook, so it cannot be attributed.
 */
export function toastLine(row: any): { title: string; message: string; variant: "info" | "error" } | null {
  const hook = typeof row?.hook === "string" ? row.hook : ""
  if (!hook) return null
  const title = `jev (${hook})`
  const bullets: string[] = []

  if (row.error) return { title, message: `* ${clip(String(row.error), 200)}`, variant: "error" }
  if (row.skipped) return { title, message: `* ${clip(String(row.skipped), 200)}`, variant: "info" }

  for (const d of Array.isArray(row.decisions) ? row.decisions : []) bullets.push(describe(d))
  if (row.subject) bullets.push(clip(String(row.subject), TOOL_CLIP))
  if (row.inputTokens) bullets.push(`${row.inputTokens}tok`)
  if (!bullets.length) return { title, message: "* no answer recorded", variant: "info" }
  return { title, message: bullets.map((b) => `* ${b}`).join("\n"), variant: "info" }
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
  mkdirSync(CONFIG_DIR, { recursive: true })
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
let logWrites = 0
export function logCall(entry: Record<string, unknown>): void {
  try {
    mkdirSync(dirnameOf(LOG_FILE), { recursive: true })
    // 0600: a logged payload is a shell command or file body, redacted but not
    // secret-free.
    writeFileSync(LOG_FILE, `${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`, { flag: "a", mode: 0o600 })
    chmodSync(LOG_FILE, 0o600)
    // The log is unbounded by nature; prune to the configured tail. Every 16th
    // write, not every write: one read+rewrite is amortized over 15 appends,
    // and a 16-call burst between prunes stays well under any sane logMax.
    if (++logWrites % 16 === 0) pruneLog()
  } catch {}
}

/** Keep the last `logMax` non-empty lines. Safe no-op on a missing log. */
export function pruneLog(): void {
  try {
    const max = loadState().logMax
    const lines = readFileSync(LOG_FILE, "utf8").split("\n").filter(Boolean)
    if (lines.length <= max) return
    writeFileSync(LOG_FILE, `${lines.slice(-max).join("\n")}\n`, { mode: 0o600 })
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

/**
 * One-shot migration from the old single-dir layout:
 *   ~/.config/fazuh-agent/data/jev-state.json  → config + data split
 *   ~/.config/fazuh-agent/data/jev-calls.jsonl → ~/.local/state/fazuh-agent/
 *
 * Runs only when the old file exists and target.state does not, so it fires
 * once and never touches an already-migrated install. The old state file is
 * left in place as the rollback path.
 */
export function migrateLegacyLayout(
  oldDir = join(homedir(), ".config", "fazuh-agent", "data"),
  target = { state: STATE_FILE, data: DATA_FILE, log: LOG_FILE },
): "skipped" | "migrated" {
  const oldState = join(oldDir, "jev-state.json")
  const oldLog = join(oldDir, "jev-calls.jsonl")
  if (!existsSync(oldState) || existsSync(target.state)) return "skipped"
  let raw: any
  try {
    raw = JSON.parse(readFileSync(oldState, "utf8"))
  } catch {
    return "skipped"
  }
  // Split: skillCriteria + rosterHash move to the data file.
  const data: JevData = {
    skillCriteria: skillCriteriaMap(raw.skillCriteria),
    rosterHash: typeof raw.rosterHash === "string" ? raw.rosterHash : "",
  }
  delete raw.skillCriteria
  delete raw.rosterHash
  mkdirSync(dirnameOf(target.state), { recursive: true })
  writeFileSync(target.state, `${JSON.stringify(raw, null, 2)}\n`, "utf8")
  mkdirSync(dirnameOf(target.data), { recursive: true })
  writeFileSync(target.data, `${JSON.stringify(data, null, 2)}\n`, "utf8")
  // Move the log to the state dir.
  if (existsSync(oldLog) && !existsSync(target.log)) {
    mkdirSync(dirnameOf(target.log), { recursive: true })
    writeFileSync(target.log, readFileSync(oldLog, "utf8"), { mode: 0o600 })
    chmodSync(target.log, 0o600)
  }
  // Old state file left in place as the rollback path; target.state now
  // exists, so this never runs again.
  return "migrated"
}

// Guarded at the call site: with env overrides (tests) the default oldDir
// still points at the real home while targets redirect to scratch, which
// would migrate live files into a temp dir.
if (
  !process.env.JEV_CONFIG_DIR &&
  !process.env.JEV_DATA_DIR &&
  !process.env.JEV_DATA_HOME &&
  !process.env.JEV_STATE_HOME
) {
  migrateLegacyLayout()
}
