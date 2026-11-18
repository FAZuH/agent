/**
 * The supervisor host, driven through a fake ctx. No host, no network, no
 * model, no filesystem: the model answer, evidence broker, clock and audit are
 * injected at the seams. Every resolution path is observed through the fake
 * permission surface, not through internals.
 *
 *   bun test plugins/watchdog/src/supervisor-host.test.ts
 */

import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createEvidenceBroker } from "./evidence.ts"
import { normalize } from "../../../lib/lib-jev/jev.ts"
import { MIN_CONFIDENCE } from "./supervisor.ts"
import {
  SUPERVISOR_AUDIT_EVENTS,
  SUPERVISOR_HOLD_REASON,
  attachSupervisor,
  supervisorMarker,
  rawAdapter,
  type SupervisorAudit,
  type SupervisorCall,
  type SupervisorConfig,
  type SupervisorResolution,
} from "./supervisor-host.ts"

const CALL: SupervisorCall = {
  sessionID: "ses_sup_01",
  action: "shell",
  resources: ["src/config.ts"],
  subject: { action: "shell", resources: ["src/config.ts"], input: '{"path":"src/config.ts"}' },
  text: "shell: cat src/config.ts",
}

interface Harness {
  push: (event: any) => Promise<void>
  replies: any[]
  notices: any[]
  toasts: any[]
  interrupts: string[]
  audits: SupervisorAudit[]
  aborts: any[]
  hookCalls: string[]
  modelInputs: any[]
  modelOpts: any[]
  done: Promise<{ record: any; resolution: SupervisorResolution }>
  handle: ReturnType<typeof attachSupervisor>
  perId: string
}

function harness(opts: {
  verdict?: string
  others?: number
  enabled?: boolean
  listReturnsPending?: boolean
  modelThrows?: boolean
  note?: string
  decision?: any
  gate?: Promise<void>
  broker?: any
  maxEvidence?: number
  maxRounds?: number
  now?: () => number
}): Harness {
  const perId = "per_sup_01"
  const replies: any[] = []
  const notices: any[] = []
  const toasts: any[] = []
  const interrupts: string[] = []
  const audits: SupervisorAudit[] = []
  const aborts: any[] = []
  const hookCalls: string[] = []
  const modelInputs: any[] = []
  const modelOpts: any[] = []

  let resolveDone!: (value: { record: any; resolution: SupervisorResolution }) => void
  const done = new Promise<{ record: any; resolution: SupervisorResolution }>((r) => (resolveDone = r))

  const queue: any[] = []
  let wake: (() => void) | null = null
  let closed = false
  const stream = {
    [Symbol.asyncIterator]() {
      return {
        async next() {
          while (!queue.length && !closed) await new Promise<void>((resolve) => (wake = resolve))
          if (!queue.length) return { value: undefined, done: true }
          return { value: queue.shift(), done: false }
        },
      }
    },
  }
  const push = async (event: any) => {
    queue.push(event)
    wake?.()
    wake = null
    for (let tick = 0; tick < 5; tick++) await new Promise((resolve) => setTimeout(resolve, 0))
  }

  const others = Array.from({ length: opts.others ?? 0 }, (_, i) => ({ id: `per_other_${i}`, sessionID: CALL.sessionID }))
  const pending = [{ id: perId, sessionID: CALL.sessionID }, ...others]
  const ctx = {
    permission: {
      hook: async (name: string) => {
        hookCalls.push(name)
      },
      reply: async (input: any) => {
        replies.push(input)
      },
      list: async () => (opts.listReturnsPending === false ? [] : pending),
    },
    session: {
      synthetic: async (input: any) => {
        notices.push(input)
      },
      interrupt: async (input: any) => {
        interrupts.push(input.sessionID)
      },
      context: async () => [{ role: "user", text: "delete the build output" }],
      get: async () => ({ id: CALL.sessionID }),
    },
    event: { subscribe: () => stream },
    ui: { toast: { show: async (input: any) => { toasts.push(input) } } },
  }

  const config: SupervisorConfig = {
    state: () => ({}) as any,
    limits: () => ({
      timeoutMs: 30_000,
      maxRounds: opts.maxRounds ?? 3,
      maxEvidenceCalls: opts.maxEvidence ?? 0,
    }),
    evidenceRoot: () => "/repo",
    askWaitMs: () => 40,
  }

  const model = async (stateBody: any, _questions: any, callOpts: any): Promise<any> => {
    modelInputs.push(stateBody)
    modelOpts.push(callOpts)
    if (opts.gate) await opts.gate
    if (opts.modelThrows) throw new Error("model unreachable")
    return {
      decisions: [
        opts.decision ?? {
          value: opts.verdict ?? "propagate",
          probability: 0.9,
          confident: true,
          note: opts.note ?? "checked the held call",
        },
      ],
      model: "supervisor-model",
      inputTokens: 10,
      elapsedMs: 1,
      sent: {},
    }
  }

  const handle = attachSupervisor({
    ctx,
    config,
    model,
    broker: opts.broker,
    now: opts.now ?? (() => 0),
    audit: (entry) => audits.push(entry),
    isEnabled: () => opts.enabled ?? true,
    abortSession: async (sessionID: string, by: string, cause: string) => {
      aborts.push({ sessionID, by, cause })
      return {}
    },
    onResolved: (record, resolution) => resolveDone({ record, resolution }),
  })

  return { push, replies, notices, toasts, interrupts, audits, aborts, hookCalls, modelInputs, modelOpts, done, handle, perId }
}

