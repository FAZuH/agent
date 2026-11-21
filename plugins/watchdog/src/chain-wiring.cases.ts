/**
 * The chain as the plugin wires it, over a fake host. Run by
 * `chain-wiring.test.ts` as a child process: the shared `lib/jev/state.ts` fixes
 * its settings and log paths when it is first imported and bun shares one module
 * registry per run, so only a separate process lets this suite own those paths.
 *
 * A real host cannot activate: no shipped host exposes the permission query the
 * chain needs (ticket #19), and nothing in this repository writes the gate file.
 * This suite arms the chain by writing that file into its own scratch home,
 * which is the same explicit operator action the module documents.
 *
 *   bun test plugins/watchdog/src/chain-wiring.test.ts
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const ENV_KEYS = [
  "JEV_DATA_DIR",
  "JEV_STATE_HOME",
  "JEV_SECRET_DIR",
  "OPENCODE_JEV_CONFIG_DIR",
  "OPENCODE_JEV_STATE_HOME",
  "OPENCODE_JEV_SECRET_DIR",
  "OPENCODE_JEV_NOSPAWN_DIR",
  "OPENCODE_JEV_SESSION_BAN_DIR",
  "XDG_STATE_HOME",
  "WATCHDOG_CHAIN",
  "WATCHDOG_CHAIN_NODES",
  "WATCHDOG_CHAIN_HUMAN_ONLY",
  "WATCHDOG_CHAIN_CAP",
  "WATCHDOG_CHAIN_TIMING",
  "WATCHDOG_CHAIN_BATCH_MAX",
  "WATCHDOG_CHAIN_BATCH_MS",
  "WATCHDOG_CHAIN_JEV_BATCH_MAX",
  "WATCHDOG_CHAIN_JEV_BATCH_MS",
]
const prior: Record<string, string | undefined> = {}
for (const key of ENV_KEYS) prior[key] = process.env[key]

const scratch = mkdtempSync(join(tmpdir(), "jev-chain-wire-"))
const STATE = join(scratch, "jev")
const BAN = join(scratch, "ban")
const CONFIG = join(scratch, "config")
const XDG = join(scratch, "xdg")

/** Refuse to touch any path outside this suite's scratch directory. */
function guard(path: string): string {
  expect(path.startsWith(`${scratch}/`)).toBe(true)
  return path
}

/**
 * Point every state resolver at this suite's scratch home. `state.ts` fixes its
 * paths at import, and this runs before the first import below, which is why the
 * suite needs its own process.
 */
function activate(): void {
  process.env.OPENCODE_JEV_CONFIG_DIR = CONFIG
  process.env.OPENCODE_JEV_STATE_HOME = STATE
  process.env.OPENCODE_JEV_SECRET_DIR = join(CONFIG, "secrets")
  process.env.OPENCODE_JEV_NOSPAWN_DIR = BAN
  process.env.OPENCODE_JEV_SESSION_BAN_DIR = BAN
  process.env.JEV_DATA_DIR = CONFIG
  process.env.JEV_STATE_HOME = STATE
  process.env.JEV_SECRET_DIR = join(CONFIG, "secrets")
  process.env.XDG_STATE_HOME = XDG
}

const posted: any[] = []
const deleted: string[] = []
/** Make the service refuse card removal: the host cannot confirm a cancellation. */
let deleteFails = false
/** When set, a card POST waits on it: the test is holding the card open. */
let postGate: Promise<void> | null = null
let postArrived: (() => void) | null = null
/** Question ids the fake provider leaves unanswered, so `ask` rejects the batch. */
let omitAnswers: ((payload: any) => string[]) | null = null
/** Answers the fake provider returns verbatim, for the rejection-log cases. */
let malformedAnswers: ((payload: any) => Record<string, any>) | null = null
/** Answer every question with a confident allow, over the criteria's four labels. */
const CHOICE = (label: string) => ({
  type: "choice",
  choice: label,
  probabilities:
    label === "allow"
      ? { allow: 0.96, propagate: 0.02, deny: 0.01, abort: 0.01 }
      : { allow: 0.01, propagate: 0.02, deny: 0.01, abort: 0.96 },
})
const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const url = new URL(request.url)
    if (url.pathname === "/decisions" && request.method === "POST") {
      const payload = await request.json()
      const omitted = new Set(omitAnswers?.(payload) ?? [])
      const malformed = malformedAnswers?.(payload) ?? {}
      const answers: Record<string, any> = {}
      for (const id of Object.keys(payload?.questions ?? {})) {
        if (omitted.has(id)) continue
        answers[id] = malformed[id] ?? CHOICE("allow")
      }
      return Response.json({ answers })
    }
    const match = url.pathname.match(/^\/api\/session\/([^/]+)\/form(?:\/([^/]+))?$/)
    if (!match) return new Response("not found", { status: 404 })
    const formID = match[2] ? decodeURIComponent(match[2]) : ""
    if (request.method === "POST") {
      const card = await request.json()
      if (postGate) {
        postArrived?.()
        await postGate
      }
      posted.push({ sessionID: decodeURIComponent(match[1]), card })
      return Response.json({ ok: true })
    }
    if (request.method === "DELETE") {
      if (deleteFails) return new Response("no", { status: 500 })
      deleted.push(formID)
    }
    return new Response(null, { status: 204 })
  },
})

activate()
for (const dir of [STATE, BAN, CONFIG, join(XDG, "opencode")]) mkdirSync(dir, { recursive: true })
writeFileSync(join(XDG, "opencode", "service.json"), JSON.stringify({ url: `http://127.0.0.1:${server.port}`, password: "test" }))

const { default: plugin } = await import("./index.ts")
const state = await import("../../../lib/jev/state.ts")
const { banTool } = await import("../../../lib/jev/tool-ban.ts")
const { chainStateHome, CHAIN_BUDGET_FILE, CHAIN_GATE_FILE, CHAIN_GATE_PASSED } = await import("./chain.ts")

// Every path the shared library resolved must be inside this suite's scratch
// home. Anything else belongs to another suite or to the real machine, and this
// suite never reads or writes one: it refuses to start instead.
for (const path of [state.STATE_FILE, state.LOG_FILE, state.DEFAULT_SECRET_FILE]) expect(path.startsWith(`${scratch}/`)).toBe(true)

afterAll(() => {
  server.stop(true)
  for (const key of ENV_KEYS) {
    if (prior[key] === undefined) delete process.env[key]
    else process.env[key] = prior[key]
  }
  rmSync(scratch, { recursive: true, force: true })
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (prior[key] === undefined) delete process.env[key]
    else process.env[key] = prior[key]
  }
})

/** A per-test marker in this run's append-only log; no path is ever deleted. */
let marker = ""

