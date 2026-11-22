/**
 * Milestone B: the host glue, driven through fake contexts. No host, no
 * network, no model, no provider: fabricated `ctx`, fabricated events, a temp
 * state directory.
 *
 *   bun test plugins/watchdog/src/session-ban-host.test.ts
 *
 * M8-M13 of probes/session-ban-identity/test-plan.md, plus the flag-off guard.
 * Passing these is not host evidence: the wrapper chain, event delivery, the
 * durable cursor and the permission frames are all faked here.
 */

import { afterAll, describe, expect, test } from "bun:test"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

const scratch = mkdtempSync(join(tmpdir(), "jev-session-ban-host-"))
process.env.JEV_DATA_DIR = scratch
process.env.JEV_SECRET_DIR = join(scratch, "secrets")
process.env.OPENCODE_JEV_SESSION_BAN_DIR = join(scratch, "session-ban")

const hostModule = await import("./session-ban-host.ts")
const store = await import("./session-ban-state.ts")
const rules = await import("./session-ban.ts")
const stateModule = await import("../../../lib/jev/state.ts")

const { createAdmissionHost, attach, register, start, callKey, clearBanOrUnknown, resetOpenPrompts, revokeOpenPrompts, SUBAGENT, EVENT_TYPES } = hostModule
const { fingerprint, verdict } = rules

afterAll(() => rmSync(scratch, { recursive: true, force: true }))

// ——— fakes ———

interface FakeCtx {
  ctx: any
  transforms: number
  subscribed: number
  types: string[] | null
  hooks: Record<string, (event: any) => any>
  permission: Record<string, (event: any) => any>
  /** Every reply Jev issued through `ctx.permission.reply`. */
  replies: any[]
  /** What `ctx.permission.list` answers. The test decides. */
  pending: any[]
  interrupts: string[]
  tool: any
  feed: (event: any) => Promise<void>
  close: () => void
  /** The abort signal each event subscription was given. */
  signals: AbortSignal[]
  /** How many subscriptions were ended by their signal. */
  aborted: number
}

function subscription(): { stream: any; push: (event: any) => Promise<void>; close: () => void } {
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
  return {
    stream,
    async push(event: any) {
      queue.push(event)
      wake?.()
      wake = null
      for (let tick = 0; tick < 3; tick++) await new Promise((resolve) => setTimeout(resolve, 0))
    },
    close() {
      closed = true
      wake?.()
      wake = null
    },
  }
}

function fakeCtx(): FakeCtx {
  const hooks: Record<string, (event: any) => any> = {}
  const permission: Record<string, (event: any) => any> = {}
  const interrupts: string[] = []
  const events = subscription()
  const tool = {
    id: SUBAGENT,
    execute: async () => ({ metadata: { sessionID: "ses_child", status: "running" }, content: [] }),
  }
  const editor = {
    list: () => [tool],
    get: (id: string) => (id === SUBAGENT ? tool : undefined),
    update: (id: string, fn: (mutable: any) => void) => {
      if (id === SUBAGENT) fn(tool)
    },
  }
  const api: FakeCtx = {
    ctx: null as any,
    transforms: 0,
    subscribed: 0,
    types: null,
    hooks,
    permission,
    replies: [],
    pending: [],
    interrupts,
    tool,
    feed: events.push,
    close: events.close,
    signals: [],
    aborted: 0,
  }
  /** The host's own deregistration: a `Registration` with an async `dispose`. */
  const registration = (remove: () => void) => ({ dispose: async () => remove() })
  api.ctx = {
    tool: {
      transform: async (fn: (editor: any) => void) => {
        api.transforms += 1
        fn(editor)
        return registration(() => {})
      },
      hook: async (name: string, fn: (event: any) => any) => {
        hooks[name] = fn
        // A disposal from a replaced generation must not remove its successor.
        return registration(() => {
          if (hooks[name] === fn) delete hooks[name]
        })
      },
    },
    permission: {
      hook: async (name: string, fn: (event: any) => any) => {
        permission[name] = fn
        return registration(() => {
          if (permission[name] === fn) delete permission[name]
        })
      },
      reply: async (input: any) => {
        api.replies.push(input)
      },
      list: async () => api.pending,
    },
    event: {
      subscribe: (options: { types?: string[]; signal?: AbortSignal }) => {
        api.subscribed += 1
        api.types = options?.types ?? null
        const signal = options?.signal
        if (signal) {
          api.signals.push(signal)
          signal.addEventListener?.("abort", () => {
            api.aborted += 1
            // One queue serves the fake feed, so it closes only when every
            // subscriber has ended.
            if (api.aborted >= api.subscribed) events.close()
          })
        }
        return events.stream
      },
    },
    session: {
      interrupt: async ({ sessionID }: { sessionID: string }) => {
        interrupts.push(sessionID)
      },
    },
  }
  return api
}

let perCounter = 0
const nextPerId = () => `per_${++perCounter}`

/** One `permission.asked` frame, as the host publishes it from an `ask` effect. */
const askedFrame = (sessionID: string, message: string, id = nextPerId()) => ({
  type: "permission.asked",
  data: { id, sessionID, action: SUBAGENT, resources: ["general"], message },
})

/** One `permission.replied` frame, in the host's fixed vocabulary. */
const repliedFrame = (sessionID: string, requestID: string, reply: "once" | "always" | "reject") => ({
  type: "permission.replied",
  data: { sessionID, requestID, reply },
})

/** What a hold must write onto the event: the call key digest and the reason. */
const MARKER = /^session-ban hold [0-9a-f]{12}: .+$/

/** Correlate an ask to the hold it belongs to, then answer it as a human would. */
async function answer(api: FakeCtx, sessionID: string, event: any, reply: "once" | "always" | "reject") {
  const id = nextPerId()
  await api.feed(askedFrame(sessionID, event.message, id))
  await api.feed(repliedFrame(sessionID, id, reply))
  return id
}