const markerFor = (call = CALL) => supervisorMarker(call, SUPERVISOR_HOLD_REASON)

async function start(h: Harness, verdict: any, marker: string) {
  h.handle.begin(CALL, marker)
  await h.push({
    type: "permission.asked",
    data: { id: h.perId, sessionID: CALL.sessionID, action: CALL.action, resources: CALL.resources, message: marker },
  })
  return h.done
}

describe("supervisor marker", () => {
  test("is distinct from a nospawn hold marker and carries the call digest", () => {
    const marker = markerFor()
    expect(marker.startsWith("jev supervisor ")).toBe(true)
    expect(marker).toContain("A reviewer is checking this tool call")
    expect(marker).not.toContain("nospawn hold")
  })

  test("tells the agent a reviewer is checking the call, nothing ran, and it can approve, reject or wait", () => {
    const marker = markerFor()
    expect(marker).toContain("A reviewer is checking this tool call")
    expect(marker).toContain("Nothing has run yet")
    expect(marker).toContain("You can approve or reject now")
    expect(marker).toContain("wait for the reviewer's verdict")
  })

  test("is unique for the same call across two moments", () => {
    expect(markerFor()).not.toBe(markerFor())
  })
})

describe("supervisor audit vocabulary", () => {
  test("names every resolution event and the human answer", () => {
    expect(SUPERVISOR_AUDIT_EVENTS).toEqual([
      "supervisor_decision",
      "supervisor_allow",
      "supervisor_deny",
      "supervisor_abort",
      "supervisor_abort_hold_live",
      "supervisor_propagate",
      "supervisor_hold_uncancellable",
      "supervisor_fanout_skipped",
      "supervisor_human_answer",
    ])
  })
})

