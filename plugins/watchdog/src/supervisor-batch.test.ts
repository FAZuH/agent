/**
 * Pure non-blocking batch decisions: mode resolution, per-session queue,
 * flush triggers and fail-closed verdict normalization. No ctx, no timer,
 * no model.
 *
 *   bun test plugins/watchdog/src/supervisor-batch.test.ts
 */

import { describe, expect, test } from "bun:test"
import {
  batchTargetSession,
  createBatchQueue,
  createBatchRunner,
  normalizeBatchVerdict,
  resolveSupervisorMode,
  type SupervisorCall,
} from "./supervisor-batch.ts"

const call = (sessionID: string, action: string): SupervisorCall => ({
  sessionID,
  action,
  resources: [`src/${action}.ts`],
  subject: { action, resources: [`src/${action}.ts`] },
  text: `${action}: src/${action}.ts`,
})

describe("supervisor mode resolution", () => {
  test("keeps the Jev-first path when both switches are off", () => {
    expect(resolveSupervisorMode({ standalone: false, nonBlocking: false, active: true })).toBe("default")
  })

  test("selects the blocking standalone path when only standalone is on", () => {
    expect(resolveSupervisorMode({ standalone: true, nonBlocking: false, active: true })).toBe("standalone")
  })

  test("non-blocking implies standalone", () => {
    expect(resolveSupervisorMode({ standalone: false, nonBlocking: true, active: true })).toBe("nonBlocking")
    expect(resolveSupervisorMode({ standalone: true, nonBlocking: true, active: true })).toBe("nonBlocking")
  })

  test("an inactive supervisor keeps the Jev-first path whatever the switches say", () => {
    expect(resolveSupervisorMode({ standalone: true, nonBlocking: true, active: false })).toBe("default")
  })
})

describe("per-session batch queue", () => {
  test("returns a batch at the cap and clears it so the next window starts empty", () => {
    const queue = createBatchQueue(3)
    expect(queue.record(call("ses_a", "shell"))).toBeNull()
    expect(queue.record(call("ses_a", "edit"))).toBeNull()
    const full = queue.record(call("ses_a", "read"))
    expect(full?.sessionID).toBe("ses_a")
    expect(full?.calls.map((c) => c.action)).toEqual(["shell", "edit", "read"])
    expect(queue.size("ses_a")).toBe(0)
    expect(queue.drain("ses_a")).toBeNull()
  })

  test("keeps sessions separate and lists only sessions with pending calls", () => {
    const queue = createBatchQueue(5)
    queue.record(call("ses_a", "shell"))
    queue.record(call("ses_b", "edit"))
    expect(queue.sessions().sort()).toEqual(["ses_a", "ses_b"])
    expect(queue.drain("ses_a")?.calls.map((c) => c.action)).toEqual(["shell"])
    expect(queue.sessions()).toEqual(["ses_b"])
    expect(queue.size("ses_b")).toBe(1)
  })
})

describe("batch session targeting", () => {
  test("uses the session that produced the calls", () => {
    expect(batchTargetSession([call("ses_batch_1", "shell"), call("ses_batch_1", "edit")])).toBe("ses_batch_1")
  })

  test("refuses an empty or mixed-session batch", () => {
    expect(batchTargetSession([])).toBeNull()
    expect(batchTargetSession([call("ses_a", "shell"), call("ses_b", "edit")])).toBeNull()
  })
})

describe("fail-closed batch verdict", () => {
  test("only the exact allow passes", () => {
    expect(normalizeBatchVerdict("allow")).toBe("allow")
  })

  test("blocking verdicts, wrong case, padding and unknown shapes abort", () => {
    expect(normalizeBatchVerdict("propagate")).toBe("abort")
    expect(normalizeBatchVerdict("deny")).toBe("abort")
    expect(normalizeBatchVerdict("abort")).toBe("abort")
    expect(normalizeBatchVerdict("ALLOW")).toBe("abort")
    expect(normalizeBatchVerdict(" allow")).toBe("abort")
    expect(normalizeBatchVerdict(null)).toBe("abort")
    expect(normalizeBatchVerdict({ value: "allow" })).toBe("abort")
  })
})

describe("batch flush triggers", () => {
  const harness = () => {
    const flushes: Array<{ sessionID: string; calls: SupervisorCall[] }> = []
    const timers: Array<{ sessionID: string; ms: number; fire: () => void; cancelled: boolean }> = []
    const runner = createBatchRunner({
      batchMs: 1000,
      batchMax: 3,
      onFlush: (batch) => flushes.push(batch),
      schedule: (sessionID, ms, fire) => {
        const timer = { sessionID, ms, fire, cancelled: false }
        timers.push(timer)
        return () => {
          timer.cancelled = true
        }
      },
    })
    return { flushes, timers, runner }
  }

  test("opens one window on the first call and does not restart it", () => {
    const { timers, runner } = harness()
    runner.record(call("ses_a", "shell"))
    runner.record(call("ses_a", "edit"))
    expect(timers).toHaveLength(1)
    expect(timers[0].sessionID).toBe("ses_a")
    expect(timers[0].ms).toBe(1000)
  })

  test("the timer flushes the whole window, and the next call opens a new one", () => {
    const { flushes, timers, runner } = harness()
    runner.record(call("ses_a", "shell"))
    runner.record(call("ses_a", "edit"))
    timers[0].fire()
    expect(flushes[0].calls.map((c) => c.action)).toEqual(["shell", "edit"])
    runner.record(call("ses_a", "read"))
    expect(timers).toHaveLength(2)
    timers[1].fire()
    expect(flushes[1].calls.map((c) => c.action)).toEqual(["read"])
  })

  test("the cap flushes early and cancels that session's window", () => {
    const { flushes, timers, runner } = harness()
    runner.record(call("ses_a", "shell"))
    runner.record(call("ses_a", "edit"))
    runner.record(call("ses_a", "read"))
    expect(flushes).toHaveLength(1)
    expect(flushes[0].calls).toHaveLength(3)
    expect(timers[0].cancelled).toBe(true)
    timers[0].fire()
    expect(flushes).toHaveLength(1)
  })

  test("sessions flush independently", () => {
    const { flushes, timers, runner } = harness()
    runner.record(call("ses_a", "shell"))
    runner.record(call("ses_b", "edit"))
    timers[0].fire()
    expect(flushes).toHaveLength(1)
    expect(flushes[0].sessionID).toBe("ses_a")
    timers[1].fire()
    expect(flushes[1].sessionID).toBe("ses_b")
  })

  test("session end drains pending calls and cancels the window", () => {
    const { flushes, timers, runner } = harness()
    runner.record(call("ses_a", "shell"))
    runner.record(call("ses_a", "edit"))
    runner.endSession("ses_a")
    expect(flushes[0].calls.map((c) => c.action)).toEqual(["shell", "edit"])
    expect(timers[0].cancelled).toBe(true)
    runner.endSession("ses_a")
    expect(flushes).toHaveLength(1)
  })

  test("close drains pending calls through one judgement and no timer can flush twice", () => {
    const { flushes, timers, runner } = harness()
    runner.record(call("ses_a", "shell"))
    runner.record(call("ses_b", "edit"))
    runner.close()
    expect(flushes.map((batch) => batch.sessionID).sort()).toEqual(["ses_a", "ses_b"])
    expect(timers.map((timer) => timer.cancelled)).toEqual([true, true])
    timers[0].fire()
    timers[1].fire()
    runner.endSession("ses_a")
    expect(flushes).toHaveLength(2)
  })
})
