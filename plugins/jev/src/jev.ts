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

import { FEATURE_DEFAULTS, loadState, logCall, resolveKey, type JevState } from "./state.ts"

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
  /**
   * The full ranked distribution, choice only. Lets callers name runners-up
   * instead of throwing the whole distribution away after the winner.
   */
  distribution?: Record<string, number>
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

/** Confidence thresholds, per call: each feature carries its own numbers. */
export interface Thresholds {
  minProbability: number
  minMargin: number
}

/** For a noul the answer is P(yes), so certainty is distance from a coin flip. */
function noulCertainty(p: number): number {
  return Math.max(p, 1 - p)
}

/** Build the request body. Exported so the tools and the log agree. */
export function buildPayload(state: JevState, stateBody: JevStateBody, questions: Record<string, JevQuestion>) {
  return { model: state.model, state: redact(stateBody), questions: redact(questions) as Record<string, JevQuestion> }
}

/**
 * The chat transport's prompt. It has to ask for exactly the same answer shape
 * System One returns, because everything downstream - the validation, the
 * confidence maths, the thresholds - is written against that shape.
 *
 * Criteria are load-bearing here, not decoration. A small model answers the
 * surface topic rather than the question's polarity unless the criteria name
 * what true and false mean, so every question's criteria go into the prompt.
 */
export function chatPrompt(stateBody: JevStateBody, questions: Record<string, JevQuestion>): string {
  const lines: string[] = [
    "You are a decision model. Answer only with JSON, one answer per id, and nothing else.",
    "",
    'Return exactly: {"answers":{ "<id>": <answer object> }}',
    "Each id below states the exact answer object it must return. Use it verbatim:",
    "",
  ]
  for (const [id, q] of Object.entries(questions)) {
    lines.push(`- ${id}: ${JSON.stringify(q.instructions)}`)
    // The shape goes next to the question, not in the preamble. A small model
    // copies the shape it sees nearest the question, and one that only reads
    // the preamble echoes the id into the type field.
    // A small model copies the placeholder instead of filling it, so a choice
    // and a score name their actual labels. A template of <label> comes back
    // verbatim; a list of real ones comes back filled in.
    if (q.type === "noul") lines.push('  answer: {"type":"noul","noul":<probability that yes is true, 0 to 1>}')
    else if (q.type === "choice") {
      const labels = labelsOf(q.criteria)
      lines.push(`  answer: {"type":"choice","choice":"<one of: ${labels.join(", ")}>","probabilities":{${labels.map((l) => `"${l}":<0..1>`).join(",")}}}`)
      lines.push("  The probabilities cover every label and sum to 1. The choice is the highest one.")
    } else {
      const levels = labelsOf(q.criteria)
      lines.push(`  answer: {"type":"score","score":<one of: ${levels.map((_, i) => i).join(", ")}>,"probabilities":{${levels.map((_, i) => `"${i}":<0..1>`).join(",")}}}`)
      lines.push("  The probabilities cover every level and sum to 1.")
    }
    const crit = q.criteria
    if (Array.isArray(crit)) crit.forEach((level, i) => lines.push(`  level ${i} = ${JSON.stringify(level)}`))
    else if (crit) {
      if (crit.true) lines.push(`  true = ${JSON.stringify(crit.true)}`)
      if (crit.false) lines.push(`  false = ${JSON.stringify(crit.false)}`)
    }
  }
  lines.push("", `state: ${JSON.stringify(redact(stateBody))}`)
  return lines.join("\n")
}

/** Strip a markdown fence, which some chat models wrap their JSON in. */
function unfence(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  return (fenced ? fenced[1] : text).trim()
}

/**
 * Map a reply's answers onto the questions that were asked.
 *
 * A small model often invents its own keys — asked for `verdict` it answers
 * `1`. When the keys line up, use them. When they do not but the count does,
 * map by position, because the prompt lists the questions in order and the
 * model answers them in that order. Otherwise fail: guessing which answer
 * belongs to which question would put a confident-looking value on the wrong
 * question, which is worse than no answer.
 */
