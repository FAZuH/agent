/**
 * Self-check for the loop rules. No host and no network: the point is that
 * argument parsing, promise matching, and the idle decision hold up on their
 * own, because those three decide whether a loop finishes or runs away.
 *
 *   bun test src/loop.test.ts
 */

import { describe, expect, test } from "bun:test"

import { DEFAULT_COMPLETION_PROMISE, MAX_EMPTY_STREAK, decide, iterationPrompt, matches, parseArgs, promiseIn, status, tokenize, type LoopState } from "./loop.ts"

const state = (over: Partial<LoopState> = {}): LoopState => ({
  sessionID: "ses_test",
  prompt: "Build a todo API",
  iteration: 1,
  maxIterations: 0,
  completionPromise: DEFAULT_COMPLETION_PROMISE,
  abortPromise: null,
  emptyStreak: 0,
  startedAt: 1_700_000_000_000,
  ...over,
})

describe("tokenize", () => {
  test("keeps a quoted span as one token", () => {
    expect(tokenize(`"Task complete" --completion-promise "TASK COMPLETE"`)).toEqual(["Task complete", "--completion-promise", "TASK COMPLETE"])
  })

  test("single quotes work too", () => {
    expect(tokenize("'a b' c")).toEqual(["a b", "c"])
  })
})

describe("parseArgs", () => {
  test("unquoted words are the task, defaults otherwise", () => {
    const parsed = parseArgs("Build a todo API")
    expect(parsed).toEqual({ ok: true, options: { prompt: "Build a todo API", maxIterations: 0, completionPromise: "COMPLETE", abortPromise: null } })
  })

  test("takes every flag", () => {
    const parsed = parseArgs('Fix the parser --max-iterations 20 --completion-promise "TASK DONE" --abort-promise BLOCKED')
    expect(parsed).toEqual({
      ok: true,
      options: { prompt: "Fix the parser", maxIterations: 20, completionPromise: "TASK DONE", abortPromise: "BLOCKED" },
    })
  })

  test("rejects a non-numeric cap", () => {
    expect(parseArgs("task --max-iterations ten")).toEqual({ ok: false, error: expect.stringContaining("whole number") })
  })

  test("rejects a flag with no value", () => {
    expect(parseArgs("task --completion-promise")).toEqual({ ok: false, error: expect.stringContaining("needs a value") })
  })

  test("rejects flags with no task", () => {
    expect(parseArgs("--max-iterations 5").ok).toBe(false)
  })

  test("help returns the usage line", () => {
    expect(parseArgs("--help")).toEqual({ ok: false, error: expect.stringContaining("/ralph-loop") })
  })
})

describe("promise detection", () => {
  test("takes the first tag and collapses whitespace", () => {
    expect(promiseIn("done\n<promise>\n  TASK   DONE\n</promise>\n<promise>SECOND</promise>")).toBe("TASK DONE")
  })

  test("no tag means no promise", () => {
    expect(promiseIn("still working")).toBeNull()
  })

  test("matches across case and whitespace", () => {
    expect(matches("all set <promise>task done</promise>", "TASK   DONE")).toBe(true)
  })

  test("compares literally, so a glob in the promise is text", () => {
    expect(matches("<promise>DONEX</promise>", "DONE*")).toBe(false)
    expect(matches("<promise>DONE*</promise>", "DONE*")).toBe(true)
  })
})

describe("decide", () => {
  test("the promise completes the loop even on the last allowed iteration", () => {
    expect(decide(state({ iteration: 3, maxIterations: 3 }), "<promise>COMPLETE</promise>")).toEqual({ kind: "complete" })
  })

  test("the abort promise stops before completion is checked", () => {
    expect(decide(state({ abortPromise: "BLOCKED" }), "impossible <promise>BLOCKED</promise>")).toEqual({ kind: "abort" })
  })

  test("the cap stops the loop when the work is not done", () => {
    expect(decide(state({ iteration: 3, maxIterations: 3 }), "still working")).toEqual({ kind: "max" })
  })

  test("continues and counts the iteration", () => {
    const decision = decide(state(), "made progress")
    expect(decision.kind).toBe("continue")
    expect(decision.kind === "continue" && decision.next.iteration).toBe(2)
    expect(decision.kind === "continue" && decision.next.emptyStreak).toBe(0)
  })

  test("a turn with no text keeps the streak and stops at the cap", () => {
    const first = decide(state(), "")
    expect(first.kind === "continue" && first.next.emptyStreak).toBe(1)
    const capped = decide(state({ emptyStreak: MAX_EMPTY_STREAK - 1 }), "")
    expect(capped).toEqual({ kind: "silent" })
  })

  test("any text clears the streak", () => {
    const decision = decide(state({ emptyStreak: MAX_EMPTY_STREAK - 1 }), "one word")
    expect(decision.kind === "continue" && decision.next.emptyStreak).toBe(0)
  })
})

describe("iterationPrompt", () => {
  test("leads with the task and states the promise", () => {
    const text = iterationPrompt(state({ maxIterations: 5 }))
    expect(text.startsWith("Build a todo API")).toBe(true)
    expect(text).toContain("Ralph iteration 1 / 5")
    expect(text).toContain("<promise>COMPLETE</promise>")
  })

  test("says unlimited and offers the abort promise when set", () => {
    const text = iterationPrompt(state({ abortPromise: "BLOCKED" }))
    expect(text).toContain("1 (unlimited)")
    expect(text).toContain("<promise>BLOCKED</promise>")
  })

  test("the task text is identical between iterations", () => {
    const one = iterationPrompt(state())
    const two = iterationPrompt(state({ iteration: 2 }))
    expect(one.split("\n---")[0]).toBe(two.split("\n---")[0])
  })
})

describe("status", () => {
  test("reports the loop a person can act on", () => {
    const text = status(state({ iteration: 4, maxIterations: 10 }), 1_700_000_042_000)
    expect(text).toContain("ses_test")
    expect(text).toContain("iteration  4 / 10")
    expect(text).toContain("elapsed    42s")
    expect(text).toContain("<promise>COMPLETE</promise>")
  })
})