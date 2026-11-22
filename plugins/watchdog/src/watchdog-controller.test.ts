/**
 * The Watchdog page controller (#18): the load fan-in, the busy keys, and the
 * release path. The release tests pin the fan-out ban: one click releases
 * exactly one operation through the public contract, no matter how many
 * sessions it covers or how many other operations exist.
 */
import { describe, expect, test } from "bun:test"
import { createWatchdogView, releaseWarning, type ReleaseResult, type WatchdogRPC, type WatchdogViewState, type WatchdogStatusInfo, type WatchdogSettingsInfo, type WatchdogOperationInfo } from "./watchdog-controller.ts"

const status: WatchdogStatusInfo = {
  ok: true,
  on: true,
  chain: { status: "passed", reason: "the capability gate passed", wired: true },
  pending: { inFlight: 2, waiting: 1, durable: 1, durableUnreadable: false },
  effective: {
    activeOperations: 2,
    sessionsCovered: 2,
    overlapping: [{ sessionID: "ses_covered", operations: 2 }],
    incompleteOperations: 0,
  },
  recordsReadable: true,
}

const settings: WatchdogSettingsInfo = {
  on: true,
  persisted: { nodes: "", timing: "blocking", sessionCap: 4, jevBatchMax: 1, jevBatchMs: 0, supervisorBatchMax: 1, supervisorBatchMs: 0 },
  effective: {
    timing: "blocking",
    sessionCap: 4,
    jevBatchMax: 1,
    jevBatchMs: 0,
    supervisorBatchMax: 1,
    supervisorBatchMs: 0,
    nodes: { jev: true, parent: true, supervisor: true, human: true },
  },
  envOverrides: [],
  receiptsWebhookPresent: false,
  supervisorEndpointPresent: false,
  migration: { present: false, stored: 0, defaulted: 8, invalid: 0 },
}

const operations: WatchdogOperationInfo[] = [
  {
    id: "op_1",
    sessionID: "ses_covered",
    scope: ["ses_covered", "ses_child"],
    source: "human",
    cause: "operator abort",
    at: 1,
    incomplete: [],
  },
  {
    id: "op_2",
    sessionID: "ses_covered",
    scope: ["ses_covered"],
    source: "human",
    cause: "operator abort",
    at: 2,
    incomplete: [{ step: "ban", status: "failed", detail: "the ban file could not be written" }],
    delivery: { receipt: "delivered", attempts: 1, notice: "delivered" },
  },
]

/** A release result as the RPC returns it; overrides name what a case inspects. */
function releaseResult(over: Partial<ReleaseResult> = {}): ReleaseResult {
  return {
    ok: true,
    durable: true,
    receipt: true,
    already: false,
    operationID: "op_1",
    ban: { cleared: 2, kept: 0, failed: 0 },
    covered: [],
    continued: "not-requested",
    incomplete: [],
    ...over,
  }
}

function harness(overrides: Partial<WatchdogRPC> = {}) {
  const releaseCalls: Array<{ operationID: string; continue?: boolean }> = []
  const errors: string[] = []
  const warnings: string[] = []
  const states: WatchdogViewState[] = []
  let listener: ((event: { reason: string }) => void) | undefined
  let releaseAnswer: ReleaseResult = releaseResult()
  let releaseError: unknown = undefined
  const rpc: WatchdogRPC = {
    watchdogStatus: async () => status,
    getWatchdogSettings: async () => settings,
    setWatchdogSetting: async () => ({ ok: true }),
    setWatchdogSecret: async () => ({ ok: true }),
    abortOperations: async () => ({ ok: true, operations }),
    releaseOperation: async (input) => {
      releaseCalls.push(input)
      if (releaseError) throw releaseError
      return releaseAnswer
    },
    subscribe: (fn) => {
      listener = fn
      return () => {
        listener = undefined
      }
    },
    ...overrides,
  }
  const view = createWatchdogView(rpc, {
    update: (next) => states.push(next),
    error: (message) => errors.push(message),
    warning: (message) => warnings.push(message),
  })
  return {
    view,
    releaseCalls,
    errors,
    warnings,
    states,
    fire: () => listener?.({ reason: "changed" }),
    answerRelease: (result: ReleaseResult) => {
      releaseAnswer = result
    },
    failRelease: (error: unknown) => {
      releaseError = error
    },
  }
}

