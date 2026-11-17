/**
 * The pure supervisor core: verdicts, strict decision validation, precedence
 * and budget arithmetic. No host, no model, no clock, no filesystem. A host
 * adapter supplies the model call and the current time; this module only
 * decides what a raw answer means and how far the budget has been spent.
 *
 * Defaults are fixed by the approved design: 30 s, 3 model rounds, 6 evidence
 * calls. Any unknown, uncertain, malformed or over-budget result becomes
 * ask_user, never allow. Abort and deny cannot be erased by a later allow.
 */

export const SUPERVISOR_VERDICTS = ["allow", "deny", "abort", "ask_user"] as const
export type SupervisorVerdict = (typeof SUPERVISOR_VERDICTS)[number]

export interface SupervisorDecision {
  verdict: SupervisorVerdict
  confidence: number
  reason: string
}

/** What the host writes to the audit log when the supervisor runs. */
export interface DecisionRecord {
  verdict: SupervisorVerdict
  confidence: number
  reason: string
  round: number
  evidenceCalls: number
  elapsedMs: number
}

export interface BudgetLimits {
  timeoutMs: number
  maxRounds: number
  maxEvidenceCalls: number
}

export interface BudgetState {
  elapsedMs: number
  rounds: number
  evidenceCalls: number
}

export const DEFAULT_BUDGET: BudgetLimits = {
  timeoutMs: 30_000,
  maxRounds: 3,
  maxEvidenceCalls: 6,
}

/** Answers below this are uncertainty, not permission. */
export const MIN_CONFIDENCE = 0.6

const VERDICT_STRENGTH: Record<SupervisorVerdict, number> = {
  allow: 0,
  ask_user: 1,
  deny: 2,
  abort: 3,
}

function normalizeVerdict(raw: unknown): SupervisorVerdict | undefined {
  if (typeof raw !== "string") return undefined
  const key = raw.trim().toLowerCase().replace(/[\s-]+/g, "_")
  return (SUPERVISOR_VERDICTS as readonly string[]).includes(key) ? (key as SupervisorVerdict) : undefined
}

function parseRaw(raw: unknown): Record<string, unknown> | undefined {
  let value = raw
  if (typeof value === "string") {
    let text = value.trim()
    const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(text)
    if (fenced) text = fenced[1].trim()
    try {
      value = JSON.parse(text)
    } catch {
      return undefined
    }
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

/** Always returns a usable decision; a bad answer can never produce allow. */
export function escalate(reason: string, confidence = 0): SupervisorDecision {
  return { verdict: "ask_user", confidence, reason }
}

/** The part of a context snapshot that decides whether history is usable. */
export interface HistoryStatus {
  complete: boolean
  incomplete?: string
  entries?: readonly unknown[]
}

/** Escalate before any model round when task history is absent or unusable. */
export function escalateIfIncomplete(snapshot: HistoryStatus | null | undefined): SupervisorDecision | null {
  if (!snapshot || !snapshot.complete) {
    const why = typeof snapshot?.incomplete === "string" ? snapshot.incomplete.trim() : ""
    return escalate(why || "task history unavailable")
  }
  if (snapshot.entries && snapshot.entries.length === 0) {
    return escalate("task history has no usable entries")
  }
  return null
}

export function validateDecision(raw: unknown): SupervisorDecision {
  const parsed = parseRaw(raw)
  if (!parsed) return escalate("malformed decision")

  const verdict = normalizeVerdict(parsed.verdict)
  if (!verdict) return escalate("unknown verdict")

  const confidence = parsed.confidence
  if (typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    return escalate("malformed confidence")
  }
  const suppliedReason = typeof parsed.reason === "string" ? parsed.reason.trim() : ""
  if (parsed.confident === false) return escalate(suppliedReason || "model reported low confidence", confidence)
  if (confidence < MIN_CONFIDENCE) return escalate(suppliedReason || "low confidence", confidence)
  if (!suppliedReason) return escalate("missing reason")

  return { verdict, confidence, reason: suppliedReason }
}

/** Abort outranks deny, deny outranks ask_user, ask_user outranks allow. */
export function stronger(a: SupervisorDecision, b: SupervisorDecision): SupervisorDecision {
  return VERDICT_STRENGTH[b.verdict] > VERDICT_STRENGTH[a.verdict] ? b : a
}

export function combineDecisions(...decisions: SupervisorDecision[]): SupervisorDecision {
  if (decisions.length === 0) return escalate("no supervisor decision")
  return decisions.reduce(stronger)
}

export function startRound(state: BudgetState): BudgetState {
  return { ...state, rounds: state.rounds + 1 }
}

export function useEvidence(state: BudgetState): BudgetState {
  return { ...state, evidenceCalls: state.evidenceCalls + 1 }
}

export function canRunRound(state: BudgetState, limits: BudgetLimits = DEFAULT_BUDGET): boolean {
  return state.rounds < limits.maxRounds && state.elapsedMs < limits.timeoutMs
}

export function canFetchEvidence(state: BudgetState, limits: BudgetLimits = DEFAULT_BUDGET): boolean {
  return state.evidenceCalls < limits.maxEvidenceCalls && state.elapsedMs < limits.timeoutMs
}

/** True as soon as any of the three limits is reached: stop and escalate. */
export function budgetExhausted(state: BudgetState, limits: BudgetLimits = DEFAULT_BUDGET): boolean {
  return (
    state.elapsedMs >= limits.timeoutMs ||
    state.rounds >= limits.maxRounds ||
    state.evidenceCalls >= limits.maxEvidenceCalls
  )
}

export function elapsedSince(startMs: number, nowMs: number): number {
  return Math.max(0, nowMs - startMs)
}

/** Move elapsed forward from a clock pair; a backwards clock cannot undo time. */
export function tickBudget(state: BudgetState, startMs: number, nowMs: number): BudgetState {
  return { ...state, elapsedMs: Math.max(state.elapsedMs, elapsedSince(startMs, nowMs)) }
}

export function remainingEvidence(state: BudgetState, limits: BudgetLimits = DEFAULT_BUDGET): number {
  return Math.max(0, limits.maxEvidenceCalls - state.evidenceCalls)
}

export function remainingTime(state: BudgetState, limits: BudgetLimits = DEFAULT_BUDGET): number {
  return Math.max(0, limits.timeoutMs - state.elapsedMs)
}

/** One guard per evidence step: refresh the clock, then recheck the call limit. */
export function evidenceStepAllowed(
  state: BudgetState,
  startMs: number,
  nowMs: number,
  limits: BudgetLimits = DEFAULT_BUDGET,
): boolean {
  return canFetchEvidence(tickBudget(state, startMs, nowMs), limits)
}

export function makeRecord(decision: SupervisorDecision, state: BudgetState): DecisionRecord {
  return {
    verdict: decision.verdict,
    confidence: decision.confidence,
    reason: decision.reason,
    round: state.rounds,
    evidenceCalls: state.evidenceCalls,
    elapsedMs: state.elapsedMs,
  }
}
