/**
 * The one Jev client. One POST to /systemone, then validation.
 *
 * Jev is advisory. Nothing here executes, blocks, or mutates: it returns typed
 * answers plus an explicit confidence verdict, and the host decides. Every
 * failure path throws JevError so callers can fail open.
 *
 * Validation follows the rules in the wuyoscar/jev-skill reference client:
 * a choice must be a highest-probability candidate, probabilities must sum to
 * about one, and a score's legend must cover every level. Schema-valid output
 * is not a correct decision, so the checks that catch a malformed answer are
 * the ones worth paying for.
 */

import { loadState, logCall, resolveKey, type JevState } from "./state.ts"

export type JevKind = "noul" | "choice" | "score"

export interface JevQuestion {
  type: JevKind
  instructions: string
  /** choice: {label: meaning}. score: ordered level strings. noul: unused. */
  criteria?: Record<string, string> | string[]
}

export type JevStateBody = string | Record<string, unknown> | unknown[]

/** One normalized answer plus the confidence verdict the host thresholds on. */
export interface Decision {
  id: string
  kind: JevKind
  /** The answer: a label, a level index, or a boolean. */
  value: string | number | boolean
  /** Top probability for a choice, P(yes) for a noul. Undefined for a score. */
  probability?: number
  /** The provider's own confidence head. Undefined for a noul. */
  confidence?: number
  /** Gap between the winner and the runner-up. */
  margin?: number
  /** False when the answer is too weak or too close to act on. */
  confident: boolean
  /** Why it is not confident, for the agent to read. */
  note?: string
}

export interface JevResult {
  decisions: Decision[]
  model: string
  inputTokens: number
  elapsedMs: number
  /** The exact payload that was sent, after redaction. */
  sent: unknown
}

export class JevError extends Error {
  constructor(
    message: string,
    readonly kind: "no-key" | "http" | "timeout" | "network" | "shape" | "bad-answer" = "network",
  ) {
    super(message)
    this.name = "JevError"
  }
}

/** Options that name a fallback the agent should take instead of the answer. */
const REVIEW_LABELS = new Set([
  "other", "unknown", "none", "abstain", "review", "ask_user", "defer", "escalate", "insufficient_evidence",
])

/** Each pattern keeps whatever prefix identifies the secret, drops the value. */
const SECRET_PATTERNS: [RegExp, string][] = [
  [/-----BEGIN[A-Z ]*PRIVATE KEY-----[\s\S]*?-----END[A-Z ]*PRIVATE KEY-----/g, "[redacted:private-key]"],
  [/\b(?:sk|sk-or|sk-ant|ghp|gho|ghu|ghs|github_pat|xoxb|xoxp|xoxa|AKIA|ASIA|AIza)[-_A-Za-z0-9]{16,}\b/g, "[redacted:token]"],
  [/\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/g, "Bearer [redacted:token]"],
  [
    /((?:api[_-]?key|secret|passwd|password|token|credential|private[_-]?key)["']?\s*[:=]\s*)["']?[^\s"',;]{6,}/gi,
    "$1[redacted]",
  ],
]

/**
 * Strip credential-shaped text before anything leaves the machine. Deliberately
 * blunt: a false positive costs a redacted token in a prompt, a false negative
 * costs a leaked key.
 */
export function redact(value: unknown): unknown {
  if (typeof value === "string") {
    return SECRET_PATTERNS.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value)
  }
  if (Array.isArray(value)) return value.map(redact)
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v)]))
  }
  return value
}

function labelsOf(criteria: JevQuestion["criteria"]): string[] {
  if (Array.isArray(criteria)) return criteria.map((_, i) => String(i))
  return criteria ? Object.keys(criteria) : []
}

function isConfidentProbability(p: number, minProbability: number): boolean {
  return p >= minProbability
}

/** For a noul the answer is P(yes), so certainty is distance from a coin flip. */
function noulCertainty(p: number): number {
  return Math.max(p, 1 - p)
}

