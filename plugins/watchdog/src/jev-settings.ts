/**
 * Snapshot and writers for the Jev Desktop Settings tab. Server-side only:
 * this module reads state files and never crosses into the GUI bundle.
 *
 * Credentials are write-only here. The snapshot returns presence booleans for
 * the key, the alert webhook, and the endpoint URL; the stored values never
 * enter a returned object, an error message, or a log line.
 */
import {
  FEATURES,
  FEATURE_DEFAULTS,
  cfgStr,
  keySource,
  loadState,
  saveState,
  setFeatureConfig,
  writeKey,
  type ConfigValue,
  type JevState,
} from "../../../lib/jev/state.ts"

export interface SettingsResult {
  ok: boolean
  error?: string
}

export interface SetSettingInput {
  scope: "state" | "feature"
  key: string
  value: ConfigValue
  feature?: string
}

export interface SetSecretInput {
  key: "apiKey" | "alertWebhook"
  value: string
}

type FieldType = "boolean" | "string" | "number"

interface FieldRule {
  type: FieldType
  values?: readonly string[]
}

/** Editable top-level fields and the only shapes accepted for each. */
const STATE_RULES: Record<string, FieldRule> = {
  protocol: { type: "string", values: ["systemone", "chat", "opencode"] },
  think: { type: "boolean" },
  model: { type: "string" },
  keyEnv: { type: "string" },
  keyFile: { type: "string" },
  endpoint: { type: "string" },
  yoloAsk: { type: "string", values: ["block-notify", "no-op"] },
  approveTtl: { type: "number" },
  sidebar: { type: "boolean" },
  sidebarCount: { type: "number" },
  sidebarSubject: { type: "boolean" },
  toast: { type: "boolean" },
  logMax: { type: "number" },
}

function matches(value: ConfigValue, rule: FieldRule): boolean {
  if (typeof value !== rule.type) return false
  if (rule.type === "number" && !Number.isFinite(value)) return false
  if (rule.values && !rule.values.includes(String(value))) return false
  return true
}

/** The whole merged settings picture, with every credential replaced by a flag. */
export function settingsSnapshot() {
  const state = loadState()
  const config: Record<string, Record<string, ConfigValue>> = {}
  for (const feature of FEATURES) {
    const defaults = FEATURE_DEFAULTS[feature.key] ?? {}
    const stored = state.config[feature.key] ?? {}
    const fields: Record<string, ConfigValue> = {}
    for (const [key, fallback] of Object.entries(defaults)) {
      const secret = key === "alertWebhook" || (feature.key === "hook_supervisor" && key === "endpoint")
      fields[key] = secret ? "" : (stored[key] ?? fallback)
    }
    config[feature.key] = fields
  }
  const webhook = cfgStr("hook_tool_risk", "alertWebhook").trim()
  return {
    protocol: state.protocol,
    think: state.think,
    model: state.model,
    keyEnv: state.keyEnv,
    keyFile: state.keyFile,
    yoloAsk: state.yoloAsk,
    approveTtl: state.approveTtl,
    sidebar: state.sidebar,
    sidebarCount: state.sidebarCount,
    sidebarSubject: state.sidebarSubject,
    toast: state.toast,
    logMax: state.logMax,
    secrets: {
      keyPresent: keySource().present,
      webhookPresent: webhook.length > 0,
      endpointPresent: state.endpoint.trim().length > 0,
      supervisorEndpointPresent: cfgStr("hook_supervisor", "endpoint").trim().length > 0,
    },
    config,
    features: Object.fromEntries(FEATURES.map((f) => [f.key, state.features[f.key] ?? true])),
  }
}

/** Write one top-level or per-feature field. Errors never contain the value. */
export function applySetting(input: SetSettingInput): SettingsResult {
  if (!input || typeof input !== "object") return { ok: false, error: "Invalid setting." }
  const { scope, key, value } = input
  if (scope === "state") {
    const rule = STATE_RULES[key]
    if (!rule) return { ok: false, error: "Unknown setting." }
    if (!matches(value, rule)) return { ok: false, error: `Wrong type for ${key}.` }
    saveState({ [key]: value } as Partial<JevState>)
    return { ok: true }
  }
  if (scope === "feature") {
    const { feature } = input
    if (typeof feature !== "string" || !(feature in FEATURE_DEFAULTS)) return { ok: false, error: "Unknown feature." }
    if (key === "alertWebhook") return { ok: false, error: "Use the webhook field in Secrets." }
    const known = FEATURE_DEFAULTS[feature]?.[key]
    if (known === undefined) return { ok: false, error: "Unknown config key." }
    if (!matches(value, { type: typeof known as FieldType })) return { ok: false, error: `Wrong type for ${key}.` }
    try {
      setFeatureConfig(feature, key, value)
    } catch {
      return { ok: false, error: "Could not save the setting." }
    }
    return { ok: true }
  }
  return { ok: false, error: "Unknown scope." }
}

/** Write a credential without ever returning, logging, or echoing its value. */
export function applySecret(input: SetSecretInput): SettingsResult {
  if (!input || typeof input !== "object") return { ok: false, error: "Invalid secret." }
  const value = typeof input.value === "string" ? input.value.trim() : ""
  if (input.key === "apiKey") {
    if (!value) return { ok: false, error: "Enter a key first." }
    try {
      writeKey(value)
    } catch {
      return { ok: false, error: "Could not save the key." }
    }
    return { ok: true }
  }
  if (input.key === "alertWebhook") {
    try {
      setFeatureConfig("hook_tool_risk", "alertWebhook", value)
    } catch {
      return { ok: false, error: "Could not save the webhook." }
    }
    return { ok: true }
  }
  return { ok: false, error: "Unknown secret." }
}
