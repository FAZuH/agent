/**
 * Self-check for the pure supervisor core: verdict validation, precedence,
 * budget arithmetic and the audit record. No host, no model, no clock.
 *
 *   bun test plugins/watchdog/src/supervisor.test.ts
 */

import { describe, expect, test } from "bun:test"
import {
  DEFAULT_BUDGET,
  MIN_CONFIDENCE,
  SUPERVISOR_VERDICTS,
  budgetExhausted,
  canFetchEvidence,
  canRunRound,
  combineDecisions,
  elapsedSince,
  escalate,
  escalateIfIncomplete,
  evidenceStepAllowed,
  makeRecord,
  remainingEvidence,
  remainingTime,
  startRound,
  stronger,
  tickBudget,
  useEvidence,
  validateDecision,
  type BudgetState,
  type SupervisorDecision,
} from "./supervisor.ts"

const fresh = (): BudgetState => ({ elapsedMs: 0, rounds: 0, evidenceCalls: 0 })
const decision = (
  verdict: SupervisorDecision["verdict"],
  confidence = 0.9,
  reason = "checked evidence",
): SupervisorDecision => ({ verdict, confidence, reason })

describe("approved constants", () => {
  test("default budget is 30 s, 3 rounds and 6 evidence calls", () => {
    expect(DEFAULT_BUDGET).toEqual({ timeoutMs: 30_000, maxRounds: 3, maxEvidenceCalls: 6 })
  })

  test("verdict vocabulary is exactly the four approved values", () => {
    expect([...SUPERVISOR_VERDICTS]).toEqual(["allow", "deny", "abort", "propagate"])
  })

  test("confidence threshold rejects weak answers", () => {
    expect(MIN_CONFIDENCE).toBe(0.6)
  })
})

describe("validateDecision accepts well-formed decisions", () => {
  const valid = [
    ["allow", { verdict: "allow", confidence: 0.92, reason: "change matches the request" }],
    ["deny", { verdict: "deny", confidence: 0.81, reason: "writes outside the task" }],
    ["abort", { verdict: "abort", confidence: 0.75, reason: "runaway loop" }],
    ["propagate", { verdict: "propagate", confidence: 0.6, reason: "needs a human" }],
  ] as const

  for (const [verdict, raw] of valid) {
    test(`accepts a well-formed ${verdict} decision`, () => {
      expect(validateDecision(raw).verdict).toBe(verdict)
    })
  }

  test("parses a JSON decision string wrapped in a code fence", () => {
    const raw = '```json\n{"verdict":"deny","confidence":0.95,"reason":"policy"}\n```'
    expect(validateDecision(raw).verdict).toBe("deny")
  })

  test("parses a bare JSON decision string", () => {
    const raw = '{"verdict":"abort","confidence":0.88,"reason":"loop"}'
    expect(validateDecision(raw).verdict).toBe("abort")
  })

  test("normalizes case, whitespace and separators in the verdict", () => {
    expect(validateDecision({ verdict: " PROPAGATE ", confidence: 0.9, reason: "x" }).verdict).toBe("propagate")
  })

  test("preserves the reason of an accepted decision", () => {
    expect(validateDecision({ verdict: "deny", confidence: 0.9, reason: "policy violation" }).reason).toBe(
      "policy violation",
    )
  })
})