function rekey(reply: Record<string, any>, questions: Record<string, JevQuestion>): Record<string, any> {
  const asked = Object.keys(questions)
  const got = Object.keys(reply)
  if (asked.every((id) => id in reply)) return reply
  if (asked.length === got.length) {
    return Object.fromEntries(asked.map((id, i) => [id, reply[got[i]]]))
  }
  throw new JevError(
    `Jev answered ${got.length} of ${asked.length} questions, keyed ${got.map((k) => JSON.stringify(k)).join(", ")}`,
    "bad-answer",
  )
}

/** Post one chat request and return the model's reply content. */
async function postChat(state: JevState, prompt: string, timeoutMs: number): Promise<string> {
  let response: Response
  try {
    // No Authorization header: a chat endpoint needs none, and a key that
    // happens to be configured is left out rather than sent to a host that did
    // not ask for one.
    response = await fetch(state.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: state.model,
        stream: false,
        think: state.think,
        options: { temperature: 0 },
        messages: [{ role: "user", content: prompt }],
      }),
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
    const hint = response.status === 404 ? ` (no model "${state.model}" at this endpoint - check /jev-model and /jev-endpoint)` : ""
    throw new JevError(`Jev HTTP ${response.status}${hint}: ${text.slice(0, 300)}`, "http")
  }

  let body: any
  try {
    body = JSON.parse(text)
  } catch {
    throw new JevError("Jev returned non-JSON", "shape")
  }
  const content = body?.message?.content
  if (typeof content !== "string" || !content.trim()) throw new JevError("Jev chat reply had no message content", "shape")
  return content
}

export function normalize(id: string, question: JevQuestion, answer: any, thresholds: Thresholds): Decision {
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
    const confident = certainty >= thresholds.minProbability && p !== 0.5
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
    return { id, kind: "score", value: score, margin, confident: margin >= thresholds.minMargin }
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
  if (top < thresholds.minProbability) reasons.push(`top probability ${top.toFixed(2)} < ${thresholds.minProbability}`)
  if (margin < thresholds.minMargin) reasons.push(`margin ${margin.toFixed(2)} < ${thresholds.minMargin}`)
  if (REVIEW_LABELS.has(choice)) reasons.push(`"${choice}" is a hand-back label`)
  return {
    id,
    kind: "choice",
    value: choice,
    probability: top,
    confidence,
    margin,
    distribution: Object.fromEntries(ranked),
    confident: reasons.length === 0,
    note: reasons.length ? reasons.join("; ") : undefined,
  }
}

/**
 * The key is required on the systemone transport and optional on chat, which
 * needs no auth at all. Split out so the protocol branch reads as intent
 * rather than as a missing check.
 */
