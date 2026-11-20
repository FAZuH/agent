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

const { createAdmissionHost, attach, register, start, callKey, SUBAGENT, EVENT_TYPES } = hostModule
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
  }
  api.ctx = {
    tool: {
      transform: async (fn: (editor: any) => void) => {
        api.transforms += 1
        fn(editor)
      },
      hook: async (name: string, fn: (event: any) => any) => {
        hooks[name] = fn
      },
    },
    permission: {
      hook: async (name: string, fn: (event: any) => any) => {
        permission[name] = fn
      },
      reply: async (input: any) => {
        api.replies.push(input)
      },
      list: async () => api.pending,
    },
    event: {
      subscribe: (options: { types?: string[] }) => {
        api.subscribed += 1
        api.types = options?.types ?? null
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

  test("a second pending permission in the session skips the self-reject", async () => {    const timers: { fn: () => void; ms: number }[] = []
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
      api.ctx.permission.reply = async () => {
        throw new Error("refused")
      }

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

      expect(host.clearSessionBan(parentID)).toBe(true)

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

      expect(host.clearSessionBan(parentID)).toBe(true)
      await call("draft a spec", "msg_3", "call_3", parentID)
      expect((await api.permission.evaluate(assertEvent(parentID, "msg_3", "call_3"))).row).not.toBe("sessionBan")
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
      expect(host.clearSessionBan(parentID)).toBe(true)
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
})
