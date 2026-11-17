/**
 * Server-side RPC handlers for the Jev Desktop panel. This module is imported
 * only by the server plugin, never by the GUI bundle: it reads the state and
 * log files from disk. Every value returned here is an allowlisted projection,
 * so a credential in a state field or a logged payload cannot cross RPC.
 */
import { grant, readApprovals, rejectApproval } from "./approve.ts"
import {
  FEATURES,
  STATE_FILE,
  featureOn,
  featureStored,
  keySource,
  loadState,
  maskUrl,
  readLog,
  setEnabled,
  setFeature,
  spend,
} from "./state.ts"

type Emit = (event: { reason: string }) => void
// The server loads a plugin once per location. Keep every registration's
// emitter: the panel may subscribe to one instance while a mutation lands on
// another, and only emitting to all of them refreshes that panel.
const emitters = new Set<Emit>()

/** The registration supplies its emitter once `ctx.rpc.register` resolves. */
export function setJevEmitter(fn: Emit | undefined): void {
  if (fn) emitters.add(fn)
}

function changed(reason: string): void {
  for (const emit of emitters) {
    void Promise.resolve(emit({ reason })).catch(() => {})
  }
}

/** Fields of a call row the panel may show. Never `sent`, `received`, or a URL. */
const LOG_FIELDS = [
  "ts",
  "hook",
  "event",
  "verdict",
  "confidence",
  "round",
  "resolution",
  "detail",
  "error",
  "skipped",
  "tool",
  "elapsedMs",
  "evidenceCalls",
  "inputTokens",
  "reason",
  // Detail the log row can expand to. `subject` is already redacted at write
  // time; `sent`/`received` hold the full prompt payload and stay out.
  "subject",
  "outcome",
  "blocked",
  "token",
  "acted",
  "decisions",
  "rules",
] as const

export function statusSnapshot() {
  const state = loadState()
  const supervisor = state.config.hook_supervisor ?? {}
  const key = keySource()
  return {
    enabled: state.enabled,
    toast: state.toast,
    features: FEATURES.map((feature) => ({
      key: feature.key,
      label: feature.label,
      what: feature.what,
      on: featureOn(feature.key),
      stored: featureStored(feature.key),
    })),
    supervisor: {
      model: String(supervisor.model ?? ""),
      protocol: String(supervisor.protocol ?? "systemone"),
      endpoint: maskUrl(String(supervisor.endpoint ?? "")),
      timeoutMs: Number(supervisor.timeoutMs ?? 30000),
      maxRounds: Number(supervisor.maxRounds ?? 3),
      maxEvidence: Number(supervisor.maxEvidence ?? 6),
      trial: Boolean(supervisor.trial ?? true),
      askWaitMs: Number(supervisor.askWaitMs ?? 5000),
    },
    key: { present: key.present, from: key.from },
    spend: spend(),
    logMax: state.logMax,
    statePath: STATE_FILE,
  }
}

export function logRows(limit = 30) {
  const cap = Number.isFinite(limit) ? Math.max(1, Math.min(200, Math.floor(limit))) : 30
  return readLog(cap).map((row: any) => {
    const out: Record<string, unknown> = {}
    for (const field of LOG_FIELDS) {
      const value = row?.[field]
      if (value === undefined) continue
      out[field] = typeof value === "string" && value.length > 240 ? `${value.slice(0, 239)}…` : value
    }
    return out
  })
}

/** The blocked calls a human can still act on, oldest first. */
export function pendingApprovals() {
  const state = loadState()
  return readApprovals(state.approveTtl).map((approval) => ({
    token: approval.token,
    sessionID: approval.sessionID,
    action: approval.action,
    subject: approval.subject.length > 240 ? `${approval.subject.slice(0, 239)}…` : approval.subject,
    reason: approval.reason,
    ts: approval.ts,
  }))
}

/**
 * Handlers bound to `ctx.rpc.register`. Mutations are the same functions the
 * TUI uses, so the Desktop panel and the terminal cannot disagree on a switch.
 */
export function jevRpcHandlers() {
  return {
    status: async () => statusSnapshot(),
    log: async (input: any) => ({ rows: logRows(Number(input?.limit ?? 30)) }),
    approvals: async () => ({ approvals: pendingApprovals() }),
    approve: async (input: any) => {
      const token = String(input?.token ?? "")
      const sessionID = String(input?.sessionID ?? "")
      if (!token || !sessionID) return { ok: false }
      const pending = pendingApprovals().find((item) => item.token === token)
      if (!pending || pending.sessionID !== sessionID) return { ok: false }
      grant(token, sessionID)
      changed(`approved ${token}`)
      return { ok: true }
    },
    reject: async (input: any) => {
      const token = String(input?.token ?? "")
      if (!token) return { ok: false }
      const ok = rejectApproval(token)
      if (ok) changed(`rejected ${token}`)
      return { ok }
    },
    setEnabled: async (input: any) => {
      const on = input?.on === true
      setEnabled(on)
      changed(`enabled ${on ? "on" : "off"}`)
      return { ok: true }
    },
    setFeature: async (input: any) => {
      const key = String(input?.key ?? "")
      if (!FEATURES.some((feature) => feature.key === key)) return { ok: false }
      const on = input?.on === true
      setFeature(key, on)
      changed(`${key} ${on ? "on" : "off"}`)
      return { ok: true }
    },
  }
}
