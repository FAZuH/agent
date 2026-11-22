/**
 * Server-side RPC handlers for the Jev Desktop panel. This module is imported
 * only by the server plugin, never by the GUI bundle: it reads the state and
 * log files from disk. Every value returned here is an allowlisted projection,
 * so a credential in a state field or a logged payload cannot cross RPC.
 */
import { grant, readApprovals, rejectApproval } from "../../../lib/jev/approve.ts"
import { readToolBans } from "../../../lib/jev/tool-ban.ts"
import { incompleteContainment, readAbortRecords } from "./abort.ts"
import type { ClearBanResult } from "./session-ban-host.ts"
import { applySecret, applySetting, settingsSnapshot, type SetSecretInput, type SetSettingInput } from "./jev-settings.ts"
import {
  FEATURES,
  STATE_FILE,
  featureOn,
  featureStored,
  keySource,
  loadState,
  maskUrl,
  onLog,
  readLog,
  setEnabled,
  setFeature,
  spend,
} from "../../../lib/jev/state.ts"

type Emit = (event: { reason: string }) => void
// The server loads a plugin once per location. Keep every registration's
// emitter: the panel may subscribe to one instance while a mutation lands on
// another, and only emitting to all of them refreshes that panel.
const emitters = new Set<Emit>()

/** The registration supplies its emitter once `ctx.rpc.register` resolves. */
export function setJevEmitter(fn: Emit | undefined): void {
  if (fn) emitters.add(fn)
}

export function changed(reason: string): void {
  for (const emit of emitters) {
    void Promise.resolve(emit({ reason })).catch(() => {})
  }
}

onLog(() => changed("log"))

/** Fields of a call row the panel may show. Never `sent`, `received`, or a URL. */
const LOG_FIELDS = [
  "ts",
  "sessionID",
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
  "rawVerdict",
  "decisionNote",
  // Abort operation rows: identity, scope size and the incomplete step names.
  "operationID",
  "scope",
  "incomplete",
  "shape",
  "source",
  "cause",
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
      askWaitMs: Number(supervisor.askWaitMs ?? 5000),
    },
    key: { present: key.present, from: key.from },
    spend: spend(),
    logMax: state.logMax,
    statePath: STATE_FILE,
  }
}

/**
 * Recent call rows, newest first. With a `sessionID`, only that session's
 * tagged rows are returned; untagged legacy rows belong to no session and are
 * excluded. Reading a wider tail keeps `cap` matches when one session is a
 * small share of the global log.
 */
export function logRows(limit = 30, sessionID?: string) {
  const cap = Number.isFinite(limit) ? Math.max(1, Math.min(200, Math.floor(limit))) : 30
  const rows = sessionID ? readLog(1000).filter((row: any) => row?.sessionID === sessionID).slice(0, cap) : readLog(cap)
  return rows.map((row: any) => {
    const out: Record<string, unknown> = {}
    for (const field of LOG_FIELDS) {
      const value = row?.[field]
      if (value === undefined) continue
      out[field] = typeof value === "string" && value.length > 240 ? `${value.slice(0, 239)}…` : value
    }
    return out
  })
}

/**
 * Every abort operation this machine recorded, with the containment it could not
 * complete. Read server-side: the projection is the record's own redacted fields,
 * never a prompt, argument or model reply.
 */