describe("releaseWarning", () => {
  test("a clean release carries no warning", () => {
    expect(releaseWarning(releaseResult())).toBeNull()
  })
  test("an unverified release says nothing was assumed cleared", () => {
    const text = releaseWarning(releaseResult({ ok: false, reason: "the record could not be read" }))
    expect(text).toContain("could not be verified")
    expect(text).toContain("the record could not be read")
    expect(text).toContain("Nothing was assumed cleared")
  })
  test("bans that failed to clear are reported, kept and failed separated", () => {
    const text = releaseWarning(releaseResult({ ban: { cleared: 1, kept: 2, failed: 1 } }))
    expect(text).toContain("1 ban could not be cleared")
    expect(text).toContain("2 kept by another covering operation")
  })
  test("a still-covered session says the other covering bans stay in force", () => {
    const text = releaseWarning(releaseResult({ covered: ["ses_covered"] }))
    expect(text).toContain("still covered by another active operation")
    expect(text).toContain("kept every other covering ban in force")
  })
  test("a prevented continuation is named, not restated as success", () => {
    expect(releaseWarning(releaseResult({ continued: "prevented" }))).toContain("No continuation was sent")
    expect(releaseWarning(releaseResult({ continued: "unsupported" }))).toContain("no hook in this process can deliver one")
  })
})

describe("WatchdogView controller", () => {
  test("load fans in status, settings, and operations in one state", async () => {
    const h = harness()
    await h.view.load()
    const last = h.states[h.states.length - 1]
    expect(last.loading).toBe(false)
    expect(last.status).toEqual(status)
    expect(last.settings).toEqual(settings)
    expect(last.operations).toHaveLength(2)
    expect(last.operationsReadable).toBe(true)
  })

  test("a load failure lands as an error, never a payload", async () => {
    const h = harness({ watchdogStatus: async () => { throw new Error("boom at the boundary") } })
    await h.view.load()
    const last = h.states[h.states.length - 1]
    expect(last.loading).toBe(false)
    expect(last.error).toContain("boom at the boundary")
  })

  test("unreadable abort records are a state, not an empty list", async () => {
    const h = harness({ abortOperations: async () => ({ ok: false as const, reason: "the record file is broken", operations: [] }) })
    await h.view.load()
    const last = h.states[h.states.length - 1]
    expect(last.operationsReadable).toBe(false)
    expect(last.operations).toEqual([])
  })

  test("one release click is exactly one releaseOperation call, however many sessions it covers", async () => {
    const h = harness()
    await h.view.load()
    await h.view.release("op_1", true)
    expect(h.releaseCalls).toEqual([{ operationID: "op_1", continue: true }])
    // No second call for the covered session, the other operation, or the load.
    await h.view.release("op_1", false)
    expect(h.releaseCalls).toEqual([
      { operationID: "op_1", continue: true },
      { operationID: "op_1" },
    ])
  })

  test("a still-covered release raises the covering-ban warning", async () => {
    const h = harness()
    h.answerRelease(releaseResult({ covered: ["ses_covered"] }))
    await h.view.load()
    await h.view.release("op_1", false)
    expect(h.warnings).toHaveLength(1)
    expect(h.warnings[0]).toContain("kept every other covering ban in force")
    expect(h.errors).toEqual([])
  })

  test("a release that throws is reported without a payload and retried never blindly", async () => {
    const h = harness()
    h.failRelease(new Error("transport died"))
    await h.view.load()
    await h.view.release("op_1", false)
    expect(h.errors).toHaveLength(1)
    expect(h.errors[0]).toContain("could not be confirmed")
    expect(h.errors[0]).toContain("transport died")
    expect(h.errors[0]).toContain("Check the abort records before retrying")
  })

  test("a failed setting write reports the server's error text", async () => {
    const h = harness({ setWatchdogSetting: async () => ({ ok: false, error: "Wrong type for sessionCap." }) })
    await h.view.load()
    await h.view.setSetting("sessionCap", "four")
    expect(h.errors).toEqual(["Wrong type for sessionCap."])
  })

  test("the busy key is held for the mutation and cleared after", async () => {
    let releaseBusy = false
    const h = harness({ releaseOperation: async (input) => {
      releaseBusy = h.states.some((s) => s.busy === `release:${input.operationID}`)
      return releaseResult({ operationID: input.operationID })
    } })
    await h.view.load()
    await h.view.release("op_1", false)
    expect(releaseBusy).toBe(true)
    expect(h.states[h.states.length - 1].busy).toBeUndefined()
  })

  test("a changed event reloads the whole picture once", async () => {
    const h = harness()
    await h.view.load()
    const loads = h.states.length
    h.fire()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(h.states.length).toBeGreaterThan(loads)
    expect(h.states[h.states.length - 1].loading).toBe(false)
  })

  test("dispose stops loads and the subscription", async () => {
    const h = harness()
    await h.view.load()
    h.view.dispose()
    const loads = h.states.length
    await h.view.load()
    h.fire()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(h.states.length).toBe(loads)
  })
})