beforeEach(() => {
  activate()
  for (const dir of [STATE, BAN]) {
    rmSync(guard(dir), { recursive: true, force: true })
    mkdirSync(guard(dir), { recursive: true })
  }
  posted.length = 0
  deleted.length = 0
  deleteFails = false
  postGate = null
  postArrived = null
  omitAnswers = null
  malformedAnswers = null
  // Pacing knobs are pinned per case: an inherited operator value must not move
  // the default this suite asserts.
  for (const key of Object.keys(process.env)) if (key.startsWith("WATCHDOG_CHAIN")) delete process.env[key]
  const base = state.loadState()
  // The question-card route also registers execute.before; off here keeps the
  // capture to the chain alone. A high logMax keeps one test's rows from being
  // pruned before the next reads them.
  state.saveState({
    enabled: true,
    logMax: 5000,
    config: { ...base.config, hook_tool_risk: { ...base.config.hook_tool_risk, questionCards: false } },
  })
  marker = `m_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
  state.logCall({ hook: "test_marker", case: marker })
})

/** Log rows written since this test's marker, newest first. */
function since(): any[] {
  const rows = state.readLog(100000)
  const at = rows.findIndex((row) => row.hook === "test_marker" && row.case === marker)
  return at < 0 ? rows : rows.slice(0, at)
}

/** The capability verdict only the ticket #19 routine may write. */
function gateVerdict(value: unknown = CHAIN_GATE_PASSED): void {
  gateRaw(JSON.stringify({ gate: value }))
}

/** Gate file bytes verbatim: the malformed cases. */
function gateRaw(text: string): void {
  const home = chainStateHome()
  expect(home.startsWith(`${scratch}/`)).toBe(true)
  mkdirSync(home, { recursive: true })
  writeFileSync(join(home, CHAIN_GATE_FILE), text)
}

/** Drop the gate file: the second activation condition disappears. */
function ungate(): void {
  const home = chainStateHome()
  expect(home.startsWith(`${scratch}/`)).toBe(true)
  rmSync(join(home, CHAIN_GATE_FILE), { force: true })
}

/** Both activation conditions: the operator's switch and the gate file. */
function arm(): void {
  process.env.WATCHDOG_CHAIN = "1"
  gateVerdict()
}

function nodes(list: string): void {
  process.env.WATCHDOG_CHAIN_NODES = list
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

const settle = async (promise: Promise<unknown>) => promise.then(
  () => "allowed",
  (error: Error) => error.message,
)

/** The card open is an HTTP round trip: wait for it, bounded. */
const cardsOpen = async (count: number) => {
  for (let i = 0; i < 500 && posted.length < count; i++) await tick()
  expect(posted).toHaveLength(count)
}

const ticks = async (count = 8) => {
  for (let i = 0; i < count; i++) await tick()
}

/** One user task, one assistant claim and one tool result: only the first survives. */
const MESSAGES = [
  { role: "user", text: "clean up the build directory" },
  { role: "assistant", text: "I will list the files first" },
  { role: "tool", parts: [{ type: "tool", state: { output: "TOOL_OUTPUT_SECRET" } }] },
]

interface Subscription {
  stream: any
  types: string[]
  push(event: any): Promise<void>
  lose(): Promise<void>
}

function subscription(): Subscription {
  const queue: any[] = []
  let ended = false
  let wake: (() => void) | null = null
  const wakeIt = () => {
    wake?.()
    wake = null
  }
  const stream = {
    [Symbol.asyncIterator]() {
      return {
        async next() {
          while (!queue.length) {
            if (ended) return { value: undefined, done: true }
            await new Promise<void>((resolve) => {
              wake = resolve
            })
          }
          return { value: queue.shift(), done: false }
        },
        async return() {
          ended = true
          wakeIt()
          return { value: undefined, done: true }
        },
      }
    },
  }
  return {
    stream,
    types: [] as string[],
    async push(event: any) {
      queue.push(event)
      wakeIt()
      await ticks(5)
    },
    async lose() {
      ended = true
      wakeIt()
      await ticks(5)
    },
  }
}

interface Host {
  ctx: any
  hooks: Record<string, Array<(event: any) => any>>
  generateHooks: Array<(event: any) => any>
  subscriptions: Subscription[]
  /** The answer feeds the chain opens: the fake host's other hooks subscribe too. */
  formFeeds(): Subscription[]
  calls: { generate: any[]; context: string[]; checks: any[]; projected: any[] }
  push(event: any): Promise<void>
  lose(): Promise<void>
}

interface HostOptions {
  generate?: (request: any) => any
  effect?: (index: number) => string | Promise<string>
  /** Model a host that does not run the generate hook for one call. */
  skipFilter?: (index: number) => boolean
  /** Hold one call before its generate hook fires. */
  beforeHook?: (index: number) => Promise<void> | void
  /** Model an unexpected projection shape. */
  shape?: (event: any) => any
  /** The user-only context this host projects. */
  context?: any[]
  /** Text the host appends to the newest projected message. */
  appendToNewest?: string
  /** Present the newest projected message as several text parts. */
  spreadNewest?: boolean
  /** Model a host that refuses to register one named hook. */
  rejectHook?: (name: string) => boolean
}

function fakeHost(options: HostOptions = {}): Host {
  const hooks: Record<string, Array<(event: any) => any>> = {}
  const generateHooks: Array<(event: any) => any> = []
  const subscriptions: Subscription[] = []
  const calls: Host["calls"] = { generate: [], context: [], checks: [], projected: [] }
  const context = options.context ?? MESSAGES
  const ctx: any = {
    location: { directory: scratch },
    permission: {
      hook: async () => {},
      reply: async () => {},
      list: async () => [],
      check: async (request: any) => {
        const index = calls.checks.length
        calls.checks.push(request)
        return { effect: options.effect ? await options.effect(index) : "allow" }
      },
    },
    tool: {
      transform: async () => {},
      hook: async (name: string, callback: any) => {
        if (options.rejectHook?.(name)) throw new Error(`no ${name} hook here`)
        ;(hooks[name] ??= []).push(callback)
      },
    },
    event: {
      subscribe: (options?: any) => {
        const created = subscription()
        created.types = Array.isArray(options?.types) ? options.types : []
        subscriptions.push(created)
        return created.stream
      },
    },
    session: {
      hook: async (name: string, callback: any) => {
        if (name === "generate") generateHooks.push(callback)
      },
      context: async ({ sessionID }: any) => {
        calls.context.push(sessionID)
        return context
      },
      generate: async (request: any) => {
        const index = calls.generate.length
        calls.generate.push(request)
        const newest = options.appendToNewest
          ? { role: "user", content: `${request.prompt}${options.appendToNewest}` }
          : options.spreadNewest
            ? {
                role: "user",
                parts: [
                  { type: "text", text: request.prompt },
                  { type: "text", text: "EXPANSION_TEXT" },
                ],
              }
            : { role: "user", content: request.prompt }
        const base = { sessionID: request.sessionID, messages: [...context, newest] }
        const event = options.shape ? options.shape(base) : base
        if (!options.skipFilter?.(index)) {
          await options.beforeHook?.(index)
          for (const hook of generateHooks) await hook(event)
        }
        calls.projected.push(event.messages)
        return { data: { text: options.generate ? await options.generate(request) : "" } }
      },
      get: async () => ({}),
      interrupt: async () => {},
      synthetic: async () => {},
    },
    command: { transform: async () => {} },
  }
  const formFeeds = () => subscriptions.filter((entry) => entry.types.includes("form.replied"))
  const active = () => {
    const feeds = formFeeds()
    return feeds[feeds.length - 1]
  }
  return {
    ctx,
    hooks,
    generateHooks,
    subscriptions,
    formFeeds,
    calls,
    push: (event: any) => active().push(event),
    lose: () => active().lose(),
  }
}

const gate = (hooks: Record<string, Array<(event: any) => any>>) => {
  const list = hooks["execute.before"] ?? []
  expect(list).toHaveLength(1)
  return list[0]
}

/** The wrapper of the last setup, for a host that registers one per setup. */
const latestGate = (hooks: Record<string, Array<(event: any) => any>>) => {
  const list = hooks["execute.before"] ?? []
  expect(list.length).toBeGreaterThan(0)
  return list[list.length - 1]
}

const idsIn = (text: string): string[] => [...String(text ?? "").matchAll(/wd_[0-9a-f]{24}(?:\.\d+)?/g)].map((match) => match[0])
const itemIDOf = (text: string): string => idsIn(text)[0] ?? ""

/** One allow row per item the prompt carries: a batch gets an answer for each. */
const allowReply = (prompt: string) => JSON.stringify({ results: idsIn(prompt).map((id) => ({ id, verdict: "allow", reason: "routine for the task" })) })

const chainRows = (itemID: string) => since().filter((row) => row.hook === "hook_watchdog_chain" && row.itemID === itemID)

const chainRow = (predicate: (row: any) => boolean) => since().find((row) => row.hook === "hook_watchdog_chain" && predicate(row))

/** The activation rows this test wrote: one per setup, plus one per change. */
const announcements = () => since().filter((row) => row.protection === "not-enabled")

describe("activation", () => {
  test("the switch alone reports an absent gate and passes calls through", async () => {
    process.env.WATCHDOG_CHAIN = "1"
    nodes("human")
    const host = fakeHost()
    await plugin.setup(host.ctx)
    expect(announcements()).toHaveLength(1)
    expect(announcements()[0].reason).toBe("the capability gate file is absent")
    expect(announcements()[0].wired).toBe(true)
    // The wrapper tracks the switch, so a gate file written later is honoured.
    const wrapper = gate(host.hooks)
    await expect(wrapper({ sessionID: "ses_w50", tool: "shell", input: { command: "ls" }, id: "c50" })).resolves.toBeUndefined()
    await expect(wrapper({ sessionID: "ses_w50", tool: "shell", input: { command: "ls" }, id: "c50b" })).resolves.toBeUndefined()
    expect(announcements()).toHaveLength(1)
    expect(since().some((row) => row.event === "chain_stage")).toBe(false)
    expect(host.calls.checks).toHaveLength(0)
  })

  test("a gate file that is present but unpassed is reported as not passed", async () => {
    process.env.WATCHDOG_CHAIN = "1"
    gateVerdict("blocked")
    nodes("human")
    const host = fakeHost()
    await plugin.setup(host.ctx)
    expect(announcements()).toHaveLength(1)
    expect(announcements()[0].reason).toBe("the capability gate has not passed")
    await gate(host.hooks)({ sessionID: "ses_w51", tool: "shell", input: { command: "ls" }, id: "c51" })
    expect(announcements()).toHaveLength(1)
    expect(since().some((row) => row.event === "chain_stage")).toBe(false)
    expect(host.calls.checks).toHaveLength(0)
  })

  test("an unparseable gate file is reported as malformed", async () => {
    process.env.WATCHDOG_CHAIN = "1"
    gateRaw("{not json")
    nodes("human")
    const host = fakeHost()
    await plugin.setup(host.ctx)
    expect(announcements()).toHaveLength(1)
    expect(announcements()[0].reason).toBe("the capability gate file is unreadable or malformed")
    await expect(gate(host.hooks)({ sessionID: "ses_w53", tool: "shell", input: { command: "ls" }, id: "c53" })).resolves.toBeUndefined()
    expect(host.calls.checks).toHaveLength(0)
  })

  test("the gate file alone wires nothing", async () => {
    gateVerdict()
    nodes("human")
    const host = fakeHost()
    await plugin.setup(host.ctx)
    expect(host.hooks["execute.before"]).toBeUndefined()
  })

  test("a gate file written after setup activates the next call", async () => {
    process.env.WATCHDOG_CHAIN = "1"
    nodes("human")
    const host = fakeHost()
    await plugin.setup(host.ctx)
    const wrapper = gate(host.hooks)
    await expect(wrapper({ sessionID: "ses_w52", tool: "shell", input: { command: "ls" }, id: "c52a" })).resolves.toBeUndefined()
    expect(host.calls.checks).toHaveLength(0)

    gateVerdict()
    const pending = wrapper({ sessionID: "ses_w52", tool: "shell", input: { command: "ls" }, id: "c52b" })
    await cardsOpen(1)
    expect(host.calls.checks.length).toBeGreaterThan(0)
    await host.push({ type: "form.replied", data: { id: posted[0].card.id, answer: { decision: "allow" } } })
    expect(await settle(pending)).toBe("allowed")
  })

  test("each effective status change is reported once, passed included", async () => {
    process.env.WATCHDOG_CHAIN = "1"
    nodes("supervisor")
    const host = fakeHost({ generate: (request) => allowReply(request.prompt) })
    await plugin.setup(host.ctx)
    const wrapper = gate(host.hooks)
    const call = (id: string) => wrapper({ sessionID: "ses_w54", tool: "shell", input: { command: "ls" }, id })

    await settle(call("c54a"))
    await settle(call("c54b"))
    expect(announcements().map((row) => row.reason)).toEqual(["the capability gate file is absent"])

    gateVerdict()
    expect(await settle(call("c54c"))).toBe("allowed")
    expect(chainRow((row) => row.protection === "active")?.wired).toBe(true)
    expect(announcements()).toHaveLength(1)

    ungate()
    await settle(call("c54d"))
    expect(announcements()).toHaveLength(2)
  })

  test("both conditions wire one wrapper and one filter, and report it active", async () => {
    arm()
    nodes("human")
    const host = fakeHost()
    await plugin.setup(host.ctx)
    expect(host.hooks["execute.before"]).toHaveLength(1)
    expect(host.generateHooks).toHaveLength(1)
    expect(chainRow((entry) => entry.protection === "active")?.wired).toBe(true)
    expect(announcements()).toHaveLength(0)
  })
})

describe("a retired wrapper", () => {
  const CALL = (id: string) => ({ sessionID: "ses_w60", tool: "shell", input: { command: "ls" }, id })

  test("never decides a later call", async () => {
    arm()
    nodes("supervisor")
    const host = fakeHost({ generate: (request) => allowReply(request.prompt) })
    await plugin.setup(host.ctx)
    await plugin.setup(host.ctx)
    const list = host.hooks["execute.before"] ?? []
    expect(list).toHaveLength(2)

    // A host that keeps both callbacks reaches the retired one first.
    await expect(list[0](CALL("call_60a"))).resolves.toBeUndefined()
    expect(host.calls.checks).toHaveLength(0)
    expect(since().some((row) => row.event === "chain_stage")).toBe(false)

    // The current wrapper still reviews exactly one call.
    expect(await settle(list[1](CALL("call_60b")))).toBe("allowed")
    expect(host.calls.checks.length).toBeGreaterThan(0)
    expect(since().filter((row) => row.event === "chain_decision")).toHaveLength(1)
  })

  test("never reports a status it did not observe", async () => {
    arm()
    nodes("supervisor")
    const host = fakeHost()
    await plugin.setup(host.ctx)
    ungate()
    await plugin.setup(host.ctx)
    const list = host.hooks["execute.before"] ?? []
    expect(list).toHaveLength(2)
    expect(announcements()).toHaveLength(1)

    await expect(list[0](CALL("call_61"))).resolves.toBeUndefined()
    expect(announcements()).toHaveLength(1)
    expect(host.calls.checks).toHaveLength(0)
  })
})

describe("required wiring", () => {
  test("no event feed: every call is refused and the failure is recorded", async () => {
    arm()
    nodes("human")
    const host = fakeHost()
    delete host.ctx.event.subscribe
    await plugin.setup(host.ctx)
    await expect(gate(host.hooks)({ sessionID: "ses_w20", tool: "shell", input: { command: "ls" }, id: "c20" })).rejects.toThrow(
      /cannot run on this host/,
    )
    const row = chainRow((entry) => entry.protection === "incomplete")
    expect(String(row?.reason ?? "")).toContain("cannot deliver a card answer")
    expect(row?.wired).toBe(false)
    expect(chainRow((entry) => entry.protection === "active")).toBeUndefined()
  })

  test("a refused execute.before registration is reported as unwired, not active", async () => {
    arm()
    nodes("human")
    const host = fakeHost({ rejectHook: (name) => name === "execute.before" })
    await expect(plugin.setup(host.ctx)).rejects.toThrow(/refused/)
    expect(host.hooks["execute.before"]).toBeUndefined()
    expect(chainRow((entry) => entry.protection === "active")).toBeUndefined()
    expect(chainRow((entry) => entry.wired === true)).toBeUndefined()
    const row = chainRow((entry) => entry.protection === "incomplete")
    expect(row?.wired).toBe(false)
    expect(String(row?.reason ?? "")).toContain("execute.before")
  })

  test("no generate hook: every call is refused and the failure is recorded", async () => {
    arm()
    nodes("human")
    const host = fakeHost()
    delete host.ctx.session.hook
    await plugin.setup(host.ctx)
    await expect(gate(host.hooks)({ sessionID: "ses_w21", tool: "shell", input: { command: "ls" }, id: "c21" })).rejects.toThrow(
      /cannot run on this host/,
    )
    const row = chainRow((entry) => entry.protection === "incomplete")
    expect(String(row?.reason ?? "")).toContain("cannot filter the review projection")
  })

  test("no tool hook: protection is absent, and no denial is claimed", async () => {
    arm()
    nodes("human")
    const host = fakeHost()
    delete host.ctx.tool.hook
    await plugin.setup(host.ctx)
    expect(host.hooks["execute.before"]).toBeUndefined()
    const row = chainRow((entry) => entry.protection === "absent")
    expect(String(row?.reason ?? "")).toContain("no tool.execute.before hook")
    expect(row?.denied).toBeUndefined()
  })

  test("disarming stops an installed deny-all wrapper instead of leaving it behind", async () => {
    arm()
    nodes("human")
    const host = fakeHost()
    delete host.ctx.session.hook
    await plugin.setup(host.ctx)
    const wrapper = gate(host.hooks)
    await expect(wrapper({ sessionID: "ses_w26", tool: "shell", input: { command: "ls" }, id: "c26" })).rejects.toThrow(/cannot run on this host/)
    delete process.env.WATCHDOG_CHAIN
    await expect(wrapper({ sessionID: "ses_w26", tool: "shell", input: { command: "ls" }, id: "c26" })).resolves.toBeUndefined()
  })
})

describe("the generation boundary", () => {
  test("a review generation is reduced to the review prompt alone", async () => {
    arm()
    nodes("supervisor")
    const host = fakeHost({ generate: (request) => allowReply(request.prompt) })
    await plugin.setup(host.ctx)
    await gate(host.hooks)({ sessionID: "ses_w01", tool: "shell", input: { command: "ls build" }, id: "call_1" })

    const projected = host.calls.projected[0]
    expect(projected).toHaveLength(1)
    expect(projected[0].role).toBe("user")
    const sent = JSON.stringify(projected)
    expect(sent).not.toContain("I will list the files first")
    expect(sent).not.toContain("TOOL_OUTPUT_SECRET")
    expect(projected[0].content).toBe(host.calls.generate[0].prompt)

    const itemID = itemIDOf(host.calls.generate[0].prompt)
    expect(itemID).not.toBe("")
    expect(chainRows(itemID).find((row) => row.event === "chain_decision")?.verdict).toBe("allow")
  })

  test("an ordinary turn is left whole", async () => {
    arm()
    nodes("supervisor")
    const host = fakeHost({ generate: (request) => allowReply(request.prompt) })
    await plugin.setup(host.ctx)
    await gate(host.hooks)({ sessionID: "ses_w02", tool: "shell", input: { command: "ls" }, id: "call_2" })

    const ordinary = { sessionID: "ses_w02", messages: [...MESSAGES, { role: "user", content: "please fix the build" }] }
    for (const hook of host.generateHooks) await hook(ordinary)
    expect(ordinary.messages).toHaveLength(MESSAGES.length + 1)
  })

  test("a host that does not run the filter makes the supervisor unavailable", async () => {
    arm()
    nodes("supervisor,human")
    const host = fakeHost({ generate: (request) => allowReply(request.prompt), skipFilter: () => true })
    await plugin.setup(host.ctx)
    const pending = gate(host.hooks)({ sessionID: "ses_w03", tool: "shell", input: { command: "ls" }, id: "call_3" })
    await cardsOpen(1)
    expect(host.calls.generate).toHaveLength(1)
    await host.push({ type: "form.replied", data: { id: posted[0].card.id, answer: { decision: "allow" } } })
    await pending
  })

  test("an unrecognized projection shape makes the supervisor unavailable", async () => {
    arm()
    nodes("supervisor,human")
    const host = fakeHost({ generate: (request) => allowReply(request.prompt), shape: () => ({ messages: "not-a-list" }) })
    await plugin.setup(host.ctx)
    const pending = gate(host.hooks)({ sessionID: "ses_w04", tool: "shell", input: { command: "ls" }, id: "call_4" })
    await cardsOpen(1)
    await host.push({ type: "form.replied", data: { id: posted[0].card.id, answer: { decision: "allow" } } })
    await pending
  })

  test("text the host appends to the newest message never reaches the reviewer", async () => {
    arm()
    nodes("supervisor,human")
    const host = fakeHost({ generate: (request) => allowReply(request.prompt), appendToNewest: "\n\nEXPANSION_TEXT" })
    await plugin.setup(host.ctx)
    const pending = gate(host.hooks)({ sessionID: "ses_w09", tool: "shell", input: { command: "ls" }, id: "call_9" })
    await cardsOpen(1)
    expect(chainRow((row) => row.stage === "supervisor")?.verdict).toBe("unavailable")
    await host.push({ type: "form.replied", data: { id: posted[0].card.id, answer: { decision: "allow" } } })
    expect(await settle(pending)).toBe("allowed")
  })

  test("a newest message split into extra parts never reaches the reviewer", async () => {
    arm()
    nodes("supervisor,human")
    const host = fakeHost({ generate: (request) => allowReply(request.prompt), spreadNewest: true })
    await plugin.setup(host.ctx)
    const pending = gate(host.hooks)({ sessionID: "ses_w10", tool: "shell", input: { command: "ls" }, id: "call_10" })
    await cardsOpen(1)
    expect(chainRow((row) => row.stage === "supervisor")?.verdict).toBe("unavailable")
    await host.push({ type: "form.replied", data: { id: posted[0].card.id, answer: { decision: "allow" } } })
    expect(await settle(pending)).toBe("allowed")
  })

  test("a second review of the same item gets its own filter proof", async () => {
    arm()
    nodes("supervisor,human")
    const host = fakeHost({
      generate: (request) => allowReply(request.prompt),
      skipFilter: (index) => index === 1,
    })
    await plugin.setup(host.ctx)
    const run = gate(host.hooks)
    await run({ sessionID: "ses_w05", tool: "shell", input: { command: "ls" }, id: "call_5a" })

    const pending = run({ sessionID: "ses_w05", tool: "shell", input: { command: "ls" }, id: "call_5b" })
    await cardsOpen(1)
    await host.push({ type: "form.replied", data: { id: posted[0].card.id, answer: { decision: "allow" } } })
    await pending
    expect(host.calls.projected[0]).toHaveLength(1)
    expect(host.calls.projected[1]).toHaveLength(MESSAGES.length + 1)
  })

  test("concurrent reviews of one item each filter their own projection", async () => {
    arm()
    nodes("supervisor")
    const host = fakeHost({ generate: (request) => allowReply(request.prompt) })
    await plugin.setup(host.ctx)
    const run = gate(host.hooks)
    const first = run({ sessionID: "ses_w06", tool: "shell", input: { command: "ls" }, id: "call_6a" })
    const second = run({ sessionID: "ses_w06", tool: "shell", input: { command: "ls" }, id: "call_6b" })
    await first
    await second
    expect(host.calls.projected).toHaveLength(2)
    for (const projection of host.calls.projected) expect(projection).toHaveLength(1)
  })

  test("a concurrent review keeps its own marker after the first one completes", async () => {
    arm()
    nodes("supervisor,human")
    let releaseSecond: () => void = () => {}
    const secondMayFilter = new Promise<void>((resolve) => {
      releaseSecond = resolve
    })
    const host = fakeHost({
      generate: (request) => allowReply(request.prompt),
      beforeHook: async (index) => {
        if (index === 1) await secondMayFilter
      },
    })
    await plugin.setup(host.ctx)
    const run = gate(host.hooks)
    const first = run({ sessionID: "ses_w08", tool: "shell", input: { command: "ls" }, id: "call_8a" })
    const second = run({ sessionID: "ses_w08", tool: "shell", input: { command: "ls" }, id: "call_8b" })
    for (let i = 0; i < 200 && host.calls.generate.length < 2; i++) await tick()
    expect(host.calls.generate).toHaveLength(2)
    await first
    releaseSecond()
    expect(await settle(second)).toBe("allowed")
    for (const projection of host.calls.projected) expect(projection).toHaveLength(1)
    expect(posted).toHaveLength(0)
  })

  test("a reply that authorizes nothing keeps the call from running", async () => {
    arm()
    nodes("supervisor")
    const host = fakeHost({ generate: () => JSON.stringify({ results: [] }) })
    await plugin.setup(host.ctx)
    await expect(gate(host.hooks)({ sessionID: "ses_w07", tool: "shell", input: { command: "rm -rf build" }, id: "call_7" })).rejects.toThrow(
      /did not run/,
    )
  })
})

describe("the host's own rules", () => {
  test("a host deny stops the call before any node or card", async () => {
    arm()
    nodes("supervisor,human")
    const host = fakeHost({ effect: () => "deny" })
    await plugin.setup(host.ctx)
    await expect(gate(host.hooks)({ sessionID: "ses_w20", tool: "shell", input: { command: "rm -rf build" }, id: "call_20" })).rejects.toThrow(
      /denied/,
    )
    expect(host.calls.generate).toHaveLength(0)
    expect(posted).toHaveLength(0)
  })

  test("a host with no permission query authorizes nothing", async () => {
    arm()
    nodes("human")
    const host = fakeHost()
    delete host.ctx.permission.check
    await plugin.setup(host.ctx)
    await expect(gate(host.hooks)({ sessionID: "ses_w21", tool: "shell", input: { command: "ls" }, id: "call_21" })).rejects.toThrow(
      /did not run/,
    )
    expect(posted).toHaveLength(0)
  })

  test("a host ask goes straight to the human, skipping the supervisor", async () => {
    arm()
    nodes("supervisor,human")
    const host = fakeHost({ effect: () => "ask" })
    await plugin.setup(host.ctx)
    const pending = gate(host.hooks)({ sessionID: "ses_w22", tool: "shell", input: { command: "ls" }, id: "call_22" })
    await cardsOpen(1)
    expect(host.calls.generate).toHaveLength(0)
    await host.push({ type: "form.replied", data: { id: posted[0].card.id, answer: { decision: "allow" } } })
    await pending
  })

  test("the host is rechecked at release, and a deny there stops the call", async () => {
    arm()
    nodes("supervisor")
    const host = fakeHost({ effect: (index) => (index === 0 ? "allow" : "deny"), generate: (request) => allowReply(request.prompt) })
    await plugin.setup(host.ctx)
    await expect(gate(host.hooks)({ sessionID: "ses_w23", tool: "shell", input: { command: "ls" }, id: "call_23" })).rejects.toThrow(
      /denied/,
    )
    expect(host.calls.checks).toHaveLength(2)
  })

  test("a ban applied during the release check still stops the call", async () => {
    arm()
    nodes("supervisor")
    const host = fakeHost({
      generate: (request) => allowReply(request.prompt),
      effect: (index) => {
        if (index === 1) banTool("ses_w24", [], "applied while the check was in flight")
        return "allow"
      },
    })
    await plugin.setup(host.ctx)
    const settled = settle(gate(host.hooks)({ sessionID: "ses_w24", tool: "shell", input: { command: "ls" }, id: "call_24" }))
    expect(await settled).toMatch(/denied/)
    const row = chainRow((entry) => entry.event === "chain_decision")
    expect(String(row?.reason ?? "")).toContain("tool ban")
  })

  test("a check that throws denies without leaking its text", async () => {
    arm()
    nodes("supervisor")
    const secret = "api_key=abcdef123456"
    const host = fakeHost({
      effect: () => {
        throw new Error(secret)
      },
    })
    await plugin.setup(host.ctx)
    const error: any = await gate(host.hooks)({ sessionID: "ses_w25", tool: "shell", input: { command: "ls" }, id: "call_25" }).catch(
      (failure: any) => failure,
    )
    expect(String(error?.message)).toMatch(/did not run/)
    expect(String(error?.message)).not.toContain(secret)
    expect(JSON.stringify(since())).not.toContain("abcdef123456")
  })
})

describe("the human hold", () => {
  test("a supervisor that cannot generate advances to the card, which decides", async () => {
    arm()
    nodes("supervisor,human")
    const host = fakeHost({
      generate: () => {
        throw new Error("generate failed")
      },
    })
    await plugin.setup(host.ctx)
    const pending = gate(host.hooks)({ sessionID: "ses_w30", tool: "shell", input: { command: "ls" }, id: "call_30" })
    await cardsOpen(1)
    await host.push({ type: "form.replied", data: { id: posted[0].card.id, answer: { decision: "allow" } } })
    await pending
  })

  test("the card shows the exact action, its task, and the item id", async () => {
    arm()
    nodes("human")
    const host = fakeHost()
    await plugin.setup(host.ctx)
    const pending = gate(host.hooks)({ sessionID: "ses_w31", tool: "shell", input: { command: "ls build" }, id: "call_31" })
    await cardsOpen(1)
    const card = posted[0].card
    const brief = String(card.fields[0].description)
    expect(brief).toContain("shell")
    expect(brief).toContain('Arguments: {"command":"ls build"}')
    expect(brief).toContain("clean up the build directory")
    expect(brief).not.toContain("I will list the files first")
    const itemID = itemIDOf(brief)
    expect(itemID).not.toBe("")
    expect(card.metadata.watchdogItem).toBe(itemID)
    expect(card.metadata.jevTool).toBe("shell")
    await host.push({ type: "form.replied", data: { id: card.id, answer: { decision: "allow" } } })
    await pending
  })

  test("an approval releases only the exact call it names", async () => {
    arm()
    nodes("human")
    const host = fakeHost()
    await plugin.setup(host.ctx)
    const run = gate(host.hooks)

    const first = run({ sessionID: "ses_w32", tool: "shell", input: { command: "ls" }, id: "call_a" })
    const second = run({ sessionID: "ses_w32", tool: "shell", input: { command: "rm -rf /" }, id: "call_b" })
    await cardsOpen(2)
    const [cardA, cardB] = posted
    expect(cardA.card.metadata.watchdogItem).not.toBe(cardB.card.metadata.watchdogItem)

    let secondSettled = false
    void second.then(
      () => (secondSettled = true),
      () => (secondSettled = true),
    )
    await host.push({ type: "form.replied", data: { id: cardA.card.id, answer: { decision: "allow" } } })
    await first
    expect(secondSettled).toBe(false)

    await host.push({ type: "form.replied", data: { id: cardB.card.id, answer: { decision: "deny" } } })
    await expect(second).rejects.toThrow(/denied/)
  })

  test("a dismissed card grants nothing", async () => {
    arm()
    nodes("human")
    const host = fakeHost()
    await plugin.setup(host.ctx)
    const settled = settle(gate(host.hooks)({ sessionID: "ses_w33", tool: "shell", input: { command: "ls" }, id: "call_c" }))
    await cardsOpen(1)
    await host.push({ type: "form.cancelled", data: { id: posted[0].card.id } })
    expect(await settled).toMatch(/did not run/)
  })

  test("a human allow is still refused when the host denies at release", async () => {
    arm()
    nodes("human")
    const host = fakeHost({ effect: (index) => (index === 0 ? "allow" : "deny") })
    await plugin.setup(host.ctx)
    const settled = settle(gate(host.hooks)({ sessionID: "ses_w34", tool: "shell", input: { command: "ls" }, id: "call_34" }))
    await cardsOpen(1)
    await host.push({ type: "form.replied", data: { id: posted[0].card.id, answer: { decision: "allow" } } })
    expect(await settled).toMatch(/denied/)
  })
})

describe("feed lifetime", () => {
  test("feed loss resolves an open hold, removes its card, refuses a new one, and records the failure", async () => {
    arm()
    nodes("human")
    const host = fakeHost()
    await plugin.setup(host.ctx)
    const first = settle(gate(host.hooks)({ sessionID: "ses_w40", tool: "shell", input: { command: "ls" }, id: "call_40" }))
    await cardsOpen(1)
    const cardID = posted[0].card.id
    await host.lose()
    expect(await first).toMatch(/did not run/)
    expect(deleted).toContain(cardID)
    expect(await settle(gate(host.hooks)({ sessionID: "ses_w41", tool: "shell", input: { command: "ls" }, id: "call_41" }))).toMatch(/did not run/)
    expect(posted).toHaveLength(1)
    const row = chainRow((entry) => entry.capability === "form.replied")
    expect(String(row?.detail ?? "")).toContain("feed")
    expect(String(row?.held ?? "")).toContain("not approved")
  })

  test("feed loss reports a cancellation attempt when the host refuses it", async () => {
    arm()
    nodes("human")
    const host = fakeHost()
    await plugin.setup(host.ctx)
    const first = settle(gate(host.hooks)({ sessionID: "ses_w56", tool: "shell", input: { command: "ls" }, id: "call_56" }))
    await cardsOpen(1)
    deleteFails = true
    await host.lose()
    expect(await first).toMatch(/did not run/)
    expect(deleted).toHaveLength(0)
    const row = chainRow((entry) => entry.capability === "form.replied")
    expect(String(row?.held ?? "")).toContain("cancellation attempted")
    expect(String(row?.held ?? "")).not.toContain("cards removed")
  })

  test("feed loss during card creation resolves the hold and cancels the orphan card", async () => {
    arm()
    nodes("human")
    const host = fakeHost()
    await plugin.setup(host.ctx)
    let release: () => void = () => {}
    postGate = new Promise<void>((resolve) => {
      release = resolve
    })
    const arrived = new Promise<void>((resolve) => {
      postArrived = resolve
    })
    const first = settle(gate(host.hooks)({ sessionID: "ses_w42", tool: "shell", input: { command: "ls" }, id: "call_42" }))
    await arrived
    await host.lose()
    expect(await first).toMatch(/did not run/)
    release()
    await ticks(12)
    expect(posted).toHaveLength(1)
    expect(deleted).toContain(posted[0].card.id)
  })

  test("a later setup resolves the previous hold and removes its card", async () => {
    arm()
    nodes("human")
    const host = fakeHost()
    await plugin.setup(host.ctx)
    const first = settle(gate(host.hooks)({ sessionID: "ses_w44", tool: "shell", input: { command: "ls" }, id: "call_44" }))
    await cardsOpen(1)
    const cardID = posted[0].card.id

    await plugin.setup(host.ctx)
    expect(await first).toMatch(/did not run/)
    await ticks(6)
    expect(deleted).toContain(cardID)
  })

  test("a replacement during a supervisor generation revokes the call", async () => {
    arm()
    nodes("supervisor,human")
    let release: () => void = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    let started: () => void = () => {}
    const inGenerate = new Promise<void>((resolve) => {
      started = resolve
    })
    const host = fakeHost({
      generate: (request) => allowReply(request.prompt),
      beforeHook: async () => {
        started()
        await held
      },
    })
    await plugin.setup(host.ctx)
    const first = settle(latestGate(host.hooks)({ sessionID: "ses_w45", tool: "shell", input: { command: "ls" }, id: "call_45" }))
    await inGenerate
    await plugin.setup(host.ctx)
    release()
    expect(await first).toMatch(/did not run/)
    expect(posted).toHaveLength(0)
  })

  test("a replacement during the release check does not authorize the call", async () => {
    arm()
    nodes("supervisor")
    let replaced = false
    const host = fakeHost({
      generate: (request) => allowReply(request.prompt),
      effect: async (index) => {
        if (index === 1 && !replaced) {
          replaced = true
          await plugin.setup(host.ctx)
        }
        return "allow"
      },
    })
    await plugin.setup(host.ctx)
    const wrapper = gate(host.hooks)
    const settled = settle(wrapper({ sessionID: "ses_w47", tool: "shell", input: { command: "ls" }, id: "call_47" }))
    expect(await settled).toMatch(/did not run/)
    const row = chainRow((entry) => entry.event === "chain_decision")
    expect(String(row?.reason ?? "")).toContain("replaced")
    expect(posted).toHaveLength(0)
  })

  test("a reply arriving after a replacement grants nothing", async () => {
    arm()
    nodes("human")
    const host = fakeHost()
    await plugin.setup(host.ctx)
    const first = settle(gate(host.hooks)({ sessionID: "ses_w46", tool: "shell", input: { command: "ls" }, id: "call_46" }))
    await cardsOpen(1)
    const cardID = posted[0].card.id
    const oldFeed = host.formFeeds()[0]
    await plugin.setup(host.ctx)
    await oldFeed.push({ type: "form.replied", data: { id: cardID, answer: { decision: "allow" } } })
    expect(await first).toMatch(/did not run/)
    expect(deleted).toContain(cardID)
  })

  test("a subscription left over from an earlier setup cannot mark the new runtime lost", async () => {
    arm()
    nodes("human")
    const host = fakeHost()
    await plugin.setup(host.ctx)
    await plugin.setup(host.ctx)
    const feeds = host.formFeeds()
    expect(feeds).toHaveLength(2)
    await feeds[0].lose()

    const first = settle(latestGate(host.hooks)({ sessionID: "ses_w43", tool: "shell", input: { command: "ls" }, id: "call_43" }))
    await cardsOpen(1)
    await feeds[1].push({ type: "form.replied", data: { id: posted[0].card.id, answer: { decision: "allow" } } })
    expect(await first).toBe("allowed")
    expect(since().some((entry) => entry.capability === "form.replied")).toBe(false)
  })
})

describe("admission pacing", () => {
  const call = (sessionID: string, id: string, command: string) => ({ sessionID, tool: "shell", input: { command }, id })

  /** Point the Jev node at the fake provider and give it a key. */
  const armJev = () => {
    const base = state.loadState()
    state.saveState({ ...base, endpoint: `http://127.0.0.1:${server.port}/decisions`, model: "test-model", protocol: "systemone" })
    state.writeKey("test-key")
  }

  test("the session cap waits at the budget instead of denying", async () => {
    arm()
    process.env.WATCHDOG_CHAIN_CAP = "1"
    nodes("human")
    const host = fakeHost()
    await plugin.setup(host.ctx)
    const wrapper = gate(host.hooks)

    const first = settle(wrapper(call("ses_w70", "c70a", "ls a")))
    await cardsOpen(1)
    const second = settle(wrapper(call("ses_w70", "c70b", "ls b")))
    await ticks(10)

    const waits = since().filter((row) => row.waiting === true)
    expect(waits).toHaveLength(1)
    expect(waits[0].held).toBe(1)
    expect(waits[0].event).toBe("chain_admission")
    // The waiting call has not opened a card: it is not denied, it is paced.
    expect(posted).toHaveLength(1)

    await host.push({ type: "form.replied", data: { id: posted[0].card.id, answer: { decision: "allow" } } })
    expect(await first).toBe("allowed")
    await cardsOpen(2)
    await host.push({ type: "form.replied", data: { id: posted[1].card.id, answer: { decision: "allow" } } })
    expect(await second).toBe("allowed")
  })

  test("two identical calls in one session are two distinct items", async () => {
    arm()
    process.env.WATCHDOG_CHAIN_CAP = "2"
    nodes("human")
    const host = fakeHost()
    await plugin.setup(host.ctx)
    const wrapper = gate(host.hooks)

    const first = settle(wrapper(call("ses_w76", "c76a", "ls same")))
    const second = settle(wrapper(call("ses_w76", "c76b", "ls same")))
    await cardsOpen(2)

    await host.push({ type: "form.replied", data: { id: posted[0].card.id, answer: { decision: "allow" } } })
    await host.push({ type: "form.replied", data: { id: posted[1].card.id, answer: { decision: "allow" } } })
    expect(await first).toBe("allowed")
    expect(await second).toBe("allowed")

    // Same digest, different admission: both calls decided, as two items.
    const items = since().filter((row) => row.event === "chain_decision").map((row) => row.itemID)
    expect(items).toHaveLength(2)
    expect(new Set(items).size).toBe(2)
  })

  test("a restart keeps the interrupted slot until its session continues", async () => {
    arm()
    process.env.WATCHDOG_CHAIN_CAP = "1"
    nodes("human")
    const host = fakeHost()
    await plugin.setup(host.ctx)
    const first = settle(gate(host.hooks)(call("ses_w72", "c72a", "ls a")))
    await cardsOpen(1)

    const ledger = join(chainStateHome(), CHAIN_BUDGET_FILE)
    expect(existsSync(ledger)).toBe(true)
    // Private file, hashed keys, redacted display names: no raw session id.
    expect(statSync(ledger).mode & 0o777).toBe(0o600)
    const held = JSON.parse(readFileSync(ledger, "utf8"))
    const [key] = Object.keys(held.sessions)
    expect(key).toMatch(/^sess_[0-9a-f]{24}$/)
    expect(held.sessions[key][0].stage).toBe("human")
    const heldID = String(held.sessions[key][0].id)
    expect(readFileSync(ledger, "utf8")).not.toContain("ses_w72")

    await plugin.setup(host.ctx)
    expect(await first).toMatch(/did not run/)

    // A sibling session's call reconciles the ledger and reports the interrupted
    // review once, but it does not release the dead call's slot: ownership is
    // kept, not silently dropped.
    const other = settle(latestGate(host.hooks)(call("ses_w72b", "c72c", "ls other")))
    await cardsOpen(2)
    expect(readFileSync(ledger, "utf8")).toContain(heldID)
    const restored = since().find((row) => row.restored === true)
    expect(restored?.verdict).toBe("unresolved")
    expect(String(restored?.reason)).toContain("not approved")

    // Its own session continues: the dead slot is disposed and the new call is
    // admitted without waiting on it.
    const next = settle(latestGate(host.hooks)(call("ses_w72", "c72b", "ls b")))
    await cardsOpen(3)
    await host.push({ type: "form.replied", data: { id: posted[1].card.id, answer: { decision: "allow" } } })
    await host.push({ type: "form.replied", data: { id: posted[2].card.id, answer: { decision: "allow" } } })
    expect(await other).toBe("allowed")
    expect(await next).toBe("allowed")
    expect(since().some((row) => row.waiting === true)).toBe(false)
  })

  test("an unreadable ledger refuses the call instead of admitting blind", async () => {
    arm()
    nodes("human")
    const host = fakeHost()
    await plugin.setup(host.ctx)
    const ledger = join(chainStateHome(), CHAIN_BUDGET_FILE)
    mkdirSync(chainStateHome(), { recursive: true })
    writeFileSync(ledger, "not json")

    const decision = settle(gate(host.hooks)(call("ses_w78", "c78a", "ls a")))
    expect(await decision).toMatch(/did not run/)
    expect(posted).toHaveLength(0)
    const row = since().find((row) => row.ledger === "read")
    expect(row?.error).toContain("could not be read")
  })

  test("a restart ends a waiting admission and its batch window, not leaving either stuck", async () => {
    arm()
    process.env.WATCHDOG_CHAIN_CAP = "1"
    // The one slot is held inside a batch window an hour wide: nothing but a
    // retirement can end that wait, so this case proves the restart does.
    process.env.WATCHDOG_CHAIN_JEV_BATCH_MAX = "2"
    process.env.WATCHDOG_CHAIN_JEV_BATCH_MS = "3600000"
    nodes("jev")
    const host = fakeHost()
    await plugin.setup(host.ctx)
    const wrapper = gate(host.hooks)

    const first = settle(wrapper(call("ses_w75", "c75a", "ls a")))
    await ticks(10)
    expect(since().some((row) => row.event === "chain_stage")).toBe(false)
    const second = settle(wrapper(call("ses_w75", "c75b", "ls b")))
    await ticks(10)
    expect(since().some((row) => row.waiting === true)).toBe(true)

    await plugin.setup(host.ctx)
    expect(await first).toMatch(/did not run/)
    expect(await second).toMatch(/did not run/)
  })

  test("the batch maximum collects held calls into one generation", async () => {
    arm()
    nodes("supervisor")
    process.env.WATCHDOG_CHAIN_BATCH_MAX = "2"
    process.env.WATCHDOG_CHAIN_BATCH_MS = "1000"
    const host = fakeHost({ generate: (request) => allowReply(request.prompt) })
    await plugin.setup(host.ctx)
    const wrapper = gate(host.hooks)

    const first = settle(wrapper(call("ses_w71", "c71a", "ls a")))
    await ticks(4)
    const second = settle(wrapper(call("ses_w71", "c71b", "ls b")))

    expect(await first).toBe("allowed")
    expect(await second).toBe("allowed")
    expect(host.calls.generate).toHaveLength(1)
    expect(idsIn(host.calls.generate[0].prompt)).toHaveLength(2)
  })

  test("a malformed answer's model text never reaches the log", async () => {
    arm()
    nodes("jev")
    armJev()
    const CANARY = "CANARY8b41de"
    const TOKEN = "sk-live-CANARYTOKEN0000"
    // The provider fills the fields the validator reads with model-controlled
    // text, so a rejection that echoed one would carry it into the row.
    malformedAnswers = (payload) => {
      const id = Object.keys(payload?.questions ?? {})[0]
      return id ? { [id]: { type: `${CANARY} ${TOKEN}`, choice: `${CANARY} ${TOKEN}`, probabilities: { [`${CANARY} ${TOKEN}`]: "x" } } } : {}
    }
    const host = fakeHost()
    await plugin.setup(host.ctx)
    const decision = settle(gate(host.hooks)(call("ses_w79", "c79a", "ls a")))
    expect(await decision).toMatch(/did not run/)

    const rows = since()
    expect(JSON.stringify(rows)).not.toContain(CANARY)
    expect(JSON.stringify(rows)).not.toContain(TOKEN)
    const rejected = rows.filter((row) => row.failure === "answer-rejected")
    expect(rejected.length).toBeGreaterThan(0)
    for (const row of rejected) {
      expect(row.reason).toBe("answer-type")
      expect(row.id).toMatch(/^wd_[0-9a-f]{24}\.\d+$/)
      expect(row.error).toBe("the model's answer could not be validated")
      expect(row.sent).toBeUndefined()
      expect(row.received).toBeUndefined()
    }
  })

  test("selecting nonblocking is reported, and the call is still held for authorization", async () => {
    arm()
    process.env.WATCHDOG_CHAIN_TIMING = "nonblocking"
    nodes("human")
    const host = fakeHost()
    await plugin.setup(host.ctx)
    const wrapper = gate(host.hooks)

    const held = settle(wrapper(call("ses_w74", "c74a", "ls a")))
    await cardsOpen(1)
    const row = since().find((row) => row.event === "chain_admission" && row.timing === "nonblocking")
    expect(String(row?.reason)).toContain("#15")
    expect(host.calls.generate).toHaveLength(0)

    await host.push({ type: "form.replied", data: { id: posted[0].card.id, answer: { decision: "allow" } } })
    expect(await held).toBe("allowed")
  })

  test("a Jev batch the model answered only partly still decides the item it answered", async () => {
    arm()
    nodes("jev")
    process.env.WATCHDOG_CHAIN_JEV_BATCH_MAX = "2"
    process.env.WATCHDOG_CHAIN_JEV_BATCH_MS = "100"
    armJev()
    // The provider leaves the second call's question unanswered, so the batch
    // reply fails normalization and only a per-call retry can decide either one.
    omitAnswers = (payload) => (payload?.state?.calls ?? []).filter((entry: any) => entry?.input?.command === "ls b").map((entry: any) => entry.id)
    const host = fakeHost()
    await plugin.setup(host.ctx)
    const wrapper = gate(host.hooks)

    const first = settle(wrapper(call("ses_w77", "c77a", "ls a")))
    const second = settle(wrapper(call("ses_w77", "c77b", "ls b")))
    expect(await first).toBe("allowed")
    expect(await second).toMatch(/did not run/)
    // The unanswered item propagated rather than being allowed by its sibling.
    const stages = new Map(since().filter((row) => row.event === "chain_stage").map((row) => [row.itemID, row.verdict]))
    expect(stages.size).toBe(2)
    const missed = since()
      .filter((row) => row.failure === "answer-rejected" && row.reason === "no-answer")
      .map((row) => String(row.id))
    expect(new Set(missed).size).toBe(1)
    expect(stages.get(missed[0])).toBe("propagate")
    expect([...stages.entries()].find(([id]) => id !== missed[0])?.[1]).toBe("allow")

    // The rejected batch and the rejected retry are logged as a category with
    // item ids only: no prompt, no task history, no arguments, no raw answer.
    const rejected = since().filter((row) => row.hook === "hook_tool_risk")
    expect(rejected.length).toBeGreaterThanOrEqual(2)
    for (const row of rejected) {
      expect(row.failure).toBe("answer-rejected")
      expect(row.sent).toBeUndefined()
      expect(row.received).toBeUndefined()
    }
    expect(new Set(rejected.flatMap((row) => Object.keys(row.questions ?? {})))).toEqual(new Set(stages.keys()))
    const logged = JSON.stringify(rejected)
    expect(logged).not.toContain("clean up the build directory")
    expect(logged).not.toContain("ls a")
    expect(logged).not.toContain("ls b")
    expect(logged).not.toContain("probabilities")
  })
})