export function abortOperationRows() {
  const read = readAbortRecords()
  // A store that cannot be read is not an empty set: the caller must be able to
  // tell "no operations" from "the record file is broken".
  if (!read.ok) return { ok: false as const, reason: read.reason, operations: [] }
  return {
    ok: true as const,
    operations: read.records.map((record) => ({
      id: record.operation.id,
      sessionID: record.operation.sessionID,
      scope: record.operation.scope,
      source: record.operation.source,
      cause: record.operation.cause,
      at: record.operation.at,
      incomplete: incompleteContainment(record.containment).map((row) => ({ step: row.step, status: row.status, detail: row.detail })),
    })),
  }
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

export interface JevRpcDeps {
  /** Resolve a session title for the expanded call detail. Failures are ignored. */
  sessionTitle?: (sessionID: string) => Promise<string | undefined>
  /** Lift the tool ban on a session + subagents. */
  liftToolBan?: (sessionID: string) => Promise<number>
  /** Remove the legacy session ban left by a stop. A durable abort ban is refused. */
  clearSessionBan?: (sessionID: string) => ClearBanResult
  /** True when an abort or a durable ban covers the session right now. May await. */
  sessionBlocked?: (sessionID: string) => boolean | Promise<boolean>
  /**
   * The same question, answering synchronously. Called at the send boundary and
   * must not await: the continuation is dispatched in the same step.
   */
  sessionBlockedNow?: (sessionID: string) => boolean
  /** Start one new turn with the Continue text. */
  resumeSession?: (sessionID: string, text: string) => Promise<void>
  /**
   * The admission surfaces that consult a ban right now, in the order a call
   * meets them: `chain`, `session-ban`, `cards`, `tool-risk`. Empty means no
   * hook enforces a ban in this process. Read per request.
   */
  enforcedBy?: () => string[]
  /** Run one abort operation over a session and its owned descendants. */
  abortSession?: (sessionID: string) => Promise<{
    ok: boolean
    sealed: boolean
    durable: boolean
    receipt: boolean
    ban: { written: number; failed: number }
    operation: { id: string; scope: string[] }
    incomplete: Array<{ step: string; status: string; detail: string }>
  }>
}

const CONTINUE_TEXT = "Continue the interrupted task."
const BLOCKED_RESUME = "an abort covers this session; nothing was resumed"

/**
 * What one abort answer can vouch for. `known` is the operation's own report,
 * `none` is a request that never ran, and `unknown` is a throw after the
 * operation may have written identity or a ban: on that path the zero fields
 * below are placeholders, never a statement that nothing happened.
 */
export type AbortOutcomeShape = "known" | "none" | "unknown"

/**
 * Spoken when no admission surface is active. The record can be sealed and still
 * guard nothing, so the answer names the posture instead of leaving a consumer to
 * read `sealed` as live blocking.
 */
const NO_ENFORCEMENT = "no admission hook is active, so this ban is not enforced in this process"

/**
 * One abort request, answered from the operation's own report. Both `stopSession`
 * and `abortOperation` land here: a stop is the same durable operation as a
 * verdict's, so the panel cannot be told a clean stop after a failed discovery.
 *
 * `enforcedBy` is sampled after the operation resolves, never before: an abort can
 * take seconds, and a gate file or a hook can change inside it. Sampling first
 * would label the answer with a state the caller no longer has.
 */
async function runAbortOperation(sessionID: string, reason: string | undefined, deps: JevRpcDeps) {
  const posture = () => deps.enforcedBy?.() ?? []
  if (!sessionID || !deps.abortSession) return abortRefused(undefined, "none", posture())
  try {
    const outcome = await deps.abortSession(sessionID)
    const enforcedBy = posture()
    changed(reason ?? `abortOperation ${outcome.operation.id}`)
    return {
      ok: outcome.durable,
      sealed: outcome.sealed,
      durable: outcome.durable,
      receipt: outcome.receipt,
      ban: outcome.ban,
      operationID: outcome.operation.id,
      scope: outcome.operation.scope,
      incomplete: outcome.incomplete.map((row) => ({ step: row.step, status: row.status, detail: row.detail })),
      outcome: "known" as const,
      enforcedBy,
      ...(enforcedBy.length === 0 ? { warning: NO_ENFORCEMENT } : {}),
    }
  } catch {
    // Part of the abort may have happened before the throw: identity or a ban
    // can already be on disk, so the zero fields are placeholders and `outcome`
    // says the effects are unverifiable.
    return abortRefused("the abort failed; its identity and ban state cannot be verified", "unknown", posture())
  }
}

/**
 * A refusal a consumer can read. The zero fields are placeholders unless
 * `outcome` is `none`; `enforcedBy` is always the live posture, so an empty list
 * carries the warning even here.
 */
function abortRefused(error: string | undefined, outcome: AbortOutcomeShape, enforcedBy: string[]) {
  return {
    ok: false,
    sealed: false,
    durable: false,
    receipt: false,
    ban: { written: 0, failed: 0 },
    operationID: "",
    scope: [] as string[],
    incomplete: [] as Array<{ step: string; status: string; detail: string }>,
    outcome,
    enforcedBy,
    ...(outcome !== "none" && enforcedBy.length === 0 ? { warning: NO_ENFORCEMENT } : {}),
    ...(error ? { error } : {}),
  }
}

/**
 * Lift the tool ban and the legacy session ban. The session-ban state is read
 * and settled first, because the tool ban must not disappear while the RPC
 * claims nothing was lifted: a refused, unreadable or unknown state lifts
 * nothing at all. `unknown` is a host that is off or never attached, which is
 * not evidence of an absent ban either way.
 */
async function liftBothBans(sessionID: string, deps: JevRpcDeps): Promise<{ ok: boolean; count: number; error?: string }> {
  const ban = deps.clearSessionBan ? deps.clearSessionBan(sessionID) : "unknown"
  // The ban is durable and no release operation exists in this version: the
  // error states that, rather than pointing at an action a user cannot take.
  if (ban === "refused")
    return { ok: false, count: 0, error: "a durable abort ban is in place; it persists, and this version has no operation that releases it" }
  if (ban === "unreadable") return { ok: false, count: 0, error: "the session ban state cannot be read, so nothing was lifted" }
  if (ban === "unknown") return { ok: false, count: 0, error: "the session-ban host is not available, so nothing was lifted" }
  const count = deps.liftToolBan ? await deps.liftToolBan(sessionID) : 0
  return { ok: true, count }
}

/**
 * Handlers bound to `ctx.rpc.register`. Mutations are the same functions the
 * TUI uses, so the Desktop panel and the terminal cannot disagree on a switch.
 */
export function jevRpcHandlers(deps: JevRpcDeps = {}) {
  return {
    listToolBans: async () => ({ toolBans: readToolBans() }),
    status: async () => statusSnapshot(),
    stopSession: async (input: any) => await runAbortOperation(String(input?.sessionID ?? ""), "stop", deps),
    liftToolBan: async (input: any) => {
      const sessionID = String(input?.sessionID ?? "")
      const result = await liftBothBans(sessionID, deps)
      changed("liftToolBan")
      return result
    },
    liftToolBanAndResume: async (input: any) => {
      const sessionID = String(input?.sessionID ?? "")
      const result = await liftBothBans(sessionID, deps)
      // The lift awaits the tool-ban write, so an abort can land inside it and
      // cover this session. This first check may itself await a heavier read, so
      // it cannot be the last one.
      const blocked = result.ok && (await (deps.sessionBlocked?.(sessionID) ?? false))
      if (blocked) {
        changed("liftToolBanAndResume")
        return { ok: false, count: result.count, error: BLOCKED_RESUME }
      }
      if (!result.ok) {
        changed("liftToolBanAndResume")
        return result
      }
      // The send boundary: this check and the dispatch are one synchronous step.
      // `sessionBlockedNow` must answer without awaiting, so a queued microtask
      // that runs an abort's own mark cannot land between the answer and the
      // prompt. A covered session gets no continuation.
      if (deps.sessionBlockedNow?.(sessionID)) {
        changed("liftToolBanAndResume")
        return { ok: false, count: result.count, error: BLOCKED_RESUME }
      }
      await deps.resumeSession?.(sessionID, CONTINUE_TEXT)
      changed("liftToolBanAndResume")
      return result
    },
    log: async (input: any) => {
      const sessionID = typeof input?.sessionID === "string" && input.sessionID ? input.sessionID : undefined
      const rows = logRows(Number(input?.limit ?? 30), sessionID)
      if (deps.sessionTitle) {
        const ids = Array.from(
          new Set(rows.map((r: any) => r.sessionID).filter((id: any): id is string => typeof id === "string" && !!id)),
        )
        const titles = new Map<string, string>()
        await Promise.all(
          ids.map(async (id) => {
            try {
              const title = await deps.sessionTitle!(id)
              if (typeof title === "string" && title.trim()) titles.set(id, title)
            } catch {}
          }),
        )
        for (const row of rows) {
          if (typeof (row as any).sessionID === "string" && titles.has((row as any).sessionID)) {
            ;(row as any).sessionTitle = titles.get((row as any).sessionID)
          }
        }
      }
      return { rows }
    },
    approvals: async () => ({ approvals: pendingApprovals() }),
    abortOperations: async () => abortOperationRows(),
    abortOperation: async (input: any) => await runAbortOperation(String(input?.sessionID ?? ""), undefined, deps),
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
    approveAll: async () => {
      const pending = pendingApprovals().slice(0, 200)
      let count = 0
      for (const item of pending) {
        if (!item.token || !item.sessionID) continue
        grant(item.token, item.sessionID)
        count++
      }
      changed("approveAll")
      return { ok: true, count }
    },
    rejectAll: async () => {
      const pending = pendingApprovals().slice(0, 200)
      let count = 0
      for (const item of pending) {
        if (!item.token) continue
        if (rejectApproval(item.token)) count++
      }
      changed("rejectAll")
      return { ok: true, count }
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
    getSettings: async () => settingsSnapshot(),
    setSetting: async (input: any) => {
      const result = applySetting(input as SetSettingInput)
      if (result.ok) changed("settings")
      return result
    },
    setSecret: async (input: any) => {
      const result = applySecret(input as SetSecretInput)
      if (result.ok) changed("settings")
      return result
    },
  }
}