const auditLines = (parentID: string): any[] => {
  const path = store.parentPaths(parentID).audit
  if (!existsSync(path)) return []
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

const tasks = (parentID: string): Record<string, any> => store.readSnapshot(parentID).snap?.tasks ?? {}

/** The call keys the audit reports as denied, so a hold is never counted as one. */
const deniedCalls = (parentID: string): string[] =>
  auditLines(parentID)
    .filter((line) => line.event === "deny")
    .map((line) => String(line.callID ?? ""))

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Wait for an observable the async enforcement path produces. */
const until = async (ready: () => boolean) => {
  for (let tick = 0; tick < 200 && !ready(); tick++) await sleep(2)
}

const observe = (parentID: string, messageID: string, callID: string, prompt: string) => ({
  sessionID: parentID,
  messageID,
  callID,
  agent: "general",
  prompt,
})

const assertEvent = (parentID: string, messageID: string, callID: string) => ({
  sessionID: parentID,
  agent: "general",
  action: SUBAGENT,
  resources: ["general"],
  source: { type: "tool", messageID, id: callID },
  effect: "allow",
})

/** One host behind the fake ctx's hooks, so a test can drive both sides. */
async function wired(options: any = {}) {
  const api = fakeCtx()
  const host = createAdmissionHost({ ctx: api.ctx, ...options })
  await attach(api.ctx, host)
  const call = async (prompt: string, messageID = "msg_1", callID = "call_1", parentID = "ses_parent") => {
    await api.tool.execute({ prompt }, { sessionID: parentID, messageID, id: callID, agent: "general" })
  }
  return { api, host, call, dispose: () => { host.close(); api.close() } }
}

// ——— the flag ———

describe("flag off", () => {
  test("registration wires nothing and creates no state directory", async () => {
    // The shipped default: every feature is opt-in.
    expect(stateModule.featureStored("hook_session_ban")).toBe(false)

    const dir = join(scratch, "flag-off")
    const previous = process.env.OPENCODE_JEV_SESSION_BAN_DIR
    process.env.OPENCODE_JEV_SESSION_BAN_DIR = dir
    try {
      const api = fakeCtx()
      const { dispose } = await start(api.ctx, () => false)
      expect(api.transforms).toBe(0)
      expect(api.subscribed).toBe(0)
      expect(Object.keys(api.hooks)).toEqual([])
      expect(Object.keys(api.permission)).toEqual([])
      expect(existsSync(dir)).toBe(false)
      dispose()
    } finally {
      process.env.OPENCODE_JEV_SESSION_BAN_DIR = previous
    }
  })

  test("registration wires four domains when the flag is on", async () => {
    const dir = join(scratch, "flag-on")
    const previous = process.env.OPENCODE_JEV_SESSION_BAN_DIR
    process.env.OPENCODE_JEV_SESSION_BAN_DIR = dir
    const api = fakeCtx()
    const { dispose } = await start(api.ctx, () => true)
    try {
      expect(api.transforms).toBe(1)
      expect(api.subscribed).toBe(1)
      expect(api.types).toEqual(EVENT_TYPES)
      expect(typeof api.hooks["execute.after"]).toBe("function")
      expect(typeof api.permission.evaluate).toBe("function")

      // And the observation it makes is the first file the store creates.
      await api.tool.execute({ prompt: "summarize the parser" }, { sessionID: "ses_flag_on", messageID: "msg_a", id: "call_a", agent: "general" })
      expect(existsSync(dir)).toBe(true)
    } finally {
      dispose()
      api.close()
      process.env.OPENCODE_JEV_SESSION_BAN_DIR = previous
    }
  })
})

// ——— repeated setup ———

describe("a replaced provider", () => {
  test("hands an already-dispatched call to the live provider, never undecided", async () => {
    const api = fakeCtx()
    const parentID = "ses_two_setups"
    const first = await start(api.ctx, () => true)
    const stale = api.permission.evaluate
    const second = await start(api.ctx, () => true)
    const live = api.permission.evaluate
    try {
      expect(stale).not.toBe(live)
      // No disposal happened here: the token alone retires it, and a retired
      // handle is not evidence that anything enforces the ban.
      expect(first.attached()).toBe(false)
      expect(second.attached()).toBe(true)

      // The live generation refuses a call it never observed: its documented
      // fail-closed answer, and the answer the abort path relies on.
      const liveEvent = assertEvent(parentID, "msg_live", "call_live")
      expect((await live(liveEvent)).effect).toBe("deny")
      expect(liveEvent.effect).toBe("deny")

      // A call only the retired provider observed still needs an answer, and the
      // host need not replay it to the replacement: the retired callback hands it
      // to the live provider, whose own fail-closed reason names the missing
      // entry. Returning nothing would leave the host's default to release it.
      const staleEvent = assertEvent(parentID, "msg_stale", "call_stale")
      const handed = await stale(staleEvent)
      expect(handed?.effect).toBe("deny")
      expect(handed?.reason).toContain("no admission record")
      expect(staleEvent.effect).toBe("deny")

      // A call both providers observed is judged by the live one on its own
      // evidence, and the retired callback replays that judgment.
      await api.tool.execute(
        { prompt: "summarize the parser" },
        { sessionID: parentID, messageID: "msg_ok", id: "call_ok", agent: "general" },
      )
      expect((await live(assertEvent(parentID, "msg_ok", "call_ok"))).effect).toBe("allow")
      const staleOk = assertEvent(parentID, "msg_ok", "call_ok")
      expect((await stale(staleOk))?.effect).toBe("allow")
      expect(staleOk.effect).toBe("allow")
    } finally {
      second.dispose()
      first.dispose()
      api.close()
    }
  })

  test("a decision that finds its generation retired delegates instead of stopping", async () => {
    // The retirement lands inside the decision's own await: the first provider is
    // parked reading the prompt when the second registration replaces it. The
    // parked call must still be judged — by the live provider — not dropped.
    const api = fakeCtx()
    const parentID = "ses_mid_decision"
    let release: (() => void) | null = null
    let entered = false
    const first = await start(api.ctx, () => true, {
      readPrompt: async () => {
        entered = true
        await new Promise<void>((resolve) => (release = resolve))
        return "summarize the parser"
      },
    })
    const stale = api.permission.evaluate
    try {
      await api.tool.execute(
        { prompt: "summarize the parser" },
        { sessionID: parentID, messageID: "msg_mid", id: "call_mid", agent: "general" },
      )
      const inFlight = assertEvent(parentID, "msg_mid", "call_mid")
      let decision: any = null
      const pending = stale(inFlight).then((answer: any) => {
        decision = answer
      })
      for (let tick = 0; tick < 200 && !entered; tick++) await sleep(2)
      expect(entered).toBe(true)
      expect(decision).toBeNull()

      // The replacement registers while the first decision is parked.
      const second = await start(api.ctx, () => true)
      try {
        release!()
        await pending
        // The live provider has no entry for this call: its own fail-closed
        // answer, not the retired provider's silence.
        expect(decision?.effect).toBe("deny")
        expect(decision?.reason).toContain("no admission record")
        expect(inFlight.effect).toBe("deny")
      } finally {
        second.dispose()
      }
    } finally {
      first.dispose()
      api.close()
    }
  })

  test("disposing a replaced handle stops its wires and keeps its successor's", async () => {
    const api = fakeCtx()
    const first = await start(api.ctx, () => true)
    const second = await start(api.ctx, () => true)
    const liveEnforce = api.permission.evaluate
    try {
      expect(api.subscribed).toBe(2)
      // Each registration was given the documented way to end its feed.
      expect(api.signals).toHaveLength(2)

      first.dispose()
      expect(api.signals[0]?.aborted).toBe(true)
      expect(api.aborted).toBe(1)
      // A stale disposal must not remove the current generation's hooks.
      expect(api.permission.evaluate).toBe(liveEnforce)
      expect(typeof api.hooks["execute.after"]).toBe("function")
      // Idempotent: a second call disposes nothing new.
      first.dispose()
      expect(api.aborted).toBe(1)

      second.dispose()
      expect(api.permission.evaluate).toBeUndefined()
      expect(api.aborted).toBe(2)
    } finally {
      api.close()
    }
  })

  test("turning the switch off retires the provider into the handover refusal", async () => {
    const api = fakeCtx()
    const first = await start(api.ctx, () => true)
    const stale = api.permission.evaluate
    const off = await start(api.ctx, () => false)
    try {
      expect(first.attached()).toBe(false)
      expect(off.attached()).toBe(false)
      // The old callback is still registered (nothing disposed it), and the
      // switch alone is not what retires it. No provider replaces it, so there is
      // nobody to hand the call to: it is refused, never released unjudged.
      const event = assertEvent("ses_switch_off", "msg_1", "call_1")
      const decision = await stale(event)
      expect(decision?.effect).toBe("deny")
      expect(String(decision?.reason)).toContain("enforcement handover is in progress")
      expect(event.effect).toBe("deny")
    } finally {
      off.dispose()
      api.close()
    }
  })
})

// ——— M9 / M10: the observer and the store ———

describe("observer", () => {
  test("runs once per call, writes one entry per call key, and never throws", async () => {
    let writes = 0
    const { api, dispose, call } = await wired({
      store: {
        writeTask: (...args: any[]) => {
          writes += 1
          return (store.writeTask as any)(...args)
        },
      },
    })
    const parentID = "ses_observer"
    try {
      await call("summarize the parser", "msg_1", "call_1", parentID)
      // A second wrapper pass for the same call must not add a second entry.
      await api.tool.execute({ prompt: "summarize the parser" }, { sessionID: parentID, messageID: "msg_1", id: "call_1", agent: "general" })
      expect(writes).toBe(1)
      expect(Object.keys(tasks(parentID)).length).toBe(1)
      expect(auditLines(parentID).filter((line) => line.event === "admit").length).toBe(1)

      // Five malformed shapes: no throw from the wrapper.
      const malformed: [any, any][] = [
        [{ prompt: "" }, { sessionID: parentID, messageID: "msg_2", id: "call_2", agent: "" }],
        [{}, { sessionID: parentID, messageID: "msg_3", id: "call_3", agent: "general" }],
        [{ prompt: 42 }, { sessionID: parentID, messageID: "msg_4", id: "call_4", agent: "general" }],
        [{ prompt: "x" }, {}],
        [null, null],
      ]
      for (const [input, context] of malformed) {
        await api.tool.execute(input, context)
      }
      expect(Object.keys(tasks(parentID)).length).toBe(1)

      // An oversized prompt is hashed whole, not thrown.
      await api.tool.execute(
        { prompt: "x".repeat(200_000) },
        { sessionID: "ses_oversized", messageID: "msg_big", id: "call_big", agent: "general" },
      )
      expect(Object.keys(tasks("ses_oversized")).length).toBe(1)
    } finally {
      dispose()
    }
  })

  test("the shared gate refuses this provider on its own, without the review chain", async () => {
    // This module has no review chain at all: every admission here is this
    // provider's. A gate only the chain honoured would leave it open.
    const parentID = "ses_gate_provider"
    const reason = "an unconfirmed abort's ban could not be restored at startup, so this call is not admitted"
    const { api, dispose, call } = await wired({ blocked: (id) => (id === parentID ? reason : null) })
    try {
      await call("summarize the parser", "msg_1", "call_1", parentID)
      const event = assertEvent(parentID, "msg_1", "call_1")
      const decision = await api.permission.evaluate(event)
      expect(decision.effect).toBe("deny")
      expect(decision.reason).toContain("could not be restored")
      expect(event.effect).toBe("deny")
    } finally {
      dispose()
    }
  })

  test("a scoped refusal leaves a session outside its scope admitted", async () => {
    const blocked = "ses_gate_scope_a"
    const outside = "ses_gate_scope_b"
    const reason = "an unconfirmed abort's ban could not be restored at startup, so this call is not admitted"
    const { api, dispose, call } = await wired({ blocked: (id) => (id === blocked ? reason : null) })
    try {
      await call("summarize the parser", "msg_1", "call_1", blocked)
      await call("summarize the parser", "msg_1", "call_1", outside)
      expect((await api.permission.evaluate(assertEvent(blocked, "msg_1", "call_1"))).effect).toBe("deny")
      // The outside session is a normal call: the gate names exactly its scope.
      expect((await api.permission.evaluate(assertEvent(outside, "msg_1", "call_1"))).effect).toBe("allow")
    } finally {
      dispose()
    }
  })

  test("a global refusal leaves no session admitted, not only the recorded ones", async () => {
    const { api, dispose, call } = await wired({
      blocked: () => "the abort operation record is corrupt, so this call is not admitted",
    })
    try {
      const sessionID = "ses_gate_global"
      await call("summarize the parser", "msg_1", "call_1", sessionID)
      const decision = await api.permission.evaluate(assertEvent(sessionID, "msg_1", "call_1"))
      expect(decision.effect).toBe("deny")
      expect(decision.reason).toContain("the abort operation record is corrupt")
    } finally {
      dispose()
    }
  })

  test("a store write failure makes two attempts and leaves the call unresolved", async () => {
    let writes = 0
    let evaluations = 0
    const { api, dispose, call } = await wired({
      evaluate: (input: any, records: any[], sessionBan: any) => {
        evaluations += 1
        return verdict(input, records, sessionBan)
      },
      store: {
        writeTask: () => {
          writes += 1
          throw new Error("disk is full")
        },
      },
    })
    const parentID = "ses_writeretries"
    try {
      await call("summarize the parser", "msg_1", "call_1", parentID)
      expect(writes).toBe(2)

      // The observation failed, so enforcement holds: no allow from a missing entry.
      const event = assertEvent(parentID, "msg_1", "call_1")
      const decision = await api.permission.evaluate(event)
      expect(decision.decision).toBe("hold")
      expect(event.effect).toBe("deny")
      expect(evaluations).toBe(0)
    } finally {
      dispose()
    }
  })
})

// ——— M11: the hook ———

describe("enforcement", () => {
  test("calls the real evaluator once per assert and fails closed", async () => {
    let evaluations = 0
    const { api, dispose, call } = await wired({
      evaluate: (input: any, records: any[], sessionBan: any) => {
        evaluations += 1
        return verdict(input, records, sessionBan)
      },
    })
    const parentID = "ses_enforce"
    try {
      await call("summarize the parser", "msg_1", "call_1", parentID)

      const first = assertEvent(parentID, "msg_1", "call_1")
      const decision = await api.permission.evaluate(first)
      expect(decision.decision).toBe("allow")
      expect(evaluations).toBe(1)
      // An allow is not written onto the event: the other hooks keep their say.
      expect(first.effect).toBe("allow")

      // A duplicate assert re-decides once and returns the first verdict.
      const again = assertEvent(parentID, "msg_1", "call_1")
      const duplicate = await api.permission.evaluate(again)
      expect(duplicate).toEqual(decision)
      expect(evaluations).toBe(2)

      // A missing entry holds, and the effect follows.
      const stranger = assertEvent(parentID, "msg_none", "call_none")
      const missing = await api.permission.evaluate(stranger)
      expect(missing.decision).toBe("hold")
      expect(stranger.effect).toBe("deny")
      expect(evaluations).toBe(2)

      // A missing source holds instead of allowing.
      const sourceless = { ...assertEvent(parentID, "msg_1", "call_1"), source: undefined }
      const bare = await api.permission.evaluate(sourceless)
      expect(bare.decision).toBe("hold")
      expect(sourceless.effect).toBe("deny")

      // An allow never writes the event: an earlier hook's ask survives it.
      const asked = { ...assertEvent(parentID, "msg_1", "call_1"), effect: "ask" }
      expect((await api.permission.evaluate(asked)).decision).toBe("allow")
      expect(asked.effect).toBe("ask")

      // A non-subagent action is left alone.
      const other = { sessionID: parentID, action: "shell", resources: ["x"], effect: "allow" }
      const untouched = await api.permission.evaluate(other)
      expect(untouched.decision).toBe("allow")
      expect(other.effect).toBe("allow")
    } finally {
      dispose()
    }
  })

  test("the verdict is taken in the block that reads the gate, so a queued mark cannot land between them", async () => {
    // The read is the last step before this provider answers the call. A read that
    // queues work is the hazard: if the answer travelled back across an await, that
    // work would run between the read and the verdict, and an abort that started in
    // it would find the call already released. The verdict must be taken in the
    // block that read the gate.
    const parentID = "ses_release_block"
    const { markAbortStarted, abortStarted, resetAbortMarks } = await import("./abort.ts")
    const seen: boolean[] = []
    let reads = 0
    const { api, dispose, call } = await wired({
      blocked: () => {
        reads += 1
        // The second read is the one before the verdict; the first is the entry.
        if (reads === 2) void Promise.resolve().then(() => markAbortStarted([parentID]))
        return null
      },
      evaluate: (input: any, records: any[], sessionBan: any) => {
        seen.push(abortStarted(parentID))
        return rules.verdict(input, records, sessionBan)
      },
    })
    try {
      await call("summarize the parser", "msg_1", "call_1", parentID)
      const event = assertEvent(parentID, "msg_1", "call_1")
      const decision = await api.permission.evaluate(event)
      expect(decision.decision).toBe("allow")
      // Decided before the queued mark ran, and the mark did run.
      expect(seen).toEqual([false])
      expect(abortStarted(parentID)).toBe(true)
    } finally {
      resetAbortMarks()
      dispose()
    }
  })

  test("an abort that lands while the prompt is being read refuses the allow", async () => {
    // readPrompt is an await, and this provider is an admission path of its own:
    // with the chain off it is the only one, so the shared gate is asked again
    // before the verdict's allow can take effect.
    let blocked: string | null = null
    let release: (() => void) | null = null
    let reading: (() => void) | null = null
    const readStarted = new Promise<void>((resolve) => (reading = resolve))
    const gate = new Promise<void>((resolve) => (release = resolve))
    const api = fakeCtx()
    const host = createAdmissionHost({
      ctx: api.ctx,
      blocked: () => blocked,
      readPrompt: async () => {
        reading?.()
        await gate
        return null
      },
    })
    await attach(api.ctx, host)
    const parentID = "ses_await_abort"
    try {
      await api.tool.execute({ prompt: "summarize the parser" }, { sessionID: parentID, messageID: "msg_a", id: "call_a", agent: "general" })
      const event = assertEvent(parentID, "msg_a", "call_a")
      const pending = api.permission.evaluate(event)
      await readStarted
      // The abort begins and its ban lands before the read returns.
      blocked = "an abort covers this session, so this call is not admitted"
      release?.()
      const decision = await pending
      expect(decision.decision).not.toBe("allow")
      expect(event.effect).toBe("deny")
      expect(String(event.message ?? "")).toContain("an abort covers this session")
    } finally {
      host.close()
      api.close()
    }
  })

  test("a discovery hold opened during the prompt read keeps the release waiting", async () => {
    // The entry gate ran before this hold existed, so its answer is stale. The
    // read is the last await before the call is released, and an abort that starts
    // inside it marks only its own session while an undiscovered descendant stays
    // unmarked. The release must wait the hold out and then read the restriction
    // again; releasing on the entry answer would admit the descendant.
    let blocked: string | null = null
    let holding = false
    let holdPromise: Promise<void> | null = null
    let releaseHold: (() => void) | null = null
    let releaseRead: (() => void) | null = null
    let reading: (() => void) | null = null
    const readStarted = new Promise<void>((resolve) => (reading = resolve))
    const readGate = new Promise<void>((resolve) => (releaseRead = resolve))
    const api = fakeCtx()
    const host = createAdmissionHost({
      ctx: api.ctx,
      blocked: () => blocked,
      hold: () => holdPromise ?? Promise.resolve(),
      holdInForce: () => holding,
      readPrompt: async () => {
        reading?.()
        await readGate
        return null
      },
    })
    await attach(api.ctx, host)
    const parentID = "ses_hold_in_read"
    try {
      await api.tool.execute({ prompt: "summarize the parser" }, { sessionID: parentID, messageID: "msg_hr", id: "call_hr", agent: "general" })
      const event = assertEvent(parentID, "msg_hr", "call_hr")
      let settled: any = null
      const pending = api.permission.evaluate(event).then((answer: any) => {
        settled = answer
      })
      await readStarted

      // The abort starts while the prompt is being read.
      holding = true
      holdPromise = new Promise<void>((resolve) => (releaseHold = resolve))
      releaseRead!()
      await new Promise((resolve) => setTimeout(resolve, 20))
      // Waiting, not deciding: the entry answer was read before the hold opened.
      expect(settled).toBeNull()

      // The scan returns and names this descendant.
      blocked = "an abort covers this session, so this call is not admitted"
      holding = false
      releaseHold!()
      await pending
      expect(settled.decision).not.toBe("allow")
      expect(event.effect).toBe("deny")
      expect(String(event.message ?? "")).toContain("an abort covers this session")
    } finally {
      host.close()
      api.close()
    }
  })

  test("an admission waits out a discovery hold instead of admitting inside it", async () => {
    // A pending abort marks only its selected session before the scan, so a
    // descendant's identity is unknown until the listing returns. The gate has
    // nothing to say about it yet, which is exactly why this route must wait.
    let blocked: string | null = null
    let release: (() => void) | null = null
    const discovery = new Promise<void>((resolve) => (release = resolve))
    const { api, dispose, call } = await wired({ blocked: () => blocked, hold: () => discovery })
    const parentID = "ses_discovery_wait"
    try {
      await call("summarize the parser", "msg_w1", "call_w1", parentID)
      const event = assertEvent(parentID, "msg_w1", "call_w1")
      let decision: any = null
      const pending = api.permission.evaluate(event).then((answer: any) => {
        decision = answer
      })
      await new Promise((resolve) => setTimeout(resolve, 20))
      // Nothing decided while the scan is in flight: this is a wait, not a pass.
      expect(decision).toBeNull()

      // The scan ends and the abort's scope now covers this session.
      blocked = "an abort covers this session, so this call is not admitted"
      release!()
      await pending
      expect(decision.decision).not.toBe("allow")
      expect(event.effect).toBe("deny")
      expect(String(event.message ?? "")).toContain("an abort covers this session")
    } finally {
      dispose()
    }
  })

  test("disposing the provider retires a decision that is already in flight", async () => {
    // The call is parked inside its own decision when the handle is disposed. Its
    // generation must be dead by then: a disposed host that still looked current
    // would apply the allow it computed from its own entries instead of refusing
    // or delegating, and the call would run on a provider nobody owns.
    const api = fakeCtx()
    const parentID = "ses_disposed_mid"
    let release: (() => void) | null = null
    let entered = false
    const handle = await start(api.ctx, () => true, {
      readPrompt: async () => {
        entered = true
        await new Promise<void>((resolve) => (release = resolve))
        return null
      },
    })
    const evaluate = api.permission.evaluate
    try {
      await api.tool.execute(
        { prompt: "summarize the parser" },
        { sessionID: parentID, messageID: "msg_killed", id: "call_killed", agent: "general" },
      )
      const event = assertEvent(parentID, "msg_killed", "call_killed")
      let decision: any = null
      const pending = evaluate(event).then((answer: any) => {
        decision = answer
      })
      for (let tick = 0; tick < 200 && !entered; tick++) await sleep(2)
      expect(entered).toBe(true)
      expect(decision).toBeNull()

      // Disposed mid-decision, with no provider registered to replace it.
      handle.dispose()
      expect(handle.attached()).toBe(false)
      expect(handle.enforcing()).toBe(false)
      release!()
      await pending
      expect(decision?.effect).toBe("deny")
      expect(String(decision?.reason)).toContain("enforcement handover is in progress")
      expect(event.effect).toBe("deny")
    } finally {
      api.close()
    }
  })

  test("a provider whose feed failed still refuses a call, and says so", async () => {
    // The permission hook attached, the event feed did not. The full rule needs
    // both, but the permission hook alone can still refuse: a posture that called
    // this provider inactive would contradict the callback in front of it.
    const api = fakeCtx()
    delete api.ctx.event.subscribe
    const handle = await start(api.ctx, () => true)
    try {
      expect(handle.attached()).toBe(false)
      expect(handle.enforcing()).toBe(true)
      const event = assertEvent("ses_feed_lost", "msg_feed", "call_feed")
      const decision = await api.permission.evaluate(event)
      expect(decision.effect).toBe("deny")
      expect(event.effect).toBe("deny")
    } finally {
      handle.dispose()
      api.close()
    }
  })

  test("a hold opened during the wait's own yield keeps the admission waiting", async () => {
    // The depth-zero race at this surface: no hold is open when `enforce` asks,
    // so `hold` returns at once — and the caller's await still yields. The abort
    // below opens its hold in that gap after marking only its own session, so the
    // gate would read clean. The probe must put the admission back to waiting.
    let blocked: string | null = null
    let depth = 0
    let release: (() => void) | null = null
    const hold = async (): Promise<void> => {
      if (depth > 0) await new Promise<void>((resolve) => (release = resolve))
    }
    const { api, dispose, call } = await wired({ blocked: () => blocked, hold, holdInForce: () => depth > 0 })
    const parentID = "ses_gap_wait"
    try {
      await call("summarize the parser", "msg_gap", "call_gap", parentID)
      const event = assertEvent(parentID, "msg_gap", "call_gap")
      let decision: any = null
      const pending = api.permission.evaluate(event).then((answer: any) => {
        decision = answer
      })
      // The abort opens its hold in the gap between the wait and the gate read.
      depth = 1
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(decision).toBeNull()

      blocked = "an abort covers this session, so this call is not admitted"
      depth = 0
      release!()
      await pending
      expect(decision.decision).not.toBe("allow")
      expect(String(event.message ?? "")).toContain("an abort covers this session")
    } finally {
      dispose()
    }
  })

  test("a changed input, read back from the session, holds", async () => {
    let evaluations = 0
    const api = fakeCtx()
    const host = createAdmissionHost({
      ctx: api.ctx,
      readPrompt: async () => "a different task entirely",
      evaluate: (input: any, records: any[], sessionBan: any) => {
        evaluations += 1
        return verdict(input, records, sessionBan)
      },
    })
    await attach(api.ctx, host)
    try {
      await api.tool.execute({ prompt: "summarize the parser" }, { sessionID: "ses_changed", messageID: "msg_9", id: "call_9", agent: "general" })
      const event = assertEvent("ses_changed", "msg_9", "call_9")
      const mismatch = await api.permission.evaluate(event)
      expect(mismatch.decision).toBe("hold")
      expect(event.effect).toBe("deny")
      expect(mismatch.reason).toContain("changed")
      expect(evaluations).toBe(0)
    } finally {
      host.close()
      api.close()
    }
  })
})

// ——— M12: replay ———

describe("replay", () => {
  test("the exact call key denies, a fresh call id with the same fingerprint holds", async () => {
    const { api, host, dispose, call } = await wired({})
    const parentID = "ses_replay"
    const prompt = "summarize the parser"
    try {
      await call(prompt, "msg_1", "call_1", parentID)
      const allowed = await api.permission.evaluate(assertEvent(parentID, "msg_1", "call_1"))
      expect(allowed.decision).toBe("allow")

      // Abort that task: the record now carries the aborted call key.
      await host.abort({ parentID, fingerprint: fingerprint(prompt), scope: "task", by: "user", cause: "interrupt" })

      // The same call key replayed is row 1: deny, before any evidence.
      const replay = assertEvent(parentID, "msg_1", "call_1")
      const denied = await api.permission.evaluate(replay)
      expect(denied.decision).toBe("deny")
      expect(denied.row).toBe("1")
      expect(replay.effect).toBe("deny")

      // A fresh call id with the same fingerprint is row 4: the host is asked,
      // and neither a fabricated approval nor a fabricated frontier on the
      // event lifts it.
      await call(prompt, "msg_2", "call_2", parentID)
      const fresh = { ...assertEvent(parentID, "msg_2", "call_2"), approvedGeneration: 99, frontierNow: 999, frontierSeq: 999 }
      const held = await api.permission.evaluate(fresh)
      expect(held.decision).toBe("hold")
      expect(held.row).toBe("4")
      expect(held.effect).toBe("ask")
      expect(fresh.effect).toBe("ask")
      expect(fresh.message).toMatch(MARKER)

      // A second assert while that prompt is open asks again with the same
      // marker instead of stacking a second deadline.
      const duplicate = assertEvent(parentID, "msg_2", "call_2")
      const again = await api.permission.evaluate(duplicate)
      expect(again.effect).toBe("ask")
      expect(duplicate.message).toBe(fresh.message)

      // A human reject settles it: the next assert is a terminal deny.
      await answer(api, parentID, fresh, "reject")
      await until(() => auditLines(parentID).some((line) => line.event === "hold_rejected"))
      expect((await api.permission.evaluate(assertEvent(parentID, "msg_2", "call_2"))).effect).toBe("deny")
    } finally {
      dispose()
    }
  })
})

// ——— M8: binding, window and containment ———

describe("binder and window", () => {
  test("one open admission binds the child it created", async () => {
    const { api, dispose, call } = await wired()
    const parentID = "ses_bind_one"
    try {
      await call("summarize the parser", "msg_1", "call_1", parentID)
      await api.permission.evaluate(assertEvent(parentID, "msg_1", "call_1"))
      await api.feed({
        type: "session.created",
        data: { sessionID: "ses_child_a", parentID },
        created: Date.now(),
      })
      const record = Object.values(tasks(parentID))[0]
      expect(record.childIDs).toEqual(["ses_child_a"])
      expect(auditLines(parentID).filter((line) => line.event === "bind" && line.childID === "ses_child_a").length).toBe(1)
    } finally {
      dispose()
    }
  })

  test("two open admissions make an unbound child ambiguous and preserved", async () => {
    const { api, host, dispose, call } = await wired({})
    const parentID = "ses_bind_two"
    try {
      await call("summarize the parser", "msg_1", "call_1", parentID)
      await call("write the changelog", "msg_2", "call_2", parentID)
      expect((await api.permission.evaluate(assertEvent(parentID, "msg_1", "call_1"))).effect).toBe("allow")
      expect((await api.permission.evaluate(assertEvent(parentID, "msg_2", "call_2"))).effect).toBe("allow")

      await api.feed({ type: "session.created", data: { sessionID: "ses_ambiguous", parentID }, created: Date.now() })

      await host.abort({ parentID, fingerprint: fingerprint("summarize the parser"), scope: "task", by: "user", cause: "interrupt" })
      expect(api.interrupts).toEqual([])
      expect(auditLines(parentID).some((line) => line.event === "ambiguous_child_preserved" && line.childID === "ses_ambiguous")).toBe(true)

      // Exactly the aborted task's call settles deny; the sibling keeps its allow.
      const revoked = auditLines(parentID).filter((line) => line.event === "deny" && String(line.detail ?? "").includes("revocation:abort"))
      expect(revoked.map((line) => line.callID)).toEqual([callKey(parentID, "msg_1", "call_1")])
      const sibling = await api.permission.evaluate(assertEvent(parentID, "msg_2", "call_2"))
      expect(sibling.decision).toBe("allow")
    } finally {
      dispose()
    }
  })

  test("an in-window unbound child with no other admission is interrupted, outside the window preserved", async () => {
    const parentID = "ses_window"
    const api = fakeCtx()
    const host = createAdmissionHost({ ctx: api.ctx, graceMs: 2000, capMs: 60000 })
    const prompt = "summarize the parser"
    const key = fingerprint(prompt)
    try {
      const minted = Date.now()
      host.observe(observe(parentID, "msg_1", "call_1", prompt))
      // Created while the call is open; the after hook never runs.
      host.created({ type: "session.created", data: { sessionID: "ses_inwindow", parentID }, created: minted + 500 })
      // Long after the window, must survive.
      host.created({ type: "session.created", data: { sessionID: "ses_late", parentID }, created: minted + 120000 })

      await host.abort({ parentID, fingerprint: key, scope: "task", by: "user", cause: "interrupt" })

      expect(api.interrupts).toEqual(["ses_inwindow"])
      const lines = auditLines(parentID)
      expect(lines.some((line) => line.event === "bind" && line.childID === "ses_inwindow")).toBe(true)
      expect(lines.some((line) => line.event === "ambiguous_child_preserved" && line.childID === "ses_late")).toBe(true)
    } finally {
      host.close()
      api.close()
    }
  })
})

// ——— M13: degraded frontier and repair ———

describe("degraded frontier", () => {
  test("a live tombstone holds parent-wide, and repair releases only the call that no longer matches", async () => {
    const timers: { fn: () => void; ms: number }[] = []
    const { api, host, dispose, call } = await wired({
      schedule: (fn: () => void, ms: number) => {
        timers.push({ fn, ms })
        return timers.length
      },
      repair: () => false,
    })
    const parentID = "ses_degraded"
    const prompt = "summarize the parser"
    try {
      // A live tombstone exists for one task.
      await call(prompt, "msg_1", "call_1", parentID)
      await host.abort({ parentID, fingerprint: fingerprint(prompt), scope: "task", by: "user", cause: "interrupt" })

      // The feed fails: the frontier is unreadable, so everything in the parent holds.
      host.frontierFailed(parentID, "frontier_unavailable")

      // An unrelated call holds too, and says so.
      await call("write the changelog", "msg_2", "call_2", parentID)
      const unrelated = assertEvent(parentID, "msg_2", "call_2")
      const held = await api.permission.evaluate(unrelated)
      expect(held.effect).toBe("ask")
      expect(unrelated.effect).toBe("ask")
      const degraded = auditLines(parentID).filter((line) => line.event === "degraded_hold")
      expect(degraded.length).toBe(1)
      expect(degraded[0].detail).toContain("frontier_unavailable")

      // Four retries at 250 ms, 1 s, 4 s and 15 s, then no fifth. The hold
      // deadline is a separate timer of this host, not part of that budget.
      const delays: number[] = []
      // The live array: each retry appends its successor while this runs, and
      // the hold deadline (a longer timer) is not part of that budget.
      for (let at = 0; at < timers.length; at++) {
        if (timers[at].ms > 15_000) continue
        delays.push(timers[at].ms)
        timers[at].fn()
      }
      expect(delays).toEqual([250, 1000, 4000, 15000])

      // A call that still matches the live tombstone holds, and repair keeps it held.
      await call(prompt, "msg_3", "call_3", parentID)
      const matching = assertEvent(parentID, "msg_3", "call_3")
      const stillHeld = await api.permission.evaluate(matching)
      expect(stillHeld.effect).toBe("ask")
      const admitted = auditLines(parentID).filter((line) => line.event === "admit").length

      // Repair: the unrelated call no longer matches a live tombstone, so it is
      // released. Nothing is replayed as a new admission.
      host.frontierRepaired(parentID)
      expect(auditLines(parentID).some((line) => line.event === "evidence_repaired")).toBe(true)
      expect((await api.permission.evaluate(assertEvent(parentID, "msg_2", "call_2"))).decision).toBe("allow")
      expect(auditLines(parentID).filter((line) => line.event === "admit").length).toBe(admitted)

      // The matching call is still held: repair releases only what no longer matches.
      const again = assertEvent(parentID, "msg_3", "call_3")
      expect((await api.permission.evaluate(again)).effect).toBe("ask")
      await answer(api, parentID, matching, "reject")
      await until(() => auditLines(parentID).some((line) => line.event === "hold_rejected"))
      expect((await api.permission.evaluate(assertEvent(parentID, "msg_3", "call_3"))).effect).toBe("deny")
    } finally {
      dispose()
    }
  })

  test("a later allow reports the row that just decided, not the first one", async () => {
    const { api, host, dispose, call } = await wired({
      schedule: () => 1,
      repair: () => false,
    })
    const parentID = "ses_rows"
    try {
      await call("summarize the parser", "msg_1", "call_1", parentID)

      // No tombstone and a clean audit: an unreadable frontier still admits,
      // at row 10.
      host.frontierFailed(parentID, "frontier_unavailable")
      const first = await api.permission.evaluate(assertEvent(parentID, "msg_1", "call_1"))
      expect(first.decision).toBe("allow")
      expect(first.row).toBe("10")

      // Once the frontier is readable the same call admits at row none, and the
      // reported row must be the fresh one: the row is what the audit records.
      host.frontierRepaired(parentID)
      const again = await api.permission.evaluate(assertEvent(parentID, "msg_1", "call_1"))
      expect(again.decision).toBe("allow")
      expect(again.row).toBe("none")
      expect(again.reason).toContain("never aborted")
    } finally {
      dispose()
    }
  })

  test("a repeated failure extends one chain, and a parent born degraded gets a budget", async () => {
    const delays: number[] = []
    const pending: (() => void)[] = []
    const host = createAdmissionHost({
      ctx: fakeCtx().ctx,
      schedule: (fn: () => void, ms: number) => {
        delays.push(ms)
        pending.push(fn)
        return delays.length
      },
      repair: () => false,
    })
    try {
      // The same dead feed reports twice: one chain, not two.
      host.frontierFailed("ses_repeat", "feed stopped")
      host.frontierFailed("ses_repeat", "feed stopped")
      expect(delays).toEqual([250])

      // A parent created after the feed died has no failure event of its own.
      host.feedFailed("feed stopped")
      host.userItem("ses_born_degraded", 1)
      expect(delays).toEqual([250, 250])

      // Two parents, one chain each: every delay appears exactly twice.
      while (pending.length) pending.shift()!()
      const tally = delays.reduce<Record<number, number>>((all, ms) => ({ ...all, [ms]: (all[ms] ?? 0) + 1 }), {})
      expect(tally).toEqual({ 250: 2, 1000: 2, 4000: 2, 15000: 2 })
    } finally {
      host.close()
    }
  })

  test("the repair schedule is the design's exact backoff, four attempts only", async () => {
    const delays: number[] = []
    const pending: (() => void)[] = []
    const host = createAdmissionHost({
      ctx: fakeCtx().ctx,
      schedule: (fn: () => void, ms: number) => {
        delays.push(ms)
        pending.push(fn)
        return delays.length
      },
      repair: () => false,
    })
    try {
      host.frontierFailed("ses_schedule", "frontier_unavailable")
      while (pending.length) pending.shift()!()
      expect(delays).toEqual([250, 1000, 4000, 15000])
    } finally {
      host.close()
    }
  })
})

// ——— the store's read errors: ENOENT is missing, anything else holds ———

describe("unreadable evidence", () => {
  test("an unreadable snapshot is not overwritten by a later admission", async () => {
    const { api, dispose, call } = await wired()
    const parentID = "ses_unreadable_snapshot"
    const prompt = "summarize the parser"
    try {
      // A live tombstone on disk, then the file becomes unreadable.
      await call(prompt, "msg_1", "call_1", parentID)
      await api.permission.evaluate(assertEvent(parentID, "msg_1", "call_1"))
      const snapshot = store.parentPaths(parentID).snapshot
      const original = readFileSync(snapshot, "utf8")
      chmodSync(snapshot, 0o000)

      await call("write the changelog", "msg_2", "call_2", parentID)
      const blocked = assertEvent(parentID, "msg_2", "call_2")
      const decision = await api.permission.evaluate(blocked)
      expect(decision.decision).toBe("hold")
      expect(blocked.effect).toBe("deny")

      // The file still holds what it held: no blank snapshot replaced it.
      chmodSync(snapshot, 0o600)
      expect(readFileSync(snapshot, "utf8")).toBe(original)
    } finally {
      dispose()
    }
  })

  test("a user turn does not overwrite an unreadable snapshot", async () => {
    const { api, dispose, call } = await wired({})
    const parentID = "ses_unreadable_frontier"
    try {
      await call("summarize the parser", "msg_1", "call_1", parentID)
      const snapshot = store.parentPaths(parentID).snapshot
      const original = readFileSync(snapshot, "utf8")
      chmodSync(snapshot, 0o000)

      await api.feed({
        type: "session.inbox.enqueued",
        durable: { aggregateID: parentID, seq: 1 },
        data: { item: { type: "user" } },
      })
      await sleep(20)

      chmodSync(snapshot, 0o600)
      expect(readFileSync(snapshot, "utf8")).toBe(original)
    } finally {
      dispose()
    }
  })

  test("an unreadable audit is evidence, not a clean log", async () => {
    const parentID = "ses_unreadable_audit"
    const api = fakeCtx()
    const host = createAdmissionHost({ ctx: api.ctx })
    try {
      // An audit path that exists but cannot be read, and a frontier that is
      // unavailable: a clean audit would admit under row 10.
      const paths = store.parentPaths(parentID)
      mkdirSync(paths.audit, { recursive: true })

      host.observe(observe(parentID, "msg_1", "call_1", "summarize the parser"))
      host.frontierFailed(parentID, "frontier_unavailable")
      const event = assertEvent(parentID, "msg_1", "call_1")
      const decision = await host.enforce(event)
      // Unreadable evidence holds; a clean log with no tombstone would admit.
      expect(decision.decision).toBe("hold")
      expect(decision.row).toBe("9")
      expect(decision.effect).toBe("ask")
      expect(event.effect).toBe("ask")
      expect(event.message).toMatch(MARKER)
    } finally {
      host.close()
      api.close()
    }
  })
})

// ——— the lock takeover choice ———

describe("lock", () => {
  test("a stale lock with a live holder is not preempted, one with a dead holder is", async () => {
    const { api, dispose, call } = await wired()
    const parentID = "ses_lock"
    const lock = `${store.parentPaths(parentID).snapshot}.lock`
    mkdirSync(dirname(lock), { recursive: true })
    try {
      // Older than the stale window, holder alive: the host refuses the mutation
      // rather than race a writer that could still write after the takeover.
      writeFileSync(lock, `${process.pid} ${Date.now() - 60_000} tok`)
      await call("summarize the parser", "msg_1", "call_1", parentID)
      const blocked = assertEvent(parentID, "msg_1", "call_1")
      const held = await api.permission.evaluate(blocked)
      expect(held.decision).toBe("hold")
      expect(blocked.effect).toBe("deny")

      // 6.2 s with a live holder: the store's second wait would push past the
      // stale window and preempt, so the host must refuse before 6 s.
      writeFileSync(lock, `${process.pid} ${Date.now() - 6_200} tok`)
      await call("summarize the parser", "msg_3", "call_3", parentID)
      const banded = assertEvent(parentID, "msg_3", "call_3")
      expect((await api.permission.evaluate(banded)).decision).toBe("hold")
      expect(banded.effect).toBe("deny")
      expect(tasks(parentID)["msg_3"]).toBeUndefined()

      // 5.5 s is inside the host's safe band, so the store's own budget is what
      // holds it: two waits expire before the stale window.
      writeFileSync(lock, `${process.pid} ${Date.now() - 5_500} tok`)
      await call("summarize the parser", "msg_5", "call_5", parentID)
      const inside = assertEvent(parentID, "msg_5", "call_5")
      expect((await api.permission.evaluate(inside)).decision).toBe("hold")
      expect(inside.effect).toBe("deny")

      // Older than the stale window, holder gone: the store's takeover applies.
      writeFileSync(lock, `4000000 ${Date.now() - 60_000} tok`)
      await call("summarize the parser", "msg_2", "call_2", parentID)
      const allowed = await api.permission.evaluate(assertEvent(parentID, "msg_2", "call_2"))
      expect(allowed.decision).toBe("allow")
    } finally {
      rmSync(lock, { force: true })
      dispose()
    }
  })
})

// ——— the hold: the host's own prompt, correlated and settled ———

/** One aborted task, then a replacement call that holds and returns its event. */
async function openHold(host: any, call: any, parentID: string, prompt = "summarize the parser") {
  await call(prompt, "msg_1", "call_1", parentID)
  await host.enforce(assertEvent(parentID, "msg_1", "call_1"))
  await host.abort({ parentID, fingerprint: fingerprint(prompt), scope: "task", by: "user", cause: "interrupt" })
  await call(prompt, "msg_2", "call_2", parentID)
  const event = assertEvent(parentID, "msg_2", "call_2")
  const decision = await host.enforce(event)
  return { event, decision }
}

/**
 * A held call whose third assert of the same key is admitted, so the prompt its
 * hold opened is granted instead of left for a stale reject.
 */
async function wiredGrant() {
  let calls = 0
  return wired({
    evaluate: (input: any, records: any[], sessionBan: any) => {
      calls += 1
      return calls <= 2
        ? verdict(input, records, sessionBan)
        : { effect: "allow", row: "5", reason: "the same task, after a user turn", generation: 2, retire: false }
    },
  })
}

describe("hold and settlement", () => {
  test("a hold asks the host and writes the call key digest onto the event", async () => {
    const { api, host, dispose, call } = await wired({})
    const parentID = "ses_hold_ask"
    try {
      const { event, decision } = await openHold(host, call, parentID)
      // The hook returns at once: the human answers the host's own prompt.
      expect(decision.decision).toBe("hold")
      expect(decision.effect).toBe("ask")
      expect(event.effect).toBe("ask")
      expect(event.message).toMatch(MARKER)
      expect(event.message).toContain("the same task, before any user turn")
      // Nothing is denied, and Jev issues no reply of its own at hold time.
      expect(api.replies).toEqual([])
      expect(auditLines(parentID).filter((line) => line.event === "hold").length).toBe(1)
      // The abort's revocation is the only deny on record; the hold denies nothing.
      expect(deniedCalls(parentID)).toEqual([callKey(parentID, "msg_1", "call_1")])
    } finally {
      dispose()
    }
  })

  test("an ask becomes this hold's pending id only when the marker and session match", async () => {
    const { api, host, dispose, call } = await wired({})
    const parentID = "ses_hold_correlate"
    try {
      const { event } = await openHold(host, call, parentID)
      const foreign = nextPerId()
      // Another hook's prompt, and this marker sent for another session.
      await api.feed(askedFrame(parentID, "shell: run the migration", foreign))
      await api.feed(askedFrame("ses_elsewhere", event.message, nextPerId()))
      await api.feed(repliedFrame(parentID, foreign, "once"))
      // Neither settles this hold: it is still open and still asks.
      expect(auditLines(parentID).some((line) => line.event === "hold_approved")).toBe(false)
      expect((await api.permission.evaluate(assertEvent(parentID, "msg_2", "call_2"))).effect).toBe("ask")

      // The right marker in the right session answers it.
      const id = await answer(api, parentID, event, "reject")
      await until(() => auditLines(parentID).some((line) => line.event === "hold_rejected"))
      const line = auditLines(parentID).find((item) => item.event === "hold_rejected")
      expect(line.perId).toBe(id)
    } finally {
      dispose()
    }
  })

  test("once mints the approval generation, and a duplicate assert returns it", async () => {
    const { api, host, dispose, call } = await wired({})
    const parentID = "ses_hold_once"
    const prompt = "summarize the parser"
    try {
      const { event } = await openHold(host, call, parentID)
      await answer(api, parentID, event, "once")
      await until(() => auditLines(parentID).some((line) => line.event === "hold_approved"))

      const record = tasks(parentID)[fingerprint(prompt)]
      expect(record.generation).toBe(2)
      // The approved call key belongs to the new generation, not the tombstone.
      expect(record.callKeys).toEqual([callKey(parentID, "msg_1", "call_1")])

      const duplicate = await api.permission.evaluate(assertEvent(parentID, "msg_2", "call_2"))
      expect(duplicate.decision).toBe("allow")
      expect(duplicate.generation).toBe(2)
      // One generation, one approval line, one prompt.
      expect(auditLines(parentID).filter((line) => line.event === "hold_approved").length).toBe(1)
    } finally {
      dispose()
    }
  })

  test("calls whose identity parts join to the same string never share an entry", async () => {
    // Joined with a separator, `b|c` + `d` and `b` + `c|d` are one string, so a
    // concatenated key would let the second call find the first one's approved
    // entry and replay its answer without the fingerprint check. The key is one
    // JSON array of the parts, so the two calls stay two calls.
    const { api, host, dispose, call } = await wired({})
    const parentID = "ses_identity_collide"
    const prompt = "summarize the parser"
    try {
      await call(prompt, "msg_1", "call_1", parentID)
      await host.enforce(assertEvent(parentID, "msg_1", "call_1"))
      await host.abort({ parentID, fingerprint: fingerprint(prompt), scope: "task", by: "user", cause: "interrupt" })

      // One call is held and approved by the human.
      await call(prompt, "b|c", "d", parentID)
      const approved = assertEvent(parentID, "b|c", "d")
      expect((await host.enforce(approved)).decision).toBe("hold")
      await answer(api, parentID, approved, "once")
      await until(() => auditLines(parentID).some((line) => line.event === "hold_approved"))

      // The other call must not inherit that approval.
      await call(prompt, "b", "c|d", parentID)
      const other = assertEvent(parentID, "b", "c|d")
      const decision = await host.enforce(other)
      // It is a first-time call: the host asks the human. Under a concatenated
      // key it would be an allow replays of the approved call.
      expect(decision.decision).toBe("hold")
      expect(other.effect).toBe("ask")

      // The key itself: an array of the parts, and only strings identify a call.
      expect(callKey("ses_id", "b|c", "d")).not.toBe(callKey("ses_id", "b", "c|d"))
      expect(callKey("ses_id", 1 as any, "d")).toBe("")
      expect(callKey("ses_id", "b", { nested: 1 } as any)).toBe("")
      expect(callKey("", "b", "d")).toBe("")
    } finally {
      dispose()
    }
  })

  test("always mints for this call but is audited as a downgrade, so nothing persists", async () => {
    const { api, host, dispose, call } = await wired({})
    const parentID = "ses_hold_always"
    const prompt = "summarize the parser"
    try {
      const { event } = await openHold(host, call, parentID)
      await answer(api, parentID, event, "always")
      await until(() => auditLines(parentID).some((line) => line.event === "hold_always_downgraded"))

      const line = auditLines(parentID).find((item) => item.event === "hold_always_downgraded")
      expect(line.detail).toContain("no save was passed")
      expect(tasks(parentID)[fingerprint(prompt)].generation).toBe(2)
      // The settled call is admitted; a new call key for the same task asks
      // again, because Jev passed no `save` and `always` is not a standing grant.
      expect((await api.permission.evaluate(assertEvent(parentID, "msg_2", "call_2"))).decision).toBe("allow")
      await call(prompt, "msg_3", "call_3", parentID)
      expect((await api.permission.evaluate(assertEvent(parentID, "msg_3", "call_3"))).effect).toBe("ask")
      expect(auditLines(parentID).some((item) => item.event === "hold_approved")).toBe(false)
    } finally {
      dispose()
    }
  })

  test("reject settles a terminal deny", async () => {
    const { api, host, dispose, call } = await wired({})
    const parentID = "ses_hold_reject"
    try {
      const { event } = await openHold(host, call, parentID)
      const id = await answer(api, parentID, event, "reject")
      await until(() => auditLines(parentID).some((line) => line.event === "hold_rejected"))
      expect(auditLines(parentID).find((line) => line.event === "hold_rejected").perId).toBe(id)

      const after = await api.permission.evaluate(assertEvent(parentID, "msg_2", "call_2"))
      // The table verdict stays a hold; the human's reject is the effect.
      expect(after.effect).toBe("deny")
      expect(after.generation).toBeNull()
    } finally {
      dispose()
    }
  })

  test("a grant reply that throws is audited as unobserved, never a host refusal", async () => {
    const { api, host, dispose, call } = await wiredGrant()
    const parentID = "ses_grant_threw"
    try {
      const { event } = await openHold(host, call, parentID)
      const id = nextPerId()
      await api.feed(askedFrame(parentID, event.message, id))
      api.ctx.permission.reply = async (input: any) => {
        api.replies.push(input)
        throw new Error("the transport failed")
      }
      expect((await api.permission.evaluate(assertEvent(parentID, "msg_2", "call_2"))).decision).toBe("allow")
      await until(() => auditLines(parentID).some((item) => item.event === "hold_uncancellable"))

      // The once was attempted once; nothing about its outcome was observed.
      expect(api.replies).toHaveLength(1)
      expect(api.replies[0]).toMatchObject({ sessionID: parentID, requestID: id, decision: "once" })
      const line = auditLines(parentID).find((item) => item.event === "hold_uncancellable")
      expect(String(line?.detail)).toContain("the call was admitted; no reply outcome was observed")
      expect(String(line?.detail)).not.toContain("refused")
      // The prompt was not closed by a refusal that never happened: the record
      // still stands for the next abort, which observes the same nothing.
      expect(await revokeOpenPrompts([parentID])).toEqual({
        revoked: 0,
        failed: 0,
        unconfirmed: 1,
        unsupported: 0,
        openDetail: [{ requestID: id, reason: "no-outcome" }],
      })
    } finally {
      resetOpenPrompts()
      dispose()
    }
  })

  test("a host with no reply primitive grants nothing and says the outcome was unobserved", async () => {
    const { api, host, dispose, call } = await wiredGrant()
    const parentID = "ses_grant_unsupported"
    try {
      const { event } = await openHold(host, call, parentID)
      const id = nextPerId()
      await api.feed(askedFrame(parentID, event.message, id))
      delete (api.ctx.permission as any).reply
      expect((await api.permission.evaluate(assertEvent(parentID, "msg_2", "call_2"))).decision).toBe("allow")
      await until(() => auditLines(parentID).some((item) => item.event === "hold_uncancellable"))

      // No call reached the host, so the audit says nothing was observed.
      expect(api.replies).toEqual([])
      const line = auditLines(parentID).find((item) => item.event === "hold_uncancellable")
      expect(String(line?.detail)).toContain("the call was admitted; no reply outcome was observed")
      expect(String(line?.detail)).not.toContain("refused")
    } finally {
      resetOpenPrompts()
      dispose()
    }
  })

  test("a grant reply the host declined keeps the refused wording", async () => {
    const { api, host, dispose, call } = await wiredGrant()
    const parentID = "ses_grant_refused"
    try {
      const { event } = await openHold(host, call, parentID)
      const id = nextPerId()
      await api.feed(askedFrame(parentID, event.message, id))
      // The host took the call and answered `false`: the one observed refusal.
      api.ctx.permission.reply = async () => false
      expect((await api.permission.evaluate(assertEvent(parentID, "msg_2", "call_2"))).decision).toBe("allow")
      await until(() => auditLines(parentID).some((item) => item.event === "hold_uncancellable"))

      const line = auditLines(parentID).find((item) => item.event === "hold_uncancellable")
      expect(String(line?.detail)).toContain("the call was admitted; the self-reply was refused")
    } finally {
      resetOpenPrompts()
      dispose()
    }
  })

  test("a grant the host takes closes the prompt with no audit", async () => {
    const { api, host, dispose, call } = await wiredGrant()
    const parentID = "ses_grant_closed"
    try {
      const { event } = await openHold(host, call, parentID)
      const id = nextPerId()
      await api.feed(askedFrame(parentID, event.message, id))
      expect((await api.permission.evaluate(assertEvent(parentID, "msg_2", "call_2"))).decision).toBe("allow")
      // The grant is fire-and-forget: the reply lands a tick later, so the
      // negative audit check waits for the reply first.
      await until(() => api.replies.length === 1)

      expect(api.replies[0]).toMatchObject({ sessionID: parentID, requestID: id, decision: "once" })
      expect(auditLines(parentID).some((item) => item.event === "hold_uncancellable")).toBe(false)
      // The host took the grant, so no prompt of this session is left to find.
      expect(await revokeOpenPrompts([parentID])).toEqual({
        revoked: 0,
        failed: 0,
        unconfirmed: 0,
        unsupported: 0,
        openDetail: [],
      })
    } finally {
      resetOpenPrompts()
      dispose()
    }
  })

  test("the deadline self-rejects a solo request with a message and audits hold_expired", async () => {
    const timers: { fn: () => void; ms: number }[] = []
    const { api, host, dispose, call } = await wired({
      holdMs: 60_000,
      schedule: (fn: () => void, ms: number) => {
        timers.push({ fn, ms })
        return timers.length
      },
    })
    const parentID = "ses_hold_expire"
    try {
      const { event } = await openHold(host, call, parentID)
      const id = nextPerId()
      await api.feed(askedFrame(parentID, event.message, id))
      expect(timers.map((timer) => timer.ms)).toEqual([60_000])

      // Its own request is the only pending one, so the timer may reject it.
      api.pending = [{ id, sessionID: parentID, action: SUBAGENT, resources: ["general"], message: event.message }]
      timers[0].fn()
      await until(() => auditLines(parentID).some((line) => line.event === "hold_expired"))

      expect(api.replies.length).toBe(1)
      expect(api.replies[0]).toMatchObject({ sessionID: parentID, requestID: id, decision: "reject" })
      expect(api.replies[0].message).toContain("expired after 60000 ms")
      expect(auditLines(parentID).find((line) => line.event === "hold_expired").perId).toBe(id)
      // The ordinary expiry is the one deny Jev owns, and the wording says so.
      expect(String(auditLines(parentID).find((line) => line.event === "hold_expired").detail)).toContain(
        "Jev rejected the call",
      )

      // The host's frame for Jev's own reject carries no author: it must not be
      // read back as a human's answer.
      await api.feed(repliedFrame(parentID, id, "reject"))
      expect(auditLines(parentID).filter((line) => line.event === "hold_expired").length).toBe(1)
      expect(auditLines(parentID).filter((line) => line.event === "hold_rejected").length).toBe(0)
      expect((await api.permission.evaluate(assertEvent(parentID, "msg_2", "call_2"))).effect).toBe("deny")
    } finally {
      dispose()
    }
  })

  test("a hold after a stale allow still expires", async () => {
    const timers: { fn: () => void; ms: number }[] = []
    const { api, host, dispose, call } = await wired({
      holdMs: 60_000,
      schedule: (fn: () => void, ms: number) => {
        timers.push({ fn, ms })
        return timers.length
      },
    })
    const parentID = "ses_hold_stale_allow"
    try {
      // A call admitted once, then re-decided under a dead feed: the entry keeps
      // the old allow beside the new hold, and the deadline must still settle.
      await call("summarize the parser", "msg_1", "call_1", parentID)
      expect((await api.permission.evaluate(assertEvent(parentID, "msg_1", "call_1"))).decision).toBe("allow")
      await call("write the changelog", "msg_2", "call_2", parentID)
      await api.permission.evaluate(assertEvent(parentID, "msg_2", "call_2"))
      await host.abort({ parentID, fingerprint: fingerprint("write the changelog"), scope: "task", by: "user", cause: "interrupt" })
      host.feedFailed("frontier_unavailable")
      const event = assertEvent(parentID, "msg_1", "call_1")
      expect((await api.permission.evaluate(event)).effect).toBe("ask")

      const id = nextPerId()
      await api.feed(askedFrame(parentID, event.message, id))
      api.pending = [{ id, sessionID: parentID, action: SUBAGENT, resources: ["general"], message: event.message }]
      timers.find((timer) => timer.ms === 60_000)!.fn()
      await until(() => auditLines(parentID).some((line) => line.event === "hold_expired"))

      expect(api.replies.length).toBe(1)
      expect(api.replies[0]).toMatchObject({ sessionID: parentID, requestID: id, decision: "reject" })
      expect((await api.permission.evaluate(assertEvent(parentID, "msg_1", "call_1"))).effect).toBe("deny")
    } finally {
      dispose()
    }
  })

  test("a second pending permission in the session skips the self-reject", async () => {
    const timers: { fn: () => void; ms: number }[] = []
    const { api, host, dispose, call } = await wired({
      holdMs: 60_000,
      schedule: (fn: () => void, ms: number) => {
        timers.push({ fn, ms })
        return timers.length
      },
    })
    const parentID = "ses_hold_fanout"
    try {
      const { event } = await openHold(host, call, parentID)
      const id = nextPerId()
      await api.feed(askedFrame(parentID, event.message, id))
      // A reject on this host rejects every pending permission in the session,
      // so a bystander keeps Jev's timer from firing one.
      api.pending = [
        { id, sessionID: parentID, action: SUBAGENT, resources: ["general"], message: event.message },
        { id: nextPerId(), sessionID: parentID, action: "shell", resources: ["bash"] },
      ]
      timers[0].fn()
      await until(() => auditLines(parentID).some((line) => line.event === "hold_fanout_skipped"))

      expect(api.replies).toEqual([])
      expect(auditLines(parentID).some((line) => line.event === "hold_expired")).toBe(false)
      expect(auditLines(parentID).find((line) => line.event === "hold_fanout_skipped").detail).toContain("1 other pending permission")
      // Not reported as denied: the hold stands and the next assert still asks.
      expect((await api.permission.evaluate(assertEvent(parentID, "msg_2", "call_2"))).effect).toBe("ask")
      expect(deniedCalls(parentID)).toEqual([callKey(parentID, "msg_1", "call_1")])
    } finally {
      dispose()
    }
  })

  test("a human reject during the parked expiry stands, with no Jev-rejected line", async () => {
    const timers: { fn: () => void; ms: number }[] = []
    const { api, host, dispose, call } = await wired({
      holdMs: 60_000,
      schedule: (fn: () => void, ms: number) => {
        timers.push({ fn, ms })
        return timers.length
      },
    })
    const parentID = "ses_expire_human_reject"
    try {
      const { event } = await openHold(host, call, parentID)
      const id = nextPerId()
      await api.feed(askedFrame(parentID, event.message, id))
      const pending = [{ id, sessionID: parentID, action: SUBAGENT, resources: ["general"], message: event.message }]
      // Park the expiry's one yield: the pending-list read.
      let releaseList: (() => void) | null = null
      api.ctx.permission.list = async () => {
        await new Promise<void>((resolve) => {
          releaseList = resolve
        })
        return pending
      }
      timers[0].fn()
      for (let turn = 0; turn < 400 && !releaseList; turn++) await sleep(2)

      await api.feed(repliedFrame(parentID, id, "reject"))
      releaseList!()
      await until(() => auditLines(parentID).some((line) => line.event === "hold_rejected"))
      await sleep(10)

      // The human's reject is the settlement. Jev sent no reply and expired
      // nothing, so no line may claim either.
      expect(api.replies).toEqual([])
      const line = auditLines(parentID).find((item) => item.event === "hold_rejected")
      expect(String(line?.detail)).toContain("a human rejected the call")
      expect(auditLines(parentID).some((item) => item.event === "hold_expired")).toBe(false)
      expect((await api.permission.evaluate(assertEvent(parentID, "msg_2", "call_2"))).effect).toBe("deny")
    } finally {
      resetOpenPrompts()
      dispose()
    }
  })

  test("a human once during the parked expiry mints, and the deny never lands", async () => {
    const timers: { fn: () => void; ms: number }[] = []
    const { api, host, dispose, call } = await wired({
      holdMs: 60_000,
      schedule: (fn: () => void, ms: number) => {
        timers.push({ fn, ms })
        return timers.length
      },
    })
    const parentID = "ses_expire_human_once"
    const prompt = "summarize the parser"
    try {
      const { event } = await openHold(host, call, parentID)
      const id = nextPerId()
      await api.feed(askedFrame(parentID, event.message, id))
      const pending = [{ id, sessionID: parentID, action: SUBAGENT, resources: ["general"], message: event.message }]
      let releaseList: (() => void) | null = null
      api.ctx.permission.list = async () => {
        await new Promise<void>((resolve) => {
          releaseList = resolve
        })
        return pending
      }
      timers[0].fn()
      for (let turn = 0; turn < 400 && !releaseList; turn++) await sleep(2)

      await api.feed(repliedFrame(parentID, id, "once"))
      await until(() => auditLines(parentID).some((line) => line.event === "hold_approved"))
      releaseList!()
      await sleep(20)

      // The approval is the settlement: it mints, the expiry fabricates
      // nothing, and no reply of Jev's was ever sent.
      expect(api.replies).toEqual([])
      const line = auditLines(parentID).find((item) => item.event === "hold_approved")
      expect(String(line?.detail)).toContain("generation 2")
      expect(auditLines(parentID).some((item) => item.event === "hold_expired")).toBe(false)
      expect(tasks(parentID)[fingerprint(prompt)].generation).toBe(2)
      const after = await api.permission.evaluate(assertEvent(parentID, "msg_2", "call_2"))
      expect(after.effect).toBe("allow")
      expect(after.generation).toBe(2)
    } finally {
      resetOpenPrompts()
      dispose()
    }
  })

  test("a once the covering gate refuses keeps its refusal line, and the expiry claims nothing", async () => {
    const timers: { fn: () => void; ms: number }[] = []
    let covering = false
    const { api, host, dispose, call } = await wired({
      holdMs: 60_000,
      schedule: (fn: () => void, ms: number) => {
        timers.push({ fn, ms })
        return timers.length
      },
      blocked: () => (covering ? "a covering refusal is in force" : null),
    })
    const parentID = "ses_expire_gate_refused"
    try {
      const { event } = await openHold(host, call, parentID)
      const id = nextPerId()
      await api.feed(askedFrame(parentID, event.message, id))
      const pending = [{ id, sessionID: parentID, action: SUBAGENT, resources: ["general"], message: event.message }]
      let releaseList: (() => void) | null = null
      api.ctx.permission.list = async () => {
        await new Promise<void>((resolve) => {
          releaseList = resolve
        })
        return pending
      }
      timers[0].fn()
      for (let turn = 0; turn < 400 && !releaseList; turn++) await sleep(2)

      covering = true
      await api.feed(repliedFrame(parentID, id, "once"))
      // The covering gate decides at once, so the refusal line lands during
      // the park: the once's fate is on the record before the expiry resumes.
      await until(() => auditLines(parentID).some((item) => item.event === "hold_reply_refused"))
      releaseList!()
      await sleep(20)

      expect(api.replies).toEqual([])
      expect(String(auditLines(parentID).find((item) => item.event === "hold_reply_refused")?.detail)).toContain(
        "the approval was not minted: a covering refusal is in force",
      )
      expect(auditLines(parentID).some((item) => item.event === "hold_answer_pending")).toBe(false)
      expect(auditLines(parentID).some((item) => item.event === "hold_expired")).toBe(false)
      // The covering refusal denies the next assert; the refused once mints nothing.
      const after = await api.permission.evaluate(assertEvent(parentID, "msg_2", "call_2"))
      expect(after.effect).toBe("deny")
    } finally {
      resetOpenPrompts()
      dispose()
    }
  })

  test("a gated once whose mint lands before the expiry resumes stands on its own", async () => {
    const timers: { fn: () => void; ms: number }[] = []
    let holdParked = false
    let releaseGateNow: (() => void) | null = null
    const { api, host, dispose, call } = await wired({
      holdMs: 60_000,
      schedule: (fn: () => void, ms: number) => {
        timers.push({ fn, ms })
        return timers.length
      },
      hold: () =>
        holdParked
          ? new Promise<void>((resolve) => {
              releaseGateNow = resolve
            })
          : Promise.resolve(),
    })
    const parentID = "ses_expire_gate_short"
    try {
      const { event } = await openHold(host, call, parentID)
      const id = nextPerId()
      await api.feed(askedFrame(parentID, event.message, id))
      const pending = [{ id, sessionID: parentID, action: SUBAGENT, resources: ["general"], message: event.message }]
      let releaseList: (() => void) | null = null
      api.ctx.permission.list = async () => {
        await new Promise<void>((resolve) => {
          releaseList = resolve
        })
        return pending
      }
      holdParked = true
      timers[0].fn()
      for (let turn = 0; turn < 400 && !releaseList; turn++) await sleep(2)

      // The once lands inside the park, and its mint parks on the discovery
      // hold. The scan ends first, so the mint lands before the expiry resumes.
      await api.feed(repliedFrame(parentID, id, "once"))
      for (let turn = 0; turn < 400 && !releaseGateNow; turn++) await sleep(2)
      releaseGateNow!()
      await until(() => auditLines(parentID).some((line) => line.event === "hold_approved"))
      releaseList!()
      await sleep(10)

      // The approval stands; the expiry neither fabricated a reject nor named
      // an answer that had already minted.
      expect(api.replies).toEqual([])
      expect(auditLines(parentID).some((line) => line.event === "hold_answer_pending")).toBe(false)
      expect(auditLines(parentID).some((line) => line.event === "hold_expired")).toBe(false)
      holdParked = false
      const after = await api.permission.evaluate(assertEvent(parentID, "msg_2", "call_2"))
      expect(after.effect).toBe("allow")
      expect(after.generation).toBe(2)
    } finally {
      resetOpenPrompts()
      dispose()
    }
  })

  test("a once still gated at the deadline is named, never turned into a Jev reject", async () => {
    const timers: { fn: () => void; ms: number }[] = []
    let holdParked = false
    let releaseGateNow: (() => void) | null = null
    const { api, host, dispose, call } = await wired({
      holdMs: 60_000,
      schedule: (fn: () => void, ms: number) => {
        timers.push({ fn, ms })
        return timers.length
      },
      hold: () =>
        holdParked
          ? new Promise<void>((resolve) => {
              releaseGateNow = resolve
            })
          : Promise.resolve(),
    })
    const parentID = "ses_expire_gate_long"
    const prompt = "summarize the parser"
    try {
      const { event } = await openHold(host, call, parentID)
      const id = nextPerId()
      await api.feed(askedFrame(parentID, event.message, id))
      const pending = [{ id, sessionID: parentID, action: SUBAGENT, resources: ["general"], message: event.message }]
      let releaseList: (() => void) | null = null
      api.ctx.permission.list = async () => {
        await new Promise<void>((resolve) => {
          releaseList = resolve
        })
        return pending
      }
      holdParked = true
      timers[0].fn()
      for (let turn = 0; turn < 400 && !releaseList; turn++) await sleep(2)

      // The once lands inside the park and its mint parks on the discovery
      // hold. The list releases while the admission is still gated.
      await api.feed(repliedFrame(parentID, id, "once"))
      for (let turn = 0; turn < 400 && !releaseGateNow; turn++) await sleep(2)
      releaseList!()
      await until(() => auditLines(parentID).some((item) => item.event === "hold_answer_pending"))

      // The expiry names the answer it found and claims no Jev action: no
      // reject was sent, no deny was settled, and nothing vanished.
      expect(api.replies).toEqual([])
      const line = auditLines(parentID).find((item) => item.event === "hold_answer_pending")
      expect(String(line?.detail)).toContain("a human answered the hold before the deadline; the approval was still being admitted")
      expect(auditLines(parentID).some((item) => item.event === "hold_expired")).toBe(false)
      expect(deniedCalls(parentID)).toEqual([callKey(parentID, "msg_1", "call_1")])

      // The gate lifts: the once mints, and the record shows it.
      releaseGateNow!()
      await until(() => auditLines(parentID).some((item) => item.event === "hold_approved"))
      expect(tasks(parentID)[fingerprint(prompt)].generation).toBe(2)
      holdParked = false
      const after = await api.permission.evaluate(assertEvent(parentID, "msg_2", "call_2"))
      expect(after.effect).toBe("allow")
      expect(after.generation).toBe(2)
    } finally {
      resetOpenPrompts()
      dispose()
    }
  })

  test("a frame that closes the record before the deadline takes the expiry's reply with it", async () => {
    const timers: { fn: () => void; ms: number }[] = []
    let holdParked = false
    let releaseGateNow: (() => void) | null = null
    const { api, host, dispose, call } = await wired({
      holdMs: 60_000,
      schedule: (fn: () => void, ms: number) => {
        timers.push({ fn, ms })
        return timers.length
      },
      hold: () =>
        holdParked
          ? new Promise<void>((resolve) => {
              releaseGateNow = resolve
            })
          : Promise.resolve(),
    })
    const parentID = "ses_expire_frame_first"
    try {
      const { event } = await openHold(host, call, parentID)
      const id = nextPerId()
      await api.feed(askedFrame(parentID, event.message, id))

      // The human answers before the deadline, and the approval's admission
      // parks on an open discovery hold, so the record closes while the entry
      // is still held.
      holdParked = true
      await api.feed(repliedFrame(parentID, id, "once"))
      for (let turn = 0; turn < 400 && !releaseGateNow; turn++) await sleep(2)

      // The deadline fires while the answer is still being admitted. The
      // attempt re-reads the closed record: no reject is sent for a request
      // the host already answered, and the expiry names the pending answer.
      timers[0].fn()
      await until(() => auditLines(parentID).some((item) => item.event === "hold_answer_pending"))
      expect(api.replies).toEqual([])
      expect(auditLines(parentID).some((item) => item.event === "hold_expired")).toBe(false)

      releaseGateNow!()
      await until(() => auditLines(parentID).some((item) => item.event === "hold_approved"))
      holdParked = false
      const after = await api.permission.evaluate(assertEvent(parentID, "msg_2", "call_2"))
      expect(after.effect).toBe("allow")
      expect(after.generation).toBe(2)
    } finally {
      resetOpenPrompts()
      dispose()
    }
  })

  test("an ask that never arrives is audited uncancellable and denies nothing", async () => {
    const timers: { fn: () => void; ms: number }[] = []
    const { api, host, dispose, call } = await wired({
      holdMs: 60_000,
      schedule: (fn: () => void, ms: number) => {
        timers.push({ fn, ms })
        return timers.length
      },
    })
    const parentID = "ses_hold_uncancellable"
    const prompt = "summarize the parser"
    try {
      const { event } = await openHold(host, call, parentID)
      // No `permission.asked` frame: there is no request to reject.
      timers[0].fn()
      await until(() => auditLines(parentID).some((line) => line.event === "hold_uncancellable"))

      expect(api.replies).toEqual([])
      expect(auditLines(parentID).some((line) => line.event === "hold_expired")).toBe(false)
      expect(deniedCalls(parentID)).toEqual([callKey(parentID, "msg_1", "call_1")])

      // The hold was left standing, so a late ask and a human answer still admit.
      await answer(api, parentID, event, "once")
      await until(() => auditLines(parentID).some((line) => line.event === "hold_approved"))
      expect(tasks(parentID)[fingerprint(prompt)].generation).toBe(2)
    } finally {
      dispose()
    }
  })

  test("a deny already on the event is never softened into a question", async () => {
    const { api, host, dispose, call } = await wired({})
    const parentID = "ses_hold_deny"
    const prompt = "summarize the parser"
    try {
      await call(prompt, "msg_1", "call_1", parentID)
      await host.enforce(assertEvent(parentID, "msg_1", "call_1"))
      await host.abort({ parentID, fingerprint: fingerprint(prompt), scope: "task", by: "user", cause: "interrupt" })
      await call(prompt, "msg_2", "call_2", parentID)

      // This hook registers after the risk hook, so it is the last writer: an
      // ask here would turn that hook's deny into a question.
      const event = { ...assertEvent(parentID, "msg_2", "call_2"), effect: "deny", message: "risk: blocked" }
      const decision = await api.permission.evaluate(event)
      expect(decision.decision).toBe("hold")
      expect(decision.effect).toBe("deny")
      expect(event.effect).toBe("deny")
      expect(event.message).toBe("risk: blocked")
      expect(auditLines(parentID).some((line) => line.event === "hold_refused_by_deny")).toBe(true)
      // No prompt exists, so there is nothing to answer or to time out.
      expect(auditLines(parentID).some((line) => line.event === "hold")).toBe(false)
      expect(api.replies).toEqual([])
    } finally {
      dispose()
    }
  })
})

// ——— row 1 is the aborted invocation, and rows 7, 8 and none still exist ———

describe("the verdict table through the host", () => {
  /** A store answer the host cannot tell from the real one. */
  const evidence = (parentID: string, tasks: Record<string, any>) => ({
    ok: true,
    reason: "ok" as const,
    audit: "clean" as const,
    snap: { v: 1, parentID, frontierSeq: 0, eventCursor: 0, tasks },
  })

  const task = (parentID: string, key: string, extra: any = {}) => ({
    parentID,
    fingerprint: key,
    agent: "general",
    generation: 1,
    frontierAtAdmit: 0,
    callKeys: [],
    childIDs: [],
    retiredAt: null,
    ...extra,
  })

  test("a live record carrying the current call key does not deny", async () => {
    const { api, dispose, call } = await wired({})
    const parentID = "ses_live_key"
    const prompt = "summarize the parser"
    try {
      await call(prompt, "msg_1", "call_1", parentID)
      const record = tasks(parentID)[fingerprint(prompt)]
      // Admission writes the call key into a live record. That is the call
      // asking, not a replay of an aborted one.
      expect(record.abortedAt).toBeUndefined()
      expect(record.callKeys).toContain(callKey(parentID, "msg_1", "call_1"))

      const event = assertEvent(parentID, "msg_1", "call_1")
      const decision = await api.permission.evaluate(event)
      expect(decision.decision).toBe("allow")
      expect(decision.row).not.toBe("1")
      expect(event.effect).toBe("allow")
    } finally {
      dispose()
    }
  })

  test("a tombstoned record carrying the call key denies", async () => {
    const { api, host, dispose, call } = await wired({})
    const parentID = "ses_dead_key"
    const prompt = "summarize the parser"
    try {
      await call(prompt, "msg_1", "call_1", parentID)
      await api.permission.evaluate(assertEvent(parentID, "msg_1", "call_1"))
      await host.abort({ parentID, fingerprint: fingerprint(prompt), scope: "task", by: "user", cause: "interrupt" })

      const record = tasks(parentID)[fingerprint(prompt)]
      expect(record.abortedAt).not.toBeUndefined()
      expect(record.callKeys).toContain(callKey(parentID, "msg_1", "call_1"))

      const event = assertEvent(parentID, "msg_1", "call_1")
      const decision = await api.permission.evaluate(event)
      expect(decision.decision).toBe("deny")
      expect(decision.row).toBe("1")
      expect(event.effect).toBe("deny")
    } finally {
      dispose()
    }
  })

  test("rows none, 7 and 8 are reachable when the evidence does not carry this call", async () => {
    const cases: { name: string; parentID: string; tasks: Record<string, any>; row: string }[] = []
    const other = fingerprint("write the changelog")
    cases.push({ name: "none", parentID: "ses_row_none", tasks: {}, row: "none" })
    cases.push({
      name: "7",
      parentID: "ses_row_seven",
      tasks: { [other]: task("ses_row_seven", other, { callKeys: ["ses_row_seven|x|y"] }) },
      row: "7",
    })
    cases.push({
      name: "8",
      parentID: "ses_row_eight",
      tasks: { [other]: task("ses_row_elsewhere", other) },
      row: "8",
    })

    for (const item of cases) {
      const api = fakeCtx()
      const host = createAdmissionHost({ ctx: api.ctx, store: { readSnapshot: () => evidence(item.parentID, item.tasks) } })
      try {
        host.observe(observe(item.parentID, "msg_1", "call_1", "summarize the parser"))
        const event = assertEvent(item.parentID, "msg_1", "call_1")
        const decision = await host.enforce(event)
        expect(`${item.name}:${decision.row}`).toBe(`${item.name}:${item.row}`)
        expect(decision.decision).toBe("allow")
      } finally {
        host.close()
        api.close()
      }
    }
  })
})

// ——— the review's defects: each one has a test that fails without its fix ———

describe("duplicate assert", () => {
  test("a second assert while the prompt is open asks again with the same marker", async () => {
    const timers: { fn: () => void; ms: number }[] = []
    const { api, host, dispose, call } = await wired({
      holdMs: 5000,
      schedule: (fn: () => void, ms: number) => {
        timers.push({ fn, ms })
        return timers.length
      },
    })
    const parentID = "ses_open_hold"
    const prompt = "summarize the parser"
    try {
      const { event } = await openHold(host, call, parentID)
      expect(event.effect).toBe("ask")
      expect(timers.length).toBe(1)

      // The duplicate must ask on the event itself: the hook's return value is
      // discarded by the host, so a Decision alone proves nothing. It re-asks
      // with the marker the open prompt already carries, and arms no second
      // deadline for the same call key.
      const duplicate = assertEvent(parentID, "msg_2", "call_2")
      const again = await api.permission.evaluate(duplicate)
      expect(again.decision).toBe("hold")
      expect(duplicate.effect).toBe("ask")
      expect(duplicate.message).toBe(event.message)
      expect(timers.length).toBe(1)
      expect(auditLines(parentID).filter((line) => line.event === "hold").length).toBe(1)

      // A human reject settles the call for every assert of it.
      await answer(api, parentID, event, "reject")
      await until(() => auditLines(parentID).some((line) => line.event === "hold_rejected"))
      expect((await api.permission.evaluate(assertEvent(parentID, "msg_2", "call_2"))).effect).toBe("deny")
    } finally {
      dispose()
    }
  })
})

describe("approval", () => {
  test("an approval the store refused mints nothing and says so", async () => {
    let failWrites = false
    const { api, host, dispose, call } = await wired({
      store: {
        writeTask: (...args: any[]) => {
          if (failWrites) throw new Error("lock budget exhausted")
          return (store.writeTask as any)(...args)
        },
      },
    })
    const parentID = "ses_approval_write"
    const prompt = "summarize the parser"
    try {
      const { event } = await openHold(host, call, parentID)
      failWrites = true
      await answer(api, parentID, event, "once")
      await until(() => auditLines(parentID).some((line) => line.event === "hold_unrecorded"))

      // No generation was written, so nothing was admitted and the hold stands.
      expect(tasks(parentID)[fingerprint(prompt)].generation).toBe(1)
      expect(auditLines(parentID).some((line) => line.event === "hold_approved")).toBe(false)
      expect(auditLines(parentID).find((line) => line.event === "hold_unrecorded").detail).toContain("refused generation")
      expect((await api.permission.evaluate(assertEvent(parentID, "msg_2", "call_2"))).effect).toBe("ask")
    } finally {
      dispose()
    }
  })

  test("a human reject outranks the earlier allow on the same call", async () => {
    const { api, host, dispose, call } = await wired({})
    const parentID = "ses_answer"
    try {
      await call("summarize the parser", "msg_1", "call_1", parentID)
      expect((await api.permission.evaluate(assertEvent(parentID, "msg_1", "call_1"))).decision).toBe("allow")
      await call("write the changelog", "msg_2", "call_2", parentID)
      await api.permission.evaluate(assertEvent(parentID, "msg_2", "call_2"))
      await host.abort({ parentID, fingerprint: fingerprint("write the changelog"), scope: "task", by: "user", cause: "interrupt" })

      // The feed dies, so the already-allowed call is judged again and holds.
      host.feedFailed("frontier_unavailable")
      const again = assertEvent(parentID, "msg_1", "call_1")
      const held = await api.permission.evaluate(again)
      expect(held.decision).toBe("hold")
      expect(again.effect).toBe("ask")

      await answer(api, parentID, again, "reject")
      await until(() => auditLines(parentID).some((line) => line.event === "hold_rejected"))
      expect((await api.permission.evaluate(assertEvent(parentID, "msg_1", "call_1"))).effect).toBe("deny")
    } finally {
      dispose()
    }
  })

  test("an approved replacement does not join the aborted invocation", async () => {
    const { api, host, dispose, call } = await wired({})
    const parentID = "ses_approved"
    const prompt = "summarize the parser"
    try {
      const { event } = await openHold(host, call, parentID)
      await answer(api, parentID, event, "once")
      await until(() => auditLines(parentID).some((line) => line.event === "hold_approved"))

      const record = tasks(parentID)[fingerprint(prompt)]
      expect(record.generation).toBe(2)
      expect(record.callKeys).toEqual([callKey(parentID, "msg_1", "call_1")])
      expect(record.callKeys).not.toContain(callKey(parentID, "msg_2", "call_2"))

      // The aborted key still denies: the approval added no replay surface.
      expect((await api.permission.evaluate(assertEvent(parentID, "msg_1", "call_1"))).decision).toBe("deny")

      // A duplicate assert of the approved call returns the answer it already
      // has, without asking again.
      const again = await api.permission.evaluate(assertEvent(parentID, "msg_2", "call_2"))
      expect(again.decision).toBe("allow")
      expect(again.generation).toBe(2)
      expect(auditLines(parentID).filter((line) => line.event === "hold_approved").length).toBe(1)
    } finally {
      dispose()
    }
  })
})

describe("a late reply", () => {
  const COVERED = "an abort covers this session, so this call is not admitted"

  test("an approval after the ban is refused: no generation, the hold stays, the refusal is recorded", async () => {
    // The frame arrives after the ban is written. The reply path mints what
    // admits the call, so it runs the same admission every release does.
    let blocked: string | null = null
    const { api, host, dispose, call } = await wired({ blocked: () => blocked })
    const parentID = "ses_late_reply_ban"
    const prompt = "summarize the parser"
    try {
      const { event } = await openHold(host, call, parentID)
      const before = tasks(parentID)[fingerprint(prompt)].generation
      blocked = COVERED

      await answer(api, parentID, event, "once")
      await until(() => auditLines(parentID).some((line) => line.event === "hold_reply_refused"))

      // Nothing minted: the persisted generation is the one the hold opened under.
      expect(tasks(parentID)[fingerprint(prompt)].generation).toBe(before)
      expect(auditLines(parentID).some((line) => line.event === "hold_approved")).toBe(false)
      const refused = auditLines(parentID).find((line) => line.event === "hold_reply_refused")
      expect(String(refused.detail)).toContain(COVERED)
      expect(String(refused.perId)).toMatch(/^per_/)

      // The hold stays open, and the next assert faces the gate again.
      blocked = null
      const again = await api.permission.evaluate(assertEvent(parentID, "msg_2", "call_2"))
      expect(again.effect).toBe("ask")
      expect(again.decision).toBe("hold")
    } finally {
      dispose()
    }
  })

  test("an approval during discovery waits the scan out and is refused when it covers the session", async () => {
    // The descendants are unknown until the scan returns, so a reply inside that
    // window must wait for the hold and then read the restriction. Deciding on a
    // scope that is not written yet is the late approval this closes.
    let blocked: string | null = null
    let parked = false
    let holdGate: Promise<void> = Promise.resolve()
    let releaseHold: (() => void) | null = null
    const { api, host, dispose, call } = await wired({
      blocked: () => blocked,
      hold: () => holdGate,
      holdInForce: () => parked,
    })
    const parentID = "ses_late_reply_discovery"
    const prompt = "summarize the parser"
    try {
      const { event } = await openHold(host, call, parentID)
      const before = tasks(parentID)[fingerprint(prompt)].generation

      parked = true
      holdGate = new Promise<void>((resolve) => (releaseHold = resolve))
      await answer(api, parentID, event, "once")
      await sleep(10)
      // Parked: the reply has been decided neither way, and nothing was minted.
      expect(tasks(parentID)[fingerprint(prompt)].generation).toBe(before)
      expect(auditLines(parentID).some((line) => line.event === "hold_reply_refused")).toBe(false)

      // Discovery returns and names the session, so the reply is refused.
      blocked = COVERED
      parked = false
      releaseHold?.()
      await until(() => auditLines(parentID).some((line) => line.event === "hold_reply_refused"))

      expect(tasks(parentID)[fingerprint(prompt)].generation).toBe(before)
      expect(auditLines(parentID).some((line) => line.event === "hold_approved")).toBe(false)
      expect(String(auditLines(parentID).find((line) => line.event === "hold_reply_refused").detail)).toContain(COVERED)
    } finally {
      dispose()
    }
  })
})

describe("unified abort and native holds", () => {
  test("an open hold is revoked and its prompt rejected", async () => {
    const { api, host, dispose, call } = await wired({})
    const parentID = "ses_revoke_hold"
    const prompt = "summarize the parser"
    try {
      const { event } = await openHold(host, call, parentID)
      const perId = nextPerId()
      await api.feed(askedFrame(parentID, event.message, perId))
      const before = tasks(parentID)[fingerprint(prompt)].generation

      const result = await revokeOpenPrompts([parentID])
      expect(result).toEqual({ revoked: 1, failed: 0, unconfirmed: 0, unsupported: 0, openDetail: [] })
      // The prompt is what the host opened, so refusing it is the only route that
      // ends it: the entry alone cannot close it.
      expect(api.replies).toEqual([{ sessionID: parentID, requestID: perId, decision: "reject" }])
      expect(
        auditLines(parentID).some((line) => line.event === "deny" && String(line.detail).includes("revocation:abort")),
      ).toBe(true)

      // A late answer to the same prompt mints nothing, and the call stays denied.
      await api.feed(repliedFrame(parentID, perId, "once"))
      await sleep(10)
      expect(tasks(parentID)[fingerprint(prompt)].generation).toBe(before)
      expect(auditLines(parentID).some((line) => line.event === "hold_approved")).toBe(false)
      expect((await api.permission.evaluate(assertEvent(parentID, "msg_2", "call_2"))).effect).toBe("deny")
    } finally {
      resetOpenPrompts()
      dispose()
    }
  })

  test("a hold with no correlated prompt is unconfirmed, never a claimed release", async () => {
    const { api, host, dispose, call } = await wired({})
    const parentID = "ses_revoke_unnamed"
    try {
      await openHold(host, call, parentID)
      const result = await revokeOpenPrompts([parentID])
      // Nothing was asked, so there is no prompt to reject and no proof none
      // opened: the count says exactly that.
      expect(result).toEqual({ revoked: 0, failed: 0, unconfirmed: 1, unsupported: 0, openDetail: [{ requestID: null, reason: "unnamed" }] })
      expect(api.replies).toEqual([])
    } finally {
      resetOpenPrompts()
      dispose()
    }
  })

  test("a reply the host received and declined is reported as a refusal", async () => {
    const { api, host, dispose, call } = await wired({})
    const parentID = "ses_revoke_refused"
    try {
      const { event } = await openHold(host, call, parentID)
      const perId = nextPerId()
      await api.feed(askedFrame(parentID, event.message, perId))
      // The host took the call and answered `false`: that is the one observed
      // refusal, and the only one the receipt may attribute to the host.
      api.ctx.permission.reply = async () => false
      const result = await revokeOpenPrompts([parentID])
      expect(result).toEqual({
        revoked: 0,
        failed: 1,
        unconfirmed: 0,
        unsupported: 0,
        openDetail: [{ requestID: perId, reason: "refused" }],
      })
      expect(String(auditLines(parentID).find((line) => line.event === "hold_uncancellable").detail)).toContain(
        "the self-reply was refused",
      )
    } finally {
      resetOpenPrompts()
      dispose()
    }
  })

  test("a reply that throws is unobserved, never a claimed host refusal", async () => {
    const { api, host, dispose, call } = await wired({})
    const parentID = "ses_revoke_threw"
    try {
      const { event } = await openHold(host, call, parentID)
      const perId = nextPerId()
      await api.feed(askedFrame(parentID, event.message, perId))
      api.ctx.permission.reply = async () => {
        throw new Error("the transport failed")
      }
      const result = await revokeOpenPrompts([parentID])
      expect(result).toEqual({
        revoked: 0,
        failed: 0,
        unconfirmed: 1,
        unsupported: 0,
        openDetail: [{ requestID: perId, reason: "no-outcome" }],
      })
      expect(String(auditLines(parentID).find((line) => line.event === "hold_uncancellable").detail)).toContain(
        "no reply outcome was observed",
      )
    } finally {
      resetOpenPrompts()
      dispose()
    }
  })

  test("a reject skipped for another pending permission is a local fact, not a refusal", async () => {
    const { api, host, dispose, call } = await wired({})
    const parentID = "ses_revoke_skip_pending"
    try {
      const { event } = await openHold(host, call, parentID)
      const perId = nextPerId()
      await api.feed(askedFrame(parentID, event.message, perId))
      api.pending = [
        { id: perId, sessionID: parentID, action: SUBAGENT, resources: ["general"], message: event.message },
        { id: nextPerId(), sessionID: parentID, action: "shell", resources: ["bash"] },
      ]
      const result = await revokeOpenPrompts([parentID])
      expect(api.replies).toEqual([])
      expect(result).toEqual({
        revoked: 0,
        failed: 1,
        unconfirmed: 0,
        unsupported: 0,
        openDetail: [{ requestID: perId, reason: "skipped-pending" }],
      })
      expect(auditLines(parentID).some((line) => line.event === "hold_fanout_skipped")).toBe(true)
    } finally {
      resetOpenPrompts()
      dispose()
    }
  })

  test("a reject skipped because the pending list is unreadable says so locally", async () => {
    const { api, host, dispose, call } = await wired({})
    const parentID = "ses_revoke_skip_unreadable"
    try {
      const { event } = await openHold(host, call, parentID)
      const perId = nextPerId()
      await api.feed(askedFrame(parentID, event.message, perId))
      api.ctx.permission.list = async () => {
        throw new Error("the list is down")
      }
      const result = await revokeOpenPrompts([parentID])
      expect(api.replies).toEqual([])
      expect(result).toEqual({
        revoked: 0,
        failed: 1,
        unconfirmed: 0,
        unsupported: 0,
        openDetail: [{ requestID: perId, reason: "skipped-unreadable" }],
      })
    } finally {
      resetOpenPrompts()
      dispose()
    }
  })

  test("a host with no reply primitive is unsupported, and the entry is still denied", async () => {
    const { api, host, dispose, call } = await wired({})
    const parentID = "ses_revoke_unsupported"
    try {
      const { event } = await openHold(host, call, parentID)
      const perId = nextPerId()
      await api.feed(askedFrame(parentID, event.message, perId))
      delete (api.ctx.permission as any).reply
      const result = await revokeOpenPrompts([parentID])
      expect(result).toEqual({
        revoked: 0,
        failed: 0,
        unconfirmed: 0,
        unsupported: 1,
        openDetail: [{ requestID: perId, reason: "unsupported" }],
      })
      // The release is still refused: the entry cannot be answered.
      expect((await api.permission.evaluate(assertEvent(parentID, "msg_2", "call_2"))).effect).toBe("deny")
    } finally {
      resetOpenPrompts()
      dispose()
    }
  })

  test("a hold outside the scope is left alone", async () => {
    const { api, host, dispose, call } = await wired({})
    const parentID = "ses_revoke_scope"
    try {
      const { event } = await openHold(host, call, parentID)
      await api.feed(askedFrame(parentID, event.message))
      const result = await revokeOpenPrompts(["ses_somewhere_else"])
      expect(result).toEqual({ revoked: 0, failed: 0, unconfirmed: 0, unsupported: 0, openDetail: [] })
      expect(api.replies).toEqual([])
      // Still open and still asking.
      expect((await api.permission.evaluate(assertEvent(parentID, "msg_2", "call_2"))).effect).toBe("ask")
    } finally {
      resetOpenPrompts()
      dispose()
    }
  })

  test("a named prompt whose reply surface fails is unconfirmed by its request id", async () => {
    // The abort cannot initiate a reply here, so nothing was attempted and no
    // closure was observed. The prompt is named, and saying it was never named
    // would send an operator looking for a prompt that has a request id.
    const { api, host, dispose, call } = await wired({})
    const parentID = "ses_revoke_surface"
    try {
      const { event } = await openHold(host, call, parentID)
      const perId = nextPerId()
      await api.feed(askedFrame(parentID, event.message, perId))
      Object.defineProperty(api.ctx.permission, "reply", {
        configurable: true,
        get() {
          throw new Error("the host's reply surface failed")
        },
      })

      const result = await revokeOpenPrompts([parentID])
      expect(result).toEqual({
        revoked: 0,
        failed: 0,
        unconfirmed: 1,
        unsupported: 0,
        openDetail: [{ requestID: perId, reason: "no-outcome" }],
      })
      // The entry is still denied: the abort's own protection never depended on
      // the reply surface.
      expect((await api.permission.evaluate(assertEvent(parentID, "msg_2", "call_2"))).effect).toBe("deny")
    } finally {
      resetOpenPrompts()
      dispose()
    }
  })

  test("a prompt whose own reply is in flight is reported by its request id", async () => {
    // The hold deadline started the reply, so `jevReplied` is set while this
    // abort looks: the registry must not start a second one or claim the prompt
    // was never named.
    const { api, host, dispose, call } = await wired({ holdMs: 5 })
    const parentID = "ses_revoke_in_flight"
    try {
      const { event } = await openHold(host, call, parentID)
      const perId = nextPerId()
      let release: (() => void) | null = null
      api.ctx.permission.reply = async () => {
        await new Promise<void>((resolve) => {
          release = resolve
        })
      }
      await api.feed(askedFrame(parentID, event.message, perId))
      for (let turn = 0; turn < 400 && !release; turn++) await sleep(5)
      expect(release).not.toBeNull()

      const result = await revokeOpenPrompts([parentID])
      expect(result).toEqual({
        revoked: 0,
        failed: 0,
        unconfirmed: 1,
        unsupported: 0,
        openDetail: [{ requestID: perId, reason: "in-flight" }],
      })

      // The tenant of the record is the reply already in flight: releasing it is
      // what closes the prompt.
      release!()
      await sleep(10)
      expect(await revokeOpenPrompts([parentID])).toEqual({
        revoked: 0,
        failed: 0,
        unconfirmed: 0,
        unsupported: 0,
        openDetail: [],
      })
    } finally {
      resetOpenPrompts()
      dispose()
    }
  })

  test("a confirmed revocation clears the record, so the next abort reports clean", async () => {
    // The refusal below leaves the record standing, and only a confirmed
    // rejection or the host's own answer removes it. A later abort that found the
    // record still there would claim a prompt the host already closed.
    const { api, host, dispose, call } = await wired({})
    const parentID = "ses_revoke_confirmed"
    try {
      const { event } = await openHold(host, call, parentID)
      const perId = nextPerId()
      await api.feed(askedFrame(parentID, event.message, perId))
      const refuse = api.ctx.permission.reply
      api.ctx.permission.reply = async () => false
      expect(await revokeOpenPrompts([parentID])).toEqual({
        revoked: 0,
        failed: 1,
        unconfirmed: 0,
        unsupported: 0,
        openDetail: [{ requestID: perId, reason: "refused" }],
      })

      api.ctx.permission.reply = refuse
      expect(await revokeOpenPrompts([parentID])).toEqual({ revoked: 1, failed: 0, unconfirmed: 0, unsupported: 0, openDetail: [] })
      expect(await revokeOpenPrompts([parentID])).toEqual({ revoked: 0, failed: 0, unconfirmed: 0, unsupported: 0, openDetail: [] })
    } finally {
      resetOpenPrompts()
      dispose()
    }
  })
})

describe("failed seal", () => {
  test("a tombstone the store refused is held in memory", async () => {
    let failWrites = false
    const { api, host, dispose, call } = await wired({
      store: {
        writeTask: (...args: any[]) => {
          if (failWrites) throw new Error("disk full")
          return (store.writeTask as any)(...args)
        },
      },
    })
    const parentID = "ses_seal"
    const prompt = "summarize the parser"
    try {
      await call(prompt, "msg_1", "call_1", parentID)
      await api.permission.evaluate(assertEvent(parentID, "msg_1", "call_1"))

      failWrites = true
      await host.abort({ parentID, fingerprint: fingerprint(prompt), scope: "task", by: "user", cause: "interrupt" })
      failWrites = false
      expect(tasks(parentID)[fingerprint(prompt)].abortedAt).toBeUndefined()
      expect(auditLines(parentID).some((line) => String(line.detail ?? "").includes("held in memory only"))).toBe(true)

      // The replacement still holds: the in-memory seal is what the table sees.
      await call(prompt, "msg_2", "call_2", parentID)
      const event = assertEvent(parentID, "msg_2", "call_2")
      const decision = await api.permission.evaluate(event)
      expect(decision.row).toBe("4")
      expect(decision.effect).toBe("ask")
      expect(event.effect).toBe("ask")
    } finally {
      dispose()
    }
  })
})

describe("the feed", () => {
  test("a stream that ends degrades the parent it served", async () => {
    const timers: (() => void)[] = []
    const { api, host, dispose, call } = await wired({
      schedule: (fn: () => void) => {
        timers.push(fn)
        return timers.length
      },
      repair: () => false,
    })
    const parentID = "ses_feed_dead"
    const prompt = "summarize the parser"
    try {
      await call(prompt, "msg_1", "call_1", parentID)
      await api.permission.evaluate(assertEvent(parentID, "msg_1", "call_1"))
      await host.abort({ parentID, fingerprint: fingerprint(prompt), scope: "task", by: "user", cause: "interrupt" })

      api.close()
      await until(() => store.readSnapshot(parentID).snap?.degraded !== undefined)
      const snap = store.readSnapshot(parentID).snap
      expect(snap?.degraded?.reason).toContain("feed")

      await call(prompt, "msg_2", "call_2", parentID)
      const event = assertEvent(parentID, "msg_2", "call_2")
      const decision = await api.permission.evaluate(event)
      expect(decision.row).toBe("9")
      expect(decision.effect).toBe("ask")
      expect(event.effect).toBe("ask")
      expect(auditLines(parentID).some((line) => line.event === "degraded_hold")).toBe(true)
    } finally {
      dispose()
    }
  })

  test("a user turn through the feed retires the tombstone", async () => {
    const { api, host, dispose, call } = await wired({})
    const parentID = "ses_user_turn"
    const prompt = "summarize the parser"
    try {
      await call(prompt, "msg_1", "call_1", parentID)
      await api.permission.evaluate(assertEvent(parentID, "msg_1", "call_1"))
      await host.abort({ parentID, fingerprint: fingerprint(prompt), scope: "task", by: "user", cause: "interrupt" })

      await api.feed({
        type: "session.inbox.enqueued",
        durable: { aggregateID: parentID, seq: 1 },
        data: { item: { type: "user" } },
      })
      await until(() => (store.readSnapshot(parentID).snap?.frontierSeq ?? 0) === 1)

      await call(prompt, "msg_2", "call_2", parentID)
      const event = assertEvent(parentID, "msg_2", "call_2")
      const decision = await api.permission.evaluate(event)
      // Row 5 is the same task after a user turn: an allow that retires.
      expect(decision.decision).toBe("allow")
      expect(decision.row).toBe("5")
      expect(event.effect).toBe("allow")
      expect(tasks(parentID)[fingerprint(prompt)].retiredAt).not.toBeNull()
    } finally {
      dispose()
    }
  })

  test("a deleted session removes its snapshot", async () => {
    const { api, dispose, call } = await wired({})
    const parentID = "ses_deleted"
    try {
      await call("summarize the parser", "msg_1", "call_1", parentID)
      const path = store.parentPaths(parentID).snapshot
      expect(existsSync(path)).toBe(true)
      await api.feed({ type: "session.deleted", data: { sessionID: parentID } })
      await until(() => !existsSync(path))
      expect(existsSync(path)).toBe(false)
    } finally {
      dispose()
    }
  })

  test("a synthetic enqueue does not advance the frontier or retire a tombstone", async () => {
    const { api, host, dispose, call } = await wired({})
    const parentID = "ses_synthetic_item"
    const prompt = "summarize the parser"
    try {
      await call(prompt, "msg_1", "call_1", parentID)
      await api.permission.evaluate(assertEvent(parentID, "msg_1", "call_1"))
      await host.abort({ parentID, fingerprint: fingerprint(prompt), scope: "task", by: "user", cause: "interrupt" })

      // The host's own notices: the cancelled tool result, then the abort notice.
      await api.feed({
        type: "session.inbox.enqueued",
        durable: { aggregateID: parentID, seq: 17 },
        data: { item: { type: "synthetic" } },
      })
      await api.feed({
        type: "session.inbox.enqueued",
        durable: { aggregateID: parentID, seq: 18 },
        data: { item: { type: "synthetic" } },
      })
      expect(store.readSnapshot(parentID).snap?.frontierSeq ?? 0).toBe(0)

      host.observe(observe(parentID, "msg_2", "call_2", prompt))
      const decision = await api.permission.evaluate(assertEvent(parentID, "msg_2", "call_2"))
      expect(decision.decision).toBe("hold")
      expect(decision.row).toBe("4")
      expect(tasks(parentID)[fingerprint(prompt)].retiredAt).toBeNull()
    } finally {
      dispose()
    }
  })

  test("an enqueue with no usable item type is not a user turn", async () => {
    const { host, dispose, call } = await wired({})
    const parentID = "ses_typeless_item"
    try {
      await call("summarize the parser", "msg_1", "call_1", parentID)
      host.userItem(parentID, 20)
      host.userItem(parentID, 21, "")
      host.userItem(parentID, 22, null as any)
      host.userItem(parentID, 23, 7 as any)
      expect(store.readSnapshot(parentID).snap?.frontierSeq ?? 0).toBe(0)

      host.userItem(parentID, 24, "user")
      expect(store.readSnapshot(parentID).snap?.frontierSeq).toBe(24)
    } finally {
      dispose()
    }
  })

  test("two synthetic notices after an abort leave the replacement held", async () => {
    // Milestone D in miniature: the host's own notices must not retire the
    // tombstone the abort just sealed, or the same-turn replacement is row 5.
    const { api, host, dispose, call } = await wired({})
    const parentID = "ses_mini_d"
    const prompt = "Jev milestone D task one: reply with the single word READY and stop."
    try {
      await api.feed({
        type: "session.inbox.enqueued",
        durable: { aggregateID: parentID, seq: 1 },
        data: { item: { type: "user" } },
      })
      expect(store.readSnapshot(parentID).snap?.frontierSeq).toBe(1)

      await call(prompt, "msg_1", "call_1", parentID)
      await api.permission.evaluate(assertEvent(parentID, "msg_1", "call_1"))
      await api.feed({ type: "session.created", data: { sessionID: "ses_mini_d_child", parentID }, created: Date.now() })
      await host.abort({ parentID, fingerprint: fingerprint(prompt), scope: "task", by: "user", cause: "user command" })
      expect(tasks(parentID)[fingerprint(prompt)].childIDs).toEqual(["ses_mini_d_child"])

      await api.feed({
        type: "session.inbox.enqueued",
        durable: { aggregateID: parentID, seq: 17 },
        data: { item: { type: "synthetic" } },
      })
      await api.feed({
        type: "session.inbox.enqueued",
        durable: { aggregateID: parentID, seq: 18 },
        data: { item: { type: "synthetic" } },
      })
      expect(store.readSnapshot(parentID).snap?.frontierSeq).toBe(1)

      host.observe(observe(parentID, "msg_2", "call_2", prompt))
      const event = assertEvent(parentID, "msg_2", "call_2")
      const decision = await api.permission.evaluate(event)
      expect(decision.decision).toBe("hold")
      expect(decision.row).toBe("4")
      expect(event.effect).toBe("ask")
      expect(event.message).toMatch(MARKER)
      expect(tasks(parentID)[fingerprint(prompt)].childIDs.length).toBe(1)
      expect(tasks(parentID)[fingerprint(prompt)].retiredAt).toBeNull()
    } finally {
      dispose()
    }
  })
})

describe("hold failure", () => {
  test("a self-reply the host refuses is audited and leaves the hold standing", async () => {
    const timers: { fn: () => void; ms: number }[] = []
    const { api, host, dispose, call } = await wired({
      holdMs: 60_000,
      schedule: (fn: () => void, ms: number) => {
        timers.push({ fn, ms })
        return timers.length
      },
    })
    const parentID = "ses_selfreply_fail"
    try {
      const { event } = await openHold(host, call, parentID)
      const id = nextPerId()
      await api.feed(askedFrame(parentID, event.message, id))
      api.pending = [{ id, sessionID: parentID, action: SUBAGENT, resources: ["general"], message: event.message }]
      api.ctx.permission.reply = async () => false

      timers[0].fn()
      await until(() => auditLines(parentID).some((line) => line.event === "hold_uncancellable"))
      expect(auditLines(parentID).find((line) => line.event === "hold_uncancellable").detail).toContain("the self-reply was refused")
      // A deny that did not happen is never reported.
      expect(auditLines(parentID).some((line) => line.event === "hold_expired")).toBe(false)
      expect((await api.permission.evaluate(assertEvent(parentID, "msg_2", "call_2"))).effect).toBe("ask")
    } finally {
      dispose()
    }
  })
})

describe("switches and settings", () => {
  test("turning the flag off stops enforcement and writes nothing", async () => {
    let on = true
    const { api, dispose, call } = await wired({ enabled: () => on })
    const parentID = "ses_toggle"
    try {
      await call("summarize the parser", "msg_1", "call_1", parentID)
      on = false

      const event = assertEvent(parentID, "msg_1", "call_1")
      const decision = await api.permission.evaluate(event)
      expect(decision.decision).toBe("allow")
      expect(decision.reason).toContain("feature is off")
      expect(event.effect).toBe("allow")

      const before = auditLines(parentID).length
      await call("write the changelog", "msg_2", "call_2", parentID)
      expect(auditLines(parentID).length).toBe(before)
      expect(Object.keys(tasks(parentID)).length).toBe(1)
    } finally {
      dispose()
    }
  })

  test("the configured hold deadline is the timer the hold arms", async () => {
    const timers: { fn: () => void; ms: number }[] = []
    const { api, host, dispose, call } = await wired({
      holdMs: 1234,
      schedule: (fn: () => void, ms: number) => {
        timers.push({ fn, ms })
        return timers.length
      },
    })
    const parentID = "ses_deadline"
    const prompt = "summarize the parser"
    try {
      await call(prompt, "msg_1", "call_1", parentID)
      await api.permission.evaluate(assertEvent(parentID, "msg_1", "call_1"))
      await host.abort({ parentID, fingerprint: fingerprint(prompt), scope: "task", by: "user", cause: "interrupt" })
      await call(prompt, "msg_2", "call_2", parentID)
      const event = assertEvent(parentID, "msg_2", "call_2")
      await api.permission.evaluate(event)
      expect(timers.map((timer) => timer.ms)).toEqual([1234])
    } finally {
      dispose()
    }
  })

  test("prompts that differ past 32 KB are different tasks", async () => {
    const { dispose, call } = await wired({})
    const base = "x".repeat(40_000)
    try {
      await call(base, "msg_1", "call_1", "ses_long")
      await call(`${base}y`, "msg_2", "call_2", "ses_long")
      expect(Object.keys(tasks("ses_long")).length).toBe(2)
    } finally {
      dispose()
    }
  })
})

// ——— registration diagnostics ———

/**
 * The call log is the only place a swallowed registration failure shows up.
 * These read the real file the plugin writes, cleared per case so one case's
 * records cannot answer another's question.
 */
describe("registration diagnostics", () => {
  const clearLog = () => rmSync(stateModule.LOG_FILE, { force: true })
  const logRecords = (): any[] => {
    if (!existsSync(stateModule.LOG_FILE)) return []
    return readFileSync(stateModule.LOG_FILE, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as any)
  }
  const attachRecords = (): any[] => logRecords().filter((line) => String(line.site ?? "").startsWith("attach."))
  const attachFor = (site: string): any[] => attachRecords().filter((line) => line.site === `attach.${site}`)

  test("all four domains register and each writes one passing record", async () => {
    clearLog()
    const api = fakeCtx()
    const host = createAdmissionHost({ ctx: api.ctx })
    try {
      await attach(api.ctx, host)
      const records = attachRecords()
      expect(records.map((record) => record.site)).toEqual([
        "attach.tool.transform",
        "attach.tool.hook.execute.after",
        "attach.permission.hook.evaluate",
        "attach.event.subscribe",
      ])
      for (const record of records) {
        expect(record.hook).toBe("hook_session_ban")
        expect(record.present).toBe(true)
        expect(record.attached).toBe(true)
        expect("error" in record).toBe(false)
      }
    } finally {
      host.close()
      api.close()
    }
  })

  test("a domain that throws is present, not attached, and carries its error", async () => {
    clearLog()
    const api = fakeCtx()
    api.ctx.permission.hook = async () => {
      throw new Error("boom")
    }
    const host = createAdmissionHost({ ctx: api.ctx })
    try {
      await attach(api.ctx, host)
      const refused = attachFor("permission.hook.evaluate")
      expect(refused.length).toBe(1)
      expect(refused[0].present).toBe(true)
      expect(refused[0].attached).toBe(false)
      expect(refused[0].error).toBe("boom")
      // One failing domain does not take the other three down with it.
      expect(attachRecords().length).toBe(4)
      expect(attachFor("tool.transform")[0].attached).toBe(true)
      expect(attachFor("tool.hook.execute.after")[0].attached).toBe(true)
      expect(attachFor("event.subscribe")[0].attached).toBe(true)
    } finally {
      host.close()
      api.close()
    }
  })

  test("an absent domain is not present, not attached, and has no error", async () => {
    clearLog()
    const api = fakeCtx()
    delete api.ctx.permission.hook
    const host = createAdmissionHost({ ctx: api.ctx })
    try {
      await attach(api.ctx, host)
      const missing = attachFor("permission.hook.evaluate")
      expect(missing.length).toBe(1)
      expect(missing[0].present).toBe(false)
      expect(missing[0].attached).toBe(false)
      expect("error" in missing[0]).toBe(false)
      expect(attachRecords().length).toBe(4)
      expect(attachFor("tool.transform")[0].attached).toBe(true)
    } finally {
      host.close()
      api.close()
    }
  })

  test("a refused event subscription records the refusal and still enforces through the real table", async () => {
    const sequence = async (subscribeThrows: boolean) => {
      clearLog()
      const api = fakeCtx()
      if (subscribeThrows) {
        api.ctx.event.subscribe = () => {
          throw new Error("no stream")
        }
      }
      const evaluations: any[] = []
      const host = createAdmissionHost({
        ctx: api.ctx,
        evaluate: (input: any, records: any[], sessionBan: any) => {
          evaluations.push({ input, records, sessionBan })
          return verdict(input, records, sessionBan)
        },
      })
      const parentID = subscribeThrows ? "ses_subscribe_refused" : "ses_subscribe_working"
      try {
        await attach(api.ctx, host)
        await api.tool.execute({ prompt: "summarize the parser" }, { sessionID: parentID, messageID: "msg_1", id: "call_1", agent: "general" })
        const event = assertEvent(parentID, "msg_1", "call_1")
        const decision = await api.permission.evaluate(event)
        // A non-subagent action proves the hook is live, not merely present.
        const other = { sessionID: parentID, action: "shell", resources: ["x"], effect: "allow" }
        const untouched = await api.permission.evaluate(other)
        return { decision, effect: event.effect, evaluations, untouched, other, records: attachRecords(), log: logRecords() }
      } finally {
        host.close()
        api.close()
      }
    }

    const working = await sequence(false)
    const refused = await sequence(true)

    const subscribed = refused.records.filter((record) => record.site === "attach.event.subscribe")
    expect(subscribed.length).toBe(1)
    expect(subscribed[0].present).toBe(true)
    expect(subscribed[0].attached).toBe(false)
    expect(subscribed[0].error).toBe("no stream")

    // The feed's own record says why the frontier has no source.
    const feed = refused.log.filter((record) => record.site === "feed")
    expect(feed.length).toBe(1)
    expect(feed[0].reason).toBe("the host refused the event subscription")

    // Wiring is unchanged: the permission domain registers either way, the
    // table is consulted exactly once per assert, and other actions are left
    // alone. No failure reaches the fail-closed catch-all.
    expect(refused.records.find((record) => record.site === "attach.permission.hook.evaluate")?.attached).toBe(true)
    expect(refused.evaluations.length).toBe(1)
    expect(refused.untouched.decision).toBe("allow")
    expect(refused.other.effect).toBe("allow")
    expect(refused.decision.reason).not.toContain("enforcement failed")

    // The table, not a fallback, produced the refused case's verdict.
    const [seen] = refused.evaluations
    const table = verdict(seen.input, seen.records, seen.sessionBan)
    expect(refused.decision.row).toBe(table.row)
    expect(refused.decision.reason).toBe(table.reason)
    expect(refused.decision.effect).toBe(table.effect)

    // The verdict differs in one field only: a feed that never existed leaves
    // the frontier unknown, so the same admission reports row 10 instead of
    // row none. The decision and the effect are unchanged.
    expect(working.decision.decision).toBe("allow")
    expect(working.decision.row).toBe("none")
    expect(working.effect).toBe("allow")
    expect(refused.decision.decision).toBe("allow")
    expect(refused.decision.row).toBe("10")
    expect(refused.effect).toBe("allow")
  })

  test("the first event through the stream is recorded once, with its type", async () => {
    clearLog()
    const { api, dispose } = await wired({})
    try {
      await api.feed({ type: "session.deleted", data: { sessionID: "ses_diag_first" } })
      await api.feed({ type: "session.deleted", data: { sessionID: "ses_diag_second" } })
      await until(() => attachFor("event.first").length > 0)
      const first = attachFor("event.first")
      expect(first.length).toBe(1)
      expect(first[0].type).toBe("session.deleted")
      expect(first[0].hook).toBe("hook_session_ban")
    } finally {
      dispose()
    }
  })
})

// ——— the abort trigger ———

/**
 * The user's route to a stopped task. Model-free: fake contexts, fabricated
 * events, a temp state root. What these cannot prove is that a real child run
 * actually stops, which needs a real `subagent` call.
 */
describe("abort trigger", () => {
  const taskOf = (parentID: string, prompt: string): any => tasks(parentID)[fingerprint(prompt)]

  test("seals a task with nothing running and says so", async () => {
    const synthetics: any[] = []
    const { api, host, dispose, call } = await wired({})
    api.ctx.session.synthetic = async (message: any) => {
      synthetics.push(message)
    }
    const parentID = "ses_abort_quiet"
    const prompt = "summarize the parser"
    try {
      await call(prompt, "msg_1", "call_1", parentID)
      const receipt = await host.abort({ parentID, fingerprint: fingerprint(prompt), scope: "task", by: "user", cause: "user command" })

      expect(receipt).toMatchObject({ sealed: true, durable: true, interrupted: [], preserved: [] })
      expect(receipt.revoked).toEqual([callKey(parentID, "msg_1", "call_1")])
      expect(taskOf(parentID, prompt).abortedAt).toBeNumber()
      expect(taskOf(parentID, prompt).abortedBy).toBe("user")

      // The parent is told, and the notice names the task without claiming a
      // remote stop or a model-visible reason.
      expect(synthetics.length).toBe(1)
      expect(synthetics[0].sessionID).toBe(parentID)
      expect(synthetics[0].delivery).toBe("queue")
      expect(String(synthetics[0].text)).toContain(fingerprint(prompt).slice(0, 12))
      expect(String(synthetics[0].text)).toContain("replacement")
    } finally {
      dispose()
    }
  })

  test("leaves a same-prompt hold it does not own alive, approvable only by a newer generation", async () => {
    const { api, host, dispose, call } = await wired({})
    const parentID = "ses_abort_hold"
    const prompt = "summarize the parser"
    const key = fingerprint(prompt)
    const held2 = callKey(parentID, "msg_2", "call_2")
    try {
      await call(prompt, "msg_1", "call_1", parentID)
      const first = await host.abort({ parentID, fingerprint: key, scope: "task", by: "user", cause: "user command" })
      expect(first.revoked).toEqual([callKey(parentID, "msg_1", "call_1")])
      expect(taskOf(parentID, prompt).generation).toBe(1)

      // A second call with the same prompt is a new call key the record never
      // owned: it may be another task, so the abort must not cancel it.
      await call(prompt, "msg_2", "call_2", parentID)
      const event = assertEvent(parentID, "msg_2", "call_2")
      expect((await api.permission.evaluate(event)).effect).toBe("ask")
      const id = nextPerId()
      await api.feed(askedFrame(parentID, event.message, id))

      const again = await host.abort({ parentID, fingerprint: key, scope: "task", by: "user", cause: "user command" })
      expect(again.reason).toBe("already aborted")
      expect(again.revoked).toEqual([])
      // The abort owns no prompt here, so Jev issues no reply for it.
      expect(api.replies).toEqual([])
      // The choice is on the record, not silent.
      expect(auditLines(parentID).some((line) => line.event === "hold_preserved" && line.callID === held2)).toBe(true)
      expect(taskOf(parentID, prompt).callKeys).toEqual([callKey(parentID, "msg_1", "call_1")])

      // The sealed record governs the question: an answer mints a generation
      // newer than that record, and that is the only approval that admits.
      await answer(api, parentID, event, "once")
      await until(() => auditLines(parentID).some((line) => line.event === "hold_approved"))
      expect(taskOf(parentID, prompt).generation).toBe(2)
    } finally {
      dispose()
    }
  })

  test("revokes an allow that already settled", async () => {
    const { api, host, dispose, call } = await wired({})
    const parentID = "ses_abort_allowed"
    const prompt = "summarize the parser"
    try {
      await call(prompt, "msg_1", "call_1", parentID)
      expect((await api.permission.evaluate(assertEvent(parentID, "msg_1", "call_1"))).decision).toBe("allow")

      const receipt = await host.abort({ parentID, fingerprint: fingerprint(prompt), scope: "task", by: "user", cause: "user command" })
      expect(receipt.sealed).toBe(true)

      // A replay now denies with the abort's settlement, not the old allow.
      const replay = assertEvent(parentID, "msg_1", "call_1")
      const decision = await api.permission.evaluate(replay)
      expect(decision.decision).toBe("deny")
      expect(decision.reason).toBe("revocation:abort")
      expect(replay.effect).toBe("deny")
    } finally {
      dispose()
    }
  })

  test("refuses an unreadable store and writes no tombstone", async () => {
    const { api, host, dispose, call } = await wired({})
    const parentID = "ses_abort_unreadable"
    const prompt = "summarize the parser"
    try {
      await call(prompt, "msg_1", "call_1", parentID)
      const snapshot = store.parentPaths(parentID).snapshot
      const original = readFileSync(snapshot, "utf8")
      chmodSync(snapshot, 0o000)
      try {
        const receipt = await host.abort({ parentID, fingerprint: fingerprint(prompt), scope: "task", by: "user", cause: "user command" })
        expect(receipt.sealed).toBe(false)
        expect(receipt.reason).toContain("unreadable")
        expect(auditLines(parentID).some((line) => line.event === "abort_refused")).toBe(true)
      } finally {
        chmodSync(snapshot, 0o600)
      }
      // Nothing was sealed: the file still holds the admitted record.
      expect(readFileSync(snapshot, "utf8")).toBe(original)
      expect(taskOf(parentID, prompt).abortedAt).toBeUndefined()
    } finally {
      dispose()
    }
  })

  test("a second abort moves no frontier and leaves the seal where it was", async () => {
    const { host, dispose, call } = await wired({})
    const parentID = "ses_abort_twice"
    const prompt = "summarize the parser"
    try {
      await call(prompt, "msg_1", "call_1", parentID)
      const first = await host.abort({ parentID, fingerprint: fingerprint(prompt), scope: "task", by: "user", cause: "user command" })
      const sealedAt = taskOf(parentID, prompt).frontierAtAbort
      const second = await host.abort({ parentID, fingerprint: fingerprint(prompt), scope: "task", by: "user", cause: "again" })

      expect(first.sealed).toBe(true)
      expect(second.reason).toBe("already aborted")
      expect(second.durable).toBe(true)
      expect(taskOf(parentID, prompt).frontierAtAbort).toBe(sealedAt)
      expect(taskOf(parentID, prompt).cause).toBe("user command")
    } finally {
      dispose()
    }
  })

  test("session bans every bound child, so an admission inside the child denies row 6", async () => {
    const { api, host, dispose, call } = await wired({})
    const parentID = "ses_abort_ban"
    const childID = "ses_abort_child"
    const prompt = "summarize the parser"
    try {
      await call(prompt, "msg_1", "call_1", parentID)
      await api.feed({ type: "session.created", data: { sessionID: childID, parentID }, created: Date.now() })
      expect(taskOf(parentID, prompt).childIDs).toEqual([childID])

      const receipt = await host.abort({ parentID, fingerprint: fingerprint(prompt), scope: "task", by: "user", cause: "user command" })
      expect(receipt.interrupted).toEqual([childID])

      const childSessionBan = store.readSnapshot(childID).snap?.sessionBan
      expect(childSessionBan?.kind).toBe("subtree")
      expect(String(childSessionBan?.cause)).toContain(fingerprint(prompt).slice(0, 12))

      // Row 6: the child cannot spawn anything, and no generation lifts it.
      await call("write the changelog", "msg_c", "call_c", childID)
      const inside = assertEvent(childID, "msg_c", "call_c")
      const decision = await api.permission.evaluate(inside)
      expect(decision.decision).toBe("deny")
      expect(decision.row).toBe("6")
      expect(inside.effect).toBe("deny")
    } finally {
      dispose()
    }
  })

  test("names a subtree session ban the store refused, so no child is reported session-banned", async () => {
    const childWithoutSessionBan = "ses_abort_unbanned"
    const { api, host, dispose, call } = await wired({
      store: {
        writeSnapshot: (parentID: string, ...rest: any[]) => {
          if (parentID === childWithoutSessionBan) throw new Error("the lock was held")
          return (store.writeSnapshot as any)(parentID, ...rest)
        },
      },
    })
    const parentID = "ses_abort_ban_fail"
    const prompt = "summarize the parser"
    try {
      await call(prompt, "msg_1", "call_1", parentID)
      await api.feed({ type: "session.created", data: { sessionID: childWithoutSessionBan, parentID }, created: Date.now() })
      expect(taskOf(parentID, prompt).childIDs).toEqual([childWithoutSessionBan])

      const receipt = await host.abort({ parentID, fingerprint: fingerprint(prompt), scope: "task", by: "user", cause: "user command" })
      expect(receipt.sealed).toBe(true)
      // The child was interrupted, but its session ban never reached disk: row 6 does
      // not hold there, and the receipt says so instead of the audit alone.
      expect(receipt.interrupted).toEqual([childWithoutSessionBan])
      expect(receipt.sessionBanned).toBe(0)
      expect(receipt.sessionBanFailures).toEqual([childWithoutSessionBan])
      expect(store.readSnapshot(childWithoutSessionBan).snap?.sessionBan).toBeUndefined()
      expect(auditLines(parentID).some((line) => String(line.detail ?? "").includes("subtree session ban refused"))).toBe(true)
    } finally {
      dispose()
    }
  })

  test("works while the feed is degraded, and the parent holds", async () => {
    const { api, host, dispose, call } = await wired({})
    const parentID = "ses_abort_degraded"
    const prompt = "summarize the parser"
    try {
      await call(prompt, "msg_1", "call_1", parentID)
      host.feedFailed("the event feed stopped")

      const receipt = await host.abort({ parentID, fingerprint: fingerprint(prompt), scope: "task", by: "user", cause: "user command" })
      expect(receipt.sealed).toBe(true)

      // The verdict still refuses an unrelated admission: row 9, not a key miss.
      await call("write the changelog", "msg_2", "call_2", parentID)
      const blocked = assertEvent(parentID, "msg_2", "call_2")
      const decision = await api.permission.evaluate(blocked)
      expect(decision.row).toBe("9")
      expect(decision.effect).toBe("ask")
      expect(blocked.effect).toBe("ask")
    } finally {
      dispose()
    }
  })

  test("writes the audit line before the record", async () => {
    const order: string[] = []
    const { host, dispose, call } = await wired({
      store: {
        appendAudit: (parentID: string, line: any) => {
          order.push(`audit:${line.event}`)
          return (store.appendAudit as any)(parentID, line)
        },
        writeTask: (...args: any[]) => {
          order.push("record")
          return (store.writeTask as any)(...args)
        },
      },
    })
    const parentID = "ses_abort_order"
    const prompt = "summarize the parser"
    try {
      await call(prompt, "msg_1", "call_1", parentID)
      order.length = 0
      await host.abort({ parentID, fingerprint: fingerprint(prompt), scope: "task", by: "user", cause: "user command" })

      expect(order[0]).toBe("audit:abort")
      expect(order.indexOf("record")).toBeGreaterThan(0)
      expect(order.indexOf("record")).toBeLessThan(order.indexOf("audit:abort_done"))
    } finally {
      dispose()
    }
  })

  test("refuses a retired or expired task instead of claiming a new seal", async () => {
    const { host, dispose, call } = await wired({})
    const parentID = "ses_abort_retired"
    const expiredID = "ses_abort_expired"
    const prompt = "summarize the parser"
    const key = fingerprint(prompt)
    try {
      await call(prompt, "msg_1", "call_1", parentID)
      await host.abort({ parentID, fingerprint: key, scope: "task", by: "user", cause: "user command" })
      store.writeTask(parentID, key, { ...taskOf(parentID, prompt), retiredAt: Date.now() })

      // The store merge keeps `retiredAt`, so a re-seal would report a tombstone
      // that is not there. The abort refuses and names the state.
      const retired = await host.abort({ parentID, fingerprint: key, scope: "task", by: "user", cause: "again" })
      expect(retired.sealed).toBe(false)
      expect(retired.reason).toBe("already_retired")
      expect(taskOf(parentID, prompt).cause).toBe("user command")
      expect(auditLines(parentID).filter((line) => line.event === "abort_refused").length).toBe(1)

      // The wall backstop passed: spent for the same reason. A backdated
      // abortedAt cannot go through the store's merge, which never moves a
      // terminal field, so the fixture writes the snapshot the clock would have.
      await call(prompt, "msg_2", "call_2", expiredID)
      await host.abort({ parentID: expiredID, fingerprint: key, scope: "task", by: "user", cause: "user command" })
      const path = store.parentPaths(expiredID).snapshot
      const snap = JSON.parse(readFileSync(path, "utf8"))
      snap.tasks[key].abortedAt = Date.now() - rules.TTL_MS - 1
      writeFileSync(path, JSON.stringify(snap))
      const expired = await host.abort({ parentID: expiredID, fingerprint: key, scope: "task", by: "user", cause: "again" })
      expect(expired.sealed).toBe(false)
      expect(expired.reason).toBe("already_expired")
      expect(auditLines(expiredID).filter((line) => line.event === "abort_refused").length).toBe(1)
    } finally {
      dispose()
    }
  })

  test("records who decided", async () => {
    const { host, dispose, call } = await wired({})
    const parentID = "ses_abort_authority"
    const prompt = "summarize the parser"
    try {
      await call(prompt, "msg_1", "call_1", parentID)
      await host.abort({ parentID, fingerprint: fingerprint(prompt), scope: "task", by: "system", cause: "supervisor" })
      expect(taskOf(parentID, prompt).abortedBy).toBe("system")
      expect(auditLines(parentID).find((line) => line.event === "abort")?.detail).toContain("system")
    } finally {
      dispose()
    }
  })

  test("leaves another parent, and a sibling task, untouched", async () => {
    const { api, host, dispose, call } = await wired({})
    const parentID = "ses_abort_scope"
    const otherID = "ses_abort_other"
    const prompt = "summarize the parser"
    try {
      await call(prompt, "msg_1", "call_1", parentID)
      await call("write the changelog", "msg_2", "call_2", parentID)
      await call("draft a spec", "msg_3", "call_3", otherID)
      await api.feed({ type: "session.created", data: { sessionID: "ses_other_child", parentID: otherID }, created: Date.now() })

      const receipt = await host.abort({ parentID, fingerprint: fingerprint(prompt), scope: "task", by: "user", cause: "user command" })
      expect(receipt.interrupted).toEqual([])
      expect(taskOf(parentID, "write the changelog").abortedAt).toBeUndefined()
      expect(taskOf(otherID, "draft a spec").abortedAt).toBeUndefined()
      expect(auditLines(otherID).some((line) => line.event === "abort")).toBe(false)
      // The other parent's child is never interrupted.
      expect(api.interrupts).toEqual([])
    } finally {
      dispose()
    }
  })

  test("a session abort revokes a held call and interrupts the parent", async () => {
    const { api, host, dispose, call } = await wired({})
    const parentID = "ses_abort_session"
    const prompt = "summarize the parser"
    const key = fingerprint(prompt)
    try {
      await call(prompt, "msg_1", "call_1", parentID)
      await host.abort({ parentID, fingerprint: key, scope: "task", by: "user", cause: "user command" })
      await call(prompt, "msg_2", "call_2", parentID)
      const event = assertEvent(parentID, "msg_2", "call_2")
      expect((await api.permission.evaluate(event)).effect).toBe("ask")
      const id = nextPerId()
      await api.feed(askedFrame(parentID, event.message, id))
      api.pending = [{ id, sessionID: parentID, action: SUBAGENT, resources: ["general"], message: event.message }]

      const receipt = await host.abortSession(parentID, "user", "stop the run")
      expect(receipt.sealed).toBe(true)
      expect(receipt.durable).toBe(true)
      // The hold is revoked, not left to take a late answer: its own request is
      // the only pending one, so the session stop rejects it.
      expect(receipt.revoked).toContain(callKey(parentID, "msg_2", "call_2"))
      await until(() => api.replies.length === 1)
      expect(api.replies[0]).toMatchObject({ sessionID: parentID, requestID: id, decision: "reject" })
      expect(receipt.interrupted).toContain(parentID)
      expect(api.interrupts).toContain(parentID)
      expect(store.readSnapshot(parentID).snap?.sessionBan?.kind).toBe("parent")

      const decision = await api.permission.evaluate(assertEvent(parentID, "msg_2", "call_2"))
      expect(decision.effect).toBe("deny")
      expect(decision.reason).toBe("revocation:abort")
    } finally {
      dispose()
    }
  })

  test("a refused record write still seals in memory and blocks a replacement", async () => {
    let fail = false
    const { api, host, dispose, call } = await wired({
      store: {
        writeTask: (...args: any[]) => {
          if (fail) throw new Error("the lock was held")
          return (store.writeTask as any)(...args)
        },
      },
    })
    const parentID = "ses_abort_memory"
    const prompt = "summarize the parser"
    try {
      await call(prompt, "msg_1", "call_1", parentID)
      fail = true
      const receipt = await host.abort({ parentID, fingerprint: fingerprint(prompt), scope: "task", by: "user", cause: "user command" })
      expect(receipt.sealed).toBe(true)
      expect(receipt.durable).toBe(false)

      // The disk record is unchanged, and the in-memory seal still holds the
      // replacement: it does not wait for a restart to matter.
      fail = false
      expect(taskOf(parentID, prompt).abortedAt).toBeUndefined()
      await call(prompt, "msg_2", "call_2", parentID)
      const blocked = assertEvent(parentID, "msg_2", "call_2")
      const decision = await api.permission.evaluate(blocked)
      expect(decision.decision).toBe("hold")
      expect(decision.effect).toBe("ask")
      expect(blocked.effect).toBe("ask")
      expect(auditLines(parentID).some((line) => String(line.detail ?? "").includes("held in memory only"))).toBe(true)
    } finally {
      dispose()
    }
  })

  test("a refused parent session ban still holds the session in memory and says so", async () => {
    let fail = false
    const { api, host, dispose, call } = await wired({
      store: {
        writeSnapshot: (...args: any[]) => {
          if (fail) throw new Error("the lock was held")
          return (store.writeSnapshot as any)(...args)
        },
      },
    })
    const parentID = "ses_abort_session_memory"
    try {
      await call("summarize the parser", "msg_1", "call_1", parentID)
      fail = true
      const receipt = await host.abortSession(parentID, "user", "stop the run")
      expect(receipt.sealed).toBe(true)
      expect(receipt.durable).toBe(false)
      fail = false

      // The disk carries no session ban: the hold is this process's own, and the
      // audit says a restart loses it.
      expect(store.readSnapshot(parentID).snap?.sessionBan).toBeUndefined()
      expect(auditLines(parentID).some((line) => String(line.detail ?? "").includes("parent session ban held in memory only"))).toBe(true)

      // A new subagent call in that session is held anyway.
      await call("write the changelog", "msg_2", "call_2", parentID)
      const blocked = assertEvent(parentID, "msg_2", "call_2")
      const decision = await api.permission.evaluate(blocked)
      expect(decision.decision).toBe("hold")
      expect(decision.row).toBe("sessionBan")
      expect(decision.effect).toBe("ask")
      expect(blocked.effect).toBe("ask")
    } finally {
      dispose()
    }
  })

  test("an unknown task changes nothing and audits the refusal", async () => {
    const { host, dispose, call } = await wired({})
    const parentID = "ses_abort_unknown"
    try {
      await call("summarize the parser", "msg_1", "call_1", parentID)
      const receipt = await host.abort({ parentID, fingerprint: "0".repeat(64), scope: "task", by: "user", cause: "user command" })
      expect(receipt).toMatchObject({ sealed: false, reason: "no such task in this session" })
      expect(taskOf(parentID, "summarize the parser").abortedAt).toBeUndefined()
      expect(auditLines(parentID).some((line) => line.event === "abort_refused")).toBe(true)
    } finally {
      dispose()
    }
  })

  test("a session with no records has nothing to abort", async () => {
    const { host, dispose } = await wired({})
    const receipt = await host.abort({ parentID: "ses_abort_empty", fingerprint: "0".repeat(64), scope: "task", by: "user", cause: "user command" })
    expect(receipt.sealed).toBe(false)
    // A missing snapshot is an empty session, not an unreadable one.
    expect(receipt.reason).toBe("no such task in this session")
    expect(existsSync(store.parentPaths("ses_abort_empty").snapshot)).toBe(false)
    dispose()
  })
})

describe("clearing the session ban", () => {
  test("removes the durable session ban and keeps every other snapshot field", async () => {
    const { host, dispose, call } = await wired({})
    const parentID = "ses_clear_ban"
    try {
      await call("summarize the parser", "msg_1", "call_1", parentID)
      await host.abortSession(parentID, "user", "stop the run")
      const before = store.readSnapshot(parentID).snap!
      expect(before.sessionBan?.kind).toBe("parent")

      expect(host.clearSessionBan(parentID)).toBe("cleared")

      const after = store.readSnapshot(parentID).snap!
      expect(after.sessionBan).toBeUndefined()
      expect(after.tasks).toEqual(before.tasks)
      expect(after.frontierSeq).toBe(before.frontierSeq)
      expect(after.eventCursor).toBe(before.eventCursor)
      expect(after.parentID).toBe(before.parentID)
    } finally {
      dispose()
    }
  })

  test("clears an in-memory only session ban held after a failed marker write", async () => {
    let fail = true
    const { api, host, dispose, call } = await wired({
      store: {
        writeSnapshot: (...args: any[]) => {
          if (fail) throw new Error("the lock was held")
          return (store.writeSnapshot as any)(...args)
        },
      },
    })
    const parentID = "ses_clear_ban_memory"
    try {
      await call("summarize the parser", "msg_1", "call_1", parentID)
      const receipt = await host.abortSession(parentID, "user", "stop the run")
      expect(receipt.durable).toBe(false)
      fail = false

      await call("write the changelog", "msg_2", "call_2", parentID)
      expect((await api.permission.evaluate(assertEvent(parentID, "msg_2", "call_2"))).row).toBe("sessionBan")

      expect(host.clearSessionBan(parentID)).toBe("absent")
      await call("draft a spec", "msg_3", "call_3", parentID)
      expect((await api.permission.evaluate(assertEvent(parentID, "msg_3", "call_3"))).row).not.toBe("sessionBan")
    } finally {
      dispose()
    }
  })

  test("lift refuses a durable abort ban and leaves it in place", async () => {
    const { api, host, dispose, call } = await wired({})
    const parentID = "ses_clear_subtree"
    try {
      await call("summarize the parser", "msg_1", "call_1", parentID)
      expect(store.writeSubtreeBan(parentID, "abort: op_test", 1_700_000_000_000)).toBe(true)

      expect(host.clearSessionBan(parentID)).toBe("refused")
      expect(store.readSnapshot(parentID).snap?.sessionBan?.kind).toBe("subtree")
      expect(auditLines(parentID).some((line) => line.event === "session_ban_kept")).toBe(true)

      // The session stays stopped: row 6 denies whatever admission comes next.
      await call("write the changelog", "msg_2", "call_2", parentID)
      const decision = await api.permission.evaluate(assertEvent(parentID, "msg_2", "call_2"))
      expect(decision.effect).toBe("deny")
      expect(decision.row).toBe("6")
    } finally {
      dispose()
    }
  })

  test("a legacy session stop never replaces a durable abort ban with a retirable one", async () => {
    const { host, dispose, call } = await wired({})
    const parentID = "ses_abort_keeps_subtree"
    try {
      await call("summarize the parser", "msg_1", "call_1", parentID)
      expect(store.writeSubtreeBan(parentID, "abort: op_test", 1_700_000_000_000)).toBe(true)

      const receipt = await host.abortSession(parentID, "user", "stop the run")
      // The session is durably stopped, and it is stopped by the abort's ban.
      expect(receipt.durable).toBe(true)
      expect(store.readSnapshot(parentID).snap?.sessionBan?.kind).toBe("subtree")
      expect(auditLines(parentID).some((line) => line.event === "session_ban_kept")).toBe(true)
    } finally {
      dispose()
    }
  })

  test("an unreadable snapshot is a refused lift, never a clean no-op", async () => {
    const { host, dispose, call } = await wired({})
    const parentID = "ses_clear_unreadable"
    try {
      await call("summarize the parser", "msg_1", "call_1", parentID)
      const { snapshot } = store.parentPaths(parentID)
      writeFileSync(snapshot, "{ not json")
      expect(host.clearSessionBan(parentID)).toBe("unreadable")
      // The bytes are left for the recovery that can still read them.
      expect(readFileSync(snapshot, "utf8")).toBe("{ not json")
    } finally {
      dispose()
    }
  })

  test("a session with no session ban is a clean no-op", async () => {
    const { host, dispose, call } = await wired({})
    const parentID = "ses_clear_ban_none"
    try {
      await call("summarize the parser", "msg_1", "call_1", parentID)
      expect(store.readSnapshot(parentID).snap?.sessionBan).toBeUndefined()
      expect(host.clearSessionBan(parentID)).toBe("absent")
      expect(store.readSnapshot(parentID).snap?.sessionBan).toBeUndefined()
    } finally {
      dispose()
    }
  })

  test("the registered handle exposes clearSession ban", async () => {
    const api = fakeCtx()
    const handle = await register(api.ctx)
    expect(typeof handle.clearSessionBan).toBe("function")
    handle.dispose()
  })

  test("a host that never attached reports unknown, never an absent ban", async () => {
    // `setup` catches a failed start and leaves no handle: that is a host that
    // observed nothing, so the lift must not treat it as a clean session.
    expect(clearBanOrUnknown(null, "ses_never_attached")).toBe("unknown")
  })

  test("a host that is off knows nothing about ban state, so a lift is unknown", async () => {
    const dir = join(scratch, "off-clear")
    const previous = process.env.OPENCODE_JEV_SESSION_BAN_DIR
    process.env.OPENCODE_JEV_SESSION_BAN_DIR = dir
    try {
      const api = fakeCtx()
      const handle = await start(api.ctx, () => false)
      // Not `absent`: an off host observed no state at all, and a caller must
      // never lift a tool ban on the strength of a guess.
      expect(handle.clearSessionBan("ses_off_clear")).toBe("unknown")
      expect(existsSync(dir)).toBe(false)
      handle.dispose()
    } finally {
      process.env.OPENCODE_JEV_SESSION_BAN_DIR = previous
    }
  })
})