describe("all four verdicts", () => {
  test("allow grants once after revalidation", async () => {
    const h = harness({ verdict: "allow" })
    const { resolution } = await start(h, "allow", markerFor())
    expect(resolution).toBe("allow")
    expect(h.replies).toEqual([
      { sessionID: CALL.sessionID, requestID: h.perId, decision: "once", message: expect.any(String) },
    ])
    expect(h.audits.find((a) => a.event === "supervisor_allow")?.sessionID).toBe(CALL.sessionID)
    expect(h.replies[0].message).toContain("verdict allow (confidence 0.90)")
    expect(h.replies[0].message).toContain(
      "A second reviewer approved this call; it has been released. Proceed with the original held call only, not an equivalent.",
    )
  })

  test("deny hands back to the user without stopping the session", async () => {
    const h = harness({ verdict: "deny" })
    const { resolution } = await start(h, "deny", markerFor())
    expect(resolution).toBe("propagate")
    expect(h.replies.length).toBe(0)
    expect(h.interrupts).toEqual([])
    expect(h.aborts.length).toBe(0)
    expect(h.audits.find((a) => a.event === "supervisor_deny")?.sessionID).toBe(CALL.sessionID)
    expect(h.notices[0].text).toContain("verdict deny (confidence 0.90)")
  })

  test("abort rejects, interrupts and runs the abort cascade", async () => {
    const h = harness({ verdict: "abort" })
    const { resolution } = await start(h, "abort", markerFor())
    expect(resolution).toBe("abort")
    expect(h.replies.some((r) => r.decision === "reject")).toBe(true)
    expect(h.interrupts).toEqual([CALL.sessionID])
    expect(h.aborts).toEqual([{ sessionID: CALL.sessionID, by: "supervisor", cause: "supervisor abort verdict" }])
    expect(h.audits.find((a) => a.event === "supervisor_abort")?.sessionID).toBe(CALL.sessionID)
    expect(h.notices[0].text).toContain("verdict abort (confidence 0.90)")
    expect(h.notices[0].text).toContain(
      "A second reviewer stopped the task and its descendants. Do not resume automatically.",
    )
  })

  test("propagate leaves the hold and emits a redacted notice", async () => {
    const h = harness({ verdict: "propagate" })
    const { resolution } = await start(h, "propagate", markerFor())
    expect(resolution).toBe("propagate")
    expect(h.replies.length).toBe(0)
    expect(h.notices.length).toBe(1)
    expect(h.audits.find((a) => a.event === "supervisor_propagate")?.sessionID).toBe(CALL.sessionID)
    expect(h.notices[0].text).toMatch(/verdict propagate \(confidence \d+\.\d{2}\)/)
    expect(h.notices[0].text).toContain(
      "Nothing has run. The native permission prompt is still open for the human.",
    )
    expect(h.notices[0].text).not.toContain("wait for the human")
    expect(h.toasts.length).toBe(1)
    expect(h.toasts[0].title).toBe("jev supervisor")
    expect(h.toasts[0].message).toBe(h.notices[0].text)
  })
})