describe("validateDecision falls back to propagate", () => {
  const bad = [
    ["null", null],
    ["a number", 7],
    ["an array", []],
    ["a non-JSON string", "deny it"],
    ["an object with no verdict", { confidence: 0.9, reason: "x" }],
    ["a non-string verdict", { verdict: 1, confidence: 0.9, reason: "x" }],
    ["an unknown verdict", { verdict: "maybe", confidence: 0.9, reason: "x" }],
    ["a missing confidence", { verdict: "allow", reason: "x" }],
    ["a non-number confidence", { verdict: "allow", confidence: "high", reason: "x" }],
    ["an out-of-range confidence", { verdict: "allow", confidence: 2, reason: "x" }],
    ["a negative confidence", { verdict: "allow", confidence: -0.1, reason: "x" }],
    ["a low confidence", { verdict: "allow", confidence: MIN_CONFIDENCE - 0.01, reason: "x" }],
    ["an explicit not-confident flag", { verdict: "allow", confidence: 0.9, confident: false, reason: "x" }],
    ["a missing reason", { verdict: "allow", confidence: 0.9 }],
    ["an empty reason", { verdict: "allow", confidence: 0.9, reason: "  " }],
    ["malformed JSON", "{verdict:allow"],
  ] as const

  for (const [label, raw] of bad) {
    test(`escalates when given ${label}`, () => {
      expect(validateDecision(raw).verdict).toBe("propagate")
    })
  }

  test("names an unknown verdict in the fallback reason", () => {
    expect(validateDecision({ verdict: "maybe", confidence: 0.9, reason: "x" }).reason).toContain("verdict")
  })

  test("names low confidence when no explanation was supplied", () => {
    expect(validateDecision({ verdict: "allow", confidence: 0.2 }).reason).toContain("confidence")
  })

  test("names a missing reason in the fallback reason", () => {
    expect(validateDecision({ verdict: "allow", confidence: 0.9 }).reason).toContain("reason")
  })

  test("keeps a real explanation on a low-confidence propagate decision", () => {
    const explanation = "The edit path is outside the requested module and no matching task history was found."
    const result = validateDecision({
      verdict: "propagate",
      confidence: 0.42,
      confident: false,
      reason: explanation,
    })
    expect(result.verdict).toBe("propagate")
    expect(result.reason).toBe(explanation)
    expect(result.confidence).toBe(0.42)
  })

  test("keeps a real explanation when the model flags itself unconfident", () => {
    const explanation = "Competing interpretations of the request; a human must choose."
    const result = validateDecision({ verdict: "deny", confidence: 0.9, confident: false, reason: explanation })
    expect(result.verdict).toBe("propagate")
    expect(result.reason).toBe(explanation)
  })

  test("falls back to a synthetic reason when an unconfident answer has none", () => {
    const result = validateDecision({ verdict: "deny", confidence: 0.9, confident: false })
    expect(result.reason).toContain("confidence")
  })
})

describe("verdict precedence", () => {
  const cases = [
    ["deny outranks allow", "deny", "allow", "deny"],
    ["allow cannot erase deny", "allow", "deny", "deny"],
    ["abort outranks deny", "abort", "deny", "abort"],
    ["deny cannot erase abort", "deny", "abort", "abort"],
    ["abort outranks allow", "allow", "abort", "abort"],
    ["propagate outranks allow", "allow", "propagate", "propagate"],
    ["abort outranks propagate", "propagate", "abort", "abort"],
  ] as const

  for (const [label, left, right, expected] of cases) {
    test(`${label}`, () => {
      expect(stronger(decision(left), decision(right)).verdict).toBe(expected)
    })
  }

  test("combineDecisions keeps the strongest verdict across rounds", () => {
    const rounds = [decision("allow"), decision("deny"), decision("allow")]
    expect(combineDecisions(...rounds).verdict).toBe("deny")
  })

  test("combineDecisions never revives an abort", () => {
    const rounds = [decision("abort"), decision("allow"), decision("allow")]
    expect(combineDecisions(...rounds).verdict).toBe("abort")
  })

  test("combineDecisions with no rounds escalates", () => {
    expect(combineDecisions().verdict).toBe("propagate")
  })
})

describe("budget arithmetic", () => {
  test("a fresh budget allows work", () => {
    const state = fresh()
    expect(canRunRound(state)).toBe(true)
    expect(canFetchEvidence(state)).toBe(true)
    expect(budgetExhausted(state)).toBe(false)
  })

  test("startRound increments the round counter", () => {
    expect(startRound(fresh()).rounds).toBe(1)
  })

  test("useEvidence increments the evidence counter", () => {
    expect(useEvidence(fresh()).evidenceCalls).toBe(1)
  })

  test("the round guard stops at the third round", () => {
    const state: BudgetState = { elapsedMs: 0, rounds: 3, evidenceCalls: 0 }
    expect(canRunRound(state)).toBe(false)
    expect(budgetExhausted(state)).toBe(true)
  })

  test("the evidence guard stops at the sixth call", () => {
    const state: BudgetState = { elapsedMs: 0, rounds: 0, evidenceCalls: 6 }
    expect(canFetchEvidence(state)).toBe(false)
    expect(budgetExhausted(state)).toBe(true)
  })

  test("the deadline stops both guards", () => {
    const state: BudgetState = { elapsedMs: DEFAULT_BUDGET.timeoutMs, rounds: 0, evidenceCalls: 0 }
    expect(canRunRound(state)).toBe(false)
    expect(canFetchEvidence(state)).toBe(false)
    expect(budgetExhausted(state)).toBe(true)
  })

  test("a clock at the limit is exhausted but just under is not", () => {
    const under: BudgetState = { elapsedMs: DEFAULT_BUDGET.timeoutMs - 1, rounds: 0, evidenceCalls: 0 }
    expect(budgetExhausted(under)).toBe(false)
  })

  test("custom limits replace the defaults", () => {
    const limits = { timeoutMs: 10_000, maxRounds: 1, maxEvidenceCalls: 2 }
    expect(canRunRound({ elapsedMs: 0, rounds: 1, evidenceCalls: 0 }, limits)).toBe(false)
    expect(canFetchEvidence({ elapsedMs: 0, rounds: 0, evidenceCalls: 2 }, limits)).toBe(false)
  })

  test("elapsedSince clamps a backwards clock to zero", () => {
    expect(elapsedSince(100, 90)).toBe(0)
  })

  test("elapsedSince reports the forward gap", () => {
    expect(elapsedSince(100, 190)).toBe(90)
  })

  test("escalate always returns propagate with its reason", () => {
    const result = escalate("budget exhausted")
    expect(result.verdict).toBe("propagate")
    expect(result.reason).toBe("budget exhausted")
  })
})