/** Build the request body. Exported so the tools and the log agree. */
export function buildPayload(state: JevState, stateBody: JevStateBody, questions: Record<string, JevQuestion>) {
  return { model: state.model, state: redact(stateBody), questions: redact(questions) as Record<string, JevQuestion> }
}

export function normalize(id: string, question: JevQuestion, answer: any, state: JevState): Decision {
  if (!answer || typeof answer !== "object") throw new JevError(`${id}: no answer object`, "bad-answer")
  if (answer.type !== question.type) {
    throw new JevError(`${id}: asked ${question.type}, got ${String(answer.type)}`, "bad-answer")
  }

  if (question.type === "noul") {
    const p = Number(answer.noul)
    if (!Number.isFinite(p) || p < 0 || p > 1) throw new JevError(`${id}: noul out of range`, "bad-answer")
    // A noul carries no separate confidence field: distance from a coin flip is
    // it. Measuring P(yes) against minProbability instead would call 0.97
    // confident but 0.03 not, which is backwards.
    const certainty = noulCertainty(p)
    const confident = certainty >= state.minProbability && p !== 0.5
    return {
      id,
      kind: "noul",
      value: p > 0.5,
      probability: p,
      confident,
      note: confident ? undefined : `P(yes)=${p} is too close to a coin flip to act on.`,
    }
  }

  const labels = labelsOf(question.criteria)
  if (question.type === "choice" && labels.length < 2) {
    throw new JevError(`${id}: a choice needs at least 2 labelled options`, "shape")
  }
  if (question.type === "score" && labels.length < 2) {
    throw new JevError(`${id}: a score needs at least 2 ordered levels`, "shape")
  }

  const probs = answer.probabilities
  if (!probs || typeof probs !== "object") throw new JevError(`${id}: no probabilities`, "bad-answer")
  const table = probs as Record<string, number>
  if (question.type === "choice") {
    const missing = labels.filter((l) => !(l in table))
    if (Object.keys(table).length !== labels.length || missing.length) {
      throw new JevError(`${id}: probabilities do not match the choice options`, "bad-answer")
    }
  } else if (Object.keys(table).length !== labels.length) {
    // A score's keys are level indices 0..n-1, so only the count is checkable.
    throw new JevError(`${id}: probabilities do not match the ${labels.length} score levels`, "bad-answer")
  }
  let total = 0
  for (const [k, v] of Object.entries(table)) {
    if (!Number.isFinite(v) || v < 0 || v > 1) throw new JevError(`${id}: probability for ${k} out of range`, "bad-answer")
    total += v
  }
  if (Math.abs(total - 1) > Math.min(0.05, 0.0051 * labels.length)) {
    throw new JevError(`${id}: probabilities sum to ${total.toFixed(3)}, not ~1`, "bad-answer")
  }

  const ranked = Object.entries(table).sort((a, b) => b[1] - a[1])
  const margin = Math.round(Math.max(0, ranked[0][1] - (ranked[1]?.[1] ?? 0)) * 1e4) / 1e4

  if (question.type === "score") {
    const legend = answer.legend
    if (!legend || typeof legend !== "object" || Object.keys(legend).length !== labels.length) {
      throw new JevError(`${id}: score legend must cover every level`, "bad-answer")
    }
    const score = Number(answer.score)
    if (!Number.isFinite(score) || score < 0 || score > labels.length - 1) {
      throw new JevError(`${id}: score ${String(answer.score)} outside 0..${labels.length - 1}`, "bad-answer")
    }
    return { id, kind: "score", value: score, margin, confident: margin >= state.minMargin }
  }

  const choice = answer.choice
  if (typeof choice !== "string" || !(choice in table)) {
    throw new JevError(`${id}: choice ${String(choice)} is not one of the options`, "bad-answer")
  }
  if (table[choice] !== ranked[0][1]) {
    throw new JevError(`${id}: choice is not the highest-probability option`, "bad-answer")
  }
  const top = table[choice]
  const confidence = Number.isFinite(Number(answer.confidence)) ? Number(answer.confidence) : undefined
  const reasons: string[] = []
  if (!isConfidentProbability(top, state.minProbability)) reasons.push(`top probability ${top.toFixed(2)} < ${state.minProbability}`)
  if (margin < state.minMargin) reasons.push(`margin ${margin.toFixed(2)} < ${state.minMargin}`)
  if (REVIEW_LABELS.has(choice)) reasons.push(`"${choice}" is a hand-back label`)
  return {
    id,
    kind: "choice",
    value: choice,
    probability: top,
    confidence,
    margin,
    confident: reasons.length === 0,
    note: reasons.length ? reasons.join("; ") : undefined,
  }
}