function require_key(): string {
  const key = resolveKey()
  if (key) return key
  const state = loadState()
  const names = state.keyEnv.split(",").map((s) => s.trim()).filter(Boolean)
  throw new JevError(
    `No Jev key found. Set $${names[0] ?? "JEV_API_KEY"}, or run /jev-key to write ${state.keyFile}.`,
    "no-key",
  )
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
  opts: { timeoutMs?: number; log?: boolean; thresholds?: Thresholds } = {},
): Promise<JevResult> {
  const state = loadState()
  const thresholds: Thresholds = opts.thresholds ?? {
    minProbability: FEATURE_DEFAULTS.hook_skill_pick.minProbability,
    minMargin: FEATURE_DEFAULTS.hook_skill_pick.minMargin,
  }
  // Unconfigured is a state, not a bug: say which setting is missing rather
  // than posting an empty URL or letting the model see a bare TypeError.
  if (!state.endpoint || !state.model) {
    const missing = [!state.endpoint && "endpoint", !state.model && "model"].filter(Boolean).join(" and ")
    throw new JevError(
      `Jev is not configured: no ${missing}. Set ${!state.endpoint ? "/jev-endpoint" : "/jev-model"} in /jev-settings.`,
      "no-key",
    )
  }
  // The chat transport needs no key, so the check is protocol-conditional.
  const key = state.protocol === "chat" ? resolveKey() : require_key()
  const payload = buildPayload(state, stateBody, questions)
  const started = Date.now()
  // A local model spends 8-13s a call where a hosted one spends 1-2s, and the
  // cost grows with the question count, so the default scales rather than
  // assuming the fast provider.
  const timeoutMs = opts.timeoutMs ?? Math.max(30_000, Object.keys(questions).length * 15_000)

  let answers: any
  let inputTokens = 0
  let sent: unknown = payload

  if (state.protocol === "chat") {
    // Same questions, a different wire. The prompt carries the redacted state,
    // so what leaves the machine is what the log records.
    const prompt = chatPrompt(stateBody, questions)
    sent = { protocol: "chat", model: state.model, think: state.think, prompt }
    const content = await postChat(state, prompt, timeoutMs)
    let parsed: any
    try {
      parsed = JSON.parse(unfence(content))
    } catch {
      throw new JevError(`Jev chat reply was not JSON: ${unfence(content).slice(0, 200)}`, "shape")
    }
    if (!parsed?.answers || typeof parsed.answers !== "object") throw new JevError("Jev chat reply had no answers object", "shape")
    answers = rekey(parsed.answers, questions)
    // A score's legend is the question's own criteria restated, so a chat model
    // that omits it loses nothing. Synthesizing it here keeps the validation
    // that catches a mangled legend on the systemone transport, where the
    // provider returns one and it is not redundant.
    for (const [id, q] of Object.entries(questions)) {
      const a = answers[id]
      if (q.type === "score" && a && !a.legend && Array.isArray(q.criteria)) {
        a.legend = q.criteria
      }
    }
    inputTokens = Number(parsed?.prompt_eval_count ?? 0)
  } else {
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
    // Some providers (or gateways in front of them) nest the System One
    // payload one level deeper: { result: { answers }, success }. Accept
    // both, refusing anything that has neither.
    ;({ answers, inputTokens } = answersOf(body))
  }

  const elapsedMs = Date.now() - started
  let decisions: Decision[]
  try {
    decisions = Object.entries(questions).map(([id, q]) => normalize(id, q, answers[id], thresholds))
  } catch (error) {
    // Logged, not swallowed: the raw reply is the only way to see what the
    // model actually returned, and a validation failure is a finding about the
    // prompt rather than a bug in this plugin.
    logCall({
      protocol: state.protocol,
      model: state.model,
      endpoint: state.endpoint,
      questions: Object.fromEntries(Object.entries(questions).map(([id, q]) => [id, q.type])),
      sent,
      received: typeof answers === "object" ? answers : String(answers).slice(0, 400),
      error: error instanceof JevError ? error.message : String(error),
      inputTokens,
      elapsedMs,
    })
    throw error
  }

  if (opts.log !== false) {
    logCall({
      protocol: state.protocol,
      model: state.model,
      endpoint: state.endpoint,
      questions: Object.fromEntries(Object.entries(questions).map(([id, q]) => [id, q.type])),
      sent,
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

/**
 * Find the answers object in a System One reply. Native providers return it
 * at top level; some endpoints (or gateways in front of them) nest the whole
 * payload one level deeper under `result`. Exported so the unwrap is tested,
 * because the wrong unwrap reads as "the model is broken" when the model is
 * fine and the envelope is the problem.
 */
export function answersOf(body: any): { answers: Record<string, any>; inputTokens: number } {
  const envelope = body?.answers && typeof body.answers === "object" ? body : body?.result
  if (!envelope?.answers || typeof envelope.answers !== "object") throw new JevError("Jev returned no answers object", "shape")
  return { answers: envelope.answers, inputTokens: Number(envelope?.usage?.input_tokens ?? body?.usage?.input_tokens ?? 0) }
}