describe("audit record", () => {
  test("makeRecord carries the decision and the budget state", () => {
    const state: BudgetState = { elapsedMs: 1234, rounds: 2, evidenceCalls: 4 }
    expect(makeRecord(decision("deny", 0.8, "policy"), state)).toEqual({
      verdict: "deny",
      confidence: 0.8,
      reason: "policy",
      round: 2,
      evidenceCalls: 4,
      elapsedMs: 1234,
    })
  })

  test("a fallback decision is recordable", () => {
    const state = fresh()
    const record = makeRecord(validateDecision({ verdict: "unknown", confidence: 0.9, reason: "x" }), state)
    expect(record.verdict).toBe("propagate")
    expect(record.round).toBe(0)
  })
})

describe("escalateIfIncomplete", () => {
  test("returns null when history is complete and has entries", () => {
    const snapshot = { complete: true, entries: [{ role: "user", text: "review the hook" }] }
    expect(escalateIfIncomplete(snapshot)).toBeNull()
  })

  test("escalates when the snapshot is missing", () => {
    expect(escalateIfIncomplete(undefined)?.verdict).toBe("propagate")
  })

  test("carries the supplied reason for an incomplete snapshot", () => {
    const snapshot = { complete: false, incomplete: "context read failed", entries: [] }
    expect(escalateIfIncomplete(snapshot)?.reason).toBe("context read failed")
  })

  test("uses a default reason when an incomplete snapshot gives none", () => {
    expect(escalateIfIncomplete({ complete: false })?.reason).toBe("task history unavailable")
  })

  test("escalates when a complete snapshot has no usable entries", () => {
    expect(escalateIfIncomplete({ complete: true, entries: [] })?.reason).toBe("task history has no usable entries")
  })
})

describe("evidence-step budget guards", () => {
  test("tickBudget advances elapsed from the clock", () => {
    expect(tickBudget(fresh(), 1000, 1250).elapsedMs).toBe(250)
  })

  test("tickBudget never moves elapsed backwards", () => {
    const state: BudgetState = { elapsedMs: 500, rounds: 0, evidenceCalls: 0 }
    expect(tickBudget(state, 1000, 1100).elapsedMs).toBe(500)
  })

  test("remainingEvidence counts calls left under the default limit", () => {
    expect(remainingEvidence(fresh())).toBe(6)
  })

  test("remainingEvidence never goes negative", () => {
    expect(remainingEvidence({ elapsedMs: 0, rounds: 0, evidenceCalls: 8 })).toBe(0)
  })

  test("remainingTime counts milliseconds left under the deadline", () => {
    expect(remainingTime(fresh())).toBe(30_000)
  })

  test("remainingTime never goes negative", () => {
    expect(remainingTime({ elapsedMs: 40_000, rounds: 0, evidenceCalls: 0 })).toBe(0)
  })

  test("evidenceStepAllowed refuses a step after the deadline even with calls left", () => {
    expect(evidenceStepAllowed(fresh(), 0, DEFAULT_BUDGET.timeoutMs)).toBe(false)
  })

  test("evidenceStepAllowed refuses a step when calls are exhausted", () => {
    const state: BudgetState = { elapsedMs: 0, rounds: 0, evidenceCalls: 6 }
    expect(evidenceStepAllowed(state, 0, 0)).toBe(false)
  })

  test("evidenceStepAllowed permits a step inside both limits", () => {
    expect(evidenceStepAllowed(fresh(), 0, 100)).toBe(true)
  })

  test("evidenceStepAllowed sees time spent in earlier evidence steps", () => {
    const afterThree: BudgetState = { elapsedMs: 0, rounds: 0, evidenceCalls: 3 }
    expect(evidenceStepAllowed(afterThree, 0, 29_000)).toBe(true)
    expect(evidenceStepAllowed(afterThree, 0, 31_000)).toBe(false)
  })
})