/**
 * One call, any number of questions over one shared state. Throws JevError on
 * every failure path; the caller fails open.
 *
 * `ask` is a module-level binding rather than a local const so a test can
 * replace it and exercise the callers' fail-open paths without a network.
 */
export async function ask(
  stateBody: JevStateBody,
  questions: Record<string, JevQuestion>,
  opts: { timeoutMs?: number; log?: boolean } = {},
): Promise<JevResult> {
  const state = loadState()
  const key = resolveKey()
  if (!key) {
    const names = state.keyEnv.split(",").map((s) => s.trim()).filter(Boolean)
    throw new JevError(
      `No Jev key found. Set $${names[0] ?? "JEV_API_KEY"}, or run /jev-key to write ${state.keyFile}.`,
      "no-key",
    )
  }

  const payload = buildPayload(state, stateBody, questions)
  const started = Date.now()
  const timeoutMs = opts.timeoutMs ?? 30_000

  let response: Response
  try {
    response = await fetch(state.endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")
    throw new JevError(
      timedOut ? `Jev timed out after ${timeoutMs}ms` : `Jev unreachable: ${error instanceof Error ? error.message : String(error)}`,
      timedOut ? "timeout" : "network",
    )
  }

  let text: string
  try {
    // Headers can arrive and the body then die. That rejects with a TypeError,
    // not a JevError, so it has to be caught here or the caller cannot tell a
    // Jev problem from its own bug.
    text = await response.text()
  } catch (error) {
    throw new JevError(`Jev response body failed: ${error instanceof Error ? error.message : String(error)}`, "network")
  }
  if (!response.ok) {
    // 401/403 usually means the key, the model id, or the account's plan for
    // that model. Name the setting that fixes it instead of guessing.
    const hint =
      response.status === 401 || response.status === 403
        ? ` (check the key, the model id "${state.model}", and whether the account may use it — /jev-model, /jev-key)`
        : response.status === 404
          ? ` (endpoint not found — check /jev-endpoint, it must be the provider's decisions path)`
          : ""
    throw new JevError(`Jev HTTP ${response.status}${hint}: ${text.slice(0, 300)}`, "http")
  }

  let body: any
  try {
    body = JSON.parse(text)
  } catch {
    throw new JevError("Jev returned non-JSON", "shape")
  }
  if (body?.error) throw new JevError(`Jev error: ${JSON.stringify(body.error).slice(0, 300)}`, "http")
  if (!body?.answers || typeof body.answers !== "object") throw new JevError("Jev returned no answers object", "shape")

  const decisions = Object.entries(questions).map(([id, q]) => normalize(id, q, body.answers[id], state))
  const elapsedMs = Date.now() - started
  const inputTokens = Number(body?.usage?.input_tokens ?? 0)

  if (opts.log !== false) {
    logCall({
      model: state.model,
      endpoint: state.endpoint,
      questions: Object.fromEntries(Object.entries(questions).map(([id, q]) => [id, q.type])),
      sent: payload,
      decisions,
      inputTokens,
      elapsedMs,
    })
  }

  return { decisions, model: state.model, inputTokens, elapsedMs, sent: payload }
}

/** Jev costs $0.04/M input tokens and nothing for output. */
export function estimateCost(inputTokens: number): string {
  return `$${((inputTokens / 1_000_000) * 0.04).toFixed(6)}`
}