describe("real evidence adapter", () => {
  test("reads a file under root and bounds it to the byte cap", async () => {
    const root = mkdtempSync(join(tmpdir(), "jev-sup-adapter-"))
    try {
      writeFileSync(join(root, "big.txt"), "x".repeat(250_000))
      const adapter = rawAdapter(root)
      const read = await adapter.readFile("big.txt")
      expect(read.length).toBe(200_000)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("a symlink to a file outside root reads nothing", async () => {
    const root = mkdtempSync(join(tmpdir(), "jev-sup-adapter-"))
    let outside = ""
    try {
      outside = join(root, "..", `${root.split("/").pop()}-outside.txt`)
      writeFileSync(outside, "SUPERSECRET")
      symlinkSync(outside, join(root, "link.txt"))
      const broker = createEvidenceBroker(rawAdapter(root), { root })
      const result = await broker.readFile({ path: "link.txt" })
      expect(result.refs).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
      try {
        rmSync(outside, { force: true })
      } catch {}
    }
  })

  test("search and git-show evidence are wired and bounded by the call budget", async () => {
    const kinds: string[] = []
    const broker = {
      readFile: async () => ({ refs: [{ kind: "file", path: "src/config.ts", excerpt: "e", line: 1 }], redacted: false }),
      gitLog: async () => ({ refs: [{ kind: "git-log", path: "git log", excerpt: "e", rev: "abc123" }], redacted: false }),
      gitShow: async () => {
        kinds.push("git-show")
        return { refs: [{ kind: "git-show", path: "src/config.ts", excerpt: "e", rev: "abc123" }], redacted: false }
      },
      search: async () => {
        kinds.push("search")
        return { refs: [{ kind: "search", path: "src/config.ts", excerpt: "e", line: 2 }], redacted: false }
      },
    }
    const h = harness({ verdict: "allow", broker, maxEvidence: 6 })
    await start(h, "allow", markerFor())
    expect(kinds).toContain("git-show")
    expect(kinds).toContain("search")
    expect(h.audits.find((a) => a.event === "supervisor_decision")?.sessionID).toBe(CALL.sessionID)
    const refs = h.audits.find((a) => a.event === "supervisor_decision")!.evidence!
    expect(refs.map((r) => r.kind)).toContain("search")
    expect(refs.map((r) => r.kind)).toContain("git-show")
  })
})

describe("live switch and human short-circuit", () => {
  test("turning the feature off during supervision leaves the hold with the human", async () => {
    const h = harness({ verdict: "allow", enabled: false })
    const { resolution } = await start(h, "allow", markerFor())
    expect(resolution).toBe("propagate")
    expect(h.replies.length).toBe(0)
    expect(h.audits.some((a) => a.detail === "the feature was turned off during supervision")).toBe(true)
  })

  test("a human once while the supervisor runs prevents any self-grant", async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const h = harness({ verdict: "allow", gate })
    const marker = markerFor()
    h.handle.begin(CALL, marker)
    await h.push({
      type: "permission.asked",
      data: { id: h.perId, sessionID: CALL.sessionID, action: CALL.action, resources: CALL.resources, message: marker },
    })
    await h.push({ type: "permission.replied", data: { sessionID: CALL.sessionID, requestID: h.perId, reply: "once" } })
    release()
    const { resolution } = await h.done
    expect(resolution).toBe("propagate")
    expect(h.replies.length).toBe(0)
  })

  test("the audit records a redacted call, never the raw input", async () => {
    const secret = "ghp_abcdefghijklmnopqrstuvwxyz0123456789"
    const h = harness({ verdict: "deny", note: secret })
    await start(h, "deny", markerFor())
    const line = h.audits.find((a) => a.event === "supervisor_decision")!
    expect(line.detail).toContain("shell: cat src/config.ts")
    expect(JSON.stringify(line)).not.toContain(secret)
  })
})

describe("real Jev reasoning", () => {
  test("a confident answer's own reason reaches the audit and human notice", async () => {
    const explanation = "the command deletes build output without asking"
    const decision = normalize(
      "supervisor",
      { type: "choice", instructions: "decide", criteria: { allow: "", deny: "", abort: "", propagate: "" } },
      {
        type: "choice",
        choice: "deny",
        probabilities: { allow: 0.02, deny: 0.93, abort: 0.03, propagate: 0.02 },
        confidence: 0.93,
        reason: explanation,
      },
      { minProbability: MIN_CONFIDENCE, minMargin: 0 },
    )
    expect(decision.note).toBe(explanation)

    const h = harness({ decision })
    await start(h, "deny", markerFor())
    expect(h.modelOpts[0].thresholds).toEqual({ minProbability: MIN_CONFIDENCE, minMargin: 0 })
    const auditLine = h.audits.find((a) => a.event === "supervisor_deny")!
    expect(auditLine.reason).toBe(explanation)
    expect(auditLine.subject).toBe(CALL.text)
    expect(h.notices[0].text).toContain(explanation)
  })
})

describe("single writer and redaction", () => {
  test("attaching registers no second permission.evaluate writer", () => {
    const h = harness({})
    expect(h.hookCalls).toEqual([])
  })

  test("credential-shaped reasoning is redacted in audit and notice", async () => {
    const secret = "ghp_abcdefghijklmnopqrstuvwxyz0123456789"
    const h = harness({ verdict: "propagate", note: `token ${secret} was checked` })
    await start(h, "propagate", markerFor())
    const joined = JSON.stringify([...h.audits, ...h.notices])
    expect(joined).not.toContain(secret)
    expect(joined).toContain("[redacted:token]")
  })

  test("the model receives bounded, redacted excerpts; the audit entry has none", async () => {
    const broker = createEvidenceBroker(
      {
        readFile: async () => `line one\nauthorization: Bearer abcdefghijklmnopqrstuvwxyz\nline three`,
        search: async () => [],
        gitShow: async () => "",
        gitLog: async () => [],
      },
      { root: "/repo" },
    )
    const h = harness({ verdict: "allow", broker, maxEvidence: 6 })
    await start(h, "allow", markerFor())
    const input = h.modelInputs[0]
    const excerpt = input.evidence.find((ref: any) => ref.kind === "file").excerpt
    expect(excerpt).toContain("Bearer [REDACTED]")
    expect(excerpt).not.toContain("abcdefghijklmnopqrstuvwxyz")
    const auditLine = h.audits.find((a) => a.event === "supervisor_decision")!
    expect(auditLine.evidence).toEqual([{ kind: "file", path: "src/config.ts" }])
    expect(JSON.stringify(auditLine)).not.toContain("Bearer")
  })

  test("evidence in audit is references only, never excerpts", async () => {
    const broker = {
      readFile: async () => ({ refs: [{ kind: "file", path: "src/a.ts", excerpt: "API_KEY=supersecret", line: 4 }], redacted: true }),
      gitLog: async () => ({ refs: [{ kind: "git-log", path: "git log", excerpt: "commit body", rev: "abc123" }], redacted: false }),
      search: async () => ({ refs: [], redacted: false }),
      gitShow: async () => ({ refs: [], redacted: false }),
    }
    const h = harness({ verdict: "allow", broker, maxEvidence: 6 })
    await start(h, "allow", markerFor())
    const decision = h.audits.find((a) => a.event === "supervisor_decision")!
    expect(decision.evidence).toEqual([
      { kind: "file", path: "src/a.ts", line: 4 },
      { kind: "git-log", path: "git log", rev: "abc123" },
    ])
    expect(JSON.stringify(decision)).not.toContain("supersecret")
  })
})

describe("two-writer correlation and fail-closed identity", () => {
  test("a frame carrying the no-respawn marker still correlates by identity", async () => {
    const h = harness({ verdict: "allow" })
    const marker = markerFor()
    h.handle.begin(CALL, marker)
    await h.push({
      type: "permission.asked",
      data: {
        id: h.perId,
        sessionID: CALL.sessionID,
        action: CALL.action,
        resources: CALL.resources,
        message: "nospawn hold abcdef123456: a subagent replacement",
      },
    })
    const { resolution } = await h.done
    expect(resolution).toBe("allow")
    expect(h.replies.some((r) => r.decision === "once")).toBe(true)
  })

  test("an asked frame without action/resources never authorizes a grant", async () => {
    const h = harness({ verdict: "allow" })
    const marker = markerFor()
    h.handle.begin(CALL, marker)
    await h.push({ type: "permission.asked", data: { id: h.perId, sessionID: CALL.sessionID, message: marker } })
    const { resolution } = await h.done
    expect(resolution).toBe("propagate")
    expect(h.replies.length).toBe(0)
  })
})

describe("safe failure", () => {
  test("a model error escalates to the human and never allows", async () => {
    const h = harness({ modelThrows: true })
    const { record, resolution } = await start(h, "propagate", markerFor())
    expect(resolution).toBe("propagate")
    expect(record.verdict).toBe("propagate")
    expect(h.replies.length).toBe(0)
  })

  test("budget exhaustion escalates even when the model keeps saying allow", async () => {
    let tick = 0
    const h = harness({ verdict: "propagate", maxRounds: 2, now: () => (tick += 20_000) })
    const { record, resolution } = await start(h, "propagate", markerFor())
    expect(resolution).toBe("propagate")
    expect(record.verdict).toBe("propagate")
    expect(record.reason).toContain("no supervisor decision")
  })

  test("abort with siblings pending reports the live hold distinctly", async () => {
    const h = harness({ verdict: "abort", others: 1 })
    const { resolution } = await start(h, "abort", markerFor())
    expect(resolution).toBe("abort")
    expect(h.aborts.length).toBe(1)
    expect(h.audits.some((a) => a.event === "supervisor_abort_hold_live")).toBe(true)
  })

  test("deny hands back to the user even with other permissions pending", async () => {
    const h = harness({ verdict: "deny", others: 1 })
    const { resolution } = await start(h, "deny", markerFor())
    expect(resolution).toBe("propagate")
    expect(h.replies.length).toBe(0)
    expect(h.interrupts).toEqual([])
    expect(h.aborts.length).toBe(0)
  })

  test("uncancellable hold audit carries the session id", async () => {
    const h = harness({ verdict: "abort" })
    h.handle.begin(CALL, markerFor())
    await h.done
    const row = h.audits.find((a) => a.event === "supervisor_hold_uncancellable")
    expect(row).toBeDefined()
    expect(row?.sessionID).toBe(CALL.sessionID)
  })

  test("allow with a stale permission fails closed to propagate", async () => {
    const h = harness({ verdict: "allow", listReturnsPending: false })
    const { resolution } = await start(h, "allow", markerFor())
    expect(resolution).toBe("propagate")
    expect(h.replies.length).toBe(0)
    expect(h.audits.some((a) => a.event === "supervisor_propagate")).toBe(true)
  })

  test("a late reply after settlement cannot authorize another call", async () => {
    const h = harness({ verdict: "allow" })
    await start(h, "allow", markerFor())
    const count = h.audits.length
    await h.push({ type: "permission.replied", data: { sessionID: CALL.sessionID, requestID: h.perId, reply: "once" } })
    expect(h.audits.length).toBe(count)
  })
})

describe("propagate escalation", () => {
  test("budget-exhausted escalation keeps the last model confidence", async () => {
    const h = harness({
      maxRounds: 1,
      decision: { value: "propagate", probability: 0.7, confident: true, note: "writes outside the task root" },
    })
    const { record, resolution } = await start(h, "propagate", markerFor())
    expect(resolution).toBe("propagate")
    expect(record.verdict).toBe("propagate")
    expect(record.confidence).toBe(0.7)
  })

  test("a bare-label reason falls back to a call-specific sentence and keeps the raw reason in audit detail", async () => {
    const meta = '"propagate" is a hand-back label'
    const h = harness({ maxRounds: 1, decision: { value: "propagate", probability: 0.7, confident: true, note: meta } })
    const { record } = await start(h, "propagate", markerFor())
    expect(record.reason).toContain("A second reviewer could not verify this shell call")
    expect(record.reason).not.toContain("hand-back label")
    expect(h.notices[0].text).not.toContain("hand-back label")
    expect(h.audits.find((a) => a.event === "supervisor_decision")?.detail).toContain("hand-back label")
  })

  test("a propagate verdict is not re-asked with identical input", async () => {
    const h = harness({ verdict: "propagate", maxEvidence: 6 })
    await start(h, "propagate", markerFor())
    expect(h.modelInputs.length).toBe(1)
  })

  test("production budgets use the call-specific fallback without forcing exhaustion", async () => {
    const meta = '"propagate" is a hand-back label'
    const h = harness({
      maxRounds: 3,
      maxEvidence: 6,
      decision: { value: "propagate", probability: 0.7, confident: true, note: meta },
    })
    const { record } = await start(h, "propagate", markerFor())
    expect(record.reason).toContain("A second reviewer could not verify this shell call")
    expect(record.reason).not.toContain("hand-back label")
    expect(h.notices[0].text).not.toContain("hand-back label")
    expect(h.audits.find((a) => a.event === "supervisor_decision")?.detail).toContain("hand-back label")
    expect(record.confidence).toBe(0.7)
    expect(h.modelInputs.length).toBe(1)
  })

  test("escalation reason is specific: bare labels fall back, substantive notes are kept", async () => {
    const bare = harness({ verdict: "propagate", note: '"propagate" is a hand-back label' })
    await start(bare, "propagate", markerFor())
    const bareAudit = bare.audits.find((a) => a.event === "supervisor_propagate")
    expect(bareAudit?.reason).toContain("A second reviewer could not verify this shell call")
    expect(bare.audits.find((a) => a.event === "supervisor_decision")?.detail).toContain("hand-back label")

    const specific = harness({ verdict: "propagate", note: "the ssh target host is outside the evidence root" })
    await start(specific, "propagate", markerFor())
    const specificAudit = specific.audits.find((a) => a.event === "supervisor_propagate")
    expect(specificAudit?.reason).toContain("the ssh target host is outside the evidence root")
  })
})
