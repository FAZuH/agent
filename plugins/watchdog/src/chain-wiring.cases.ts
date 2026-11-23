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
  "WATCHDOG_CHAIN_ASK_MODE",
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
/** The `/jev-*` command closures this setup registered, by name. */
const commands: Record<string, any> = {}
/** Make the service refuse card removal: the host cannot confirm a cancellation. */
let deleteFails = false
/** When set, a card POST waits on it: the test is holding the card open. */
let postGate: Promise<void> | null = null
let postArrived: (() => void) | null = null
/** When set, a decision POST waits on it: the test is holding the decision itself. */
let decisionGate: Promise<void> | null = null
let decisionArrived: (() => void) | null = null
/** Question ids the fake provider leaves unanswered, so `ask` rejects the batch. */
let omitAnswers: ((payload: any) => string[]) | null = null
/** Answers the fake provider returns verbatim, for the rejection-log cases. */
let malformedAnswers: ((payload: any) => Record<string, any>) | null = null
/** Every state body the fake decisions route received in this case. */
const decisions: any[] = []
/** When set, a hook registration waits on it: a test parks a setup mid-handover. */
let registrationGate: Promise<void> | null = null
let registrationParked = false
/** The same for `tool.hook` alone, so a handover can be parked after the Jev hook published. */
let toolRegistrationGate: Promise<void> | null = null
let toolRegistrationParked = false
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
      decisions.push(payload)
      if (decisionGate) {
        decisionArrived?.()
        await decisionGate
      }
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
const { budgetKey, chainStateHome, CHAIN_BUDGET_FILE, CHAIN_GATE_FILE, CHAIN_GATE_PASSED } = await import("./chain.ts")
const { readAbortRecords, appendAbortRecord, resetAbortMarks, RELEASE_CONTINUE_TEXT } = await import("./abort.ts")
const { setReceiptTransport, readDeliveryRows, DELIVERY_FILE } = await import("./delivery.ts")
const { writeCapabilityGate, REQUIRED_CAPABILITIES } = await import("./capability-gate.ts")
const REQUIRED_GATE_IDS = REQUIRED_CAPABILITIES.map((entry: { id: string }) => entry.id)
const { resetCardRoute } = await import("./question-cards.ts")
const { resetOpenPrompts } = await import("./session-ban-host.ts")
const { readSnapshot, parentPaths, writeSnapshot, writeSubtreeBan, removeParent } = await import("./session-ban-state.ts")
const { fingerprint } = await import("./session-ban.ts")
const { recordApproval } = await import("../../../lib/jev/approve.ts")
const { applyWatchdogSetting } = await import("./watchdog-settings.ts")

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
  // Process-wide, so a case that starts an abort would otherwise refuse its
  // session in the next one: the record store is wiped here, and a kept mark is
  // exactly what this suite is proving survives a real re-setup.
  resetAbortMarks()
  // Process-lifetime by design, so a case that opened a prompt would otherwise
  // hand the next one a hold its own host never opened.
  resetOpenPrompts()
  for (const dir of [STATE, BAN]) {
    rmSync(guard(dir), { recursive: true, force: true })
    mkdirSync(guard(dir), { recursive: true })
  }
  posted.length = 0
  deleted.length = 0
  deleteFails = false
  postGate = null
  postArrived = null
  decisionGate = null
  decisionArrived = null
  omitAnswers = null
  malformedAnswers = null
  registrationGate = null
  registrationParked = false
  toolRegistrationGate = null
  toolRegistrationParked = false
  decisions.length = 0
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
  /** The permission provider callbacks a plugin registered, by hook name. */
  permissionHooks: Record<string, (event: any) => any>
  /**
   * Every permission callback any `setup` registered, in order. The last entry is
   * the live one; earlier entries are what a host that ignores deregistration
   * would still call, which is what the token guard has to neutralise.
   */
  permissionHistory: Record<string, Array<(event: any) => any>>
  /** Registrations the plugin deregistered through their `dispose`. */
  disposed: number
  /** Event feeds the plugin ended through their `AbortSignal`. */
  aborted: number
  /** The answer feeds the chain opens: the fake host's other hooks subscribe too. */
  formFeeds(): Subscription[]
  calls: {
    generate: any[]
    context: string[]
    checks: any[]
    projected: any[]
    synthetic: number
    /** Every synthetic write the plugin asked for, with the request it sent. */
    syntheticNotes: Array<{ sessionID: string; text: string; delivery?: string }>
    interrupts: Array<{ sessionID: string; resume?: boolean }>
    /** Every turn the plugin asked the host to start. */
    prompts: Array<{ sessionID: string; text: string }>
    /** Every permission reply the plugin issued, as the host received it. */
    replies: any[]
    /** Handlers the host accepted from a plugin's rpc.register. */
    rpc: Array<{ contract: any; handlers: any }>
  }
  push(event: any): Promise<void>
  lose(): Promise<void>
  /** The wrapped subagent tool, so a case can drive the observation path. */
  subagent(): any
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
  /** Model a host with no `permission.hook` surface at all. */
  noPermissionHook?: boolean
  /** Model a host whose event feed refuses to open. */
  rejectFeed?: boolean
  /** The host-recorded direct Parent of a session, or null when it is a root. */
  parentOf?: (sessionID: string) => string | null | undefined
  /** The host's session rows, for subtree enumeration. */
  sessions?: Array<{ id: string; parentID?: string }>
  /** Model a host whose session listing is absent, throws or answers garbage. */
  listFailure?: "missing" | "throw" | "malformed"
  /** Park the session listing until the returned promise resolves. */
  listGate?: () => Promise<void>
  /** Model a host with no session interrupt primitive at all. */
  noInterrupt?: boolean
  /** Park a permission reply until the returned promise resolves. */
  replyGate?: () => Promise<void>
  /** Park a permission-list read until the returned promise resolves. */
  permissionListGate?: () => Promise<void>
  /** The rows the host's pending-permission list returns. */
  permissionList?: () => any[]
  /** Model a host whose pending-permission list cannot be read. */
  permissionListFails?: () => boolean
  /** Refuse one permission reply instead of resolving it. */
  replyFails?: (index: number) => boolean
  /** Park one session interrupt until the returned promise resolves. */
  interruptGate?: () => Promise<void>
  /** Session ids whose interrupt the host refuses to confirm. */
  interruptRefused?: (sessionID: string) => boolean
}

function fakeHost(options: HostOptions = {}): Host {
  const hooks: Record<string, Array<(event: any) => any>> = {}
  const permissionHooks: Record<string, (event: any) => any> = {}
  const permissionHistory: Record<string, Array<(event: any) => any>> = {}
  let disposed = 0
  let aborted = 0
  const generateHooks: Array<(event: any) => any> = []
  const subscriptions: Subscription[] = []
  const calls: Host["calls"] = { generate: [], context: [], checks: [], projected: [], synthetic: 0, syntheticNotes: [], interrupts: [], prompts: [], replies: [], rpc: [] }
  const context = options.context ?? MESSAGES
  const options_rejectFeed = options.rejectFeed === true
  // The subagent tool as the host holds it. `wrapSubagent` installs the
  // observation wrapper on it, so a case can run it the way the host does and
  // reach the admission path the permission hook then judges.
  const subagent: any = { id: "subagent", execute: async () => ({ metadata: { sessionID: "ses_child" }, content: [] }) }
  const editor = {
    list: () => [subagent],
    get: (id: string) => (id === subagent.id ? subagent : undefined),
    update: (id: string, fn: any) => {
      if (id === subagent.id) fn(subagent)
    },
  }
  const ctx: any = {
    location: { directory: scratch },
    permission: {
      // A host without the hook surface cannot be gated: nothing may claim it was.
      ...(options.noPermissionHook
        ? {}
        : {
            hook: async (name: string, callback: any) => {
              permissionHooks[name] = callback
              ;(permissionHistory[name] ??= []).push(callback)
              if (registrationGate) {
                registrationParked = true
                await registrationGate
              }
              // The published host returns a `Registration`; removing the hook
              // must never remove a successor registered under the same name.
              return {
                dispose: async () => {
                  disposed += 1
                  if (permissionHooks[name] === callback) delete permissionHooks[name]
                },
              }
            },
          }),
      reply: async (input: any) => {
        calls.replies.push(input)
        if (options.replyFails?.(calls.replies.length - 1)) throw new Error("the host refused the reply")
        await options.replyGate?.()
      },
      list: async () => {
        if (options.permissionListFails?.()) throw new Error("the permission list is down")
        await options.permissionListGate?.()
        return options.permissionList?.() ?? []
      },
      check: async (request: any) => {
        const index = calls.checks.length
        calls.checks.push(request)
        return { effect: options.effect ? await options.effect(index) : "allow" }
      },
    },
    tool: {
      transform: async (fn: any) => {
        fn(editor)
        return { dispose: async () => { disposed += 1 } }
      },
      hook: async (name: string, callback: any) => {
        if (options.rejectHook?.(name)) throw new Error(`no ${name} hook here`)
        ;(hooks[name] ??= []).push(callback)
        if (registrationGate) {
          registrationParked = true
          await registrationGate
        }
        if (toolRegistrationGate) {
          toolRegistrationParked = true
          await toolRegistrationGate
        }
        return { dispose: async () => { disposed += 1 } }
      },
    },
    event: {
      subscribe: (options?: any) => {
        if (options_rejectFeed) throw new Error("the host refused the event feed")
        const created = subscription()
        created.types = Array.isArray(options?.types) ? options.types : []
        // The published contract ends a feed by aborting its signal.
        options?.signal?.addEventListener?.("abort", () => {
          aborted += 1
          void created.lose()
        })
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
      get: async (request: any) => {
        const sessionID = String(request?.sessionID ?? "")
        const parentID = options.parentOf?.(sessionID) ?? null
        return { id: sessionID, ...(parentID ? { parentID } : {}) }
      },
      ...(options.listFailure === "missing"
        ? {}
        : {
            list: async () => {
              if (options.listFailure === "throw") throw new Error("the session listing is down")
              if (options.listFailure === "malformed") return "not a session list"
              await options.listGate?.()
              return options.sessions ?? []
            },
          }),
      ...(options.noInterrupt
        ? {}
        : {
            interrupt: async (request: any) => {
              const sessionID = String(request?.sessionID ?? "")
              calls.interrupts.push({ sessionID, resume: request?.resume })
              await options.interruptGate?.()
              return { interrupted: !options.interruptRefused?.(sessionID) }
            },
          }),
      prompt: async (request: any) => {
        calls.prompts.push({ sessionID: String(request?.sessionID ?? ""), text: String(request?.text ?? "") })
      },
      synthetic: async (request: any) => {
        calls.synthetic += 1
        calls.syntheticNotes.push({ sessionID: String(request?.sessionID ?? ""), text: String(request?.text ?? ""), delivery: request?.delivery })
      },
    },
    command: {
      transform: async (fn: any) =>
        fn({
          add: (command: any) => {
            commands[command.name] = command
          },
        }),
    },
    rpc: {
      register: async (contract: any, handlers: any) => {
        calls.rpc.push({ contract, handlers })
        return { events: { emit: async () => {} } }
      },
    },
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
    permissionHooks,
    permissionHistory,
    get disposed() {
      return disposed
    },
    get aborted() {
      return aborted
    },
    formFeeds,
    calls,
    push: (event: any) => active().push(event),
    lose: () => active().lose(),
    subagent: () => subagent,
  }
}

/** One session-ban provider assert, shaped as the host builds it. */
const assertCall = (sessionID: string, messageID: string, callID: string) => ({
  sessionID,
  agent: "general",
  action: "subagent",
  resources: ["general"],
  source: { type: "tool", messageID, id: callID },
  effect: "allow",
})

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

/**
 * The question-card route's wrapper. The chain's own wrapper registers after it
 * in every setup, so the newest card wrapper is the one before the newest chain
 * wrapper — whatever the number of setups, the card route always precedes the
 * chain within one.
 */
const latestCardGate = (hooks: Record<string, Array<(event: any) => any>>) => {
  const list = hooks["execute.before"] ?? []
  expect(list.length).toBeGreaterThanOrEqual(2)
  return list[list.length - 2]
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

  test("the switch off makes the wrapper inert, not absent: the gate file alone activates nothing", async () => {
    gateVerdict()
    nodes("human")
    const host = fakeHost()
    await plugin.setup(host.ctx)
    // The wrapper attaches whenever the plugin runs, so the persisted switch can
    // turn the chain on later without a relaunch (#21). While the switch is off
    // it is inert: no row, no host check, no hold, no decision, no card — and
    // nothing subscribed to the form feed.
    const wrapper = gate(host.hooks)
    await expect(wrapper({ sessionID: "ses_w58", tool: "shell", input: { command: "ls" }, id: "c58" })).resolves.toBeUndefined()
    expect(since().some((row) => row.hook === "hook_watchdog_chain")).toBe(false)
    expect(since().some((row) => row.event === "chain_stage" || row.event === "chain_decision")).toBe(false)
    expect(announcements()).toHaveLength(0)
    expect(host.calls.checks).toHaveLength(0)
    expect(posted).toHaveLength(0)
    expect(host.formFeeds()).toHaveLength(0)
  })

  test("a persisted switch turned on after setup activates the next call without a relaunch", async () => {
    gateVerdict()
    nodes("human")
    const host = fakeHost()
    await plugin.setup(host.ctx)
    const wrapper = gate(host.hooks)
    await expect(wrapper({ sessionID: "ses_w70", tool: "shell", input: { command: "ls" }, id: "c70a" })).resolves.toBeUndefined()
    expect(since().some((row) => row.event === "chain_stage")).toBe(false)
    expect(posted).toHaveLength(0)

    // The page's own writer is the operator action: no restart, no env edit.
    expect(applyWatchdogSetting({ key: "chain", value: true }).ok).toBe(true)
    const pending = settle(wrapper({ sessionID: "ses_w70", tool: "shell", input: { command: "ls" }, id: "c70b" }))
    await cardsOpen(1)
    await host.push({ type: "form.replied", data: { id: posted[0].card.id, answer: { decision: "allow" } } })
    expect(await pending).toBe("allowed")

    // And turning it off again takes effect on the next call, inertly: the rows
    // the on-call wrote stay, and the off-call adds none.
    expect(applyWatchdogSetting({ key: "chain", value: false }).ok).toBe(true)
    const chainRowsBefore = since().filter((row) => row.event === "chain_stage" || row.event === "chain_decision").length
    const rowsBefore = since().length
    await expect(wrapper({ sessionID: "ses_w70", tool: "shell", input: { command: "ls" }, id: "c70c" })).resolves.toBeUndefined()
    expect(since()).toHaveLength(rowsBefore)
    expect(since().filter((row) => row.event === "chain_stage" || row.event === "chain_decision")).toHaveLength(chainRowsBefore)
  })

  test("gate passed plus the switch off is not active: the gate file is the second condition", async () => {
    gateVerdict()
    nodes("supervisor")
    const host = fakeHost({ generate: (request) => allowReply(request.prompt) })
    await plugin.setup(host.ctx)
    expect(chainRow((entry) => entry.protection === "active")).toBeUndefined()
    expect(await settle(gate(host.hooks)({ sessionID: "ses_w71", tool: "shell", input: { command: "ls" }, id: "c71" }))).toBe("allowed")
    expect(host.calls.generate).toHaveLength(0)
    expect(since().some((row) => row.event === "chain_stage")).toBe(false)
  })

  test("a persisted switch on with the gate blocked is not active", async () => {
    gateVerdict("blocked")
    nodes("human")
    const host = fakeHost()
    // Persisted on, env unset: the setup reads the state file.
    expect(applyWatchdogSetting({ key: "chain", value: true }).ok).toBe(true)
    await plugin.setup(host.ctx)
    expect(announcements()).toHaveLength(1)
    expect(announcements()[0].reason).toBe("the capability gate has not passed")
    expect(chainRow((entry) => entry.protection === "active")).toBeUndefined()
    await expect(gate(host.hooks)({ sessionID: "ses_w72", tool: "shell", input: { command: "ls" }, id: "c72" })).resolves.toBeUndefined()
    expect(since().some((row) => row.event === "chain_stage")).toBe(false)
    expect(host.calls.checks).toHaveLength(0)
  })

  test("a set environment switch wins over the persisted one", async () => {
    gateVerdict()
    nodes("human")
    // Persisted on, environment off: the environment wins, so the wrapper is inert.
    expect(applyWatchdogSetting({ key: "chain", value: true }).ok).toBe(true)
    process.env.WATCHDOG_CHAIN = "0"
    const host = fakeHost()
    await plugin.setup(host.ctx)
    await expect(gate(host.hooks)({ sessionID: "ses_w73", tool: "shell", input: { command: "ls" }, id: "c73" })).resolves.toBeUndefined()
    expect(since().some((row) => row.hook === "hook_watchdog_chain")).toBe(false)
    expect(posted).toHaveLength(0)

    // And the environment can arm a persisted-off deployment, as the wiring
    // tests and headless runs do.
    expect(applyWatchdogSetting({ key: "chain", value: false }).ok).toBe(true)
    process.env.WATCHDOG_CHAIN = "1"
    const armed = fakeHost()
    await plugin.setup(armed.ctx)
    expect(armed.hooks["execute.before"]).toHaveLength(1)
    expect(chainRow((entry) => entry.protection === "active")).toBeDefined()
  })

  test("a call that lands on a stale wrapper during a setup passes through while the switch is off", async () => {
    // The wrapper registers on every setup (#21), so the handover window every
    // later setup opens now holds a chain callback. With the switch off that
    // callback owns nothing: the call passes through exactly as it did before the
    // wrapper existed, instead of being refused by a chain that is off.
    delete process.env.WATCHDOG_CHAIN
    gateVerdict()
    nodes("human")
    const host = fakeHost()
    let openGate: (() => void) | null = null
    let second: Promise<void> | null = null
    try {
      await plugin.setup(host.ctx)
      const stale = gate(host.hooks)
      await expect(stale({ sessionID: "ses_w90", tool: "shell", input: { command: "ls" }, id: "c90a" })).resolves.toBeUndefined()

      // Setup two parks at its own chain registration: this generation's runtime
      // is gone and no judge is live, so the callback the host holds is stale.
      toolRegistrationGate = new Promise<void>((resolve) => {
        openGate = resolve
      })
      second = plugin.setup(host.ctx)
      for (let turn = 0; turn < 200 && !toolRegistrationParked; turn++) await tick()
      expect(toolRegistrationParked).toBe(true)

      await expect(stale({ sessionID: "ses_w90", tool: "shell", input: { command: "ls" }, id: "c90b" })).resolves.toBeUndefined()
      expect(since().some((row) => row.hook === "hook_watchdog_chain")).toBe(false)

      toolRegistrationGate = null
      openGate!()
      await second
      await expect(stale({ sessionID: "ses_w90", tool: "shell", input: { command: "ls" }, id: "c90c" })).resolves.toBeUndefined()
      expect(since().some((row) => row.hook === "hook_watchdog_chain")).toBe(false)
    } finally {
      // Never leave the queued setup parked: a hung attempt blocks every later
      // setup in this process.
      toolRegistrationGate = null
      openGate?.()
    }
  })

  test("a host that refuses the chain hook while the switch is off leaves setup whole and records nothing", async () => {
    // Before #21 no chain wrapper existed with the switch off, so a host that
    // refuses execute.before cost the chain nothing. The always-registered
    // wrapper keeps that: the attempt completes, it registers nothing, it writes
    // no chain row, and the wrapper the host still holds stays inert.
    delete process.env.WATCHDOG_CHAIN
    gateVerdict()
    nodes("human")
    const opts: any = {}
    const host = fakeHost(opts)
    await plugin.setup(host.ctx)
    const stale = gate(host.hooks)
    opts.rejectHook = (name: string) => name === "execute.before"
    await expect(plugin.setup(host.ctx)).resolves.toBeUndefined()
    // Only the first generation's wrapper is registered; the refused attempt
    // added nothing.
    expect(host.hooks["execute.before"]).toHaveLength(1)
    expect(since().some((row) => row.hook === "hook_watchdog_chain")).toBe(false)
    // A call the host dispatches to the older callback stays inert: the refused
    // attempt left no fail-closed posture behind it.
    await expect(stale({ sessionID: "ses_w91", tool: "shell", input: { command: "ls" }, id: "c91" })).resolves.toBeUndefined()
    expect(since().some((row) => row.hook === "hook_watchdog_chain")).toBe(false)
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

  test("hands a later call to the live generation instead of passing it through", async () => {
    arm()
    nodes("supervisor")
    const host = fakeHost({ generate: (request) => allowReply(request.prompt) })
    await plugin.setup(host.ctx)
    await plugin.setup(host.ctx)
    const list = host.hooks["execute.before"] ?? []
    expect(list).toHaveLength(2)

    // A host that keeps both callbacks reaches the retired one first, and the
    // event is not guaranteed to be replayed to the replacement. It is judged by
    // the live generation, once, instead of running unjudged.
    expect(await settle(list[0](CALL("call_60a")))).toBe("allowed")
    expect(host.calls.checks.length).toBeGreaterThan(0)
    expect(since().filter((row) => row.event === "chain_decision")).toHaveLength(1)

    // The current wrapper reviews its own call exactly once.
    expect(await settle(list[1](CALL("call_60b")))).toBe("allowed")
    expect(since().filter((row) => row.event === "chain_decision")).toHaveLength(2)
  })

  test("judges one call once when the host dispatches it to both wrappers", async () => {
    arm()
    nodes("supervisor")
    const host = fakeHost({ generate: (request) => allowReply(request.prompt) })
    await plugin.setup(host.ctx)
    await plugin.setup(host.ctx)
    const list = host.hooks["execute.before"] ?? []
    expect(list).toHaveLength(2)

    // One call handed to both generations: the shared entry replays the first
    // judgment instead of reviewing the same call twice.
    const answers = await Promise.all([
      settle(list[0](CALL("call_60c"))),
      settle(list[1](CALL("call_60c"))),
    ])
    expect(answers).toEqual(["allowed", "allowed"])
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
    // The proof failure is a transport-level throw: the bounded retry asks once
    // more before the stage reports itself unavailable.
    expect(host.calls.generate).toHaveLength(2)
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
      // Persistent for the second review's retry too: a host that does not
      // filter this review does not filter its re-ask.
      skipFilter: (index) => index >= 1,
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

  test("immediate routing: a host ask goes straight to the human, skipping the supervisor", async () => {
    arm()
    nodes("supervisor,human")
    // Immediate keeps today's skip for a host ask (#21): the stages never run.
    process.env.WATCHDOG_CHAIN_ASK_MODE = "immediate"
    const host = fakeHost({ effect: () => "ask" })
    await plugin.setup(host.ctx)
    const pending = gate(host.hooks)({ sessionID: "ses_w22", tool: "shell", input: { command: "ls" }, id: "call_22" })
    await cardsOpen(1)
    expect(host.calls.generate).toHaveLength(0)
    await host.push({ type: "form.replied", data: { id: posted[0].card.id, answer: { decision: "allow" } } })
    await pending
  })

  test("judged routing: a host ask runs the supervisor stage and still ends at the human card", async () => {
    arm()
    nodes("supervisor,human")
    const host = fakeHost({ effect: () => "ask", generate: (request) => allowReply(request.prompt) })
    await plugin.setup(host.ctx)
    const pending = settle(gate(host.hooks)({ sessionID: "ses_w74", tool: "shell", input: { command: "ls" }, id: "call_74" }))
    await cardsOpen(1)
    // No automated stage authorized: the supervisor ran and its allow was
    // withheld for the card, which decides.
    expect(host.calls.generate.length).toBeGreaterThan(0)
    const stages = since().filter((row) => row.event === "chain_stage").map((row) => `${row.stage}:${row.verdict}`)
    expect(stages).toContain("supervisor:allow")
    await host.push({ type: "form.replied", data: { id: posted[0].card.id, answer: { decision: "deny" } } })
    // The card decided, not the withheld supervisor allow: denied, not allowed.
    expect(await pending).toMatch(/denied/)
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

describe("parent review", () => {
  const call = (sessionID: string, id: string, command: string) => ({ sessionID, tool: "shell", input: { command }, id })

  test("a subagent call is reviewed by its direct Parent on the inherited context", async () => {
    arm()
    nodes("parent")
    const PARENT = "ses_w80p"
    const host = fakeHost({
      parentOf: (id) => (id === "ses_w80" ? PARENT : null),
      generate: (request) => allowReply(request.prompt),
    })
    await plugin.setup(host.ctx)
    expect(await settle(gate(host.hooks)(call("ses_w80", "c80a", "ls a")))).toBe("allowed")

    expect(host.calls.generate).toHaveLength(1)
    expect(host.calls.generate[0].sessionID).toBe(PARENT)
    expect(host.calls.context).toContain(PARENT)
    // The Parent's own projection is inherited, not replaced by the review prompt.
    const projected = host.calls.projected[0]
    expect(projected.length).toBeGreaterThan(1)
    expect(JSON.stringify(projected)).toContain("clean up the build directory")
    // Never both in sequence: a subagent call has no Supervisor row.
    expect(since().some((row) => row.stage === "supervisor")).toBe(false)
    // No native fork and no new judge session: the review is one transient call.
    expect(host.calls.synthetic).toBe(0)
    expect(since().find((row) => row.event === "chain_stage")?.stage).toBe("parent")
  })

  test("an unavailable Parent advances to the human, never Supervisor", async () => {
    arm()
    nodes("parent,human")
    const PARENT = "ses_w82p"
    const host = fakeHost({
      parentOf: (id) => (id === "ses_w82" ? PARENT : null),
      generate: () => {
        throw new Error("the parent generation failed")
      },
    })
    await plugin.setup(host.ctx)
    const decision = settle(gate(host.hooks)(call("ses_w82", "c82a", "ls a")))
    await cardsOpen(1)
    await host.push({ type: "form.replied", data: { id: posted[0].card.id, answer: { decision: "allow" } } })
    expect(await decision).toBe("allowed")

    // The failed Parent is unavailable review, and the human is next. Supervisor
    // never stands in for it.
    const stages = since()
      .filter((row) => row.event === "chain_stage")
      .map((row) => [row.stage, row.verdict])
    expect(stages).toHaveLength(2)
    expect(stages).toContainEqual(["parent", "unavailable"])
    expect(stages).toContainEqual(["human", "allow"])
  })

  test("a root session is reviewed by Supervisor, never the Parent stage", async () => {
    arm()
    nodes("supervisor")
    const host = fakeHost({ generate: (request) => allowReply(request.prompt) })
    await plugin.setup(host.ctx)
    expect(await settle(gate(host.hooks)(call("ses_w81", "c81a", "ls a")))).toBe("allowed")

    expect(host.calls.generate).toHaveLength(1)
    expect(host.calls.generate[0].sessionID).toBe("ses_w81")
    // Supervisor's filtered transport: the review prompt is the only projection.
    expect(host.calls.projected[0]).toHaveLength(1)
    expect(since().some((row) => row.stage === "parent")).toBe(false)
  })

  test("an exact action too large for the Parent prompt escalates unresolved", async () => {
    arm()
    nodes("parent")
    const host = fakeHost({
      parentOf: (id) => (id === "ses_w83" ? "ses_w83p" : null),
      generate: (request) => allowReply(request.prompt),
    })
    await plugin.setup(host.ctx)
    const huge = { sessionID: "ses_w83", tool: "shell", input: { command: "y".repeat(30_000) }, id: "c83a" }
    expect(await settle(gate(host.hooks)(huge))).toMatch(/did not run/)
    // Nothing was sent: the exact action did not fit, so no prompt judged it.
    expect(host.calls.generate).toHaveLength(0)
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
    expect(String(row?.reason)).toContain("stays gated")
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
    // The Jev call carries the exact current task beside the filtered history.
    expect(decisions[0]?.state?.currentTask).toBe("clean up the build directory")
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

describe("abort operation", () => {
  const call = (sessionID: string, id: string, command: string) => ({ sessionID, tool: "shell", input: { command }, id })
  const ROOT = "ses_ab_root"
  const CHILD = "ses_ab_child"
  const SELF = "ses_ab_sibling"

  /** One root with two children: the abort scope is a child, not the tree. */
  const lineage = () => ({
    sessions: [{ id: ROOT }, { id: CHILD, parentID: ROOT }, { id: SELF, parentID: ROOT }],
    parentOf: (id: string) => (id === CHILD || id === SELF ? ROOT : null),
  })

  const banOf = (sessionID: string) => readSnapshot(sessionID).snap?.sessionBan

  /**
   * A real native hold: a tombstone makes the next assert of that task a hold,
   * which is what opens a prompt with the host. The correlated prompt id is the
   * caller's business, because an uncorrelated hold is a case of its own.
   */
  const openNativeHold = async (host: Host, sessionID: string, tag: string) => {
    const prompt = "summarize the parser"
    const key = fingerprint(prompt)
    writeSnapshot(sessionID, {
      v: 1,
      parentID: sessionID,
      frontierSeq: 0,
      eventCursor: 0,
      tasks: {
        [key]: {
          parentID: sessionID,
          fingerprint: key,
          agent: "general",
          generation: 1,
          frontierAtAdmit: 0,
          callKeys: [],
          childIDs: [],
          abortedAt: Date.now(),
        },
      },
    } as any)
    await host.subagent().execute(
      { prompt },
      { sessionID, messageID: `msg_${tag}`, id: `call_${tag}`, agent: "general" },
    )
    const event: any = assertCall(sessionID, `msg_${tag}`, `call_${tag}`)
    expect((await host.permissionHooks.evaluate!(event)).effect).toBe("ask")
    return { key, event }
  }

  /** A native hold with its correlated host request, ready for an abort. */
  const openCorrelatedHold = async (host: Host, sessionID: string, tag: string) => {
    const { key, event } = await openNativeHold(host, sessionID, tag)
    const feed = host.subscriptions.find((entry) => entry.types.includes("permission.replied"))!
    const requestID = `per_${tag}_1`
    await feed.push({
      type: "permission.asked",
      data: { id: requestID, sessionID, action: "subagent", resources: ["general"], message: event.message },
    })
    return { key, event, feed, requestID }
  }

  /** The receipt row for one operation, read back from the durable record. */
  const approvalsRow = (operationID: string) => {
    const read = readAbortRecords()
    const record = read.ok ? read.records.find((row) => row.operation.id === operationID) : undefined
    return record?.containment.find((row) => row.step === "approvals")
  }

  test("a card's abort stops the selected session only, and records identity and containment separately", async () => {
    arm()
    nodes("human")
    const host = fakeHost(lineage())
    await plugin.setup(host.ctx)

    const decision = settle(gate(host.hooks)(call(CHILD, "ca1", "ls a")))
    await cardsOpen(1)
    await host.push({ type: "form.replied", data: { id: posted[0].card.id, answer: { decision: "abort" } } })
    expect(await decision).toContain("aborted")

    // Containment: the selected session alone is interrupted and banned.
    expect(host.calls.interrupts.map((entry) => entry.sessionID)).toEqual([CHILD])
    expect(host.calls.interrupts[0].resume).toBe(false)
    expect(banOf(CHILD)?.kind).toBe("subtree")
    // Ancestors and unrelated siblings keep their own state.
    expect(banOf(ROOT)).toBeUndefined()
    expect(banOf(SELF)).toBeUndefined()

    // Two rows, two events: the verdict that decided and the containment it caused.
    const verdictRow = since().find((row) => row.event === "chain_decision" && row.verdict === "abort")
    const abortRow = since().find((row) => row.event === "abort_operation")
    expect(verdictRow).toBeTruthy()
    expect(abortRow).toBeTruthy()
    expect(abortRow!.sessionID).toBe(CHILD)
    expect(abortRow!.scope).toBe(1)

    // The operation is a durable record of its own.
    const read = readAbortRecords()
    expect(read.ok).toBe(true)
    if (!read.ok) throw new Error("unreachable")
    const record = read.records.find((entry) => entry.operation.sessionID === CHILD)!
    expect(record.operation.source).toBe("chain")
    expect(record.operation.scope).toEqual([CHILD])
    // Unsupported cancellation is named, never claimed as a full stop.
    expect(record.containment.find((row) => row.step === "tools")?.status).toBe("unsupported")
    expect(record.containment.find((row) => row.step === "jobs")?.status).toBe("unsupported")
    // Notices belong to #17: this abort queues none and starts no session.
    expect(host.calls.synthetic).toBe(0)
  })

  test("a later call in the aborted session is refused, and its ancestor and sibling still run", async () => {
    arm()
    nodes("human")
    const host = fakeHost({ ...lineage(), generate: (request: any) => allowReply(request.prompt) })
    await plugin.setup(host.ctx)
    const first = settle(gate(host.hooks)(call(CHILD, "cb1", "ls a")))
    await cardsOpen(1)
    await host.push({ type: "form.replied", data: { id: posted[0].card.id, answer: { decision: "abort" } } })
    await first

    // The next call in the aborted session is refused by its durable ban, before
    // any stage is reached. A subagent's LLM stage is its Parent, a root's is
    // Supervisor, so both are enabled for the out-of-scope calls.
    nodes("parent,supervisor")
    const stagesFor = () => since().filter((row) => row.event === "chain_stage" && row.sessionID === CHILD).length
    const before = stagesFor()
    const refused = await gate(host.hooks)(call(CHILD, "cb2", "ls b")).then(
      () => "allowed",
      (error: Error) => error.message,
    )
    expect(refused).toContain("did not run")
    expect(stagesFor()).toBe(before)

    // The sibling and the ancestor are outside the scope and still reviewed.
    const sibling = await gate(host.hooks)(call(SELF, "cb3", "ls c")).then(
      () => "allowed",
      (error: Error) => error.message,
    )
    expect(sibling).toBe("allowed")
    const ancestor = await gate(host.hooks)(call(ROOT, "cb4", "ls d")).then(
      () => "allowed",
      (error: Error) => error.message,
    )
    expect(ancestor).toBe("allowed")
  })

  test("restart keeps the abort: a fresh setup and an ordinary message do not release it", async () => {
    arm()
    nodes("human")
    const before = fakeHost(lineage())
    await plugin.setup(before.ctx)
    const held = settle(gate(before.hooks)(call(CHILD, "cc1", "ls a")))
    await cardsOpen(1)
    await before.push({ type: "form.replied", data: { id: posted[0].card.id, answer: { decision: "abort" } } })
    await held

    // A second setup is a new runtime over the same durable store.
    posted.length = 0
    nodes("parent,supervisor")
    const after = fakeHost({ ...lineage(), generate: (request: any) => allowReply(request.prompt) })
    await plugin.setup(after.ctx)
    // An ordinary user message arrives: it retires a parent-kind ban, never this one.
    for (const feed of after.subscriptions) {
      await feed.push({ type: "session.inbox.enqueued", data: { sessionID: CHILD, item: { type: "user" }, seq: 9 } })
    }
    const refused = await latestGate(after.hooks)(call(CHILD, "cc2", "ls b")).then(
      () => "allowed",
      (error: Error) => error.message,
    )
    expect(refused).toContain("did not run")
    expect(banOf(CHILD)?.kind).toBe("subtree")
    const read = readAbortRecords()
    expect(read.ok && read.records.some((entry) => entry.operation.sessionID === CHILD)).toBe(true)
  })

  test("an aborted session's held card is cancelled, and a late answer releases nothing", async () => {
    arm()
    nodes("human")
    const host = fakeHost(lineage())
    await plugin.setup(host.ctx)
    const one = settle(gate(host.hooks)(call(CHILD, "cd1", "ls a")))
    const two = settle(gate(host.hooks)(call(CHILD, "cd2", "ls b")))
    await cardsOpen(2)
    const [first, second] = posted.map((entry) => entry.card.id)
    // Answer the first card with abort: the second card is inside the scope.
    await host.push({ type: "form.replied", data: { id: first, answer: { decision: "abort" } } })
    expect(await one).toContain("aborted")
    await ticks(10)
    expect(deleted).toContain(second)
    expect(await two).toContain("did not run")

    // A late answer for the removed card finds no hold and authorizes nothing.
    await host.push({ type: "form.replied", data: { id: second, answer: { decision: "allow" } } })
    const later = await gate(host.hooks)(call(CHILD, "cd3", "ls c")).then(
      () => "allowed",
      (error: Error) => error.message,
    )
    expect(later).toContain("did not run")
  })

  test("the headless abort revokes approvals in scope, reports partial cancellation and is queryable", async () => {
    arm()
    nodes("human")
    const host = fakeHost(lineage())
    await plugin.setup(host.ctx)
    const handlers = host.calls.rpc[0].handlers
    const ttl = state.loadState().approveTtl
    for (const sessionID of [CHILD, SELF]) {
      recordApproval(
        { token: `tok_${sessionID}`, sessionID, action: "shell", resources: [], subject: "ls", reason: "review", ts: new Date().toISOString() },
        ttl,
      )
    }
    const result = await handlers.abortOperation({ sessionID: CHILD })
    expect(result.ok).toBe(true)
    expect(result.scope).toEqual([CHILD])
    const steps = result.incomplete.map((row: any) => row.step)
    expect(steps).toContain("tools")
    expect(steps).toContain("jobs")

    // Pending approvals: the scope's is revoked, the sibling's is kept.
    const pending = await handlers.approvals({})
    const sessions = pending.approvals.map((row: any) => row.sessionID)
    expect(sessions).toContain(SELF)
    expect(sessions).not.toContain(CHILD)

    // The record is queryable through the same service surface.
    const listed = await handlers.abortOperations({})
    expect(listed.ok).toBe(true)
    expect(listed.operations.some((row: any) => row.sessionID === CHILD && row.source === "human")).toBe(true)
  })

  test("an abort that lands while a call is held refuses the late allow", async () => {
    arm()
    nodes("human")
    const host = fakeHost(lineage())
    await plugin.setup(host.ctx)
    const held = settle(gate(host.hooks)(call(CHILD, "cg1", "ls a")))
    await cardsOpen(1)
    const formID = posted[0].card.id

    // The operator aborts while the card is still open, then answers it allow.
    await host.calls.rpc[0].handlers.abortOperation({ sessionID: CHILD })
    await ticks(6)
    await host.push({ type: "form.replied", data: { id: formID, answer: { decision: "allow" } } })
    expect(await held).toContain("did not run")
    await ticks(6)
    // No row claims the stage allowed it after the abort.
    expect(since().some((row) => row.event === "chain_stage" && row.verdict === "allow")).toBe(false)
    expect(since().some((row) => row.event === "chain_decision" && row.verdict === "allow")).toBe(false)
  })

  test("an interrupt the host does not confirm is recorded as incomplete containment", async () => {
    arm()
    nodes("human")
    const host = fakeHost({ ...lineage(), interruptRefused: (id: string) => id === CHILD })
    await plugin.setup(host.ctx)
    await host.calls.rpc[0].handlers.abortOperation({ sessionID: CHILD })
    const read = readAbortRecords()
    expect(read.ok).toBe(true)
    if (!read.ok) throw new Error("unreachable")
    const record = read.records.find((entry) => entry.operation.sessionID === CHILD)!
    const interrupt = record.containment.find((row) => row.step === "interrupt")!
    expect(interrupt.status).toBe("failed")
    expect(interrupt.detail).toContain("0 of 1")
  })

  test("the legacy lift and the legacy session stop keep a durable abort ban", async () => {
    arm()
    nodes("human")
    const host = fakeHost(lineage())
    await plugin.setup(host.ctx)
    const handlers = host.calls.rpc[0].handlers
    await handlers.abortOperation({ sessionID: CHILD })
    expect(banOf(CHILD)?.kind).toBe("subtree")

    // The session-ban host is off in this suite, so it observed no ban state at
    // all. The legacy route lifts nothing on a state it cannot read, and the
    // abort's restriction stays: `unknown` is not permission.
    const lifted = await handlers.liftToolBan({ sessionID: CHILD })
    expect(lifted.ok).toBe(false)
    expect(lifted.count).toBe(0)
    expect(lifted.error).toContain("not available")
    expect(banOf(CHILD)?.kind).toBe("subtree")

    // Lift and resume sends no continuation on top of a ban that still stands.
    const resumed = await handlers.liftToolBanAndResume({ sessionID: CHILD })
    expect(resumed.ok).toBe(false)
    expect(host.calls.prompts).toEqual([])
    expect(banOf(CHILD)?.kind).toBe("subtree")

    // A legacy session stop cannot replace it with a ban a user turn retires.
    const stopped = await handlers.stopSession({ sessionID: CHILD })
    expect(stopped.ok).toBe(true)
    expect(banOf(CHILD)?.kind).toBe("subtree")

    // A later user message retires a parent ban, never this one.
    nodes("parent,supervisor")
    for (const feed of host.subscriptions) {
      await feed.push({ type: "session.inbox.enqueued", data: { sessionID: CHILD, item: { type: "user" }, seq: 11 } })
    }
    const refused = await latestGate(host.hooks)(call(CHILD, "ch1", "ls e")).then(
      () => "allowed",
      (error: Error) => error.message,
    )
    expect(refused).toContain("did not run")
    expect(banOf(CHILD)?.kind).toBe("subtree")
  })

  test("failed descendant discovery is an incomplete scope over the known session only", async () => {
    arm()
    nodes("human")
    const host = fakeHost({ ...lineage(), listFailure: "throw" })
    await plugin.setup(host.ctx)
    const result = await host.calls.rpc[0].handlers.abortOperation({ sessionID: CHILD })

    // The operation ran and is durable; the subtree is not claimed as blocked.
    expect(result.ok).toBe(true)
    expect(result.durable).toBe(true)
    expect(result.sealed).toBe(false)
    expect(result.scope).toEqual([CHILD])
    const scope = result.incomplete.find((row: any) => row.step === "scope")
    expect(scope.status).toBe("failed")
    expect(scope.detail).toContain("the session listing failed")
    expect(scope.detail).toContain("unknown")

    // Only the known session is held; nothing outside it is touched.
    expect(banOf(CHILD)?.kind).toBe("subtree")
    expect(banOf(ROOT)).toBeUndefined()
    expect(banOf(SELF)).toBeUndefined()

    // The queryable record carries the same distinction.
    const listed = await host.calls.rpc[0].handlers.abortOperations({})
    const row = listed.operations.find((entry: any) => entry.sessionID === CHILD)!
    expect(row.scope).toEqual([CHILD])
    expect(row.incomplete.some((entry: any) => entry.step === "scope" && entry.status === "failed")).toBe(true)
  })

  test("an abort during a pending execution check refuses the allow even when the ban write fails", async () => {
    arm()
    nodes("human")
    let releaseCheck: (() => void) | null = null
    const host = fakeHost({
      ...lineage(),
      effect: async (index: number) => {
        // The precheck at index 0 allows; the release recheck at index 1 parks.
        if (index !== 1) return "allow"
        await new Promise<void>((resolve) => {
          releaseCheck = resolve
        })
        return "allow"
      },
    })
    await plugin.setup(host.ctx)
    const held = settle(gate(host.hooks)(call(CHILD, "ci1", "ls a")))
    await cardsOpen(1)
    await host.push({ type: "form.replied", data: { id: posted[0].card.id, answer: { decision: "allow" } } })
    for (let turn = 0; turn < 200 && !releaseCheck; turn++) await tick()
    expect(releaseCheck).not.toBeNull()

    // A live lock keeps the ban write out: the restriction never reaches disk,
    // so the check this call is parked inside will read a clean store.
    const lockPath = `${parentPaths(CHILD).snapshot}.lock`
    writeFileSync(lockPath, `${process.pid} ${Date.now()} held`)
    try {
      const result = await host.calls.rpc[0].handlers.abortOperation({ sessionID: CHILD })
      expect(result.ban).toEqual({ written: 0, failed: 1 })
      expect(result.sealed).toBe(false)
      expect(banOf(CHILD)).toBeUndefined()
    } finally {
      rmSync(lockPath, { force: true })
    }

    releaseCheck!()
    expect(await held).toContain("did not run")
    await ticks(6)
    expect(since().some((row) => row.event === "chain_decision" && row.verdict === "allow")).toBe(false)
  })

  test("a crash between the receipt and the ban is reconciled at the next setup", async () => {
    arm()
    nodes("parent,supervisor")
    // A child process writes the identity-only record and exits: the state a
    // process death between the receipt and its ban leaves behind.
    const record = {
      operation: { id: "op_crashed", sessionID: CHILD, scope: [CHILD, `${CHILD}_child`], source: "chain", cause: "the chain aborted", at: 1 },
      containment: [
        { step: "receipt", status: "unsupported", detail: "the containment receipt was not written; treat every step as unconfirmed" },
      ],
    }
    const written = Bun.spawnSync({
      cmd: ["bun", "-e", `(await import("./abort.ts")).appendAbortRecord(${JSON.stringify(record)})`],
      cwd: new URL(".", import.meta.url).pathname,
      env: { ...process.env },
    })
    expect(written.exitCode).toBe(0)
    expect(banOf(CHILD)).toBeUndefined()

    const host = fakeHost(lineage())
    await plugin.setup(host.ctx)

    // The restriction is back before any call is admitted.
    expect(banOf(CHILD)?.kind).toBe("subtree")
    expect(banOf(`${CHILD}_child`)?.kind).toBe("subtree")
    const refused = await gate(host.hooks)(call(CHILD, "cj1", "ls a")).then(
      () => "allowed",
      (error: Error) => error.message,
    )
    expect(refused).toContain("did not run")
    // The record says what recovery did, and still says the steps were never
    // confirmed.
    const read = readAbortRecords()
    expect(read.ok).toBe(true)
    if (!read.ok) throw new Error("unreachable")
    const crashed = read.records.find((entry) => entry.operation.id === "op_crashed")!
    expect(crashed.containment.find((row) => row.step === "ban")?.status).toBe("done")
    expect(since().some((row) => row.event === "abort_recovery" && row.operationID === "op_crashed")).toBe(true)
  })

  test("a host with no interrupt primitive records the step as unsupported", async () => {
    arm()
    nodes("human")
    const host = fakeHost({ ...lineage(), noInterrupt: true })
    await plugin.setup(host.ctx)
    const result = await host.calls.rpc[0].handlers.abortOperation({ sessionID: CHILD })
    expect(result.ok).toBe(true)
    const interrupt = result.incomplete.find((row: any) => row.step === "interrupt")
    expect(interrupt.status).toBe("unsupported")
    expect(interrupt.detail).toContain("could not be attempted")
    // The selected session is still durably held by its ban.
    expect(banOf(CHILD)?.kind).toBe("subtree")
  })

  test("an unreadable operation record refuses every chain admission after a restart", async () => {
    arm()
    nodes("parent,supervisor")
    const home = chainStateHome()
    expect(home.startsWith(`${scratch}/`)).toBe(true)
    mkdirSync(home, { recursive: true })
    writeFileSync(join(home, "abort-operations.json"), "{ not json")

    const host = fakeHost({ ...lineage(), generate: (request: any) => allowReply(request.prompt) })
    await plugin.setup(host.ctx)

    // Recovery could not run and says so: the store is not treated as clean.
    const blocked = since().find((row) => row.event === "abort_recovery_unavailable")
    expect(blocked?.reason).toBe("corrupt")

    // No session is proved safe, so no call is admitted, not even a sibling's.
    for (const sessionID of [CHILD, SELF, ROOT]) {
      const refused = await latestGate(host.hooks)(call(sessionID, `cm_${sessionID}`, "ls a")).then(
        () => "allowed",
        (error: Error) => error.message,
      )
      expect(refused).toContain("did not run")
    }
    const decisions = since().filter((row) => row.event === "chain_decision")
    expect(decisions.length).toBe(3)
    for (const row of decisions) expect(row.verdict).toBe("deny")
    expect(decisions[0].reason).toContain("the abort operation record is corrupt")
  })

  test("a failed ban reassertion refuses the session-ban provider with the chain off", async () => {
    // The documented default posture: the review chain is not enabled at all, so
    // this provider is the only admission path that runs.
    delete process.env.WATCHDOG_CHAIN
    state.setFeature("hook_session_ban", true)
    const record = {
      operation: { id: "op_provider_gate", sessionID: CHILD, scope: [CHILD], source: "human", cause: "operator abort", at: 3 },
      containment: [
        { step: "receipt", status: "unsupported", detail: "the containment receipt was not written; treat every step as unconfirmed" },
      ],
    }
    expect(appendAbortRecord(record)).toBe(true)
    const lockPath = `${parentPaths(CHILD).snapshot}.lock`
    writeFileSync(lockPath, `${process.pid} ${Date.now()} held`)
    try {
      const host = fakeHost(lineage())
      await plugin.setup(host.ctx)

      // Recovery could not restore the ban, and setup says so.
      expect(since().find((row) => row.event === "abort_recovery_unavailable")?.reason).toBe("reassert-failed")
      // The chain's wrapper exists whenever the plugin runs, but with the switch
      // off it is inert: it passes calls through and never refuses, so nothing
      // else can refuse this session on the chain's behalf.
      expect(host.hooks["execute.before"] ?? []).toHaveLength(1)
      const evaluate = host.permissionHooks.evaluate
      expect(typeof evaluate).toBe("function")

      // The provider refuses the blocked session on its own.
      const childCall = assertCall(CHILD, "msg_gate_1", "call_gate_1")
      const denied = await evaluate!(childCall)
      expect(denied.effect).toBe("deny")
      expect(String(denied.reason)).toContain("could not be restored")
      expect(childCall.effect).toBe("deny")

      // A session outside the blocked scope is not refused by the gate.
      const selfCall = assertCall(SELF, "msg_gate_2", "call_gate_2")
      const answered = await evaluate!(selfCall)
      expect(String(answered.reason)).not.toContain("could not be restored")
    } finally {
      rmSync(lockPath, { force: true })
      state.setFeature("hook_session_ban", false)
    }
  })

  test("an abort in its discovery window blocks the resume with the chain off", async () => {
    // The chain is off, so nothing else marks anything: the abort operation's own
    // mark is the only signal before the ban lands, and the ban lands only after
    // discovery returns.
    delete process.env.WATCHDOG_CHAIN
    state.setFeature("hook_session_ban", true)
    let releaseScan: (() => void) | null = null
    const host = fakeHost({
      ...lineage(),
      listGate: () =>
        new Promise<void>((resolve) => {
          releaseScan = resolve
        }),
    })
    try {
      await plugin.setup(host.ctx)
      const aborting = host.calls.rpc[0].handlers.abortOperation({ sessionID: CHILD })
      for (let turn = 0; turn < 200 && !releaseScan; turn++) await tick()
      expect(releaseScan).not.toBeNull()
      expect(banOf(CHILD)).toBeUndefined()

      const resumed = await host.calls.rpc[0].handlers.liftToolBanAndResume({ sessionID: CHILD })
      expect(resumed.ok).toBe(false)
      expect(resumed.error).toContain("an abort covers this session")
      // No continuation starts under an abort that has not finished scanning.
      expect(host.calls.prompts).toEqual([])

      releaseScan!()
      await aborting
    } finally {
      state.setFeature("hook_session_ban", false)
    }
  })

  test("a recovery block alone suppresses the continuation with the chain off", async () => {
    // A corrupt record store blocks every session; the snapshot is readable and
    // carries no ban, and the chain is off, so only the recovery gate can stop
    // the continuation.
    delete process.env.WATCHDOG_CHAIN
    state.setFeature("hook_session_ban", true)
    const home = chainStateHome()
    mkdirSync(home, { recursive: true })
    writeFileSync(join(home, "abort-operations.json"), "{ not json")
    const host = fakeHost(lineage())
    try {
      await plugin.setup(host.ctx)
      expect(since().find((row) => row.event === "abort_recovery_unavailable")?.reason).toBe("corrupt")
      expect(banOf(CHILD)).toBeUndefined()

      const resumed = await host.calls.rpc[0].handlers.liftToolBanAndResume({ sessionID: CHILD })
      expect(resumed.ok).toBe(false)
      expect(host.calls.prompts).toEqual([])
    } finally {
      state.setFeature("hook_session_ban", false)
    }
  })

  test("a failed ban reassertion refuses the question-card and tool-risk path on its own", async () => {
    // The third admission path: cards and the risk hook, active with the chain
    // and the session-ban provider both off.
    delete process.env.WATCHDOG_CHAIN
    const base = state.loadState()
    state.saveState({ config: { ...base.config, hook_tool_risk: { ...base.config.hook_tool_risk, questionCards: true } } })
    state.setFeature("hook_tool_risk", true)
    const record = {
      operation: { id: "op_card_gate", sessionID: CHILD, scope: [CHILD], source: "human", cause: "operator abort", at: 4 },
      containment: [
        { step: "receipt", status: "unsupported", detail: "the containment receipt was not written; treat every step as unconfirmed" },
      ],
    }
    expect(appendAbortRecord(record)).toBe(true)
    const lockPath = `${parentPaths(CHILD).snapshot}.lock`
    writeFileSync(lockPath, `${process.pid} ${Date.now()} held`)
    try {
      const host = fakeHost(lineage())
      await plugin.setup(host.ctx)
      expect(since().find((row) => row.event === "abort_recovery_unavailable")?.reason).toBe("reassert-failed")

      // The tool-risk hook refuses the covered session before scoring anything.
      const evaluate = host.permissionHooks.evaluate
      expect(typeof evaluate).toBe("function")
      const event = { ...assertCall(CHILD, "msg_card_1", "call_card_1"), action: "shell" }
      await evaluate!(event)
      expect(event.effect).toBe("deny")
      expect(String(event.message)).toContain("could not be restored")

      // And the card route refuses before it decides: no model call, no card.
      const wrapper = latestCardGate(host.hooks)
      await expect(wrapper({ sessionID: CHILD, tool: "shell", input: { command: "ls" }, id: "call_card_2" })).rejects.toThrow(
        /could not be restored/,
      )
      expect(posted).toHaveLength(0)
      expect(host.calls.generate).toEqual([])
    } finally {
      rmSync(lockPath, { force: true })
      state.setFeature("hook_tool_risk", false)
      resetCardRoute()
    }
  })

  test("an abort in its discovery window refuses the card and tool-risk path with the chain off", async () => {
    // The same two surfaces, refused by a live abort whose ban cannot exist yet:
    // inside discovery the mark is the only signal there is.
    delete process.env.WATCHDOG_CHAIN
    const base = state.loadState()
    state.saveState({ config: { ...base.config, hook_tool_risk: { ...base.config.hook_tool_risk, questionCards: true } } })
    state.setFeature("hook_tool_risk", true)
    let releaseScan: (() => void) | null = null
    const host = fakeHost({
      ...lineage(),
      listGate: () =>
        new Promise<void>((resolve) => {
          releaseScan = resolve
        }),
    })
    try {
      await plugin.setup(host.ctx)
      const aborting = host.calls.rpc[0].handlers.abortOperation({ sessionID: CHILD })
      for (let turn = 0; turn < 200 && !releaseScan; turn++) await tick()
      expect(releaseScan).not.toBeNull()
      expect(banOf(CHILD)).toBeUndefined()

      // The tool-risk hook refuses before scoring anything.
      const evaluate = host.permissionHooks.evaluate
      expect(typeof evaluate).toBe("function")
      const event = { ...assertCall(CHILD, "msg_mark_1", "call_mark_1"), action: "shell" }
      await evaluate!(event)
      expect(event.effect).toBe("deny")
      expect(String(event.message)).toContain("an abort covers this session")

      // And the card route refuses before it decides: no model call, no card.
      const wrapper = latestCardGate(host.hooks)
      await expect(wrapper({ sessionID: CHILD, tool: "shell", input: { command: "ls" }, id: "call_mark_2" })).rejects.toThrow(
        /an abort covers this session/,
      )
      expect(posted).toHaveLength(0)
      expect(host.calls.generate).toEqual([])

      releaseScan!()
      await aborting
    } finally {
      state.setFeature("hook_tool_risk", false)
      resetCardRoute()
    }
  })

  test("an abort in its discovery window refuses the session-ban provider with the chain off", async () => {
    // With the chain off this provider is an admission path of its own, so the
    // mark has to reach it too, exactly as it reaches the chain's own check.
    delete process.env.WATCHDOG_CHAIN
    state.setFeature("hook_session_ban", true)
    let releaseScan: (() => void) | null = null
    const host = fakeHost({
      ...lineage(),
      listGate: () =>
        new Promise<void>((resolve) => {
          releaseScan = resolve
        }),
    })
    try {
      await plugin.setup(host.ctx)
      const aborting = host.calls.rpc[0].handlers.abortOperation({ sessionID: CHILD })
      for (let turn = 0; turn < 200 && !releaseScan; turn++) await tick()
      expect(releaseScan).not.toBeNull()
      expect(banOf(CHILD)).toBeUndefined()

      const evaluate = host.permissionHooks.evaluate
      expect(typeof evaluate).toBe("function")
      const childCall = assertCall(CHILD, "msg_pmark_1", "call_pmark_1")
      const denied = await evaluate!(childCall)
      expect(denied.effect).toBe("deny")
      expect(String(denied.reason)).toContain("an abort covers this session")
      expect(childCall.effect).toBe("deny")

      // A session outside the aborted scope is not refused by the mark.
      const sibling = await evaluate!(assertCall(SELF, "msg_pmark_2", "call_pmark_2"))
      expect(String(sibling.reason)).not.toContain("an abort covers this session")

      releaseScan!()
      await aborting
    } finally {
      state.setFeature("hook_session_ban", false)
    }
  })

  test("a descendant's tool-risk evaluate waits out the discovery hold before it refuses", async () => {
    // The tool-risk hook admits on its own with the chain and the provider off.
    // A descendant is unmarked until the listing returns, so without the hold
    // this call would settle inside the window the abort is about to close.
    delete process.env.WATCHDOG_CHAIN
    const base = state.loadState()
    state.saveState({ config: { ...base.config, hook_tool_risk: { ...base.config.hook_tool_risk, questionCards: false } } })
    state.setFeature("hook_tool_risk", true)
    let releaseScan: (() => void) | null = null
    const host = fakeHost({
      ...lineage(),
      listGate: () =>
        new Promise<void>((resolve) => {
          releaseScan = resolve
        }),
    })
    try {
      await plugin.setup(host.ctx)
      const evaluate = host.permissionHooks.evaluate
      expect(typeof evaluate).toBe("function")
      // ROOT selects the tree; CHILD is a descendant nothing has marked yet.
      const aborting = host.calls.rpc[0].handlers.abortOperation({ sessionID: ROOT })
      for (let turn = 0; turn < 200 && !releaseScan; turn++) await tick()
      expect(releaseScan).not.toBeNull()
      expect(banOf(CHILD)).toBeUndefined()

      const childCall = assertCall(CHILD, "msg_th1", "call_th1")
      let settledAs: string | null = null
      const pending = evaluate!(childCall).then(() => {
        settledAs = String(childCall.effect ?? "resolved")
      })
      await ticks(10)
      // Blocked, not admitted: this is the wait, not a quiet pass.
      expect(settledAs).toBeNull()

      releaseScan!()
      await pending
      await aborting
      expect(childCall.effect).toBe("deny")
      expect(String(childCall.message)).toContain("an abort covers this session")
    } finally {
      state.setFeature("hook_tool_risk", false)
    }
  })

  test("an abort that starts while the verdict is in flight refuses the release", async () => {
    // The entry gate passed before the abort existed, so that answer is spent. The
    // model call is the last await before the plan is applied, and the settlement
    // asks the gate when it returns: the hold is waited out and the restriction
    // read in one block, so an in-flight allow never lands on a covered session.
    delete process.env.WATCHDOG_CHAIN
    const base = state.loadState()
    state.saveState({
      ...base,
      endpoint: `http://127.0.0.1:${server.port}/decisions`,
      model: "test-model",
      protocol: "systemone",
      config: { ...base.config, hook_tool_risk: { ...base.config.hook_tool_risk, questionCards: false, cache: false } },
    })
    state.writeKey("test-key")
    state.setFeature("hook_tool_risk", true)
    const ALLOW = {
      type: "choice",
      choice: "allow",
      probabilities: { allow: 0.96, propagate: 0.01, deny: 0.02, abort: 0.01 },
    }
    malformedAnswers = (payload) =>
      Object.fromEntries(Object.keys(payload?.questions ?? {}).map((id) => [id, ALLOW]))
    let releaseVerdict: (() => void) | null = null
    let arrived = false
    decisionGate = new Promise<void>((resolve) => {
      releaseVerdict = resolve
    })
    decisionArrived = () => {
      arrived = true
    }
    let releaseScan: (() => void) | null = null
    const host = fakeHost({
      ...lineage(),
      listGate: () =>
        new Promise<void>((resolve) => {
          releaseScan = resolve
        }),
    })
    try {
      await plugin.setup(host.ctx)
      const evaluate = host.permissionHooks.evaluate
      expect(typeof evaluate).toBe("function")
      const call = { ...assertCall(CHILD, "msg_inflight", "call_inflight"), action: "shell", effect: "ask" }
      let settled = false
      const pending = evaluate!(call).then(() => {
        settled = true
      })
      for (let turn = 0; turn < 400 && !arrived; turn++) await tick()
      expect(arrived).toBe(true)

      // The abort starts while the verdict is parked: ROOT is marked and the
      // discovery hold opens, so nothing about this descendant is marked yet.
      const aborting = host.calls.rpc[0].handlers.abortOperation({ sessionID: ROOT })
      for (let turn = 0; turn < 200 && !releaseScan; turn++) await tick()
      expect(releaseScan).not.toBeNull()

      releaseVerdict!()
      decisionGate = null
      await ticks(10)
      // Waiting on the hold, not deciding on the verdict that just arrived.
      expect(settled).toBe(false)

      releaseScan!()
      await pending
      await aborting
      expect(call.effect).toBe("deny")
      expect(String(call.message)).toContain("abort")
      // The verdict that lost is on the record as refused, never as applied.
      const rows = since().filter((row) => row.hook === "hook_tool_risk" && row.sessionID === CHILD)
      expect(rows.filter((row) => row.acted === true)).toHaveLength(0)
      expect(rows.some((row) => typeof row.refused === "string")).toBe(true)
    } finally {
      malformedAnswers = null
      decisionGate = null
      decisionArrived = null
      state.setFeature("hook_tool_risk", false)
    }
  })

  test("an abort that covers the session during an inert evaluation still refuses the call", async () => {
    // A judgment that fails open decides nothing about the call, so its plan is
    // inert and the host's own effect stands. Inert about the judgment is not
    // inert about containment: the settlement still admits the call, so an abort
    // that covers the session during the evaluation refuses it. The model answer
    // is rejected, which is this hook's fail-open path.
    delete process.env.WATCHDOG_CHAIN
    const base = state.loadState()
    state.saveState({
      ...base,
      endpoint: `http://127.0.0.1:${server.port}/decisions`,
      model: "test-model",
      protocol: "systemone",
      config: { ...base.config, hook_tool_risk: { ...base.config.hook_tool_risk, questionCards: false, cache: false } },
    })
    state.writeKey("test-key")
    state.setFeature("hook_tool_risk", true)
    // An answer the validator rejects: the risk hook throws and the judge returns
    // its fail-open plan.
    malformedAnswers = (payload) => {
      const id = Object.keys(payload?.questions ?? {})[0]
      return id ? { [id]: { type: "bogus", choice: "bogus", probabilities: { bogus: "x" } } } : {}
    }
    let releaseVerdict: (() => void) | null = null
    let arrived = false
    decisionGate = new Promise<void>((resolve) => {
      releaseVerdict = resolve
    })
    decisionArrived = () => {
      arrived = true
    }
    let releaseScan: (() => void) | null = null
    const host = fakeHost({
      ...lineage(),
      listGate: () =>
        new Promise<void>((resolve) => {
          releaseScan = resolve
        }),
    })
    try {
      await plugin.setup(host.ctx)
      const evaluate = host.permissionHooks.evaluate
      expect(typeof evaluate).toBe("function")
      const call = { ...assertCall(CHILD, "msg_inert", "call_inert"), action: "shell", effect: "ask" }
      let settled = false
      const pending = evaluate!(call).then(() => {
        settled = true
      })
      for (let turn = 0; turn < 400 && !arrived; turn++) await tick()
      expect(arrived).toBe(true)

      const aborting = host.calls.rpc[0].handlers.abortOperation({ sessionID: ROOT })
      for (let turn = 0; turn < 200 && !releaseScan; turn++) await tick()
      expect(releaseScan).not.toBeNull()

      releaseVerdict!()
      decisionGate = null
      await ticks(10)
      // The failure is decided, but the release is still waiting on the scan.
      expect(settled).toBe(false)

      releaseScan!()
      await pending
      await aborting
      expect(call.effect).toBe("deny")
      expect(String(call.message)).toContain("abort")

      // With nothing covering it, an inert plan leaves the call as it found it.
      const clean = { ...assertCall("ses_inert_clean", "msg_inert_clean", "call_inert_clean"), action: "shell", effect: "ask" }
      await evaluate!(clean)
      expect(clean.effect).toBe("ask")
    } finally {
      malformedAnswers = null
      decisionGate = null
      decisionArrived = null
      state.setFeature("hook_tool_risk", false)
    }
  })

  test("a hold opened after the gate's own wait still refuses the card and the risk hook", async () => {
    // The depth-zero race: no hold is open when both consumers enter, so the
    // hold primitive returns on its fast path. Its caller's await still yields,
    // and the abort below opens its hold inside that gap after marking only ROOT.
    // The gate read must therefore happen after the wait, never before it.
    delete process.env.WATCHDOG_CHAIN
    const base = state.loadState()
    state.saveState({
      ...base,
      endpoint: `http://127.0.0.1:${server.port}/decisions`,
      model: "test-model",
      protocol: "systemone",
      config: { ...base.config, hook_tool_risk: { ...base.config.hook_tool_risk, questionCards: true, cache: false } },
    })
    state.writeKey("test-key")
    const cli = join(scratch, `cli-gap-${marker}.json`)
    writeFileSync(cli, JSON.stringify({ session: { permissions: "prompt" } }))
    process.env.JEV_CLI_CONFIG = cli
    const { resetAutoAcceptCache } = await import("./autopermit.ts")
    resetAutoAcceptCache()
    state.setFeature("hook_tool_risk", true)
    let releaseScan: (() => void) | null = null
    const host = fakeHost({
      ...lineage(),
      listGate: () =>
        new Promise<void>((resolve) => {
          releaseScan = resolve
        }),
    })
    try {
      await plugin.setup(host.ctx)
      const scored = decisions.length
      // Both consumers enter with no hold open.
      let cardSettled: string | null = null
      const cardCall = latestCardGate(host.hooks)({ sessionID: CHILD, tool: "shell", input: { command: "ls gap" }, id: "call_gap" }).then(
        () => {
          cardSettled = "allowed"
        },
        (error: Error) => {
          cardSettled = error.message
        },
      )
      const jevEvent = { ...assertCall(CHILD, "msg_gap", "call_gap_risk"), action: "shell" }
      const riskCall = host.permissionHooks.evaluate!(jevEvent)
      // Same synchronous block: the abort marks ROOT and opens its hold before
      // either consumer's continuation can read a gate.
      const aborting = host.calls.rpc[0].handlers.abortOperation({ sessionID: ROOT })
      for (let turn = 0; turn < 200 && !releaseScan; turn++) await tick()
      expect(releaseScan).not.toBeNull()
      expect(banOf(CHILD)).toBeUndefined()
      expect(posted).toHaveLength(0)
      expect(decisions.length).toBe(scored)
      expect(cardSettled).toBeNull()

      releaseScan!()
      await cardCall
      await riskCall
      await aborting
      expect(cardSettled).toContain("an abort covers this session")
      expect(jevEvent.effect).toBe("deny")
      expect(String(jevEvent.message)).toContain("an abort covers this session")
      expect(posted).toHaveLength(0)
    } finally {
      state.setFeature("hook_tool_risk", false)
      resetCardRoute()
    }
  })

  test("a durable subtree ban alone refuses the card route", async () => {
    delete process.env.WATCHDOG_CHAIN
    const base = state.loadState()
    state.saveState({ config: { ...base.config, hook_tool_risk: { ...base.config.hook_tool_risk, questionCards: true } } })
    state.setFeature("hook_tool_risk", true)
    // The ban an abort writes: no record, no mark, just the durable row.
    expect(writeSubtreeBan(CHILD, "operator abort", 1)).toBe(true)
    const host = fakeHost(lineage())
    try {
      await plugin.setup(host.ctx)
      const wrapper = latestCardGate(host.hooks)
      await expect(wrapper({ sessionID: CHILD, tool: "shell", input: { command: "ls" }, id: "call_ban_1" })).rejects.toThrow(
        /durable abort ban/,
      )
      expect(posted).toHaveLength(0)
    } finally {
      state.setFeature("hook_tool_risk", false)
      resetCardRoute()
    }
  })

  test("a parent-kind ban refuses on the card route, the risk route and the chain", async () => {
    // The legacy ban this route may not approve around: it is read as its own
    // vote at the call sites, exactly as the chain's host check and the
    // provider's evaluator read it (see session-ban.test.ts, "a parent session
    // ban holds without an approval"). The provider's own vote lives in that
    // verdict table; its `blocked` gate carries only the abort's ban.
    const legacy = {
      v: 1 as const,
      parentID: CHILD,
      frontierSeq: 0,
      eventCursor: 0,
      tasks: {},
      sessionBan: { kind: "parent" as const, atSeq: 0, at: 1, cause: "a stop" },
    }
    writeSnapshot(CHILD, legacy)
    delete process.env.WATCHDOG_CHAIN
    const base = state.loadState()
    state.saveState({ config: { ...base.config, hook_tool_risk: { ...base.config.hook_tool_risk, questionCards: true } } })
    state.setFeature("hook_tool_risk", true)
    try {
      const host = fakeHost(lineage())
      await plugin.setup(host.ctx)

      // The card route refuses the covered session before it decides.
      await expect(latestCardGate(host.hooks)({ sessionID: CHILD, tool: "shell", input: { command: "ls" }, id: "call_par_1" })).rejects.toThrow(
        /active session ban/,
      )
      expect(posted).toHaveLength(0)

      // The tool-risk hook refuses it as well, before scoring anything.
      const event = { ...assertCall(CHILD, "msg_par_1", "call_par_1"), action: "shell" }
      await host.permissionHooks.evaluate!(event)
      expect(event.effect).toBe("deny")
      expect(String(event.message)).toContain("active session ban")

      // And the chain, on its own check, refuses the same call.
      arm()
      nodes("parent,supervisor")
      const chained = fakeHost(lineage())
      await plugin.setup(chained.ctx)
      // The card route is still registered on this host; the chain registered
      // last, so its wrapper is the one this call meets.
      const settled = await settle(latestGate(chained.hooks)(call(CHILD, "cpar1", "ls a")))
      expect(settled).toContain("did not run")
      expect(since().some((row) => row.event === "chain_decision" && String(row.reason ?? "").includes("session ban"))).toBe(true)
    } finally {
      state.setFeature("hook_tool_risk", false)
      resetCardRoute()
    }
  })

  test("an abort that lands during a card's awaited decision refuses the late allow", async () => {
    // The chain and the provider are off, so this route is the only gate. The
    // decision is a real model round trip; the abort lands inside it.
    delete process.env.WATCHDOG_CHAIN
    const base = state.loadState()
    // The decision is a real model round trip through this suite's server, which
    // is what lets one be held open while an abort lands.
    state.saveState({
      ...base,
      endpoint: `http://127.0.0.1:${server.port}/decisions`,
      model: "test-model",
      protocol: "systemone",
      // `cache: false`: the verdict cache is process-wide and this suite reuses
      // the session ids across cases, so a cached allow from an earlier case
      // would skip the model call this test holds open.
      config: { ...base.config, hook_tool_risk: { ...base.config.hook_tool_risk, questionCards: true, cache: false } },
    })
    state.writeKey("test-key")
    state.setFeature("hook_tool_risk", true)
    let release: (() => void) | null = null
    let arrived = false
    decisionGate = new Promise<void>((resolve) => {
      release = resolve
    })
    decisionArrived = () => {
      arrived = true
    }
    const host = fakeHost(lineage())
    try {
      await plugin.setup(host.ctx)
      const held = latestCardGate(host.hooks)({ sessionID: CHILD, tool: "shell", input: { command: "ls a" }, id: "call_dec_1" }).then(
        () => "allowed",
        (error: Error) => error.message,
      )
      for (let turn = 0; turn < 400 && !arrived; turn++) await tick()
      expect(arrived).toBe(true)

      // The ban and the mark exist before the decision does.
      const aborted = await host.calls.rpc[0].handlers.abortOperation({ sessionID: CHILD })
      expect(aborted.ok).toBe(true)
      expect(banOf(CHILD)?.kind).toBe("subtree")

      release!()
      decisionGate = null
      // The pending allow does not survive: the gate is read again at the
      // release boundary, and the call never runs.
      expect(await held).toContain("an abort covers this session")
      expect(posted).toHaveLength(0)
    } finally {
      state.setFeature("hook_tool_risk", false)
      resetCardRoute()
    }
  })

  test("a question-card abort writes the unified operation and a ban a user turn cannot retire", async () => {
    delete process.env.WATCHDOG_CHAIN
    const base = state.loadState()
    state.saveState({
      ...base,
      endpoint: `http://127.0.0.1:${server.port}/decisions`,
      model: "test-model",
      protocol: "systemone",
      // No cached verdict: the card must come from this case's forced answer.
      config: { ...base.config, hook_tool_risk: { ...base.config.hook_tool_risk, questionCards: true, cache: false } },
    })
    state.writeKey("test-key")
    // A propagate verdict becomes a hold only when the host is not
    // auto-accepting; the real client config must not decide this case.
    const cli = join(scratch, `cli-${marker}.json`)
    writeFileSync(cli, JSON.stringify({ session: { permissions: "prompt" } }))
    process.env.JEV_CLI_CONFIG = cli
    const { resetAutoAcceptCache } = await import("./autopermit.ts")
    resetAutoAcceptCache()
    state.setFeature("hook_tool_risk", true)
    state.setFeature("hook_session_ban", true)
    // Force the held card, then answer it with the abort option. `CHOICE` only
    // builds allow and abort shapes, and a choice that is not its own argmax is
    // rejected, so the propagate answer names its probabilities.
    malformedAnswers = (payload) => {
      const id = Object.keys(payload?.questions ?? {})[0]
      return id
        ? { [id]: { type: "choice", choice: "propagate", probabilities: { allow: 0.01, propagate: 0.96, deny: 0.02, abort: 0.01 } } }
        : {}
    }
    const host = fakeHost(lineage())
    try {
      await plugin.setup(host.ctx)
      const held = settle(latestCardGate(host.hooks)({ sessionID: CHILD, tool: "shell", input: { command: "ls a" }, id: "call_card_abort" }))
      await cardsOpen(1)
      await host.push({ type: "form.replied", data: { id: posted[0].card.id, answer: { decision: "abort" } } })
      expect(await held).toContain("aborted")

      // The card's stop is the unified operation, not the retirable legacy one.
      const read = readAbortRecords()
      expect(read.ok && read.records.some((row) => row.operation.sessionID === CHILD && row.operation.source === "chain")).toBe(true)
      expect(banOf(CHILD)?.kind).toBe("subtree")

      // It survives a restart and an ordinary user turn, which retires a
      // parent-kind ban only.
      posted.length = 0
      await plugin.setup(host.ctx)
      for (const feed of host.subscriptions) {
        await feed.push({ type: "session.inbox.enqueued", data: { sessionID: CHILD, item: { type: "user" }, seq: 7 } })
      }
      expect(banOf(CHILD)?.kind).toBe("subtree")
      const refused = await latestCardGate(host.hooks)({ sessionID: CHILD, tool: "shell", input: { command: "ls b" }, id: "call_after" }).then(
        () => "allowed",
        (error: Error) => error.message,
      )
      expect(refused).toContain("durable abort ban")
    } finally {
      delete process.env.JEV_CLI_CONFIG
      resetAutoAcceptCache()
      state.setFeature("hook_tool_risk", false)
      state.setFeature("hook_session_ban", false)
      resetCardRoute()
    }
  })

  test("the abort RPC names the surfaces that enforce the ban, and none when all are off", async () => {
    delete process.env.WATCHDOG_CHAIN
    const base = state.loadState()
    state.saveState({ config: { ...base.config, hook_tool_risk: { ...base.config.hook_tool_risk, questionCards: false } } })
    state.setFeature("hook_tool_risk", false)
    state.setFeature("hook_tool_standard", false)
    state.setFeature("hook_session_ban", false)
    state.setFeature("hook_supervisor", false)

    const off = fakeHost(lineage())
    await plugin.setup(off.ctx)
    const result = await off.calls.rpc[0].handlers.abortOperation({ sessionID: CHILD })
    // Sealed is a fact about the record; the posture says nobody consults it.
    expect(result.ok).toBe(true)
    expect(result.enforcedBy).toEqual([])
    expect(result.warning).toContain("not enforced")
    expect(banOf(CHILD)?.kind).toBe("subtree")

    // With the chain armed over the same store, the answer names it.
    arm()
    const on = fakeHost(lineage())
    await plugin.setup(on.ctx)
    const second = await on.calls.rpc[0].handlers.abortOperation({ sessionID: SELF })
    expect(second.enforcedBy).toEqual(["chain"])
    expect(second.warning).toBeUndefined()
  })

  test("the posture lists the chain only while its capability gate passes", async () => {
    // The wrapper registers on the switch alone, so registration is not
    // evidence: without a passing gate it passes every call through, and the
    // answer must not claim the chain enforces the ban.
    state.setFeature("hook_tool_risk", false)
    state.setFeature("hook_tool_standard", false)
    state.setFeature("hook_session_ban", false)
    state.setFeature("hook_supervisor", false)
    process.env.WATCHDOG_CHAIN = "1"
    nodes("human")
    const base = state.loadState()
    state.saveState({ config: { ...base.config, hook_tool_risk: { ...base.config.hook_tool_risk, questionCards: false } } })
    const host = fakeHost(lineage())
    await plugin.setup(host.ctx)
    const absent = await host.calls.rpc[0].handlers.abortOperation({ sessionID: CHILD })
    expect(absent.enforcedBy).toEqual([])
    expect(absent.warning).toContain("not enforced")

    // The gate lands: the same process reports the chain without a restart.
    gateVerdict()
    const passed = await host.calls.rpc[0].handlers.abortOperation({ sessionID: SELF })
    expect(passed.enforcedBy).toEqual(["chain"])

    // Removing it again makes the same wrapper inert, and the answer says so.
    ungate()
    const removed = await host.calls.rpc[0].handlers.abortOperation({ sessionID: SELF })
    expect(removed.enforcedBy).toEqual([])
    expect(removed.warning).toContain("not enforced")
  })

  test("a surface whose host hook never attached is never listed", async () => {
    // Configuration is not evidence: this host has no permission hook, so none
    // of the permission-backed routes exists however the flags are set.
    delete process.env.WATCHDOG_CHAIN
    const base = state.loadState()
    state.saveState({ config: { ...base.config, hook_tool_risk: { ...base.config.hook_tool_risk, questionCards: true } } })
    state.setFeature("hook_tool_risk", true)
    state.setFeature("hook_session_ban", true)
    const host = fakeHost({ ...lineage(), noPermissionHook: true })
    try {
      await plugin.setup(host.ctx)
      // The chain's wrapper is registered whenever the plugin runs, but with the
      // switch off it is inert; the posture below must still list no surface.
      expect(host.hooks["execute.before"] ?? []).toHaveLength(1)
      const result = await host.calls.rpc[0].handlers.abortOperation({ sessionID: CHILD })
      expect(result.enforcedBy).toEqual([])
      expect(result.warning).toContain("not enforced")
    } finally {
      state.setFeature("hook_tool_risk", false)
      state.setFeature("hook_session_ban", false)
      resetCardRoute()
    }
  })

  test("a Jev abort verdict with the cards off writes the unified operation", async () => {
    // The flag-off route this suite's default posture runs: no execute.before
    // card, so the verdict is judged by the permission hook alone. It must not
    // fall back to the retirable parent-kind stop.
    delete process.env.WATCHDOG_CHAIN
    const base = state.loadState()
    state.saveState({
      ...base,
      endpoint: `http://127.0.0.1:${server.port}/decisions`,
      model: "test-model",
      protocol: "systemone",
      config: { ...base.config, hook_tool_risk: { ...base.config.hook_tool_risk, questionCards: false, cache: false } },
    })
    state.writeKey("test-key")
    state.setFeature("hook_tool_risk", true)
    malformedAnswers = (payload) => {
      const id = Object.keys(payload?.questions ?? {})[0]
      return id
        ? { [id]: { type: "choice", choice: "abort", probabilities: { allow: 0.01, propagate: 0.02, deny: 0.01, abort: 0.96 } } }
        : {}
    }
    const host = fakeHost(lineage())
    try {
      await plugin.setup(host.ctx)
      const event: any = { ...assertCall(CHILD, "msg_verdict_ab", "call_verdict_ab"), action: "shell", resources: ["src/x.ts"] }
      await host.permissionHooks.evaluate!(event)
      expect(event.effect).toBe("deny")

      // One operation with the verdict as its source, and a durable ban a user
      // turn cannot retire — not a parent-kind stop.
      const read = readAbortRecords()
      expect(read.ok && read.records.some((row) => row.operation.sessionID === CHILD && row.operation.source === "chain")).toBe(true)
      expect(banOf(CHILD)?.kind).toBe("subtree")
    } finally {
      state.setFeature("hook_tool_risk", false)
    }
  })

  test("an abort that lands while the verdict is scored refuses the allow", async () => {
    // Scoring awaits the model, and the cards are off: this permission hook is
    // the only gate, so the entry read cannot be the last one.
    delete process.env.WATCHDOG_CHAIN
    const base = state.loadState()
    state.saveState({
      ...base,
      endpoint: `http://127.0.0.1:${server.port}/decisions`,
      model: "test-model",
      protocol: "systemone",
      config: { ...base.config, hook_tool_risk: { ...base.config.hook_tool_risk, questionCards: false, cache: false } },
    })
    state.writeKey("test-key")
    state.setFeature("hook_tool_risk", true)
    let release: (() => void) | null = null
    let arrived = false
    decisionGate = new Promise<void>((resolve) => {
      release = resolve
    })
    decisionArrived = () => {
      arrived = true
    }
    const host = fakeHost(lineage())
    try {
      await plugin.setup(host.ctx)
      const event: any = { ...assertCall(CHILD, "msg_score_ab", "call_score_ab"), action: "shell", resources: ["src/x.ts"] }
      const scored = host.permissionHooks.evaluate!(event)
      for (let turn = 0; turn < 400 && !arrived; turn++) await tick()
      expect(arrived).toBe(true)

      // The abort lands and writes its mark and ban before the verdict returns.
      const aborted = await host.calls.rpc[0].handlers.abortOperation({ sessionID: CHILD })
      expect(aborted.ok).toBe(true)

      release!()
      decisionGate = null
      await scored
      expect(event.effect).toBe("deny")
      expect(String(event.message)).toContain("an abort covers this session")
    } finally {
      state.setFeature("hook_tool_risk", false)
    }
  })

  test("an open question card is in the abort's inventory, never reported as none", async () => {
    // The card waits in this process, not in the chain runtime: an inventory
    // that read only chain cards would report no holds while one is open.
    delete process.env.WATCHDOG_CHAIN
    const base = state.loadState()
    state.saveState({
      ...base,
      endpoint: `http://127.0.0.1:${server.port}/decisions`,
      model: "test-model",
      protocol: "systemone",
      config: { ...base.config, hook_tool_risk: { ...base.config.hook_tool_risk, questionCards: true, cache: false } },
    })
    state.writeKey("test-key")
    const cli = join(scratch, `cli-q-${marker}.json`)
    writeFileSync(cli, JSON.stringify({ session: { permissions: "prompt" } }))
    process.env.JEV_CLI_CONFIG = cli
    const { resetAutoAcceptCache } = await import("./autopermit.ts")
    resetAutoAcceptCache()
    state.setFeature("hook_tool_risk", true)
    malformedAnswers = (payload) => {
      const id = Object.keys(payload?.questions ?? {})[0]
      return id
        ? { [id]: { type: "choice", choice: "propagate", probabilities: { allow: 0.01, propagate: 0.96, deny: 0.02, abort: 0.01 } } }
        : {}
    }
    const host = fakeHost(lineage())
    try {
      await plugin.setup(host.ctx)
      const held = settle(latestCardGate(host.hooks)({ sessionID: CHILD, tool: "shell", input: { command: "ls a" }, id: "call_qheld" }))
      await cardsOpen(1)
      // The card is open and the abort runs from the operator route.
      const result = await host.calls.rpc[0].handlers.abortOperation({ sessionID: CHILD })
      expect(result.ok).toBe(true)
      const read = readAbortRecords()
      const record = read.ok ? read.records.find((row) => row.operation.sessionID === CHILD) : undefined
      const cardsRow = record?.containment.find((row) => row.step === "cards")
      expect(cardsRow?.detail).toBe("cancelled 1 of 1 held cards")
      expect(await held).toContain("an abort covers this session")
    } finally {
      delete process.env.JEV_CLI_CONFIG
      resetAutoAcceptCache()
      state.setFeature("hook_tool_risk", false)
      resetCardRoute()
    }
  })

  test("a confirmed receipt whose ban is not confirmed is re-asserted after a restart", async () => {
    // The record says its receipt landed and its ban did not. Keyed on the
    // receipt, recovery leaves this scope unbanned for good; keyed on the ban,
    // the restart restores it and the durable ban refuses the session from then on.
    delete process.env.WATCHDOG_CHAIN
    state.setFeature("hook_session_ban", true)
    const record = {
      operation: { id: "op_receipt_done_ban_failed", sessionID: CHILD, scope: [CHILD], source: "human", cause: "operator abort", at: 11 },
      containment: [
        { step: "ban", status: "failed", detail: "durable subtree ban written for 0 of 1 sessions" },
        { step: "receipt", status: "done", detail: "the operation record carries this receipt" },
      ],
    }
    expect(appendAbortRecord(record)).toBe(true)
    try {
      const host = fakeHost(lineage())
      await plugin.setup(host.ctx)
      expect(since().find((row) => row.event === "abort_recovery")?.operationID).toBe("op_receipt_done_ban_failed")
      expect(banOf(CHILD)?.kind).toBe("subtree")

      const denied = await host.permissionHooks.evaluate!(assertCall(CHILD, "msg_rbd_1", "call_rbd_1"))
      expect(denied.effect).toBe("deny")
      expect(String(denied.reason)).toContain("durable abort ban")
    } finally {
      state.setFeature("hook_session_ban", false)
    }
  })

  test("a native provider hold is revoked by the abort and named in its receipt", async () => {
    // The provider hold waits in its own table with a pending prompt behind it,
    // not in the card registry. The receipt has to count it and the prompt has to
    // be refused, or the abort reports approvals complete while one is still open.
    delete process.env.WATCHDOG_CHAIN
    state.setFeature("hook_session_ban", true)
    const prompt = "summarize the parser"
    const key = fingerprint(prompt)
    // A tombstone for the same task: the next assert of that task before a user
    // turn is a hold, which is what opens a native prompt.
    writeSnapshot(CHILD, {
      v: 1,
      parentID: CHILD,
      frontierSeq: 0,
      eventCursor: 0,
      tasks: {
        [key]: {
          parentID: CHILD,
          fingerprint: key,
          agent: "general",
          generation: 1,
          frontierAtAdmit: 0,
          callKeys: [],
          childIDs: [],
          abortedAt: Date.now(),
        },
      },
    } as any)
    const host = fakeHost(lineage())
    try {
      await plugin.setup(host.ctx)
      await host.subagent().execute(
        { prompt },
        { sessionID: CHILD, messageID: "msg_native", id: "call_native", agent: "general" },
      )
      const event: any = assertCall(CHILD, "msg_native", "call_native")
      const held = await host.permissionHooks.evaluate!(event)
      expect(held.effect).toBe("ask")

      // The host correlates its own prompt to the hold by the marker.
      const feed = host.subscriptions.find((entry) => entry.types.includes("permission.replied"))
      expect(feed).toBeDefined()
      await feed!.push({
        type: "permission.asked",
        data: { id: "per_native_1", sessionID: CHILD, action: "subagent", resources: ["general"], message: event.message },
      })

      const result = await host.calls.rpc[0].handlers.abortOperation({ sessionID: CHILD })
      expect(result.ok).toBe(true)

      // The pending prompt was refused, and the receipt says so.
      expect(host.calls.replies).toEqual([{ sessionID: CHILD, requestID: "per_native_1", decision: "reject" }])
      const read = readAbortRecords()
      const record = read.ok ? read.records.find((row) => row.operation.sessionID === CHILD) : undefined
      const approvals = record?.containment.find((row) => row.step === "approvals")
      expect(approvals?.status).toBe("done")
      expect(String(approvals?.detail)).toContain("native provider holds: 1 released")
      expect(String(approvals?.detail)).not.toContain("no native provider holds")
      // The cards row speaks only for question cards, so it cannot be read as a
      // claim about the provider's holds.
      expect(record?.containment.find((row) => row.step === "cards")?.detail).toBe("no question cards in scope")

      // A late approval of that same prompt mints nothing.
      await feed!.push({ type: "permission.replied", data: { sessionID: CHILD, requestID: "per_native_1", reply: "once" } })
      await ticks(10)
      expect(readSnapshot(CHILD).snap?.tasks[key].generation).toBe(1)
      const audit = readFileSync(parentPaths(CHILD).audit, "utf8")
      expect(audit).not.toContain("hold_approved")
      const denied = await host.permissionHooks.evaluate!(assertCall(CHILD, "msg_native", "call_native"))
      expect(denied.effect).toBe("deny")
    } finally {
      state.setFeature("hook_session_ban", false)
    }
  })

  test("a reply inside the abort's discovery window mints nothing, before any ban exists", async () => {
    // The mark is the only trace during discovery: the ban is not written yet, so
    // a reply that decided here would mint an approval for a session whose scope
    // is still being discovered.
    delete process.env.WATCHDOG_CHAIN
    state.setFeature("hook_session_ban", true)
    const prompt = "summarize the parser"
    const key = fingerprint(prompt)
    writeSnapshot(CHILD, {
      v: 1,
      parentID: CHILD,
      frontierSeq: 0,
      eventCursor: 0,
      tasks: {
        [key]: {
          parentID: CHILD,
          fingerprint: key,
          agent: "general",
          generation: 1,
          frontierAtAdmit: 0,
          callKeys: [],
          childIDs: [],
          abortedAt: Date.now(),
        },
      },
    } as any)
    let releaseScan: (() => void) | null = null
    const host = fakeHost({
      ...lineage(),
      listGate: () =>
        new Promise<void>((resolve) => {
          releaseScan = resolve
        }),
    })
    try {
      await plugin.setup(host.ctx)
      await host.subagent().execute(
        { prompt },
        { sessionID: CHILD, messageID: "msg_disc", id: "call_disc", agent: "general" },
      )
      const event: any = assertCall(CHILD, "msg_disc", "call_disc")
      expect((await host.permissionHooks.evaluate!(event)).effect).toBe("ask")
      const feed = host.subscriptions.find((entry) => entry.types.includes("permission.replied"))!
      await feed.push({
        type: "permission.asked",
        data: { id: "per_disc_1", sessionID: CHILD, action: "subagent", resources: ["general"], message: event.message },
      })

      const aborting = host.calls.rpc[0].handlers.abortOperation({ sessionID: CHILD })
      for (let turn = 0; turn < 200 && !releaseScan; turn++) await tick()
      expect(releaseScan).not.toBeNull()
      // Marked and held, with no ban on disk yet.
      expect(banOf(CHILD)).toBeUndefined()

      await feed.push({ type: "permission.replied", data: { sessionID: CHILD, requestID: "per_disc_1", reply: "once" } })
      await ticks(10)
      expect(readSnapshot(CHILD).snap?.tasks[key].generation).toBe(1)
      expect(readFileSync(parentPaths(CHILD).audit, "utf8")).not.toContain("hold_approved")

      releaseScan!()
      await aborting
      // Still nothing minted once discovery named the session. The host's own
      // reply frame resolved the prompt, so nothing was left for the abort to
      // reject: its receipt must not claim a hold it never released.
      expect(readSnapshot(CHILD).snap?.tasks[key].generation).toBe(1)
      expect(readFileSync(parentPaths(CHILD).audit, "utf8")).not.toContain("hold_approved")
      expect(host.calls.replies).toEqual([])
      const read = readAbortRecords()
      const record = read.ok ? read.records.find((row) => row.operation.sessionID === CHILD) : undefined
      const approvals = record?.containment.find((row) => row.step === "approvals")
      expect(approvals?.status).toBe("done")
      expect(String(approvals?.detail)).toContain("no native provider holds in scope")
    } finally {
      state.setFeature("hook_session_ban", false)
    }
  })

  test("a prompt the abort could not name is still named by the next abort", async () => {
    // No asked frame: the hold has no correlated prompt, so the first abort can
    // only deny the entry in process. Reporting that as a released hold would
    // claim a closure nothing confirmed, and dropping the record would let the
    // next abort report no holds while the prompt is still open.
    delete process.env.WATCHDOG_CHAIN
    state.setFeature("hook_session_ban", true)
    const host = fakeHost(lineage())
    try {
      await plugin.setup(host.ctx)
      await openNativeHold(host, CHILD, "unnamed")

      const first = await host.calls.rpc[0].handlers.abortOperation({ sessionID: CHILD })
      expect(first.ok).toBe(true)
      const firstRow = approvalsRow(first.operationID)
      expect(firstRow?.status).toBe("unconfirmed")
      expect(String(firstRow?.detail)).toContain("native provider holds: 0 released; 1 with no prompt named")
      expect(host.calls.replies).toEqual([])

      // Overlapping the same prompt is the second abort's business: it must not
      // read the first abort's deny as the prompt being gone.
      const second = await host.calls.rpc[0].handlers.abortOperation({ sessionID: CHILD })
      expect(second.operationID).not.toBe(first.operationID)
      const secondRow = approvalsRow(second.operationID)
      expect(secondRow?.status).not.toBe("done")
      expect(String(secondRow?.detail)).toContain("1 with no prompt named")
      expect(String(secondRow?.detail)).not.toContain("no native provider holds")
    } finally {
      state.setFeature("hook_session_ban", false)
    }
  })

  test("two aborts overlapping one prompt both name it, and it is rejected once", async () => {
    // The first abort's self-reject is parked in the host when the second starts,
    // so neither knows the other's outcome. Both receipts have to name the prompt,
    // and the host has to see one rejection, not two for one request.
    delete process.env.WATCHDOG_CHAIN
    state.setFeature("hook_session_ban", true)
    let releaseReply: (() => void) | null = null
    const host = fakeHost({
      ...lineage(),
      replyGate: () =>
        new Promise<void>((resolve) => {
          releaseReply = resolve
        }),
    })
    try {
      await plugin.setup(host.ctx)
      const { event } = await openNativeHold(host, CHILD, "overlap")
      const feed = host.subscriptions.find((entry) => entry.types.includes("permission.replied"))!
      await feed.push({
        type: "permission.asked",
        data: { id: "per_overlap_1", sessionID: CHILD, action: "subagent", resources: ["general"], message: event.message },
      })

      const first = host.calls.rpc[0].handlers.abortOperation({ sessionID: CHILD })
      for (let turn = 0; turn < 400 && !releaseReply; turn++) await tick()
      expect(releaseReply).not.toBeNull()
      expect(host.calls.replies).toHaveLength(1)
      const second = host.calls.rpc[0].handlers.abortOperation({ sessionID: CHILD })
      await ticks(10)
      releaseReply!()
      const [one, two] = await Promise.all([first, second])

      expect(String(approvalsRow(one.operationID)?.detail)).toContain("native provider holds: 1 released")
      expect(String(approvalsRow(two.operationID)?.detail)).toContain("native provider holds: 1 released")
      expect(host.calls.replies).toEqual([{ sessionID: CHILD, requestID: "per_overlap_1", decision: "reject" }])
    } finally {
      state.setFeature("hook_session_ban", false)
    }
  })

  test("a prompt left open by a replaced provider is still named by the abort", async () => {
    // A replacement retires the provider that opened the prompt: its table and
    // its timer are gone, and the prompt it left is still on the host's screen.
    // The abort has to consult the process-wide record, not the live handle.
    delete process.env.WATCHDOG_CHAIN
    state.setFeature("hook_session_ban", true)
    const host = fakeHost(lineage())
    try {
      await plugin.setup(host.ctx)
      const { event } = await openNativeHold(host, CHILD, "orphan")
      const feed = host.subscriptions.find((entry) => entry.types.includes("permission.replied"))!
      await feed.push({
        type: "permission.asked",
        data: { id: "per_orphan_1", sessionID: CHILD, action: "subagent", resources: ["general"], message: event.message },
      })

      await plugin.setup(host.ctx)

      const result = await host.calls.rpc.at(-1)!.handlers.abortOperation({ sessionID: CHILD })
      expect(result.ok).toBe(true)
      const row = approvalsRow(result.operationID)
      expect(String(row?.detail)).toContain("native provider holds: 1 released")
      expect(String(row?.detail)).not.toContain("no native provider holds")
      expect(host.calls.replies).toEqual([{ sessionID: CHILD, requestID: "per_orphan_1", decision: "reject" }])
    } finally {
      state.setFeature("hook_session_ban", false)
    }
  })

  test("a prompt left open by a disabled provider is still named by the abort", async () => {
    // The off handle opens no prompt of its own and reports none, which is the
    // truth about itself and not about the prompt the enabled generation left.
    delete process.env.WATCHDOG_CHAIN
    state.setFeature("hook_session_ban", true)
    const host = fakeHost(lineage())
    try {
      await plugin.setup(host.ctx)
      const { event } = await openNativeHold(host, CHILD, "disabled")
      const feed = host.subscriptions.find((entry) => entry.types.includes("permission.replied"))!
      await feed.push({
        type: "permission.asked",
        data: { id: "per_disabled_1", sessionID: CHILD, action: "subagent", resources: ["general"], message: event.message },
      })

      state.setFeature("hook_session_ban", false)
      await plugin.setup(host.ctx)

      const result = await host.calls.rpc.at(-1)!.handlers.abortOperation({ sessionID: CHILD })
      expect(result.ok).toBe(true)
      const row = approvalsRow(result.operationID)
      expect(String(row?.detail)).toContain("native provider holds: 1 released")
      expect(String(row?.detail)).not.toContain("no native provider holds")
      expect(host.calls.replies).toEqual([{ sessionID: CHILD, requestID: "per_disabled_1", decision: "reject" }])
    } finally {
      state.setFeature("hook_session_ban", false)
    }
  })

  test("a replacement landing inside a parked abort still leaves a truthful receipt", async () => {
    // The inventory runs after the interrupt, so a replacement that lands while
    // the interrupt is parked disposes the provider before the abort looks for
    // its prompt. The record has to outlive the disposal, not the instance.
    delete process.env.WATCHDOG_CHAIN
    state.setFeature("hook_session_ban", true)
    let releaseInterrupt: (() => void) | null = null
    const host = fakeHost({
      ...lineage(),
      interruptGate: () =>
        new Promise<void>((resolve) => {
          releaseInterrupt = resolve
        }),
    })
    try {
      await plugin.setup(host.ctx)
      const { event } = await openNativeHold(host, CHILD, "parked")
      const feed = host.subscriptions.find((entry) => entry.types.includes("permission.replied"))!
      await feed.push({
        type: "permission.asked",
        data: { id: "per_parked_1", sessionID: CHILD, action: "subagent", resources: ["general"], message: event.message },
      })

      const aborting = host.calls.rpc[0].handlers.abortOperation({ sessionID: CHILD })
      for (let turn = 0; turn < 400 && !releaseInterrupt; turn++) await tick()
      expect(releaseInterrupt).not.toBeNull()
      await plugin.setup(host.ctx)
      releaseInterrupt!()
      const result = await aborting

      const row = approvalsRow(result.operationID)
      expect(String(row?.detail)).toContain("native provider holds: 1 released")
      expect(String(row?.detail)).not.toContain("no native provider holds")
      expect(host.calls.replies).toEqual([{ sessionID: CHILD, requestID: "per_parked_1", decision: "reject" }])
    } finally {
      state.setFeature("hook_session_ban", false)
    }
  })

  test("a named prompt whose reply is already in flight is reported by its request id", async () => {
    // The hold's own deadline starts the reject before the operator aborts, so the
    // reply belongs to this process but not to this abort. The abort cannot read
    // that outcome, and the truth is a named request with a reply in flight, not a
    // prompt nothing ever saw.
    delete process.env.WATCHDOG_CHAIN
    const live = state.loadState()
    state.saveState({
      config: {
        ...live.config,
        hook_session_ban: { ...live.config.hook_session_ban, holdMs: 40 },
      },
    })
    state.setFeature("hook_session_ban", true)
    let releaseReply: (() => void) | null = null
    const host = fakeHost({
      ...lineage(),
      replyGate: () =>
        new Promise<void>((resolve) => {
          releaseReply = resolve
        }),
    })
    try {
      await plugin.setup(host.ctx)
      const { event } = await openNativeHold(host, CHILD, "in_flight")
      const feed = host.subscriptions.find((entry) => entry.types.includes("permission.replied"))!
      await feed.push({
        type: "permission.asked",
        data: { id: "per_in_flight_1", sessionID: CHILD, action: "subagent", resources: ["general"], message: event.message },
      })

      // The hold deadline fires and its reject parks in the host.
      for (let turn = 0; turn < 400 && host.calls.replies.length === 0; turn++) await tick()
      expect(host.calls.replies.map((reply: any) => reply.requestID)).toEqual(["per_in_flight_1"])
      expect(releaseReply).not.toBeNull()

      const result = await host.calls.rpc.at(-1)!.handlers.abortOperation({ sessionID: CHILD })
      expect(result.ok).toBe(true)
      const row = approvalsRow(result.operationID)
      expect(row?.status).toBe("unconfirmed")
      expect(String(row?.detail)).toContain("request per_in_flight_1: a reply is still in flight")
      expect(String(row?.detail)).not.toContain("no prompt named")
      // The same detail reaches every consumer: the operation's own answer and the
      // list the panel binds.
      const answered = result.incomplete.find((entry: any) => entry.step === "approvals")
      expect(answered?.detail).toBe(row?.detail)
      const listed = await host.calls.rpc.at(-1)!.handlers.abortOperations({})
      const listedRow = listed.operations
        .find((entry: any) => entry.id === result.operationID)
        ?.incomplete.find((entry: any) => entry.step === "approvals")
      expect(listedRow?.detail).toBe(row?.detail)

      // The pending reply lands, so the prompt is closed and the next abort is clean.
      releaseReply!()
      await ticks(8)
      const after = await host.calls.rpc.at(-1)!.handlers.abortOperation({ sessionID: CHILD })
      const afterRow = approvalsRow(after.operationID)
      expect(afterRow?.status).toBe("done")
      expect(String(afterRow?.detail)).toContain("no native provider holds in scope")
    } finally {
      state.setFeature("hook_session_ban", false)
    }
  })

  test("an expiry parked before its reply keeps the abort from answering twice", async () => {
    // The expiry checks the host's pending list before it replies, and that read
    // is where it can be paused. An abort arriving there must find the prompt in
    // flight, not start a second reject for the same request — and once the parked
    // attempt closes the prompt, the next abort reads clean.
    delete process.env.WATCHDOG_CHAIN
    const live = state.loadState()
    state.saveState({
      config: { ...live.config, hook_session_ban: { ...live.config.hook_session_ban, holdMs: 40 } },
    })
    state.setFeature("hook_session_ban", true)
    let releaseList: (() => void) | null = null
    let listParked = false
    const host = fakeHost({
      ...lineage(),
      permissionListGate: () => {
        if (listParked) return Promise.resolve()
        listParked = true
        return new Promise<void>((resolve) => {
          releaseList = resolve
        })
      },
    })
    try {
      await plugin.setup(host.ctx)
      const { event } = await openNativeHold(host, CHILD, "expiry")
      const feed = host.subscriptions.find((entry) => entry.types.includes("permission.replied"))!
      await feed.push({
        type: "permission.asked",
        data: { id: "per_expiry_1", sessionID: CHILD, action: "subagent", resources: ["general"], message: event.message },
      })

      for (let turn = 0; turn < 400 && !listParked; turn++) await tick()
      expect(listParked).toBe(true)
      const aborting = host.calls.rpc.at(-1)!.handlers.abortOperation({ sessionID: CHILD })
      const result = await aborting

      // The abort issued no reply of its own: the expiry still owns the prompt.
      expect(host.calls.replies).toEqual([])
      const row = approvalsRow(result.operationID)
      expect(row?.status).toBe("unconfirmed")
      expect(String(row?.detail)).toContain("request per_expiry_1: a reply is still in flight")
      expect(String(row?.detail)).not.toContain("no prompt named")

      // The parked attempt lands: one reply for the request in total, and the
      // prompt is closed.
      releaseList!()
      for (let turn = 0; turn < 400 && host.calls.replies.length === 0; turn++) await tick()
      await ticks(8)
      expect(host.calls.replies).toHaveLength(1)
      const after = await host.calls.rpc.at(-1)!.handlers.abortOperation({ sessionID: CHILD })
      const afterRow = approvalsRow(after.operationID)
      expect(afterRow?.status).toBe("done")
      expect(String(afterRow?.detail)).toContain("no native provider holds in scope")
      // Still one reply: the abort never answered the same request.
      expect(host.calls.replies).toHaveLength(1)
    } finally {
      state.setFeature("hook_session_ban", false)
    }
  })

  test("an expiry that fails leaves the prompt named by the next abort", async () => {
    // The parked attempt is the one that fails, so the prompt stays open with its
    // request id known. The next abort names it as left open; it must not fall
    // back to "no prompt named" or claim the approval step done.
    delete process.env.WATCHDOG_CHAIN
    const live = state.loadState()
    state.saveState({
      config: { ...live.config, hook_session_ban: { ...live.config.hook_session_ban, holdMs: 40 } },
    })
    state.setFeature("hook_session_ban", true)
    let releaseList: (() => void) | null = null
    let listParked = false
    const host = fakeHost({
      ...lineage(),
      replyFails: () => true,
      permissionListGate: () => {
        if (listParked) return Promise.resolve()
        listParked = true
        return new Promise<void>((resolve) => {
          releaseList = resolve
        })
      },
    })
    try {
      await plugin.setup(host.ctx)
      const { event } = await openNativeHold(host, CHILD, "expiry_fail")
      const feed = host.subscriptions.find((entry) => entry.types.includes("permission.replied"))!
      await feed.push({
        type: "permission.asked",
        data: { id: "per_expiry_fail_1", sessionID: CHILD, action: "subagent", resources: ["general"], message: event.message },
      })

      for (let turn = 0; turn < 400 && !listParked; turn++) await tick()
      expect(listParked).toBe(true)
      const inFlight = await host.calls.rpc.at(-1)!.handlers.abortOperation({ sessionID: CHILD })
      expect(String(approvalsRow(inFlight.operationID)?.detail)).toContain("request per_expiry_fail_1")

      releaseList!()
      await ticks(16)
      const result = await host.calls.rpc.at(-1)!.handlers.abortOperation({ sessionID: CHILD })
      const row = approvalsRow(result.operationID)
      expect(row?.status).not.toBe("done")
      // The reply threw, so nothing about the prompt's state was observed: the
      // fact names the request and the missing outcome, never a refusal.
      expect(String(row?.detail)).toContain("1 unconfirmed (request per_expiry_fail_1: no reply outcome was observed)")
      expect(String(row?.detail)).not.toContain("the host refused")
      expect(String(row?.detail)).not.toContain("no prompt named")
    } finally {
      state.setFeature("hook_session_ban", false)
    }
  })

  test("a reject skipped for another pending permission is named as a local skip", async () => {
    // A reject on this host is session-wide, so the provider declines to send one
    // when a bystander is waiting. No reply was attempted, and the receipt must
    // not attribute the outcome to the host.
    delete process.env.WATCHDOG_CHAIN
    state.setFeature("hook_session_ban", true)
    const host = fakeHost({
      ...lineage(),
      permissionList: () => [
        { id: "per_skip_pending_1", sessionID: CHILD, action: "subagent", resources: ["general"] },
        { id: "per_bystander_1", sessionID: CHILD, action: "shell", resources: ["bash"] },
      ],
    })
    try {
      await plugin.setup(host.ctx)
      await openCorrelatedHold(host, CHILD, "skip_pending")

      const result = await host.calls.rpc.at(-1)!.handlers.abortOperation({ sessionID: CHILD })
      expect(host.calls.replies).toEqual([])
      const row = approvalsRow(result.operationID)
      expect(row?.status).toBe("failed")
      expect(String(row?.detail)).toContain("1 left open (request per_skip_pending_1: the reject was skipped: another permission is pending)")
      expect(String(row?.detail)).not.toContain("the host refused")
      // The same detail reaches the operation's answer and the listed record.
      const answered = result.incomplete.find((entry: any) => entry.step === "approvals")
      expect(answered?.detail).toBe(row?.detail)
      const listed = await host.calls.rpc.at(-1)!.handlers.abortOperations({})
      const listedRow = listed.operations
        .find((entry: any) => entry.id === result.operationID)
        ?.incomplete.find((entry: any) => entry.step === "approvals")
      expect(listedRow?.detail).toBe(row?.detail)
    } finally {
      state.setFeature("hook_session_ban", false)
    }
  })

  test("a reject skipped because the pending list is unreadable says so locally", async () => {
    delete process.env.WATCHDOG_CHAIN
    state.setFeature("hook_session_ban", true)
    const host = fakeHost({ ...lineage(), permissionListFails: () => true })
    try {
      await plugin.setup(host.ctx)
      await openCorrelatedHold(host, CHILD, "skip_unreadable")

      const result = await host.calls.rpc.at(-1)!.handlers.abortOperation({ sessionID: CHILD })
      expect(host.calls.replies).toEqual([])
      const row = approvalsRow(result.operationID)
      expect(String(row?.detail)).toContain(
        "1 left open (request per_skip_unreadable_1: the reject was skipped: the pending list could not be read)",
      )
      expect(String(row?.detail)).not.toContain("the host refused")
      expect(String(row?.detail)).not.toContain("no reply outcome")
    } finally {
      state.setFeature("hook_session_ban", false)
    }
  })

  test("a delivered-and-declined reply is a refusal, a thrown one is not", async () => {
    delete process.env.WATCHDOG_CHAIN
    state.setFeature("hook_session_ban", true)
    const host = fakeHost(lineage())
    try {
      await plugin.setup(host.ctx)
      await openCorrelatedHold(host, CHILD, "declined")
      // The host took the call and answered `false`: an observed refusal.
      host.ctx.permission.reply = async () => false
      const declined = await host.calls.rpc.at(-1)!.handlers.abortOperation({ sessionID: CHILD })
      const declinedRow = approvalsRow(declined.operationID)
      expect(String(declinedRow?.detail)).toContain("1 left open (request per_declined_1: the host refused the reject)")

      // The host takes the next reject, so the refused prompt's record closes and
      // the next receipt speaks for one prompt only.
      host.ctx.permission.reply = async () => {}
      const retried = await host.calls.rpc.at(-1)!.handlers.abortOperation({ sessionID: CHILD })
      expect(String(approvalsRow(retried.operationID)?.detail)).toContain("native provider holds: 1 released")

      // A throw is a transport or surface failure: the attempt observed nothing
      // and must not report a refusal the host never gave.
      const throwing = fakeHost({ ...lineage(), replyFails: () => true })
      await plugin.setup(throwing.ctx)
      await openCorrelatedHold(throwing, CHILD, "threw")
      const threw = await throwing.calls.rpc.at(-1)!.handlers.abortOperation({ sessionID: CHILD })
      const threwRow = approvalsRow(threw.operationID)
      expect(String(threwRow?.detail)).toContain("1 unconfirmed (request per_threw_1: no reply outcome was observed)")
      expect(String(threwRow?.detail)).not.toContain("the host refused")
      expect(throwing.calls.replies).toHaveLength(1)
    } finally {
      state.setFeature("hook_session_ban", false)
    }
  })

  test("a human answer during the parked attempt closes the prompt with no second reply", async () => {
    // The abort's reject is parked in the host's pending list when the human's
    // frame arrives. Replying after that would answer a request the host already
    // resolved, so the attempt re-reads the closure and sends nothing.
    delete process.env.WATCHDOG_CHAIN
    state.setFeature("hook_session_ban", true)
    let releaseList: (() => void) | null = null
    let listParked = false
    const host = fakeHost({
      ...lineage(),
      permissionListGate: () => {
        if (listParked) return Promise.resolve()
        listParked = true
        return new Promise<void>((resolve) => {
          releaseList = resolve
        })
      },
    })
    try {
      await plugin.setup(host.ctx)
      const { feed, requestID } = await openCorrelatedHold(host, CHILD, "human")

      const aborting = host.calls.rpc.at(-1)!.handlers.abortOperation({ sessionID: CHILD })
      for (let turn = 0; turn < 400 && !listParked; turn++) await tick()
      expect(listParked).toBe(true)
      await feed.push({ type: "permission.replied", data: { sessionID: CHILD, requestID, reply: "once" } })
      releaseList!()
      const result = await aborting

      // The human settled the request; the plugin issued no reply for it.
      expect(host.calls.replies).toEqual([])
      const row = approvalsRow(result.operationID)
      expect(row?.status).toBe("done")
      expect(String(row?.detail)).toContain("native provider holds: 1 released")
      const after = await host.calls.rpc.at(-1)!.handlers.abortOperation({ sessionID: CHILD })
      expect(String(approvalsRow(after.operationID)?.detail)).toContain("no native provider holds in scope")
    } finally {
      state.setFeature("hook_session_ban", false)
    }
  })

  test("a human answer during the parked attempt is closure even when a reply would fail", async () => {
    delete process.env.WATCHDOG_CHAIN
    state.setFeature("hook_session_ban", true)
    let releaseList: (() => void) | null = null
    let listParked = false
    const host = fakeHost({
      ...lineage(),
      replyFails: () => true,
      permissionListGate: () => {
        if (listParked) return Promise.resolve()
        listParked = true
        return new Promise<void>((resolve) => {
          releaseList = resolve
        })
      },
    })
    try {
      await plugin.setup(host.ctx)
      const { feed, requestID } = await openCorrelatedHold(host, CHILD, "human_fail")

      const aborting = host.calls.rpc.at(-1)!.handlers.abortOperation({ sessionID: CHILD })
      for (let turn = 0; turn < 400 && !listParked; turn++) await tick()
      expect(listParked).toBe(true)
      await feed.push({ type: "permission.replied", data: { sessionID: CHILD, requestID, reply: "reject" } })
      releaseList!()
      const result = await aborting

      // No reply was attempted at all, so the failing reply surface never ran.
      expect(host.calls.replies).toEqual([])
      const row = approvalsRow(result.operationID)
      expect(row?.status).toBe("done")
      expect(String(row?.detail)).not.toContain("left open")
      expect(String(row?.detail)).not.toContain("no reply outcome")
      const after = await host.calls.rpc.at(-1)!.handlers.abortOperation({ sessionID: CHILD })
      expect(String(approvalsRow(after.operationID)?.detail)).toContain("no native provider holds in scope")
    } finally {
      state.setFeature("hook_session_ban", false)
    }
  })

  test("a re-setup during an abort's discovery keeps its mark and keeps refusing", async () => {
    // An abort that has not finished discovery has written no record yet, so the
    // mark is its only trace. A re-setup that cleared marks before reconciling
    // would leave a window with neither a mark nor a ban.
    delete process.env.WATCHDOG_CHAIN
    state.setFeature("hook_session_ban", true)
    let releaseScan: (() => void) | null = null
    const host = fakeHost({
      ...lineage(),
      listGate: () =>
        new Promise<void>((resolve) => {
          releaseScan = resolve
        }),
    })
    try {
      await plugin.setup(host.ctx)
      const aborting = host.calls.rpc[0].handlers.abortOperation({ sessionID: CHILD })
      for (let turn = 0; turn < 200 && !releaseScan; turn++) await tick()
      expect(releaseScan).not.toBeNull()
      const before = readAbortRecords()
      expect(before.ok && before.records).toEqual([])

      await plugin.setup(host.ctx)
      expect(banOf(CHILD)).toBeUndefined()

      const handlers = host.calls.rpc[host.calls.rpc.length - 1].handlers
      const resumed = await handlers.liftToolBanAndResume({ sessionID: CHILD })
      expect(resumed.ok).toBe(false)
      expect(resumed.error).toContain("an abort covers this session")
      expect(host.calls.prompts).toEqual([])

      // Every admission surface reads the same kept mark after the re-setup.
      const denied = await host.permissionHooks.evaluate!(assertCall(CHILD, "msg_keep_1", "call_keep_1"))
      expect(denied.effect).toBe("deny")
      expect(String(denied.reason)).toContain("an abort covers this session")

      releaseScan!()
      await aborting
    } finally {
      state.setFeature("hook_session_ban", false)
    }
  })

  test("a readable record whose ban cannot be restored refuses its scope after a restart", async () => {
    arm()
    nodes("parent,supervisor")
    const record = {
      operation: { id: "op_unrestored", sessionID: CHILD, scope: [CHILD], source: "chain", cause: "the chain aborted", at: 2 },
      containment: [
        { step: "receipt", status: "unsupported", detail: "the containment receipt was not written; treat every step as unconfirmed" },
      ],
    }
    expect(appendAbortRecord(record)).toBe(true)
    expect(banOf(CHILD)).toBeUndefined()

    // A live lock keeps recovery's ban write out. The record is perfectly
    // readable, but its enforcement cannot be established, so it must gate.
    const lockPath = `${parentPaths(CHILD).snapshot}.lock`
    writeFileSync(lockPath, `${process.pid} ${Date.now()} held`)
    try {
      const host = fakeHost({ ...lineage(), generate: (request: any) => allowReply(request.prompt) })
      await plugin.setup(host.ctx)

      const blocked = since().find((row) => row.event === "abort_recovery_unavailable")
      expect(blocked?.reason).toBe("reassert-failed")
      expect(blocked?.all).toBe(false)
      expect(banOf(CHILD)).toBeUndefined()

      const refused = await latestGate(host.hooks)(call(CHILD, "cp1", "ls a")).then(
        () => "allowed",
        (error: Error) => error.message,
      )
      expect(refused).toContain("did not run")
      const decision = since().find((row) => row.event === "chain_decision" && row.sessionID === CHILD)
      expect(decision?.verdict).toBe("deny")
      expect(String(decision?.reason)).toContain("could not be restored")

      // The gate carries only the affected scope: an unrelated sibling runs.
      const allowed = await latestGate(host.hooks)(call(SELF, "cp2", "ls a")).then(
        () => "allowed",
        (error: Error) => error.message,
      )
      expect(allowed).toBe("allowed")
      expect(banOf(SELF)).toBeUndefined()
    } finally {
      rmSync(lockPath, { force: true })
    }
  })

  test("a call in the selected session is refused while discovery is still running", async () => {
    arm()
    nodes("human")
    let releaseScan: (() => void) | null = null
    let releaseCheck: (() => void) | null = null
    const host = fakeHost({
      ...lineage(),
      listGate: () =>
        new Promise<void>((resolve) => {
          releaseScan = resolve
        }),
      effect: async (index: number) => {
        if (index !== 1) return "allow"
        await new Promise<void>((resolve) => {
          releaseCheck = resolve
        })
        return "allow"
      },
    })
    await plugin.setup(host.ctx)
    let settledAs: string | null = null
    const held = gate(host.hooks)(call(CHILD, "cn1", "ls a")).then(
      () => {
        settledAs = "allowed"
      },
      (error: Error) => {
        settledAs = error.message
      },
    )
    await cardsOpen(1)
    await host.push({ type: "form.replied", data: { id: posted[0].card.id, answer: { decision: "allow" } } })
    for (let turn = 0; turn < 200 && !releaseCheck; turn++) await tick()
    expect(releaseCheck).not.toBeNull()

    // The abort starts and parks inside descendant discovery. The selected
    // session is already cancelled, so the parked check decides nothing: its
    // result is refused the moment it returns, without waiting for discovery,
    // because the scope does not have to be known to refuse this session.
    const aborting = host.calls.rpc[0].handlers.abortOperation({ sessionID: CHILD })
    await ticks(4)
    expect(releaseScan).not.toBeNull()
    expect(banOf(CHILD)).toBeUndefined()
    releaseCheck!()
    await held
    expect(settledAs).toContain("did not run")
    // Refused while the scan was still parked, and never allowed.
    expect(releaseScan).not.toBeNull()
    await ticks(6)
    expect(since().some((row) => row.event === "chain_decision" && row.verdict === "allow")).toBe(false)

    releaseScan!()
    expect((await aborting).scope).toEqual([CHILD])
  })

  test("a descendant cannot execute during the parent abort's discovery window", async () => {
    arm()
    nodes("human")
    let releaseScan: (() => void) | null = null
    let releaseCheck: (() => void) | null = null
    const host = fakeHost({
      ...lineage(),
      listGate: () =>
        new Promise<void>((resolve) => {
          releaseScan = resolve
        }),
      effect: async (index: number) => {
        if (index !== 1) return "allow"
        await new Promise<void>((resolve) => {
          releaseCheck = resolve
        })
        return "allow"
      },
    })
    await plugin.setup(host.ctx)
    // CHILD is a descendant of ROOT, and nothing names it as cancelled yet.
    let settledAs: string | null = null
    const held = gate(host.hooks)(call(CHILD, "co1", "ls a")).then(
      () => {
        settledAs = "allowed"
      },
      (error: Error) => {
        settledAs = error.message
      },
    )
    await cardsOpen(1)
    await host.push({ type: "form.replied", data: { id: posted[0].card.id, answer: { decision: "allow" } } })
    for (let turn = 0; turn < 200 && !releaseCheck; turn++) await tick()
    expect(releaseCheck).not.toBeNull()

    // The abort selects ROOT only: CHILD is unknown until the scan returns.
    const aborting = host.calls.rpc[0].handlers.abortOperation({ sessionID: ROOT })
    await ticks(4)
    expect(releaseScan).not.toBeNull()
    releaseCheck!()
    await ticks(10)
    // Without the discovery hold this allow would execute into a session the
    // abort is about to cover.
    expect(settledAs).toBeNull()

    releaseScan!()
    await held
    expect(settledAs).toContain("did not run")
    expect((await aborting).scope).toEqual([ROOT, CHILD, SELF])
    expect(since().some((row) => row.event === "chain_decision" && row.verdict === "allow")).toBe(false)
  })

  test("a descendant's card allow waits out the parent abort's discovery with the chain off", async () => {
    // With the chain off the question-card route is the only gate, and the
    // discovery hold must gate it too: a descendant is neither marked nor banned
    // until the listing returns, so an allow inside that window would execute.
    delete process.env.WATCHDOG_CHAIN
    const base = state.loadState()
    state.saveState({
      ...base,
      endpoint: `http://127.0.0.1:${server.port}/decisions`,
      model: "test-model",
      protocol: "systemone",
      config: { ...base.config, hook_tool_risk: { ...base.config.hook_tool_risk, questionCards: true, cache: false } },
    })
    state.writeKey("test-key")
    const cli = join(scratch, `cli-hold-${marker}.json`)
    writeFileSync(cli, JSON.stringify({ session: { permissions: "prompt" } }))
    process.env.JEV_CLI_CONFIG = cli
    const { resetAutoAcceptCache } = await import("./autopermit.ts")
    resetAutoAcceptCache()
    state.setFeature("hook_tool_risk", true)
    malformedAnswers = (payload) => {
      const id = Object.keys(payload?.questions ?? {})[0]
      return id
        ? { [id]: { type: "choice", choice: "propagate", probabilities: { allow: 0.01, propagate: 0.96, deny: 0.02, abort: 0.01 } } }
        : {}
    }
    let releaseScan: (() => void) | null = null
    const host = fakeHost({
      ...lineage(),
      listGate: () =>
        new Promise<void>((resolve) => {
          releaseScan = resolve
        }),
    })
    try {
      await plugin.setup(host.ctx)
      let settledAs: string | null = null
      const held = latestCardGate(host.hooks)({ sessionID: CHILD, tool: "shell", input: { command: "ls a" }, id: "call_hold_1" }).then(
        () => {
          settledAs = "allowed"
        },
        (error: Error) => {
          settledAs = error.message
        },
      )
      await cardsOpen(1)
      // The abort selects ROOT; CHILD is a descendant nothing has named yet.
      const aborting = host.calls.rpc[0].handlers.abortOperation({ sessionID: ROOT })
      for (let turn = 0; turn < 200 && !releaseScan; turn++) await tick()
      expect(releaseScan).not.toBeNull()
      expect(banOf(CHILD)).toBeUndefined()

      // The user allows during the scan: the answer must not release the call.
      await host.push({ type: "form.replied", data: { id: posted[0].card.id, answer: { decision: "allow" } } })
      await ticks(10)
      expect(settledAs).toBeNull()

      releaseScan!()
      await held
      expect(settledAs).toContain("an abort covers this session")
      expect((await aborting).scope).toEqual([ROOT, CHILD, SELF])
      expect(banOf(CHILD)?.kind).toBe("subtree")
    } finally {
      delete process.env.JEV_CLI_CONFIG
      resetAutoAcceptCache()
      state.setFeature("hook_tool_risk", false)
      resetCardRoute()
    }
  })

  test("the /jev-abort session command writes the unified operation a user turn cannot retire", async () => {
    // The command used the retirable parent-kind ban. It is the same durable
    // operation as a verdict's now, with the same record and the same rows.
    arm()
    nodes("human")
    // The command is gated on the session-ban switch, as before.
    state.setFeature("hook_session_ban", true)
    const host = fakeHost(lineage())
    try {
      await plugin.setup(host.ctx)
      const result = await commands["jev-abort"].execute({ sessionID: ROOT, prompt: { text: "session" } })
      expect(result.content).toContain(`session ${ROOT.slice(0, 12)} aborted`)
      expect(result.content).toContain("3 sessions covered")
      expect(result.content).toContain("durable subtree ban was written for all 3 sessions")
      // The provider attached in this process, so the stop is enforceable now.
      expect(result.content).toContain("The stop is durable")

      // One operation, marked human, over the whole discovered subtree.
      const read = readAbortRecords()
      expect(read.ok).toBe(true)
      if (!read.ok) throw new Error("unreachable")
      const record = read.records.find((row) => row.operation.sessionID === ROOT)!
      expect(record.operation.source).toBe("human")
      expect(record.operation.scope).toEqual([ROOT, CHILD, SELF])
      expect(banOf(ROOT)?.kind).toBe("subtree")
      expect(banOf(CHILD)?.kind).toBe("subtree")

      // An ordinary user message retires a parent-kind ban, never this one.
      nodes("parent,supervisor")
      for (const feed of host.subscriptions) {
        await feed.push({ type: "session.inbox.enqueued", data: { sessionID: CHILD, item: { type: "user" }, seq: 21 } })
      }
      const refused = await latestGate(host.hooks)(call(CHILD, "cq1", "ls a")).then(
        () => "allowed",
        (error: Error) => error.message,
      )
      expect(refused).toContain("did not run")
      expect(banOf(CHILD)?.kind).toBe("subtree")
    } finally {
      state.setFeature("hook_session_ban", false)
    }
  })

  test("the GUI stop runs the unified operation and reports a failed discovery", async () => {
    arm()
    nodes("human")
    const host = fakeHost({ ...lineage(), listFailure: "throw" })
    await plugin.setup(host.ctx)
    const stopped = await host.calls.rpc[0].handlers.stopSession({ sessionID: CHILD })

    // Not a clean success: the scope step failed and says so.
    expect(stopped.ok).toBe(true)
    expect(stopped.sealed).toBe(false)
    expect(stopped.scope).toEqual([CHILD])
    const scope = stopped.incomplete.find((row: any) => row.step === "scope")
    expect(scope.status).toBe("failed")
    expect(scope.detail).toContain("the session listing failed")

    // And it is the same durable record a verdict's abort writes.
    expect(banOf(CHILD)?.kind).toBe("subtree")
    const read = readAbortRecords()
    expect(read.ok && read.records.some((row) => row.operation.sessionID === CHILD && row.operation.source === "human")).toBe(true)
  })

  test("a deny cancels only its own call and aborts nothing", async () => {
    arm()
    nodes("human")
    const host = fakeHost(lineage())
    await plugin.setup(host.ctx)
    const denied = settle(gate(host.hooks)(call(CHILD, "ce1", "ls a")))
    await cardsOpen(1)
    await host.push({ type: "form.replied", data: { id: posted[0].card.id, answer: { decision: "deny" } } })
    expect(await denied).toContain("did not run")
    await ticks(8)

    // No subtree abort: no interrupt, no ban, no operation, no sibling card.
    expect(host.calls.interrupts).toEqual([])
    expect(banOf(CHILD)).toBeUndefined()
    const read = readAbortRecords()
    expect(read.ok && read.records.length).toBe(0)
    const row = since().find((entry) => entry.event === "chain_deny")
    expect(row?.shape).toBe("queued")
  })

  /** One root with two children, tagged per case so no two cases share a scope. */
  const relTree = (tag: string) => {
    const root = `ses_rel_${tag}_root`
    const child = `ses_rel_${tag}_child`
    const self = `ses_rel_${tag}_self`
    return {
      root,
      child,
      self,
      options: {
        sessions: [{ id: root }, { id: child, parentID: root }, { id: self, parentID: root }],
        parentOf: (id: string) => (id === child || id === self ? root : null),
      },
    }
  }

  const operationIDOf = (sessionID: string) => {
    const read = readAbortRecords()
    if (!read.ok) throw new Error("unreachable")
    const matches = read.records.filter((entry) => entry.operation.sessionID === sessionID)
    return matches[matches.length - 1]!.operation.id
  }

  test("a child operation's release never lifts the ancestor's coverage over it", async () => {
    // Criterion 7: B is the child's own abort, A the ancestor's separate one.
    arm()
    nodes("human")
    const tree = relTree("b_first")
    const host = fakeHost(tree.options)
    await plugin.setup(host.ctx)
    const handlers = host.calls.rpc[0].handlers
    await handlers.abortOperation({ sessionID: tree.child })
    await handlers.abortOperation({ sessionID: tree.root })
    expect(banOf(tree.child)?.kind).toBe("subtree")
    expect(banOf(tree.root)?.kind).toBe("subtree")

    const released = await handlers.releaseOperation({ operationID: operationIDOf(tree.child), continue: true })
    expect(released.ok).toBe(true)
    // The ancestor covers the child's whole scope, so nothing clears.
    expect(released.covered).toEqual([tree.child])
    expect(released.ban).toEqual({ cleared: 0, kept: 0, failed: 0 })
    // No continuation while another operation covers the selected session.
    expect(released.continued).toBe("prevented")
    expect(host.calls.prompts).toEqual([])

    // The child stays blocked by the ancestor's own restriction.
    expect(banOf(tree.child)?.kind).toBe("subtree")
    const refused = await gate(host.hooks)(call(tree.child, "cr1", "ls a")).then(
      () => "allowed",
      (error: Error) => error.message,
    )
    expect(refused).toContain("did not run")
  })

  test("the ancestor's release lifts only itself, and continuing it resumes no child", async () => {
    // Criterion 8: A is released while the child's own abort stands.
    arm()
    nodes("human")
    const tree = relTree("a_first")
    const host = fakeHost(tree.options)
    await plugin.setup(host.ctx)
    const handlers = host.calls.rpc[0].handlers
    await handlers.abortOperation({ sessionID: tree.child })
    await handlers.abortOperation({ sessionID: tree.root })

    const released = await handlers.releaseOperation({ operationID: operationIDOf(tree.root), continue: true })
    expect(released.ok).toBe(true)
    expect(released.covered).toEqual([tree.child])
    // The ancestor's own rows lifted; the child's own abort holds it.
    expect(banOf(tree.root)).toBeUndefined()
    expect(banOf(tree.self)).toBeUndefined()
    expect(banOf(tree.child)?.kind).toBe("subtree")
    // One prompt, to the selected session only.
    expect(host.calls.prompts).toEqual([{ sessionID: tree.root, text: RELEASE_CONTINUE_TEXT }])

    // Continuing the ancestor does not resume the child.
    const refused = await gate(host.hooks)(call(tree.child, "cr2", "ls b")).then(
      () => "allowed",
      (error: Error) => error.message,
    )
    expect(refused).toContain("did not run")
  })

  test("releasing both without continuation resumes nothing, and the tree runs again", async () => {
    // Criterion 9, the both-released half: no session stays covered, no prompt
    // was asked for, and the next call passes the normal chain.
    arm()
    nodes("human")
    const tree = relTree("both")
    const host = fakeHost({ ...tree.options, generate: (request: any) => allowReply(request.prompt) })
    await plugin.setup(host.ctx)
    const handlers = host.calls.rpc[0].handlers
    await handlers.abortOperation({ sessionID: tree.child })
    await handlers.abortOperation({ sessionID: tree.root })

    const first = await handlers.releaseOperation({ operationID: operationIDOf(tree.root) })
    const second = await handlers.releaseOperation({ operationID: operationIDOf(tree.child) })
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    expect(first.continued).toBe("not-requested")
    expect(second.continued).toBe("not-requested")
    expect(host.calls.prompts).toEqual([])
    // Every restriction is gone, including the child row the ancestor's later
    // write had replaced.
    expect(banOf(tree.root)).toBeUndefined()
    expect(banOf(tree.self)).toBeUndefined()
    expect(banOf(tree.child)).toBeUndefined()

    // A new call passes the normal chain again: host rules, review, admission.
    nodes("parent,supervisor")
    const allowed = await gate(host.hooks)(call(tree.child, "cr3", "ls c")).then(
      () => "allowed",
      (error: Error) => error.message,
    )
    expect(allowed).toBe("allowed")
  })

  test("the final release with continuation prompts only the selected session", async () => {
    // Criterion 9, the final-release half: with every other operation released,
    // one prompt to the operation's own session and no other.
    arm()
    nodes("human")
    const tree = relTree("final")
    const host = fakeHost(tree.options)
    await plugin.setup(host.ctx)
    const handlers = host.calls.rpc[0].handlers
    await handlers.abortOperation({ sessionID: tree.child })
    await handlers.abortOperation({ sessionID: tree.root })

    const first = await handlers.releaseOperation({ operationID: operationIDOf(tree.root) })
    expect(first.continued).toBe("not-requested")
    const second = await handlers.releaseOperation({ operationID: operationIDOf(tree.child), continue: true })
    expect(second.ok).toBe(true)
    expect(second.continued).toBe("sent")
    expect(host.calls.prompts).toEqual([{ sessionID: tree.child, text: RELEASE_CONTINUE_TEXT }])
  })

  test("a retried release answers already and never repeats the prompt", async () => {
    // Criterion 10's retry: the record says released and continued, so the
    // second request re-clears idempotently and sends nothing.
    arm()
    nodes("human")
    const tree = relTree("retry")
    const host = fakeHost(tree.options)
    await plugin.setup(host.ctx)
    const handlers = host.calls.rpc[0].handlers
    await handlers.abortOperation({ sessionID: tree.child })

    const first = await handlers.releaseOperation({ operationID: operationIDOf(tree.child), continue: true })
    expect(first.ok).toBe(true)
    expect(first.already).toBe(false)
    expect(first.continued).toBe("sent")
    expect(host.calls.prompts).toHaveLength(1)

    const second = await handlers.releaseOperation({ operationID: operationIDOf(tree.child), continue: true })
    expect(second.ok).toBe(true)
    expect(second.already).toBe(true)
    expect(second.continued).toBe("already")
    expect(host.calls.prompts).toHaveLength(1)
  })

  test("a restart restores the released and the active operation each to its own state", async () => {
    // Criterion 6 with criterion 10's restart: the released operation is not
    // re-asserted, the active one keeps its coverage, and the new runtime's
    // release can finish what the first began.
    arm()
    nodes("human")
    const tree = relTree("restart")
    const before = fakeHost({ ...tree.options, generate: (request: any) => allowReply(request.prompt) })
    await plugin.setup(before.ctx)
    const handlers = before.calls.rpc[0].handlers
    await handlers.abortOperation({ sessionID: tree.child })
    await handlers.abortOperation({ sessionID: tree.root })
    const childOp = operationIDOf(tree.child)
    const rootOp = operationIDOf(tree.root)
    await handlers.releaseOperation({ operationID: childOp })
    // The child's release lifted nothing its scope did not own: the root
    // operation still covers it.
    expect(banOf(tree.child)?.kind).toBe("subtree")

    // A second setup is a new runtime over the same durable store.
    posted.length = 0
    const after = fakeHost({ ...tree.options, generate: (request: any) => allowReply(request.prompt) })
    await plugin.setup(after.ctx)
    // The active operation keeps every restriction; the released one gains none.
    expect(banOf(tree.child)?.kind).toBe("subtree")
    expect(banOf(tree.root)?.kind).toBe("subtree")
    expect(banOf(tree.self)?.kind).toBe("subtree")

    const released = await after.calls.rpc[0].handlers.releaseOperation({ operationID: rootOp })
    expect(released.ok).toBe(true)
    // The root's own rows and the released child's replaced row both clear.
    expect(banOf(tree.root)).toBeUndefined()
    expect(banOf(tree.self)).toBeUndefined()
    expect(banOf(tree.child)).toBeUndefined()

    // The new runtime admits the released tree again, through its own chain.
    nodes("parent,supervisor")
    const allowed = await latestGate(after.hooks)(call(tree.child, "cr4", "ls d")).then(
      () => "allowed",
      (error: Error) => error.message,
    )
    expect(allowed).toBe("allowed")
  })

  test("a released scope keeps stale approvals dead and late answers deciding nothing", async () => {
    // Criterion 10's stale approvals and late replies: release restores no
    // revoked authority and re-decides no settled call.
    arm()
    nodes("human")
    const tree = relTree("stale")
    const host = fakeHost({ ...tree.options, generate: (request: any) => allowReply(request.prompt) })
    await plugin.setup(host.ctx)
    const handlers = host.calls.rpc[0].handlers
    const ttl = state.loadState().approveTtl
    recordApproval(
      { token: "tok_rel_stale", sessionID: tree.child, action: "shell", resources: [], subject: "ls", reason: "review", ts: new Date().toISOString() },
      ttl,
    )
    const one = settle(gate(host.hooks)(call(tree.child, "cq1", "ls a")))
    const two = settle(gate(host.hooks)(call(tree.child, "cq2", "ls b")))
    await cardsOpen(2)
    const [first, second] = posted.map((entry) => entry.card.id)
    await host.push({ type: "form.replied", data: { id: first, answer: { decision: "abort" } } })
    expect(await one).toContain("aborted")
    await ticks(10)
    expect(deleted).toContain(second)
    expect(await two).toContain("did not run")

    await handlers.releaseOperation({ operationID: operationIDOf(tree.child) })

    // The approval the abort revoked stays revoked: no restoration.
    const approved = await handlers.approve({ token: "tok_rel_stale", sessionID: tree.child })
    expect(approved.ok).toBe(false)

    // A late answer for the cancelled card finds no hold and authorizes
    // nothing: the next call's fate is the chain's, and the chain admits it.
    await host.push({ type: "form.replied", data: { id: second, answer: { decision: "allow" } } })
    nodes("parent,supervisor")
    const later = await gate(host.hooks)(call(tree.child, "cq3", "ls c")).then(
      () => "allowed",
      (error: Error) => error.message,
    )
    expect(later).toBe("allowed")
    // No continuation was requested, and the late card sent none either.
    expect(host.calls.prompts).toEqual([])
  })
})

describe("abort delivery", () => {
  const ROOT = "ses_dl_root"
  const CHILD = "ses_dl_child"
  const GRAND = "ses_dl_grand"

  /** One child with its own child: the scope is two sessions, the receipt is one. */
  const lineage = () => ({
    sessions: [{ id: ROOT }, { id: CHILD, parentID: ROOT }, { id: GRAND, parentID: CHILD }],
  })

  const enable = () => {
    state.setFeature("hook_abort_receipts", true)
    state.setFeatureConfig("hook_abort_receipts", "webhook", "http://127.0.0.1:9/unused")
    // One attempt per pass: a failed POST reads failed without a retry timer,
    // so a case never leaves one scheduled behind its own finally.
    state.setFeatureConfig("hook_abort_receipts", "maxAttempts", 1)
  }
  const disable = () => state.setFeature("hook_abort_receipts", false)

  /**
   * The transport seam: every POST the plugin issued, with the body parsed, and
   * a park switch that holds a POST open so a case can race a second abort.
   */
  const receiptRecorder = () => {
    const posts: Array<{ url: string; body: any }> = []
    const waits: Array<() => void> = []
    let parked = false
    return {
      posts,
      transport: async (url: string, body: string) => {
        posts.push({ url, body: JSON.parse(body) })
        if (parked) await new Promise<void>((resolve) => waits.push(resolve))
        return true
      },
      parkAll: () => {
        parked = true
      },
      releaseAll: () => {
        parked = false
        for (const resolve of waits.splice(0)) resolve()
      },
    }
  }

  test("one abort sends one receipt and one parent notice, never one per descendant", async () => {
    arm()
    nodes("human")
    enable()
    const rec = receiptRecorder()
    setReceiptTransport(rec.transport)
    try {
      const host = fakeHost(lineage())
      await plugin.setup(host.ctx)
      const result = await host.calls.rpc[0].handlers.abortOperation({ sessionID: CHILD })
      expect(result.ok).toBe(true)
      expect(result.scope).toEqual([CHILD, GRAND])
      await ticks(10)

      // One logical receipt for the whole two-session operation.
      expect(rec.posts.length).toBe(1)
      expect(rec.posts[0].body.event).toBe("abort_receipt")
      expect(rec.posts[0].body.scope).toBe(2)
      // The scope is a count, and the endpoint never travels with the body.
      expect(JSON.stringify(rec.posts[0].body)).not.toContain(GRAND)
      expect(JSON.stringify(rec.posts[0].body)).not.toContain("127.0.0.1")

      // The notice is one queue write to the host-recorded direct parent, and
      // no turn was ever started for it.
      expect(host.calls.prompts).toEqual([])
      expect(host.calls.syntheticNotes.length).toBe(1)
      expect(host.calls.syntheticNotes[0].sessionID).toBe(ROOT)
      expect(host.calls.syntheticNotes[0].delivery).toBe("queue")
      expect(host.calls.syntheticNotes[0].text).toContain(CHILD)
      expect(host.calls.syntheticNotes[0].text).toContain("no turn was started and nothing was resumed")
      expect(host.calls.syntheticNotes[0].text).not.toContain("127.0.0.1")

      // The statuses are observable through the operation listing.
      const listed = await host.calls.rpc[0].handlers.abortOperations({})
      const row = listed.operations.find((entry: any) => entry.sessionID === CHILD)
      expect(row.delivery).toEqual({ receipt: "delivered", attempts: 1, notice: "delivered" })
    } finally {
      setReceiptTransport(null)
      disable()
    }
  })

  test("a parent aborted while delivery is parked gets no notice for its child", async () => {
    arm()
    nodes("human")
    enable()
    const rec = receiptRecorder()
    rec.parkAll()
    setReceiptTransport(rec.transport)
    try {
      const host = fakeHost(lineage())
      await plugin.setup(host.ctx)
      // The child's receipt POST parks inside the pump.
      await host.calls.rpc[0].handlers.abortOperation({ sessionID: CHILD })
      await ticks(4)
      expect(rec.posts.length).toBe(1)

      // The parent is aborted while that delivery is still parked. Its own
      // receipt is queued behind the parked pass, so no second post yet.
      await host.calls.rpc[0].handlers.abortOperation({ sessionID: ROOT })
      await ticks(4)
      expect(rec.posts.length).toBe(1)

      // Released, both passes settle: the child's notice finds a parent that
      // is itself being aborted, and the parent's own row has no parent.
      rec.releaseAll()
      await ticks(10)
      expect(rec.posts.length).toBe(2)
      const read = readDeliveryRows()
      expect(read.ok).toBe(true)
      if (!read.ok) throw new Error("unreachable")
      const childRow = read.rows.find((row) => row.sessionID === CHILD)
      expect(childRow?.notice).toBe("suppressed")
      const parentRow = read.rows.find((row) => row.sessionID === ROOT)
      expect(parentRow?.notice).toBe("absent")
      // Neither operation wrote a notice, and neither started a turn.
      expect(host.calls.syntheticNotes).toEqual([])
      expect(host.calls.prompts).toEqual([])
    } finally {
      rec.releaseAll()
      setReceiptTransport(null)
      disable()
    }
  })

  test("a parked receipt transport never delays containment", async () => {
    arm()
    nodes("human")
    enable()
    const rec = receiptRecorder()
    rec.parkAll()
    setReceiptTransport(rec.transport)
    try {
      const host = fakeHost(lineage())
      await plugin.setup(host.ctx)
      const result = await host.calls.rpc[0].handlers.abortOperation({ sessionID: CHILD })
      // The abort operation resolved with its containment complete while the
      // receipt POST is still parked.
      expect(result.ok).toBe(true)
      expect(result.sealed).toBe(true)
      await ticks(4)
      expect(rec.posts.length).toBe(1)
      const read = readDeliveryRows()
      expect(read.ok).toBe(true)
      if (!read.ok) throw new Error("unreachable")
      expect(read.rows[0].receipt.status).toBe("queued")

      rec.releaseAll()
      await ticks(10)
      const settled = readDeliveryRows()
      expect(settled.ok).toBe(true)
      if (!settled.ok) throw new Error("unreachable")
      expect(settled.rows[0].receipt.status).toBe("delivered")
    } finally {
      rec.releaseAll()
      setReceiptTransport(null)
      disable()
    }
  })

  test("the delivery feature is off by default: an abort posts nothing and queues no row", async () => {
    arm()
    nodes("human")
    disable()
    const rec = receiptRecorder()
    setReceiptTransport(rec.transport)
    try {
      const host = fakeHost(lineage())
      await plugin.setup(host.ctx)
      const result = await host.calls.rpc[0].handlers.abortOperation({ sessionID: CHILD })
      expect(result.ok).toBe(true)
      await ticks(10)
      expect(rec.posts.length).toBe(0)
      expect(host.calls.prompts).toEqual([])
      expect(host.calls.syntheticNotes).toEqual([])
      const read = readDeliveryRows()
      expect(read.ok).toBe(true)
      if (!read.ok) throw new Error("unreachable")
      expect(read.rows.length).toBe(0)
      expect(existsSync(join(chainStateHome(), DELIVERY_FILE))).toBe(false)
    } finally {
      setReceiptTransport(null)
      disable()
    }
  })
})

describe("repeated setup", () => {
  const CHILD = "ses_setup_child"
  /** The posture the abort RPC reports, read after its operation resolved. */
  const posture = async (host: Host, sessionID: string): Promise<string[]> => {
    const handlers = host.calls.rpc.at(-1)?.handlers
    const answer = await handlers.abortOperation({ sessionID })
    return answer.enforcedBy as string[]
  }

  test("a call dispatched to a retired card callback is judged by the live route, once", async () => {
    // The host keeps every callback it was given (`permissionHistory`, `hooks`)
    // and calls them all. A retired card callback must not release a call the new
    // generation may never see, and it must not score the same call twice either.
    delete process.env.WATCHDOG_CHAIN
    const base = state.loadState()
    state.saveState({
      ...base,
      endpoint: `http://127.0.0.1:${server.port}/decisions`,
      model: "test-model",
      protocol: "systemone",
      // `cache: false`: the verdict cache is process-wide and this suite reuses
      // session ids, so a cached allow would skip the model call this case counts.
      config: { ...base.config, hook_tool_risk: { ...base.config.hook_tool_risk, questionCards: true, cache: false } },
    })
    state.writeKey("test-key")
    // A propagate verdict opens a card only when the host is not auto-accepting;
    // the real client config must not decide this case.
    const cli = join(scratch, `cli-${marker}.json`)
    writeFileSync(cli, JSON.stringify({ session: { permissions: "prompt" } }))
    process.env.JEV_CLI_CONFIG = cli
    const { resetAutoAcceptCache } = await import("./autopermit.ts")
    resetAutoAcceptCache()
    state.setFeature("hook_tool_risk", true)
    const host = fakeHost()
    try {
      await plugin.setup(host.ctx)
      // Each setup registers the card route, then the chain's own inert wrapper.
      expect(host.hooks["execute.before"]).toHaveLength(2)
      const staleCard = host.hooks["execute.before"][0]
      const staleJev = host.permissionHistory.evaluate[0]

      // A second setup with the route still on replaces both callbacks.
      await plugin.setup(host.ctx)
      expect(host.hooks["execute.before"]).toHaveLength(4)
      expect(host.permissionHistory.evaluate).toHaveLength(2)
      // The replaced card route, the retired Jev hook and the chain's own wrapper
      // (registered per setup) were all disposed, and the retired card feed was
      // ended through its own signal.
      expect(host.disposed).toBe(3)
      expect(host.aborted).toBe(1)

      // The retired Jev hook answers nothing now that the handover is over.
      const handoverDone = { ...assertCall(CHILD, "msg_stale_jev", "call_stale_jev"), action: "shell" }
      await staleJev(handoverDone)
      expect(handoverDone.effect).toBe("allow")

      // The retired card callback still owes a decision: it hands the call to the
      // live route, which is the one whose feed answers the card it opens.
      malformedAnswers = (payload) => {
        const id = Object.keys(payload?.questions ?? {})[0]
        return id ? { [id]: { type: "choice", choice: "propagate", probabilities: { allow: 0.01, propagate: 0.96, deny: 0.02, abort: 0.01 } } } : {}
      }
      const scoredBefore = decisions.length
      const held = staleCard({ sessionID: CHILD, tool: "shell", input: { command: "ls stale" }, id: "call_stale_card" }).then(
        () => "allowed",
        (error: Error) => error.message,
      )
      for (let turn = 0; turn < 200 && !posted.length; turn++) await tick()
      expect(decisions.length).toBe(scoredBefore + 1)
      expect(posted).toHaveLength(1)
      await host.push({ type: "form.replied", data: { id: posted[0].card.id, answer: { decision: "allow" } } })
      expect(await held).toBe("allowed")
      expect(posted).toHaveLength(1)

      // One call, both callbacks: the second replays the first judgement instead
      // of scoring the call again and opening a second card.
      const scoredAgain = decisions.length
      const liveCard = host.hooks["execute.before"][2]
      const both = liveCard({ sessionID: CHILD, tool: "shell", input: { command: "ls both" }, id: "call_both" }).then(
        () => "allowed",
        (error: Error) => error.message,
      )
      for (let turn = 0; turn < 200 && !posted.length; turn++) await tick()
      const replayed = staleCard({ sessionID: CHILD, tool: "shell", input: { command: "ls both" }, id: "call_both" }).then(
        () => "allowed",
        (error: Error) => error.message,
      )
      for (let turn = 0; turn < 20; turn++) await tick()
      expect(decisions.length).toBe(scoredAgain + 1)
      expect(posted).toHaveLength(2)
      await host.push({ type: "form.replied", data: { id: posted[1].card.id, answer: { decision: "allow" } } })
      expect(await both).toBe("allowed")
      // The replay carries the same answer the first callback got.
      expect(await replayed).toBe("allowed")
      expect(posted).toHaveLength(2)
    } finally {
      state.setFeature("hook_tool_risk", false)
      resetCardRoute()
    }
  })

  test("a card callback retired while its decision is parked hands the call to the live route", async () => {
    // The decision is already in flight when a second setup replaces the route.
    // The parked answer belongs to a generation that no longer owns the call, so
    // the retired callback hands it to the live route instead of acting on it —
    // or releasing it unjudged.
    delete process.env.WATCHDOG_CHAIN
    const base = state.loadState()
    state.saveState({
      ...base,
      endpoint: `http://127.0.0.1:${server.port}/decisions`,
      model: "test-model",
      protocol: "systemone",
      config: { ...base.config, hook_tool_risk: { ...base.config.hook_tool_risk, questionCards: true, cache: false } },
    })
    state.writeKey("test-key")
    const cli = join(scratch, `cli-mid-${marker}.json`)
    writeFileSync(cli, JSON.stringify({ session: { permissions: "prompt" } }))
    process.env.JEV_CLI_CONFIG = cli
    const { resetAutoAcceptCache } = await import("./autopermit.ts")
    resetAutoAcceptCache()
    state.setFeature("hook_tool_risk", true)
    const host = fakeHost()
    let releaseDecision: (() => void) | null = null
    let arrived = false
    try {
      await plugin.setup(host.ctx)
      const staleCard = host.hooks["execute.before"][0]
      // The first scoring is parked and would open a card; the live generation's
      // answer for the same call is a deny.
      malformedAnswers = (payload) => {
        const id = Object.keys(payload?.questions ?? {})[0]
        return id ? { [id]: { type: "choice", choice: "propagate", probabilities: { allow: 0.01, propagate: 0.96, deny: 0.02, abort: 0.01 } } } : {}
      }
      decisionGate = new Promise<void>((resolve) => {
        releaseDecision = resolve
      })
      decisionArrived = () => {
        arrived = true
      }
      let settled: string | null = null
      const held = staleCard({ sessionID: CHILD, tool: "shell", input: { command: "ls mid" }, id: "call_mid" }).then(
        () => {
          settled = "allowed"
        },
        (error: Error) => {
          settled = error.message
        },
      )
      for (let turn = 0; turn < 400 && !arrived; turn++) await tick()
      expect(arrived).toBe(true)

      // Retired while the decision is parked. Each setup registers the card
      // route, then the chain's own inert wrapper.
      await plugin.setup(host.ctx)
      expect(host.hooks["execute.before"]).toHaveLength(4)
      malformedAnswers = (payload) => {
        const id = Object.keys(payload?.questions ?? {})[0]
        return id ? { [id]: { type: "choice", choice: "deny", probabilities: { allow: 0.01, propagate: 0.02, deny: 0.96, abort: 0.01 } } } : {}
      }
      decisionGate = null
      releaseDecision!()

      await held
      expect(settled).toContain("jev: denied")
      // The parked propagate never became a card: the live route decided.
      expect(posted).toHaveLength(0)
    } finally {
      decisionGate = null
      decisionArrived = null
      state.setFeature("hook_tool_risk", false)
      resetCardRoute()
    }
  })

  test("a card callback retired into a setup with cards off refuses the parked call", async () => {
    // The replacement turned the route off, so no live card route exists to take
    // an event already dispatched to the old callback. Another gate is not
    // guaranteed to have seen it, so the retired callback must refuse rather than
    // return undecided and let the host's default release the call.
    delete process.env.WATCHDOG_CHAIN
    const base = state.loadState()
    state.saveState({
      ...base,
      endpoint: `http://127.0.0.1:${server.port}/decisions`,
      model: "test-model",
      protocol: "systemone",
      config: { ...base.config, hook_tool_risk: { ...base.config.hook_tool_risk, questionCards: true, cache: false } },
    })
    state.writeKey("test-key")
    const cli = join(scratch, `cli-off-${marker}.json`)
    writeFileSync(cli, JSON.stringify({ session: { permissions: "prompt" } }))
    process.env.JEV_CLI_CONFIG = cli
    const { resetAutoAcceptCache } = await import("./autopermit.ts")
    resetAutoAcceptCache()
    state.setFeature("hook_tool_risk", true)
    const host = fakeHost()
    let releaseDecision: (() => void) | null = null
    let arrived = false
    try {
      await plugin.setup(host.ctx)
      const staleCard = host.hooks["execute.before"][0]
      expect(typeof staleCard).toBe("function")
      decisionGate = new Promise<void>((resolve) => {
        releaseDecision = resolve
      })
      decisionArrived = () => {
        arrived = true
      }
      let settled: string | null = null
      const held = staleCard({ sessionID: CHILD, tool: "shell", input: { command: "ls off" }, id: "call_off" }).then(
        () => {
          settled = "allowed"
        },
        (error: Error) => {
          settled = error.message
        },
      )
      for (let turn = 0; turn < 400 && !arrived; turn++) await tick()
      expect(arrived).toBe(true)
      expect(settled).toBeNull()

      // The replacement has the card route off: no live route to hand the call to.
      const live = state.loadState()
      state.saveState({ ...live, config: { ...live.config, hook_tool_risk: { ...live.config.hook_tool_risk, questionCards: false } } })
      await plugin.setup(host.ctx)
      // No live card route: the replacement registers only the chain's own wrapper.
      expect(host.hooks["execute.before"]).toHaveLength(3)
      decisionGate = null
      releaseDecision!()

      await held
      expect(settled).toContain("question-card route was being replaced")
      expect(settled).not.toBe("allowed")
      expect(posted).toHaveLength(0)
    } finally {
      decisionGate = null
      decisionArrived = null
      // The route was turned off for the second setup; the next case must not
      // inherit that.
      const after = state.loadState()
      state.saveState({ ...after, config: { ...after.config, hook_tool_risk: { ...after.config.hook_tool_risk, questionCards: true } } })
      state.setFeature("hook_tool_risk", false)
      resetCardRoute()
    }
  })

  test("a call dispatched during the handover is refused, never released unjudged", async () => {
    // The second setup is parked inside its registrations: the generation has
    // moved, the new card route is not up yet, and the host still dispatches to
    // the callback it holds. That call must not run on the host's default.
    delete process.env.WATCHDOG_CHAIN
    const base = state.loadState()
    state.saveState({
      ...base,
      config: { ...base.config, hook_tool_risk: { ...base.config.hook_tool_risk, questionCards: true, cache: false } },
    })
    state.setFeature("hook_tool_risk", true)
    let openGate: (() => void) | null = null
    const host = fakeHost()
    try {
      await plugin.setup(host.ctx)
      const staleCard = host.hooks["execute.before"][0]
      const staleJev = host.permissionHistory.evaluate[0]
      expect(typeof staleCard).toBe("function")

      // Setup two runs up to its first parked registration, then waits.
      registrationGate = new Promise<void>((resolve) => {
        openGate = resolve
      })
      const second = plugin.setup(host.ctx)
      for (let turn = 0; turn < 200 && !registrationParked; turn++) await tick()
      expect(registrationParked).toBe(true)
      // Nothing of the old generation has been dropped yet: it is disposed only
      // after this setup's own registrations are in place.
      expect(host.disposed).toBe(0)

      // Handover: nobody else judges these calls yet, so both fail closed.
      const jevEvent = { ...assertCall(CHILD, "msg_handover", "call_handover"), action: "shell" }
      await staleJev(jevEvent)
      expect(jevEvent.effect).toBe("deny")
      expect(String(jevEvent.message)).toContain("enforcement handover is in progress")
      const cardEvent = { sessionID: CHILD, tool: "shell", input: { command: "ls handover" }, id: "call_handover" }
      await expect(staleCard(cardEvent)).rejects.toThrow(/question-card route was being replaced/)

      // The handover completes and the same retired callbacks are inert or
      // delegating, never denying a call the live generation admits.
      registrationGate = null
      openGate!()
      await second
      expect(host.hooks["execute.before"]).toHaveLength(4)
      const after = { ...assertCall(CHILD, "msg_after", "call_after"), action: "shell" }
      await staleJev(after)
      expect(after.effect).toBe("allow")
      malformedAnswers = null
      expect(posted).toHaveLength(0)
    } finally {
      state.setFeature("hook_tool_risk", false)
      resetCardRoute()
    }
  })

  test("two overlapping setups are queued, so the newest generation is the one that survives", async () => {
    // The host calls `setup` twice without awaiting either. Interleaved, the
    // second's teardown would retire the first while the first is still
    // registering, and whichever finished last would own the module handles —
    // including a session-ban handle the winner then disposes.
    delete process.env.WATCHDOG_CHAIN
    const base = state.loadState()
    state.saveState({
      ...base,
      endpoint: `http://127.0.0.1:${server.port}/decisions`,
      model: "test-model",
      protocol: "systemone",
      config: { ...base.config, hook_tool_risk: { ...base.config.hook_tool_risk, questionCards: true, cache: false } },
    })
    state.writeKey("test-key")
    state.setFeature("hook_tool_risk", true)
    state.setFeature("hook_session_ban", true)
    const host = fakeHost()
    let openGate: (() => void) | null = null
    try {
      registrationGate = new Promise<void>((resolve) => {
        openGate = resolve
      })
      const first = plugin.setup(host.ctx)
      const second = plugin.setup(host.ctx)
      for (let turn = 0; turn < 200 && !registrationParked; turn++) await tick()
      expect(registrationParked).toBe(true)
      // The second setup has not begun: one registration from the first, and no
      // card route yet.
      expect(host.permissionHistory.evaluate).toHaveLength(1)
      expect(host.hooks["execute.before"]).toBeUndefined()

      registrationGate = null
      openGate!()
      await Promise.all([first, second])
      expect(host.permissionHistory.evaluate).toHaveLength(4)
      expect(host.hooks["execute.before"]).toHaveLength(4)

      // One live judge per call: the newest card route decides, and the older
      // one hands the call over instead of scoring it a second time. Each
      // setup's chain wrapper follows its card route.
      const scored = decisions.length
      const newest = host.hooks["execute.before"][2]
      const oldest = host.hooks["execute.before"][0]
      await newest({ sessionID: CHILD, tool: "shell", input: { command: "ls newest" }, id: "call_newest" })
      await oldest({ sessionID: CHILD, tool: "shell", input: { command: "ls oldest" }, id: "call_oldest" })
      expect(decisions.length).toBe(scored + 2)
      expect(posted).toHaveLength(0)

      // The session-ban handle belongs to the newest generation: its provider
      // denies under a durable ban, and the provider it replaced is inert.
      expect(writeSubtreeBan(CHILD, "operator abort", 1)).toBe(true)
      const newestProvider = host.permissionHistory.evaluate.at(-1)!
      const newestEvent = assertCall(CHILD, "msg_queued_live", "call_queued_live")
      await newestProvider(newestEvent)
      expect(newestEvent.effect).toBe("deny")
      // The retired provider hands a call the host still dispatches to it to the
      // newest one, which refuses it on the ban in force instead of deciding
      // nothing about an event it was never replayed.
      const oldestProvider = host.permissionHistory.evaluate[1]
      const oldestEvent = assertCall(CHILD, "msg_queued_stale", "call_queued_stale")
      expect((await oldestProvider(oldestEvent)).effect).toBe("deny")
      expect(oldestEvent.effect).toBe("deny")
      expect(String(oldestEvent.message)).toContain("session-ban:")
    } finally {
      state.setFeature("hook_session_ban", false)
      state.setFeature("hook_tool_risk", false)
      resetCardRoute()
    }
  })

  test("a setup that throws midway fails closed, drops its partial registrations, and leaves the queue usable", async () => {
    // The registration after the Jev hook refuses the card route's hook, so the
    // attempt throws with one registration already made. There is no live
    // generation then: every callback the host still holds must refuse, the
    // half-attached one must be dropped, and the next setup must still run.
    // The session-ban switch stays off, so the only wire this attempt makes is
    // its own Jev hook and the count is exact.
    delete process.env.WATCHDOG_CHAIN
    const base = state.loadState()
    state.saveState({
      ...base,
      config: { ...base.config, hook_tool_risk: { ...base.config.hook_tool_risk, questionCards: true, cache: false } },
    })
    state.setFeature("hook_tool_risk", true)
    const opts: any = {}
    const host = fakeHost(opts)
    try {
      await plugin.setup(host.ctx)
      const staleJev = host.permissionHistory.evaluate[0]
      const staleCard = host.hooks["execute.before"][0]
      const disposedBefore = host.disposed

      opts.rejectHook = (name: string) => name === "execute.before"
      await expect(plugin.setup(host.ctx)).rejects.toThrow()
      // Exactly the one registration the attempt made was dropped: nothing
      // half-attached stays behind with the host.
      expect(host.disposed).toBe(disposedBefore + 1)
      expect(host.hooks["execute.before"]).toHaveLength(2)

      // No generation is live, so the callbacks the host still holds fail closed:
      // the Jev hook refuses, and the card route refuses instead of releasing the
      // call into a route it no longer owns.
      const jevEvent = { ...assertCall(CHILD, "msg_failed", "call_failed"), action: "shell" }
      await staleJev(jevEvent)
      expect(jevEvent.effect).toBe("deny")
      expect(String(jevEvent.message)).toContain("enforcement handover is in progress")
      await expect(
        staleCard({ sessionID: CHILD, tool: "shell", input: { command: "ls failed" }, id: "call_failed_card" }),
      ).rejects.toThrow(/question-card route was being replaced/)

      // The queue is not wedged by the rejection: the next setup runs, registers,
      // and clears the failed attempt's fail-closed posture.
      opts.rejectHook = null
      await plugin.setup(host.ctx)
      // Setup one's card route and chain wrapper, then the new setup's own pair.
      expect(host.hooks["execute.before"]).toHaveLength(4)
      // Setup one's hook, the failed attempt's, and the new setup's: the queue ran
      // the third attempt, and only a completed setup retires a generation.
      expect(host.permissionHistory.evaluate).toHaveLength(3)
      const after = { ...assertCall(CHILD, "msg_after_failed", "call_after_failed"), action: "shell" }
      await staleJev(after)
      expect(after.effect).toBe("allow")
    } finally {
      state.setFeature("hook_tool_risk", false)
      resetCardRoute()
    }
  })

  test("a retired Jev hook hands a call the host still holds to the live hook", async () => {
    // The host may dispatch an event to the old callback and never to the new
    // one. Returning without a judgment would release the call unjudged, so the
    // retired hook hands it to the live generation, which refuses it on the ban
    // now in force.
    delete process.env.WATCHDOG_CHAIN
    state.setFeature("hook_tool_risk", true)
    const host = fakeHost()
    try {
      await plugin.setup(host.ctx)
      await plugin.setup(host.ctx)
      expect(host.permissionHistory.evaluate).toHaveLength(2)
      const stale = host.permissionHistory.evaluate[0]
      const live = host.permissionHistory.evaluate[1]

      expect(writeSubtreeBan(CHILD, "operator abort", 1)).toBe(true)
      const staleEvent = { ...assertCall(CHILD, "msg_retired_jev", "call_retired_jev"), action: "shell" }
      await stale(staleEvent)
      expect(staleEvent.effect).toBe("deny")
      expect(String(staleEvent.message)).toContain("durable abort ban")

      // The live hook's own judgment, for comparison: the same refusal.
      const liveEvent = { ...assertCall(CHILD, "msg_live_jev", "call_live_jev"), action: "shell" }
      await live(liveEvent)
      expect(liveEvent.effect).toBe("deny")
      expect(String(liveEvent.message)).toContain("durable abort ban")
    } finally {
      state.setFeature("hook_tool_risk", false)
    }
  })

  test("a chain wrapper left by a failed setup refuses a call the host still dispatches to it", async () => {
    // The chain registers first, then the next setup is refused at the same hook
    // after the first wrapper was retired. Nothing is live to judge the call, so
    // the retired wrapper refuses instead of passing it through unjudged.
    arm()
    nodes("supervisor")
    const opts: any = {}
    const host = fakeHost(opts)
    await plugin.setup(host.ctx)
    const stale = host.hooks["execute.before"]![0]
    opts.rejectHook = (name: string) => name === "execute.before"
    await expect(plugin.setup(host.ctx)).rejects.toThrow(/refused/)
    await expect(
      stale({ sessionID: "ses_w62", tool: "shell", input: { command: "ls" }, id: "call_62" }),
    ).rejects.toThrow(/enforcement handover is in progress/)
  })

  test("a Jev callback of a setup that throws never judges as its own live self", async () => {
    // The attempt registers its own permission hook, then a later step throws
    // while that hook is already judging a call. Its generation token must die
    // with it: the parked judgment belongs to a generation nobody owns, so it
    // refuses instead of applying the allow it computed.
    delete process.env.WATCHDOG_CHAIN
    const base = state.loadState()
    state.saveState({
      ...base,
      endpoint: `http://127.0.0.1:${server.port}/decisions`,
      model: "test-model",
      protocol: "systemone",
      // The decision is a real round trip through this suite's server, which is
      // what lets one be held open while the setup throws.
      config: { ...base.config, hook_tool_risk: { ...base.config.hook_tool_risk, cache: false } },
    })
    state.writeKey("test-key")
    state.setFeature("hook_tool_risk", true)
    let release: (() => void) | null = null
    let arrived = false
    decisionGate = new Promise<void>((resolve) => {
      release = resolve
    })
    decisionArrived = () => {
      arrived = true
    }
    let openGate: (() => void) | null = null
    const host = fakeHost()
    try {
      await plugin.setup(host.ctx)

      // The second attempt parks at its own Jev hook registration: the callback
      // is installed and live, the setup has not finished.
      registrationGate = new Promise<void>((resolve) => {
        openGate = resolve
      })
      const second = plugin.setup(host.ctx)
      for (let turn = 0; turn < 200 && !registrationParked; turn++) await tick()
      expect(registrationParked).toBe(true)
      const failing = host.permissionHistory.evaluate[1]
      const event = { ...assertCall(CHILD, "msg_failed_live", "call_failed_live"), action: "shell" }
      const pending = failing(event).then(
        () => event.effect,
        (error: Error) => error.message,
      )
      for (let turn = 0; turn < 400 && !arrived; turn++) await tick()
      expect(arrived).toBe(true)

      // The attempt fails after its hook was registered.
      const original = host.ctx.command.transform
      host.ctx.command.transform = async () => {
        throw new Error("the host refused the command surface")
      }
      registrationGate = null
      openGate!()
      try {
        await expect(second).rejects.toThrow(/refused the command surface/)
      } finally {
        host.ctx.command.transform = original
      }

      release!()
      decisionGate = null
      // The parked allow is not applied: no generation is live, so the judgment
      // answers through the handover refusal.
      expect(await pending).toBe("deny")
      expect(event.effect).toBe("deny")
      expect(String(event.message)).toContain("enforcement handover is in progress")
    } finally {
      state.setFeature("hook_tool_risk", false)
      decisionGate = null
      decisionArrived = null
      registrationGate = null
    }
  })

  test("a chain wrapper from a setup that throws refuses, and its registration is dropped", async () => {
    // The attempt's chain wrapper is registered before a later step throws. Its
    // generation is retired, its runtime closed and its registration dropped, so
    // the callback the host still holds refuses instead of reviewing as if live.
    arm()
    nodes("supervisor")
    const host = fakeHost()
    await plugin.setup(host.ctx)
    expect(host.hooks["execute.before"]).toHaveLength(1)
    const disposedBefore = host.disposed
    const original = host.ctx.command.transform
    host.ctx.command.transform = async () => {
      throw new Error("the host refused the command surface")
    }
    try {
      await expect(plugin.setup(host.ctx)).rejects.toThrow(/refused the command surface/)
    } finally {
      host.ctx.command.transform = original
    }

    // The wrapper the failed attempt registered, plus the permission hook it
    // registered first: exactly those two wires were dropped.
    expect(host.hooks["execute.before"]).toHaveLength(2)
    expect(host.disposed).toBe(disposedBefore + 2)
    await expect(
      host.hooks["execute.before"][1]({ sessionID: "ses_w63", tool: "shell", input: { command: "ls" }, id: "call_63" }),
    ).rejects.toThrow(/enforcement handover is in progress/)
  })

  test("one call dispatched to both Jev generations is judged once", async () => {
    // Judging consumes grants and can score or hand off, so a second judgment is
    // a side effect. The claim is keyed by the call identity alone, whatever
    // generation arrives: the retired callback claims first, and the successor
    // finds the call taken and refuses instead of judging it again.
    delete process.env.WATCHDOG_CHAIN
    const base = state.loadState()
    state.saveState({
      ...base,
      endpoint: `http://127.0.0.1:${server.port}/decisions`,
      model: "test-model",
      protocol: "systemone",
      config: { ...base.config, hook_tool_risk: { ...base.config.hook_tool_risk, cache: false } },
    })
    state.writeKey("test-key")
    state.setFeature("hook_tool_risk", true)
    const host = fakeHost()
    try {
      await plugin.setup(host.ctx)
      await plugin.setup(host.ctx)
      expect(host.permissionHistory.evaluate).toHaveLength(2)
      const retired = host.permissionHistory.evaluate[0]
      const live = host.permissionHistory.evaluate[1]
      const before = decisions.length
      const first = { ...assertCall(CHILD, "msg_twice", "call_twice"), action: "shell" }
      const second = { ...assertCall(CHILD, "msg_twice", "call_twice"), action: "shell" }
      // Both callbacks hold the same call at once: the retired one claims it
      // first, inside the same synchronous step that dispatches it.
      await Promise.all([retired(first), live(second)])
      expect(first.effect).toBe("allow")
      // The successor owns nothing here: it neither judges the call again nor
      // adopts a verdict it never reached.
      expect(second.effect).toBe("deny")
      expect(String(second.message)).toContain("enforcement handover is in progress")
      expect(decisions.length).toBe(before + 1)
    } finally {
      state.setFeature("hook_tool_risk", false)
    }
  })

  test("a second delivery of a settled call replays its answer without judging it again", async () => {
    // The claim only covers arrivals that overlap. A host can deliver the same
    // call again once the first judgment finished, and judging it twice would
    // spend a second grant and create a second hold. The settlement's answer is
    // recorded per call identity, so the later delivery receives that answer and
    // no model call is made.
    delete process.env.WATCHDOG_CHAIN
    const base = state.loadState()
    state.saveState({
      ...base,
      endpoint: `http://127.0.0.1:${server.port}/decisions`,
      model: "test-model",
      protocol: "systemone",
      config: { ...base.config, hook_tool_risk: { ...base.config.hook_tool_risk, cache: false } },
    })
    state.writeKey("test-key")
    state.setFeature("hook_tool_risk", true)
    const host = fakeHost()
    try {
      await plugin.setup(host.ctx)
      const live = host.permissionHistory.evaluate[0]
      const before = decisions.length
      const first = { ...assertCall(CHILD, "msg_settled", "call_settled"), action: "shell" }
      await live(first)
      expect(first.effect).toBe("allow")
      expect(decisions.length).toBe(before + 1)

      const second = { ...assertCall(CHILD, "msg_settled", "call_settled"), action: "shell", effect: "ask" }
      await live(second)
      // The recorded settlement is written onto this delivery: same call, same
      // answer, and no decision of its own.
      expect(second.effect).toBe("allow")
      expect(decisions.length).toBe(before + 1)
    } finally {
      state.setFeature("hook_tool_risk", false)
    }
  })

  test("a duplicate delivered while the judgment is still in flight is refused, not replayed", async () => {
    // The other half of the contract: a replay answers a judgment that already
    // finished, while an overlapping duplicate is refused. Both arrivals are one
    // callback, so nothing separates them but the claim.
    delete process.env.WATCHDOG_CHAIN
    const base = state.loadState()
    state.saveState({
      ...base,
      endpoint: `http://127.0.0.1:${server.port}/decisions`,
      model: "test-model",
      protocol: "systemone",
      config: { ...base.config, hook_tool_risk: { ...base.config.hook_tool_risk, cache: false } },
    })
    state.writeKey("test-key")
    state.setFeature("hook_tool_risk", true)
    let release: (() => void) | null = null
    let arrived = false
    decisionGate = new Promise<void>((resolve) => {
      release = resolve
    })
    decisionArrived = () => {
      arrived = true
    }
    const host = fakeHost()
    try {
      await plugin.setup(host.ctx)
      const live = host.permissionHistory.evaluate[0]
      const before = decisions.length
      const owned = { ...assertCall(CHILD, "msg_overlap", "call_overlap"), action: "shell", effect: "ask" }
      const pending = live(owned).then(
        () => owned.effect,
        (error: Error) => error.message,
      )
      for (let turn = 0; turn < 400 && !arrived; turn++) await tick()
      expect(arrived).toBe(true)

      const duplicate = { ...assertCall(CHILD, "msg_overlap", "call_overlap"), action: "shell", effect: "ask" }
      await live(duplicate)
      expect(duplicate.effect).toBe("deny")
      expect(String(duplicate.message)).toContain("enforcement handover is in progress")

      release!()
      decisionGate = null
      expect(await pending).toBe("allow")
      expect(decisions.length).toBe(before + 1)
    } finally {
      state.setFeature("hook_tool_risk", false)
      decisionGate = null
      decisionArrived = null
    }
  })

  test("card calls whose ids collide under concatenation are judged separately", async () => {
    // The card route's claim has the same pair encoding: joining its parts with a
    // separator would let one call's card answer the other's, so two calls are two
    // judgements.
    delete process.env.WATCHDOG_CHAIN
    const marker = "cardcollide"
    const base = state.loadState()
    state.saveState({
      ...base,
      endpoint: `http://127.0.0.1:${server.port}/decisions`,
      model: "test-model",
      protocol: "systemone",
      config: { ...base.config, hook_tool_risk: { ...base.config.hook_tool_risk, questionCards: true, cache: false } },
    })
    state.writeKey("test-key")
    const cli = join(scratch, `cli-${marker}.json`)
    writeFileSync(cli, JSON.stringify({ session: { permissions: "prompt" } }))
    process.env.JEV_CLI_CONFIG = cli
    const { resetAutoAcceptCache } = await import("./autopermit.ts")
    resetAutoAcceptCache()
    state.setFeature("hook_tool_risk", true)
    const host = fakeHost()
    try {
      await plugin.setup(host.ctx)
      const before = decisions.length
      const card = host.hooks["execute.before"]![0]
      const one = settle(card({ sessionID: "a", tool: "shell", input: { command: "ls" }, id: "b\u0000c" }))
      const two = settle(card({ sessionID: "a\u0000b", tool: "shell", input: { command: "ls" }, id: "c" }))
      expect(await Promise.all([one, two])).toEqual(["allowed", "allowed"])
      expect(decisions.length).toBe(before + 2)
    } finally {
      state.setFeature("hook_tool_risk", false)
      resetCardRoute()
    }
  })

  test("chain reviews whose ids collide under concatenation are reviewed separately", async () => {
    // Joined with NUL, `a|b\u0000c` and `a\u0000b|c` are one string. Two calls must
    // still be two reviews, so the claim never merges them.
    arm()
    nodes("supervisor")
    let generated = 0
    const host = fakeHost({
      generate: async (request: any) => {
        generated += 1
        return allowReply(request.prompt)
      },
    })
    await plugin.setup(host.ctx)
    const gate = host.hooks["execute.before"]![0]
    const first = settle(gate({ sessionID: "a", tool: "shell", input: { command: "ls" }, id: "b\u0000c" }))
    const second = settle(gate({ sessionID: "a\u0000b", tool: "shell", input: { command: "ls" }, id: "c" }))
    expect(await Promise.all([first, second])).toEqual(["allowed", "allowed"])
    expect(generated).toBe(2)
    expect(since().filter((row) => row.event === "chain_decision")).toHaveLength(2)
  })

  test("a Jev call claimed before the setup moved is refused by its successor", async () => {
    // The interleaving the claim exists for: the old callback claims the call
    // while its generation is still live and parks on the model response; the
    // setup then completes; the successor receives the same call. Generation
    // scoping cannot separate these two, so the claim is keyed by the call: the
    // successor refuses, and the claimant's own settlement denies.
    delete process.env.WATCHDOG_CHAIN
    const base = state.loadState()
    state.saveState({
      ...base,
      endpoint: `http://127.0.0.1:${server.port}/decisions`,
      model: "test-model",
      protocol: "systemone",
      config: { ...base.config, hook_tool_risk: { ...base.config.hook_tool_risk, cache: false } },
    })
    state.writeKey("test-key")
    state.setFeature("hook_tool_risk", true)
    const ALLOW = {
      type: "choice",
      choice: "allow",
      probabilities: { allow: 0.96, propagate: 0.01, deny: 0.02, abort: 0.01 },
    }
    malformedAnswers = (payload) =>
      Object.fromEntries(Object.keys(payload?.questions ?? {}).map((id) => [id, ALLOW]))
    let release: (() => void) | null = null
    let arrived = false
    decisionGate = new Promise<void>((resolve) => {
      release = resolve
    })
    decisionArrived = () => {
      arrived = true
    }
    const host = fakeHost()
    try {
      await plugin.setup(host.ctx)
      const claimant = host.permissionHistory.evaluate[0]
      const before = decisions.length
      const owned = { ...assertCall(CHILD, "msg_claimed", "call_claimed"), action: "shell", effect: "ask" }
      const pending = claimant(owned).then(
        () => owned.effect,
        (error: Error) => error.message,
      )
      for (let turn = 0; turn < 400 && !arrived; turn++) await tick()
      expect(arrived).toBe(true)

      await plugin.setup(host.ctx)
      const successor = host.permissionHistory.evaluate[1]
      const later = { ...assertCall(CHILD, "msg_claimed", "call_claimed"), action: "shell", effect: "ask" }
      await successor(later)
      expect(later.effect).toBe("deny")
      expect(String(later.message)).toContain("enforcement handover is in progress")

      release!()
      decisionGate = null
      // The claimant's verdict lands after its generation moved: settle-once
      // denies it, and no fourth judgment starts.
      expect(await pending).toBe("deny")
      expect(String(owned.message)).toContain("enforcement handover is in progress")
      expect(decisions.length).toBe(before + 1)
    } finally {
      malformedAnswers = null
      state.setFeature("hook_tool_risk", false)
      decisionGate = null
      decisionArrived = null
    }
  })

  test("a Jev call its successor already claimed refuses the retired callback", async () => {
    // The other arrival order: the live generation claims the call and is still
    // waiting on its decision when the retired callback receives the same call.
    // One judge run, and the retired callback refuses rather than judging again.
    delete process.env.WATCHDOG_CHAIN
    const base = state.loadState()
    state.saveState({
      ...base,
      endpoint: `http://127.0.0.1:${server.port}/decisions`,
      model: "test-model",
      protocol: "systemone",
      config: { ...base.config, hook_tool_risk: { ...base.config.hook_tool_risk, cache: false } },
    })
    state.writeKey("test-key")
    state.setFeature("hook_tool_risk", true)
    let release: (() => void) | null = null
    let arrived = false
    decisionGate = new Promise<void>((resolve) => {
      release = resolve
    })
    decisionArrived = () => {
      arrived = true
    }
    const host = fakeHost()
    try {
      await plugin.setup(host.ctx)
      await plugin.setup(host.ctx)
      const retired = host.permissionHistory.evaluate[0]
      const live = host.permissionHistory.evaluate[1]
      const before = decisions.length
      const owned = { ...assertCall(CHILD, "msg_succ_first", "call_succ_first"), action: "shell" }
      const pending = live(owned).then(
        () => owned.effect,
        (error: Error) => error.message,
      )
      for (let turn = 0; turn < 400 && !arrived; turn++) await tick()
      expect(arrived).toBe(true)

      const stale = { ...assertCall(CHILD, "msg_succ_first", "call_succ_first"), action: "shell" }
      await retired(stale)
      expect(stale.effect).toBe("deny")
      expect(String(stale.message)).toContain("enforcement handover is in progress")

      release!()
      decisionGate = null
      expect(await pending).toBe("allow")
      expect(decisions.length).toBe(before + 1)
    } finally {
      state.setFeature("hook_tool_risk", false)
      decisionGate = null
      decisionArrived = null
    }
  })

  test("a Jev judgment that outlives its generation refuses, and is not re-run", async () => {
    // The parked decision allows the call, and the generation moves before it
    // lands. That pass is already spent: re-running the judge in the live
    // generation would spend a second model request and could consume a grant or
    // start a handoff twice for one call. The call is refused instead, so the
    // cost is the one scoring pass the setup change interrupted.
    delete process.env.WATCHDOG_CHAIN
    const base = state.loadState()
    state.saveState({
      ...base,
      endpoint: `http://127.0.0.1:${server.port}/decisions`,
      model: "test-model",
      protocol: "systemone",
      // `cache: false`: the verdict cache is process-wide and this suite reuses
      // session ids, so a cached allow would skip the model call this case counts.
      config: { ...base.config, hook_tool_risk: { ...base.config.hook_tool_risk, cache: false } },
    })
    state.writeKey("test-key")
    // The live generation keeps risk ON, so a re-home would score the call and
    // show up as a second decision row.
    state.setFeature("hook_tool_risk", true)
    const ANSWER = {
      type: "choice",
      choice: "allow",
      probabilities: { allow: 0.96, propagate: 0.01, deny: 0.02, abort: 0.01 },
    }
    malformedAnswers = (payload) =>
      Object.fromEntries(Object.keys(payload?.questions ?? {}).map((id) => [id, ANSWER]))
    let release: (() => void) | null = null
    let arrived = false
    decisionGate = new Promise<void>((resolve) => {
      release = resolve
    })
    decisionArrived = () => {
      arrived = true
    }
    const host = fakeHost()
    try {
      await plugin.setup(host.ctx)
      const retired = host.permissionHistory.evaluate[0]
      const before = decisions.length
      const event = { ...assertCall(CHILD, "msg_outlived", "call_outlived"), action: "shell", effect: "ask" }
      const pending = retired(event).then(
        () => event.effect,
        (error: Error) => error.message,
      )
      for (let turn = 0; turn < 400 && !arrived; turn++) await tick()
      expect(arrived).toBe(true)

      await plugin.setup(host.ctx)

      release!()
      decisionGate = null
      // The allow this judgment computed is not applied: nobody owns it.
      expect(await pending).toBe("deny")
      expect(event.effect).toBe("deny")
      expect(String(event.message)).toContain("enforcement handover is in progress")
      // Exactly one judge run for the call: the interrupted pass, and no re-home.
      expect(decisions.length).toBe(before + 1)
    } finally {
      malformedAnswers = null
      state.setFeature("hook_tool_risk", false)
      decisionGate = null
      decisionArrived = null
    }
  })

  test("a verdict that resolves after its generation moved writes no abort", async () => {
    // The parked response says abort. Applying it would run the unified abort:
    // a durable ban for the session and an operation record. That side effect is
    // started only after the generation is re-compared, so a stale abort leaves
    // the store untouched and the call denied with the handover sentence.
    delete process.env.WATCHDOG_CHAIN
    state.setFeature("hook_supervisor", false)
    const base = state.loadState()
    state.saveState({
      ...base,
      endpoint: `http://127.0.0.1:${server.port}/decisions`,
      model: "test-model",
      protocol: "systemone",
      config: { ...base.config, hook_tool_risk: { ...base.config.hook_tool_risk, cache: false } },
    })
    state.writeKey("test-key")
    state.setFeature("hook_tool_risk", true)
    const ABORT = {
      type: "choice",
      choice: "abort",
      probabilities: { allow: 0.01, propagate: 0.01, deny: 0.02, abort: 0.96 },
    }
    malformedAnswers = (payload) =>
      Object.fromEntries(Object.keys(payload?.questions ?? {}).map((id) => [id, ABORT]))
    let release: (() => void) | null = null
    let arrived = false
    decisionGate = new Promise<void>((resolve) => {
      release = resolve
    })
    decisionArrived = () => {
      arrived = true
    }
    const host = fakeHost()
    const target = "ses_ab_stale"
    try {
      await plugin.setup(host.ctx)
      const retired = host.permissionHistory.evaluate[0]
      const interruptions = host.calls.interrupts.length
      const event = { ...assertCall(target, "msg_stale_abort", "call_stale_abort"), action: "shell", effect: "ask" }
      const pending = retired(event).then(
        () => event.effect,
        (error: Error) => error.message,
      )
      for (let turn = 0; turn < 400 && !arrived; turn++) await tick()
      expect(arrived).toBe(true)

      await plugin.setup(host.ctx)
      release!()
      decisionGate = null
      expect(await pending).toBe("deny")
      expect(String(event.message)).toContain("enforcement handover is in progress")
      // Zero durable side effects: no ban, no abort record, no interrupt.
      expect(readSnapshot(target).snap?.sessionBan).toBeUndefined()
      expect(since().filter((row) => row.event === "abort_operation")).toHaveLength(0)
      expect(host.calls.interrupts.length).toBe(interruptions)
    } finally {
      malformedAnswers = null
      state.setFeature("hook_tool_risk", false)
      decisionGate = null
      decisionArrived = null
    }
  })

  test("a verdict that resolves after its generation moved starts no supervisor hold", async () => {
    // The parked response says propagate, and the supervisor is enabled: applying
    // it would begin a hold, whose first act is a task-history read and a model
    // round. A stale verdict begins nothing, so the history reads do not grow and
    // the call ends with the handover sentence instead of a hold marker.
    delete process.env.WATCHDOG_CHAIN
    const base = state.loadState()
    state.saveState({
      ...base,
      endpoint: `http://127.0.0.1:${server.port}/decisions`,
      model: "test-model",
      protocol: "systemone",
      config: {
        ...base.config,
        hook_tool_risk: { ...base.config.hook_tool_risk, cache: false },
        hook_supervisor: { ...base.config.hook_supervisor, model: "supervisor-model", protocol: "opencode" },
      },
    })
    state.writeKey("test-key")
    state.setFeature("hook_tool_risk", true)
    state.setFeature("hook_supervisor", true)
    const PROPAGATE = {
      type: "choice",
      choice: "propagate",
      probabilities: { allow: 0.01, propagate: 0.96, deny: 0.02, abort: 0.01 },
    }
    malformedAnswers = (payload) =>
      Object.fromEntries(Object.keys(payload?.questions ?? {}).map((id) => [id, PROPAGATE]))
    let release: (() => void) | null = null
    let arrived = false
    decisionGate = new Promise<void>((resolve) => {
      release = resolve
    })
    decisionArrived = () => {
      arrived = true
    }
    const host = fakeHost()
    try {
      await plugin.setup(host.ctx)
      const retired = host.permissionHistory.evaluate[0]
      const event = { ...assertCall(CHILD, "msg_stale_hold", "call_stale_hold"), action: "shell", effect: "ask" }
      const pending = retired(event).then(
        () => event.effect,
        (error: Error) => error.message,
      )
      for (let turn = 0; turn < 400 && !arrived; turn++) await tick()
      expect(arrived).toBe(true)

      await plugin.setup(host.ctx)
      // A hold begins with a task-history read: count them from here.
      const reads = host.calls.context.length
      release!()
      decisionGate = null
      expect(await pending).toBe("deny")
      expect(String(event.message)).toContain("enforcement handover is in progress")
      await ticks(20)
      expect(host.calls.context.length).toBe(reads)
    } finally {
      malformedAnswers = null
      state.setFeature("hook_tool_risk", false)
      state.setFeature("hook_supervisor", false)
      decisionGate = null
      decisionArrived = null
    }
  })

  test("a chain call with no id is refused instead of reviewed undeduplicated", async () => {
    // A review can hold, deny or abort, so one call must be claimable by id. The
    // host's identity contract is unverified, so a call without one is refused
    // before any model work rather than reviewed twice.
    arm()
    nodes("supervisor")
    let generated = 0
    const host = fakeHost({
      generate: async (request: any) => {
        generated += 1
        return allowReply(request.prompt)
      },
    })
    await plugin.setup(host.ctx)
    await expect(
      host.hooks["execute.before"]![0]({ sessionID: "ses_w66", tool: "shell", input: { command: "ls" } }),
    ).rejects.toThrow(/could not be identified/)
    expect(generated).toBe(0)
  })

  test("a Jev permission event with no host identity is refused instead of judged", async () => {
    // The event carries neither the message id nor the call id the claim needs,
    // so a duplicate dispatch could not be deduplicated: it is refused before
    // any scoring, and no decision is requested.
    delete process.env.WATCHDOG_CHAIN
    const base = state.loadState()
    state.saveState({
      ...base,
      endpoint: `http://127.0.0.1:${server.port}/decisions`,
      model: "test-model",
      protocol: "systemone",
      config: { ...base.config, hook_tool_risk: { ...base.config.hook_tool_risk, cache: false } },
    })
    state.writeKey("test-key")
    state.setFeature("hook_tool_risk", true)
    const host = fakeHost()
    try {
      await plugin.setup(host.ctx)
      const before = decisions.length
      const event: any = { action: "shell", sessionID: "ses_w67", resources: ["src/x.ts"], effect: "ask" }
      await host.permissionHistory.evaluate[0](event)
      expect(event.effect).toBe("deny")
      expect(String(event.message)).toContain("could not be identified")
      expect(decisions.length).toBe(before)
    } finally {
      state.setFeature("hook_tool_risk", false)
    }
  })

  test("a verdict handed to the supervisor is not recorded as applied", async () => {
    // The supervisor replaces the effect with its own hold, so the call asks and
    // nothing the model proposed was applied to it. The proposal's row is a
    // refusal naming the hand-off, which keeps the toast filters quiet.
    delete process.env.WATCHDOG_CHAIN
    const base = state.loadState()
    state.saveState({
      ...base,
      endpoint: `http://127.0.0.1:${server.port}/decisions`,
      model: "test-model",
      protocol: "systemone",
      config: {
        ...base.config,
        hook_tool_risk: { ...base.config.hook_tool_risk, cache: false },
        hook_supervisor: { ...base.config.hook_supervisor, model: "supervisor-model", protocol: "opencode" },
      },
    })
    state.writeKey("test-key")
    state.setFeature("hook_tool_risk", true)
    state.setFeature("hook_supervisor", true)
    const DENY = {
      type: "choice",
      choice: "deny",
      probabilities: { allow: 0.01, propagate: 0.01, deny: 0.96, abort: 0.02 },
    }
    malformedAnswers = (payload) =>
      Object.fromEntries(Object.keys(payload?.questions ?? {}).map((id) => [id, DENY]))
    const host = fakeHost()
    try {
      await plugin.setup(host.ctx)
      const live = host.permissionHistory.evaluate[0]
      const event = { ...assertCall(CHILD, "msg_sup_row", "call_sup_row"), action: "shell", effect: "ask" }
      await live(event)
      expect(event.effect).toBe("ask")
      expect(String(event.message)).toContain("supervisor")
      const rows = since().filter((row) => row.hook === "hook_tool_risk")
      const refused = rows.filter((row) => typeof row.refused === "string")
      expect(refused).toHaveLength(1)
      expect(String(refused[0].refused)).toContain("handed to the supervisor")
      expect(refused[0].acted).toBe(false)
      expect(refused[0].outcome).toBeUndefined()
      expect(rows.filter((row) => row.acted === true)).toHaveLength(0)
      await ticks(20)
    } finally {
      malformedAnswers = null
      state.setFeature("hook_tool_risk", false)
      state.setFeature("hook_supervisor", false)
    }
  })

  test("a card decision refused at its settlement writes no applied row and no cache entry", async () => {
    // The card route decides before its own gates, so its proposal may never be
    // published: an abort that covers the session while the decision is parked
    // refuses the call, and a verdict recorded then would be reused by a later
    // permission call for the same session, action and resources.
    delete process.env.WATCHDOG_CHAIN
    const marker = "cardsettle"
    const base = state.loadState()
    state.saveState({
      ...base,
      endpoint: `http://127.0.0.1:${server.port}/decisions`,
      model: "test-model",
      protocol: "systemone",
      config: { ...base.config, hook_tool_risk: { ...base.config.hook_tool_risk, questionCards: true, cache: true } },
    })
    state.writeKey("test-key")
    const cli = join(scratch, `cli-${marker}.json`)
    writeFileSync(cli, JSON.stringify({ session: { permissions: "prompt" } }))
    process.env.JEV_CLI_CONFIG = cli
    const { resetAutoAcceptCache } = await import("./autopermit.ts")
    resetAutoAcceptCache()
    state.setFeature("hook_tool_risk", true)
    const ALLOW = {
      type: "choice",
      choice: "allow",
      probabilities: { allow: 0.96, propagate: 0.01, deny: 0.02, abort: 0.01 },
    }
    malformedAnswers = (payload) =>
      Object.fromEntries(Object.keys(payload?.questions ?? {}).map((id) => [id, ALLOW]))
    let release: (() => void) | null = null
    let arrived = false
    decisionGate = new Promise<void>((resolve) => {
      release = resolve
    })
    decisionArrived = () => {
      arrived = true
    }
    const host = fakeHost()
    const target = "ses_card_settle"
    try {
      await plugin.setup(host.ctx)
      const staleCard = host.hooks["execute.before"]![0]
      const appliedOf = () => since().filter((row) => row.hook === "hook_tool_risk" && row.acted === true).length
      const appliedBefore = appliedOf()
      const cardEvent = { sessionID: target, tool: "shell", input: { command: "ls cardsettle" }, id: "call_card_settle" }
      const pending = settle(staleCard(cardEvent))
      for (let turn = 0; turn < 400 && !arrived; turn++) await tick()
      expect(arrived).toBe(true)

      // The abort covers the session while the card decision is parked.
      expect(writeSubtreeBan(target, "operator abort", 1)).toBe(true)
      release!()
      decisionGate = null
      expect(await pending).toContain("durable abort ban")
      // The refused decision recorded nothing as applied, and its own proposal is
      // on the record as refused. Read here, before anything else is judged in
      // this session: the probe below deliberately judges the same call again, and
      // its own row would mask this one.
      expect(appliedOf()).toBe(appliedBefore)
      const refused = since().filter(
        (row) => row.hook === "hook_tool_risk" && row.sessionID === target && typeof row.refused === "string",
      )
      expect(refused).toHaveLength(1)
      expect(String(refused[0].refused)).toContain("durable abort ban")

      // Lift the ban, take the card route out of the way, and ask the permission
      // route for the same session, action and resources: a cached card allow
      // would answer it without a judgment. This probe is the harm that outlives
      // the call, so it comes second only to the row that names the refused one.
      removeParent(target)
      resetCardRoute()
      const before = decisions.length
      const permissionEvent = {
        ...assertCall(target, "msg_card_settle", "call_card_settle_2"),
        action: "shell",
        resources: ["ls cardsettle"],
        effect: "ask",
      }
      await host.permissionHistory.evaluate[0](permissionEvent)
      expect(decisions.length).toBe(before + 1)
      expect(permissionEvent.effect).toBe("allow")
    } finally {
      malformedAnswers = null
      delete process.env.JEV_CLI_CONFIG
      state.setFeature("hook_tool_risk", false)
      resetCardRoute()
      decisionGate = null
      decisionArrived = null
    }
  })

  test("a settled call is still answered from its record after 512 later identities", async () => {
    // One call is judged once for the life of the process. A cap would let the
    // same call be judged again — a second grant, hold or abort — so the record is
    // never evicted. The bound it keeps is the number of distinct identities this
    // process judged, which is what it names.
    delete process.env.WATCHDOG_CHAIN
    state.setFeature("hook_supervisor", false)
    const base = state.loadState()
    state.saveState({
      ...base,
      endpoint: `http://127.0.0.1:${server.port}/decisions`,
      model: "test-model",
      protocol: "systemone",
      config: { ...base.config, hook_tool_risk: { ...base.config.hook_tool_risk, cache: false } },
    })
    state.writeKey("test-key")
    state.setFeature("hook_tool_risk", true)
    const host = fakeHost()
    try {
      await plugin.setup(host.ctx)
      const live = host.permissionHistory.evaluate[0]
      const first = { ...assertCall(CHILD, "msg_cap_0", "call_cap_0"), action: "shell" }
      await live(first)
      expect(first.effect).toBe("allow")
      const before = decisions.length
      for (let index = 1; index <= 513; index++) {
        const later = { ...assertCall(CHILD, `msg_cap_${index}`, `call_cap_${index}`), action: "shell" }
        await live(later)
        expect(later.effect).toBe("allow")
      }
      const judged = decisions.length
      expect(judged - before).toBe(513)

      const replay = { ...assertCall(CHILD, "msg_cap_0", "call_cap_0"), action: "shell", effect: "ask" }
      await live(replay)
      expect(replay.effect).toBe("allow")
      expect(decisions.length).toBe(judged)
    } finally {
      state.setFeature("hook_tool_risk", false)
    }
  })

  test("a settled allow replayed after an abort is refused, not replayed", async () => {
    // The record says what the call was worth. It is not an admission: the session
    // can have been covered by an abort since, so a redelivery passes the same
    // release gate a fresh judgment passes and is refused with the abort's reason.
    // No row is written for it — this delivery decided nothing.
    delete process.env.WATCHDOG_CHAIN
    state.setFeature("hook_supervisor", false)
    const base = state.loadState()
    state.saveState({
      ...base,
      endpoint: `http://127.0.0.1:${server.port}/decisions`,
      model: "test-model",
      protocol: "systemone",
      config: { ...base.config, hook_tool_risk: { ...base.config.hook_tool_risk, cache: false } },
    })
    state.writeKey("test-key")
    state.setFeature("hook_tool_risk", true)
    const host = fakeHost()
    const target = "ses_replay_gate"
    try {
      await plugin.setup(host.ctx)
      const live = host.permissionHistory.evaluate[0]
      const first = { ...assertCall(target, "msg_replay_gate", "call_replay_gate"), action: "shell", resources: ["src/replay.ts"] }
      await live(first)
      expect(first.effect).toBe("allow")
      const appliedOf = () => since().filter((row) => row.hook === "hook_tool_risk" && row.acted === true).length
      const appliedBefore = appliedOf()
      const decisionsBefore = decisions.length

      expect(writeSubtreeBan(target, "operator abort", 1)).toBe(true)
      const replay = { ...assertCall(target, "msg_replay_gate", "call_replay_gate"), action: "shell", resources: ["src/replay.ts"], effect: "ask" }
      await live(replay)
      expect(replay.effect).toBe("deny")
      expect(String(replay.message)).toContain("durable abort ban")
      // Neither a second judgment nor an applied row: the recorded allow was not
      // replayed over the restriction.
      expect(decisions.length).toBe(decisionsBefore)
      expect(appliedOf()).toBe(appliedBefore)
    } finally {
      state.setFeature("hook_tool_risk", false)
    }
  })

  test("a retirement during a no-rule judgment still settles as a refusal", async () => {
    // The rules do not apply to this call, so the standard hook contributes a
    // judgement that decided nothing. Retiring while the risk verdict is parked
    // makes the settlement refuse every judgement, and a judgement without its
    // refusal callback would throw instead of answering with the handover.
    delete process.env.WATCHDOG_CHAIN
    state.setFeature("hook_supervisor", false)
    const rulesFile = join(scratch, "rules-no-rule.json")
    writeFileSync(
      rulesFile,
      JSON.stringify({ rules: [{ id: "r-edit", match: { action: "edit" }, text: "no edits", effect: "block" }] }),
    )
    const base = state.loadState()
    state.saveState({
      ...base,
      endpoint: `http://127.0.0.1:${server.port}/decisions`,
      model: "test-model",
      protocol: "systemone",
      config: {
        ...base.config,
        hook_tool_risk: { ...base.config.hook_tool_risk, cache: false },
        hook_tool_standard: { ...base.config.hook_tool_standard, rulesFile, actions: "shell,edit" },
      },
    })
    state.writeKey("test-key")
    state.setFeature("hook_tool_risk", true)
    state.setFeature("hook_tool_standard", true)
    const ALLOW = {
      type: "choice",
      choice: "allow",
      probabilities: { allow: 0.96, propagate: 0.01, deny: 0.02, abort: 0.01 },
    }
    malformedAnswers = (payload) =>
      Object.fromEntries(
        Object.entries(payload?.questions ?? {}).map(([id, question]: [string, any]) => [
          id,
          question?.type === "noul" ? { type: "noul", noul: 0.95 } : ALLOW,
        ]),
      )
    let release: (() => void) | null = null
    let arrived = false
    decisionGate = new Promise<void>((resolve) => {
      release = resolve
    })
    decisionArrived = () => {
      arrived = true
    }
    const host = fakeHost()
    try {
      await plugin.setup(host.ctx)
      const retired = host.permissionHistory.evaluate[0]
      const event = { ...assertCall(CHILD, "msg_no_rule", "call_no_rule"), action: "shell", effect: "ask" }
      const pending = retired(event).then(
        () => event.effect,
        (error: Error) => `threw: ${error.message}`,
      )
      for (let turn = 0; turn < 400 && !arrived; turn++) await tick()
      expect(arrived).toBe(true)

      await plugin.setup(host.ctx)
      release!()
      decisionGate = null
      expect(await pending).toBe("deny")
      expect(String(event.message)).toContain("enforcement handover is in progress")
    } finally {
      malformedAnswers = null
      state.setFeature("hook_tool_risk", false)
      state.setFeature("hook_tool_standard", false)
      decisionGate = null
      decisionArrived = null
    }
  })

  test("only the proposal the call received is recorded as applied", async () => {
    // The standard hook clears its rule at a propagate close call while the risk
    // hook allows the call. The composition takes the stronger outcome, so the
    // call asks and the risk proposal lost: its row is a refusal naming what
    // outranked it, and the applied row is the standard one.
    delete process.env.WATCHDOG_CHAIN
    state.setFeature("hook_supervisor", false)
    // The host asks the human, so a propagate verdict stays a propagate outcome
    // instead of becoming this session's approval block.
    process.env.OPENCODE_CLI_CONFIG_CONTENT = JSON.stringify({ session: { permissions: "prompt" } })
    const rulesFile = join(scratch, "rules-prop.json")
    writeFileSync(
      rulesFile,
      JSON.stringify({ rules: [{ id: "r-shell", match: { action: "shell" }, text: "no shell", threshold: 0.5, effect: "propagate" }] }),
    )
    const base = state.loadState()
    state.saveState({
      ...base,
      endpoint: `http://127.0.0.1:${server.port}/decisions`,
      model: "test-model",
      protocol: "systemone",
      config: {
        ...base.config,
        hook_tool_risk: { ...base.config.hook_tool_risk, cache: false },
        hook_tool_standard: { ...base.config.hook_tool_standard, rulesFile, actions: "shell,edit" },
      },
    })
    state.writeKey("test-key")
    state.setFeature("hook_tool_risk", true)
    state.setFeature("hook_tool_standard", true)
    const ALLOW = {
      type: "choice",
      choice: "allow",
      probabilities: { allow: 0.96, propagate: 0.01, deny: 0.02, abort: 0.01 },
    }
    malformedAnswers = (payload) =>
      Object.fromEntries(
        Object.entries(payload?.questions ?? {}).map(([id, question]: [string, any]) => [
          id,
          question?.type === "noul" ? { type: "noul", noul: 0.95 } : ALLOW,
        ]),
      )
    const host = fakeHost()
    const target = "ses_loser_row"
    try {
      await plugin.setup(host.ctx)
      const live = host.permissionHistory.evaluate[0]
      const event = { ...assertCall(target, "msg_loser", "call_loser"), action: "shell", effect: "ask" }
      await live(event)
      // The stronger verdict is the rules' propagate, so the call asks.
      expect(event.effect).toBe("ask")

      const rows = since().filter((row) => row.hook === "hook_tool_risk" || row.hook === "hook_tool_standard")
      const applied = rows.filter((row) => row.acted === true)
      // Only the standard proposal is applied, and it is the propagate one.
      expect(applied).toHaveLength(1)
      expect(applied[0].hook).toBe("hook_tool_standard")
      expect(applied[0].outcome).toBe("propagate")
      expect(applied[0].refused).toBeUndefined()
      // The risk proposal was outranked, so its row claims nothing.
      const lost = rows.filter((row) => row.hook === "hook_tool_risk")
      expect(lost).toHaveLength(1)
      expect(lost[0].acted).toBe(false)
      expect(String(lost[0].refused)).toContain("outranked by the propagate verdict")
      expect(lost[0].outcome).toBeUndefined()
    } finally {
      delete process.env.OPENCODE_CLI_CONFIG_CONTENT
      malformedAnswers = null
      state.setFeature("hook_tool_risk", false)
      state.setFeature("hook_tool_standard", false)
    }
  })

  test("a verdict refused at settlement is never cached for a later call", async () => {
    // The cache is on by default. A verdict cached before the generation check
    // would let a later call with the same session, action and resources consume
    // an allow the original call never received. The entry is written by the
    // settlement, so the refused verdict leaves the cache empty; a second call is
    // judged on its own, and only then is its verdict cached.
    delete process.env.WATCHDOG_CHAIN
    state.setFeature("hook_supervisor", false)
    const base = state.loadState()
    state.saveState({
      ...base,
      endpoint: `http://127.0.0.1:${server.port}/decisions`,
      model: "test-model",
      protocol: "systemone",
      config: { ...base.config, hook_tool_risk: { ...base.config.hook_tool_risk, cache: true } },
    })
    state.writeKey("test-key")
    state.setFeature("hook_tool_risk", true)
    const ALLOW = {
      type: "choice",
      choice: "allow",
      probabilities: { allow: 0.96, propagate: 0.01, deny: 0.02, abort: 0.01 },
    }
    malformedAnswers = (payload) =>
      Object.fromEntries(Object.keys(payload?.questions ?? {}).map((id) => [id, ALLOW]))
    let release: (() => void) | null = null
    let arrived = false
    decisionGate = new Promise<void>((resolve) => {
      release = resolve
    })
    decisionArrived = () => {
      arrived = true
    }
    const host = fakeHost()
    const target = "ses_cache_stale"
    try {
      await plugin.setup(host.ctx)
      const retired = host.permissionHistory.evaluate[0]
      const before = decisions.length
      const parked = {
        ...assertCall(target, "msg_cache_a", "call_cache_a"),
        action: "shell",
        resources: ["src/cache.ts"],
        effect: "ask",
      }
      const pending = retired(parked).then(
        () => parked.effect,
        (error: Error) => error.message,
      )
      for (let turn = 0; turn < 400 && !arrived; turn++) await tick()
      expect(arrived).toBe(true)

      await plugin.setup(host.ctx)
      release!()
      decisionGate = null
      expect(await pending).toBe("deny")
      expect(String(parked.message)).toContain("enforcement handover is in progress")
      expect(decisions.length).toBe(before + 1)

      // Same session, action and resources: under the bug this reads the stale
      // allow and never posts. It must judge instead.
      const fresh = {
        ...assertCall(target, "msg_cache_b", "call_cache_b"),
        action: "shell",
        resources: ["src/cache.ts"],
        effect: "ask",
      }
      await host.permissionHistory.evaluate[1](fresh)
      expect(decisions.length).toBe(before + 2)
      expect(fresh.effect).toBe("allow")

      // The applied verdict is cached: the next matching call is answered without
      // a model decision, which is what the cache is for.
      const replayed = {
        ...assertCall(target, "msg_cache_c", "call_cache_c"),
        action: "shell",
        resources: ["src/cache.ts"],
        effect: "ask",
      }
      await host.permissionHistory.evaluate[1](replayed)
      expect(decisions.length).toBe(before + 2)
      expect(replayed.effect).toBe("allow")
    } finally {
      malformedAnswers = null
      state.setFeature("hook_tool_risk", false)
      decisionGate = null
      decisionArrived = null
    }
  })

  test("a refused abort verdict is never cached, so no later call is aborted by it", async () => {
    // The same seam with a destructive outcome: a cached abort would run the
    // unified abort for a call that never received that verdict. The refused
    // verdict writes no cache entry, so the later call is judged fresh and
    // allowed, and the session carries no ban.
    delete process.env.WATCHDOG_CHAIN
    state.setFeature("hook_supervisor", false)
    const base = state.loadState()
    state.saveState({
      ...base,
      endpoint: `http://127.0.0.1:${server.port}/decisions`,
      model: "test-model",
      protocol: "systemone",
      config: { ...base.config, hook_tool_risk: { ...base.config.hook_tool_risk, cache: true } },
    })
    state.writeKey("test-key")
    state.setFeature("hook_tool_risk", true)
    const ABORT = {
      type: "choice",
      choice: "abort",
      probabilities: { allow: 0.01, propagate: 0.01, deny: 0.02, abort: 0.96 },
    }
    const ALLOW = {
      type: "choice",
      choice: "allow",
      probabilities: { allow: 0.96, propagate: 0.01, deny: 0.02, abort: 0.01 },
    }
    let served = 0
    malformedAnswers = (payload) => {
      served += 1
      const answer = served === 1 ? ABORT : ALLOW
      return Object.fromEntries(Object.keys(payload?.questions ?? {}).map((id) => [id, answer]))
    }
    let release: (() => void) | null = null
    let arrived = false
    decisionGate = new Promise<void>((resolve) => {
      release = resolve
    })
    decisionArrived = () => {
      arrived = true
    }
    const host = fakeHost()
    const target = "ses_cache_stale_abort"
    try {
      await plugin.setup(host.ctx)
      const retired = host.permissionHistory.evaluate[0]
      const before = decisions.length
      const parked = {
        ...assertCall(target, "msg_cache_ab", "call_cache_ab"),
        action: "shell",
        resources: ["src/cache-ab.ts"],
        effect: "ask",
      }
      const pending = retired(parked).then(
        () => parked.effect,
        (error: Error) => error.message,
      )
      for (let turn = 0; turn < 400 && !arrived; turn++) await tick()
      expect(arrived).toBe(true)

      await plugin.setup(host.ctx)
      release!()
      decisionGate = null
      expect(await pending).toBe("deny")
      expect(String(parked.message)).toContain("enforcement handover is in progress")

      const fresh = {
        ...assertCall(target, "msg_cache_ab2", "call_cache_ab2"),
        action: "shell",
        resources: ["src/cache-ab.ts"],
        effect: "ask",
      }
      await host.permissionHistory.evaluate[1](fresh)
      expect(decisions.length).toBe(before + 2)
      expect(fresh.effect).toBe("allow")
      // No containment ran: the refused abort was not reused.
      expect(readSnapshot(target).snap?.sessionBan).toBeUndefined()
      expect(since().filter((row) => row.event === "abort_operation")).toHaveLength(0)
    } finally {
      malformedAnswers = null
      state.setFeature("hook_tool_risk", false)
      decisionGate = null
      decisionArrived = null
    }
  })

  test("a refused settlement records the handover refusal, never the verdict it proposed", async () => {
    // The applied/announced fields are written from the settlement. A parked deny
    // returned after its generation moved is refused, so its row names the
    // handover and claims nothing: no outcome, no blocked reason, no approval
    // token, and acted false — which is what keeps the toast and sidebar filters
    // from announcing a decision the call never received. The model's own answer
    // stays in the row so the call can still be read.
    delete process.env.WATCHDOG_CHAIN
    state.setFeature("hook_supervisor", false)
    const base = state.loadState()
    state.saveState({
      ...base,
      endpoint: `http://127.0.0.1:${server.port}/decisions`,
      model: "test-model",
      protocol: "systemone",
      config: { ...base.config, hook_tool_risk: { ...base.config.hook_tool_risk, cache: false } },
    })
    state.writeKey("test-key")
    state.setFeature("hook_tool_risk", true)
    const DENY = {
      type: "choice",
      choice: "deny",
      probabilities: { allow: 0.01, propagate: 0.01, deny: 0.96, abort: 0.02 },
    }
    malformedAnswers = (payload) =>
      Object.fromEntries(Object.keys(payload?.questions ?? {}).map((id) => [id, DENY]))
    let release: (() => void) | null = null
    let arrived = false
    decisionGate = new Promise<void>((resolve) => {
      release = resolve
    })
    decisionArrived = () => {
      arrived = true
    }
    const host = fakeHost()
    const target = "ses_refused_row"
    try {
      await plugin.setup(host.ctx)
      const retired = host.permissionHistory.evaluate[0]
      // Rows that claim the hook decided something. A refused proposal must add
      // none of them, so this count is the guard against a pre-settlement row.
      const appliedOf = () => since().filter((row) => row.hook === "hook_tool_risk" && row.acted === true).length
      const appliedBefore = appliedOf()
      const parked = {
        ...assertCall(target, "msg_refused_row", "call_refused_row"),
        action: "shell",
        resources: ["src/refused.ts"],
        effect: "ask",
      }
      const pending = retired(parked).then(
        () => parked.effect,
        (error: Error) => error.message,
      )
      for (let turn = 0; turn < 400 && !arrived; turn++) await tick()
      expect(arrived).toBe(true)

      await plugin.setup(host.ctx)
      release!()
      decisionGate = null
      expect(await pending).toBe("deny")

      const refused = since().filter((row) => row.hook === "hook_tool_risk" && typeof row.refused === "string")
      expect(refused).toHaveLength(1)
      const row = refused[0]
      expect(String(row.refused)).toContain("enforcement handover is in progress")
      expect(row.acted).toBe(false)
      expect(row.outcome).toBeUndefined()
      expect(row.blocked).toBeUndefined()
      expect(row.token).toBeUndefined()
      expect(row.verdict).toBe("deny")
      // Nothing was recorded as acted for this call.
      expect(appliedOf()).toBe(appliedBefore)

      // The applied path is unchanged: a fresh call carries the verdict's own
      // fields and is recorded as acted.
      const applied = {
        ...assertCall(target, "msg_applied_row", "call_applied_row"),
        action: "shell",
        resources: ["src/applied.ts"],
        effect: "ask",
      }
      await host.permissionHistory.evaluate[1](applied)
      expect(applied.effect).toBe("deny")
      expect(appliedOf()).toBe(appliedBefore + 1)
      const rows = since().filter(
        (line) => line.hook === "hook_tool_risk" && line.outcome === "deny" && line.acted === true,
      )
      expect(rows).toHaveLength(1)
      expect(rows[0].refused).toBeUndefined()
      expect(rows[0].blocked).toBe("denied (P=0.96)")
    } finally {
      malformedAnswers = null
      state.setFeature("hook_tool_risk", false)
      decisionGate = null
      decisionArrived = null
    }
  })

  test("an allow-effect permission event with no usable identity is refused, not passed through", async () => {
    // The host hands over `allow` and this hook would judge the call, so every way
    // the identity can be incomplete must end in a refusal: leaving the allow in
    // place would release a call no claim can deduplicate and no verdict covers.
    delete process.env.WATCHDOG_CHAIN
    state.setFeature("hook_tool_risk", true)
    const host = fakeHost()
    const before = decisions.length
    try {
      await plugin.setup(host.ctx)
      const evaluate = host.permissionHistory.evaluate[0]
      const cases: Array<[string, any]> = [
        ["no session", { action: "shell", sessionID: "", source: { messageID: "m", id: "c" } }],
        ["absent session", { action: "shell", source: { messageID: "m", id: "c" } }],
        ["no message id", { action: "shell", sessionID: "ses_w70", source: { messageID: "", id: "c" } }],
        ["no call id", { action: "shell", sessionID: "ses_w70", source: { messageID: "m", id: "" } }],
        ["absent source", { action: "shell", sessionID: "ses_w70" }],
        ["object call id", { action: "shell", sessionID: "ses_w70", source: { messageID: "m", id: { nested: 1 } } }],
        ["numeric call id", { action: "shell", sessionID: "ses_w70", source: { messageID: "m", id: 7 } }],
      ]
      for (const [label, event] of cases) {
        const target: any = { ...event, resources: ["src/x.ts"], effect: "allow" }
        await evaluate(target)
        expect([label, target.effect]).toEqual([label, "deny"])
        expect([label, String(target.message)]).toEqual([label, "jev: the call could not be identified, so it was denied"])
      }
      // An empty action with a complete identity is its own refusal: nothing
      // about the call can be shown to be in scope.
      const noAction: any = { action: "", sessionID: "ses_w70", source: { messageID: "m", id: "c" }, effect: "allow" }
      await evaluate(noAction)
      expect(noAction.effect).toBe("deny")
      expect(String(noAction.message)).toBe("jev: the call carried no action, so it was denied")
      // None of them reached a model.
      expect(decisions.length).toBe(before)
    } finally {
      state.setFeature("hook_tool_risk", false)
    }
  })

  test("a card call that cannot be identified is refused before its tool check", async () => {
    // The route is active and decides on its own, so an empty tool is not a
    // reason to release the call: an unidentifiable one is refused first.
    delete process.env.WATCHDOG_CHAIN
    const marker = "cardnoident"
    const base = state.loadState()
    state.saveState({
      ...base,
      endpoint: `http://127.0.0.1:${server.port}/decisions`,
      model: "test-model",
      protocol: "systemone",
      config: { ...base.config, hook_tool_risk: { ...base.config.hook_tool_risk, questionCards: true, cache: false } },
    })
    state.writeKey("test-key")
    const cli = join(scratch, `cli-${marker}.json`)
    writeFileSync(cli, JSON.stringify({ session: { permissions: "prompt" } }))
    process.env.JEV_CLI_CONFIG = cli
    const { resetAutoAcceptCache } = await import("./autopermit.ts")
    resetAutoAcceptCache()
    state.setFeature("hook_tool_risk", true)
    const host = fakeHost()
    try {
      await plugin.setup(host.ctx)
      const before = posted.length
      const card = host.hooks["execute.before"]![0]
      // No call id and no tool: the identity gate is what decides.
      await expect(card({ sessionID: "ses_w71", tool: "", input: {} })).rejects.toThrow(/could not be identified/)
      // A tool but no session id is the same refusal.
      await expect(card({ tool: "shell", input: {}, id: "call_w71" })).rejects.toThrow(/could not be identified/)
      expect(posted.length).toBe(before)
    } finally {
      state.setFeature("hook_tool_risk", false)
      resetCardRoute()
    }
  })

  test("calls whose ids collide under concatenation are judged separately", async () => {
    // Joined with NUL, `a|b|c\u0000d` and `a|b\u0000c|d` are the same string, so a
    // concatenated key would make these one call. Identity is encoded as a JSON
    // array, so they stay two calls and each is judged.
    delete process.env.WATCHDOG_CHAIN
    const base = state.loadState()
    state.saveState({
      ...base,
      endpoint: `http://127.0.0.1:${server.port}/decisions`,
      model: "test-model",
      protocol: "systemone",
      config: { ...base.config, hook_tool_risk: { ...base.config.hook_tool_risk, cache: false } },
    })
    state.writeKey("test-key")
    state.setFeature("hook_tool_risk", true)
    const host = fakeHost()
    try {
      await plugin.setup(host.ctx)
      const evaluate = host.permissionHistory.evaluate[0]
      const before = decisions.length
      const one = {
        action: "shell",
        sessionID: "a",
        source: { messageID: "b", id: "c\u0000d" },
        resources: ["src/x.ts"],
        effect: "ask",
      }
      const two = {
        action: "shell",
        sessionID: "a",
        source: { messageID: "b\u0000c", id: "d" },
        resources: ["src/x.ts"],
        effect: "ask",
      }
      const first = evaluate(one)
      const second = evaluate(two)
      await Promise.all([first, second])
      // Two judgments for two calls, not one verdict replayed onto both.
      expect(decisions.length).toBe(before + 2)
      expect(one.effect).toBe("allow")
      expect(two.effect).toBe("allow")
    } finally {
      state.setFeature("hook_tool_risk", false)
    }
  })

  test("a card call with no id is refused instead of held undeduplicated", async () => {
    // The card route can hold, deny or abort one call, so it needs the call id to
    // claim it. Without one the call is refused and no card is opened.
    delete process.env.WATCHDOG_CHAIN
    const marker = "nocallid"
    const base = state.loadState()
    state.saveState({
      ...base,
      endpoint: `http://127.0.0.1:${server.port}/decisions`,
      model: "test-model",
      protocol: "systemone",
      config: { ...base.config, hook_tool_risk: { ...base.config.hook_tool_risk, questionCards: true, cache: false } },
    })
    state.writeKey("test-key")
    const cli = join(scratch, `cli-${marker}.json`)
    writeFileSync(cli, JSON.stringify({ session: { permissions: "prompt" } }))
    process.env.JEV_CLI_CONFIG = cli
    const { resetAutoAcceptCache } = await import("./autopermit.ts")
    resetAutoAcceptCache()
    state.setFeature("hook_tool_risk", true)
    const host = fakeHost()
    try {
      await plugin.setup(host.ctx)
      // The card route's wrapper, then the chain's own inert wrapper.
      expect(host.hooks["execute.before"]).toHaveLength(2)
      const opened = posted.length
      await expect(
        host.hooks["execute.before"]![0]({ sessionID: "ses_w68", tool: "shell", input: { command: "ls" } }),
      ).rejects.toThrow(/could not be identified/)
      expect(posted.length).toBe(opened)
    } finally {
      state.setFeature("hook_tool_risk", false)
      resetCardRoute()
    }
  })

  test("a review interrupted by a setup does not block the generation that replaced it", async () => {
    // The first review is parked inside its own runtime when the next setup
    // retires that runtime. The same call id reaching the new wrapper is
    // reviewed afresh: it neither waits on the retired review nor adopts it.
    arm()
    nodes("supervisor")
    let release: (() => void) | null = null
    const parked = new Promise<void>((resolve) => {
      release = resolve
    })
    let generated = 0
    const host = fakeHost({
      generate: async (request: any) => {
        generated += 1
        if (generated === 1) await parked
        return allowReply(request.prompt)
      },
    })
    const call = (id: string) => ({ sessionID: "ses_w64", tool: "shell", input: { command: "ls" }, id })
    await plugin.setup(host.ctx)
    const first = host.hooks["execute.before"]![0]
    const a = settle(first(call("call_64")))
    for (let turn = 0; turn < 400 && generated < 1; turn++) await tick()
    expect(generated).toBe(1)

    await plugin.setup(host.ctx)
    const second = host.hooks["execute.before"]![1]
    const b = settle(second(call("call_64")))
    for (let turn = 0; turn < 400 && generated < 2; turn++) await tick()
    expect(generated).toBe(2)
    expect(await b).toBe("allowed")

    release!()
    await a
  })

  test("repeated setups leave no settled chain judgment behind", async () => {
    // Each completed review releases its entry, so a later generation judges the
    // same call id rather than replaying an answer from a generation it replaced.
    arm()
    nodes("supervisor")
    let generated = 0
    const host = fakeHost({
      generate: async (request: any) => {
        generated += 1
        return allowReply(request.prompt)
      },
    })
    const call = { sessionID: "ses_w65", tool: "shell", input: { command: "ls" }, id: "call_65" }
    await plugin.setup(host.ctx)
    expect(await settle(host.hooks["execute.before"]![0](call))).toBe("allowed")
    await plugin.setup(host.ctx)
    expect(await settle(host.hooks["execute.before"]![1](call))).toBe("allowed")
    await plugin.setup(host.ctx)
    expect(await settle(host.hooks["execute.before"]![2](call))).toBe("allowed")
    expect(generated).toBe(3)
    expect(since().filter((row) => row.event === "chain_decision")).toHaveLength(3)
  })

  test("a retired Jev hook refuses during a handover and delegates once it completes", async () => {
    // The window is real: the successor's Jev hook is published, its later card
    // registration is still parked. A retired callback must refuse inside that
    // window instead of judging through half a generation, and delegate after.
    delete process.env.WATCHDOG_CHAIN
    const base = state.loadState()
    state.saveState({
      ...base,
      config: { ...base.config, hook_tool_risk: { ...base.config.hook_tool_risk, questionCards: true } },
    })
    let openGate: (() => void) | null = null
    const host = fakeHost()
    try {
      await plugin.setup(host.ctx)
      // The card route's wrapper, then the chain's own inert wrapper.
      expect(host.hooks["execute.before"]).toHaveLength(2)
      const retired = host.permissionHistory.evaluate[0]

      toolRegistrationGate = new Promise<void>((resolve) => {
        openGate = resolve
      })
      const second = plugin.setup(host.ctx)
      for (let turn = 0; turn < 200 && !toolRegistrationParked; turn++) await tick()
      expect(toolRegistrationParked).toBe(true)

      const during = { ...assertCall(CHILD, "msg_during", "call_during"), action: "shell", effect: "allow" }
      await retired(during)
      expect(during.effect).toBe("deny")
      expect(String(during.message)).toContain("enforcement handover is in progress")

      toolRegistrationGate = null
      openGate!()
      await second
      // Each generation adds its card route and its chain wrapper.
      expect(host.hooks["execute.before"]).toHaveLength(4)

      // The handover is over: the same retired callback hands the call to the
      // live generation, which judges no risk here and leaves the host's effect.
      const after = { ...assertCall(CHILD, "msg_after_handover", "call_after_handover"), action: "shell", effect: "allow" }
      await retired(after)
      expect(after.effect).toBe("allow")
    } finally {
      toolRegistrationGate = null
      resetCardRoute()
    }
  })

  test("a provider whose replacement never starts leaves posture and the host agreeing", async () => {
    // The start throws after the generation moved, so the inherited provider is
    // already retired. Restoring it would publish a handle that reports itself
    // unattached while its callbacks keep refusing calls: it is disposed and
    // retired instead, and posture says exactly that — no provider at all.
    delete process.env.WATCHDOG_CHAIN
    state.setFeature("hook_session_ban", true)
    const host = fakeHost()
    const tool = host.ctx.tool
    try {
      await plugin.setup(host.ctx)
      expect(await posture(host, "ses_start_failed")).toEqual(["session-ban"])
      const staleProvider = host.permissionHistory.evaluate[1]
      const disposedBefore = host.disposed
      const abortedBefore = host.aborted

      // The provider's own attach asks the tool surface for its transform first.
      // A one-shot refusal there is a start failure, and only a start failure.
      let armed = true
      Object.defineProperty(host.ctx, "tool", {
        configurable: true,
        get() {
          if (armed) {
            armed = false
            throw new Error("the host refused the tool surface")
          }
          return tool
        },
      })
      await plugin.setup(host.ctx)

      // Reality and posture agree: nothing is published, the inherited handle's
      // wires are gone, and nothing claims an admission surface.
      expect(await posture(host, "ses_start_failed")).toEqual([])
      expect(host.disposed).toBeGreaterThan(disposedBefore)
      expect(host.aborted).toBe(abortedBefore + 1)
      expect(host.permissionHooks.evaluate).not.toBe(staleProvider)

      // A call the host still holds gets exactly one owner's judgment: the
      // provider is retired with nobody to replace it, so it refuses.
      const staleEvent = assertCall(CHILD, "msg_start_failed", "call_start_failed")
      expect((await staleProvider(staleEvent)).effect).toBe("deny")
      expect(String(staleEvent.message)).toContain("enforcement handover is in progress")

      // And the next setup recovers: one provider, and posture names it.
      Object.defineProperty(host.ctx, "tool", { value: tool, configurable: true, writable: true })
      await plugin.setup(host.ctx)
      expect(await posture(host, "ses_start_recovered")).toEqual(["session-ban"])
      const recovered = assertCall(CHILD, "msg_recovered", "call_recovered")
      expect((await host.permissionHistory.evaluate.at(-1)!(recovered)).effect).toBe("deny")
    } finally {
      state.setFeature("hook_session_ban", false)
    }
  })

  test("posture names the provider while its permission hook refuses, even with no feed", async () => {
    // The full rule needs the feed, but the permission hook alone still denies a
    // call. Posture that reported no admission surface while that callback sits in
    // front of the host would be a false all-clear.
    delete process.env.WATCHDOG_CHAIN
    state.setFeature("hook_session_ban", true)
    const host = fakeHost({ rejectFeed: true })
    try {
      await plugin.setup(host.ctx)
      expect(await posture(host, "ses_feed_failed")).toEqual(["session-ban"])
      const event = assertCall(CHILD, "msg_feed_failed", "call_feed_failed")
      expect((await host.permissionHooks.evaluate(event)).effect).toBe("deny")
      expect(event.effect).toBe("deny")
    } finally {
      state.setFeature("hook_session_ban", false)
    }
  })

  test("a later setup retires the provider this host still holds", async () => {
    // The host here never forgets a permission callback: it keeps every one and
    // the last one wins. That is the worst case for a re-registration, and the
    // generation token is what keeps the old provider from judging a call it
    // never observed.
    delete process.env.WATCHDOG_CHAIN
    state.setFeature("hook_session_ban", true)
    const host = fakeHost()
    try {
      // One setup: the Jev hook, then the admission provider.
      await plugin.setup(host.ctx)
      expect(host.permissionHistory.evaluate).toHaveLength(2)
      const stale = host.permissionHistory.evaluate[1]
      expect(await posture(host, "ses_setup_a")).toEqual(["session-ban"])

      // A second setup with the switch still on replaces the provider.
      await plugin.setup(host.ctx)
      expect(host.permissionHistory.evaluate).toHaveLength(4)
      // Everything the first setup registered was disposed through its own
      // `dispose`: the provider's three hooks, the Jev permission hook the
      // generation token retires, and the chain's own inert wrapper (the card
      // route is off here). The provider's feed ended through its signal.
      expect(host.disposed).toBe(5)
      expect(host.aborted).toBe(1)
      // Still exactly one live surface, not one per setup.
      expect(await posture(host, "ses_setup_b")).toEqual(["session-ban"])

      // Under a durable subtree ban the live provider refuses. A call the host
      // still dispatches to the retired provider is handed to the live one and
      // refused, never released undecided: it was not replayed to the new hook,
      // so silence would let it run.
      expect(writeSubtreeBan(CHILD, "operator abort", 1)).toBe(true)
      const staleEvent = assertCall(CHILD, "msg_stale", "call_stale")
      expect((await stale(staleEvent)).effect).toBe("deny")
      expect(staleEvent.effect).toBe("deny")
      expect(String(staleEvent.message)).toContain("session-ban:")

      const live = host.permissionHistory.evaluate.at(-1)!
      const liveEvent = assertCall(CHILD, "msg_live", "call_live")
      expect((await live(liveEvent)).effect).toBe("deny")
      expect(liveEvent.effect).toBe("deny")
      expect(String(liveEvent.message)).toContain("session-ban:")

      // The switch off retires the provider too: no surface is listed. The Jev
      // hooks the host still holds decide nothing for an uncovered session, but a
      // retired provider has no replacement to hand its call to, so it refuses
      // instead of releasing it. The session here is not the banned one: a Jev
      // hook admits every plan, so it refuses a covered session too.
      state.setFeature("hook_session_ban", false)
      await plugin.setup(host.ctx)
      expect(await posture(host, "ses_setup_c")).toEqual([])
      const uncovered = "ses_setup_uncovered"
      for (const [index, callback] of host.permissionHistory.evaluate.entries()) {
        const event = assertCall(uncovered, `msg_off_${index}`, `call_off_${index}`)
        await callback(event)
        if (index % 2 === 1) {
          // A provider: retired, and no provider is registered to replace it.
          expect(event.effect).toBe("deny")
          expect(String(event.message)).toContain("enforcement handover is in progress")
        } else {
          expect(event.effect).toBe("allow")
        }
      }

      // On again: the posture names exactly the new generation.
      state.setFeature("hook_session_ban", true)
      await plugin.setup(host.ctx)
      expect(await posture(host, "ses_setup_d")).toEqual(["session-ban"])
    } finally {
      state.setFeature("hook_session_ban", false)
    }
  })
})

describe("watchdog page settings (ticket #18)", () => {
  const call = (sessionID: string, id: string, command: string) => ({ sessionID, tool: "shell", input: { command }, id })

  test("a persisted admission cap paces calls with no environment override", async () => {
    arm()
    nodes("human")
    // The page's persisted scope is the only cap source: beforeEach pins every
    // WATCHDOG_CHAIN* environment variable to unset, and this case sets none.
    const base = state.loadState()
    state.saveState({ ...base, watchdog: { ...base.watchdog, on: true, sessionCap: 1 } })
    const host = fakeHost()
    await plugin.setup(host.ctx)
    const wrapper = gate(host.hooks)

    const first = settle(wrapper(call("ses_w80", "c80a", "ls a")))
    await cardsOpen(1)
    const second = settle(wrapper(call("ses_w80", "c80b", "ls b")))
    await ticks(10)

    const waits = since().filter((row) => row.waiting === true)
    expect(waits).toHaveLength(1)
    expect(waits[0].event).toBe("chain_admission")

    const settings = await host.calls.rpc[0].handlers.getWatchdogSettings({})
    expect(settings.on).toBe(true)
    expect(settings.effective.sessionCap).toBe(1)
    // The pacing came from the persisted scope, not from an environment cap.
    expect(settings.envOverrides).not.toContain("sessionCap")

    await host.push({ type: "form.replied", data: { id: posted[0].card.id, answer: { decision: "allow" } } })
    expect(await first).toBe("allowed")
    await cardsOpen(2)
    await host.push({ type: "form.replied", data: { id: posted[1].card.id, answer: { decision: "allow" } } })
    expect(await second).toBe("allowed")
  })

  test("the environment still outranks the persisted page value", async () => {
    arm()
    nodes("human")
    const base = state.loadState()
    state.saveState({ ...base, watchdog: { ...base.watchdog, sessionCap: 1 } })
    process.env.WATCHDOG_CHAIN_CAP = "3"
    const host = fakeHost()
    await plugin.setup(host.ctx)
    const wrapper = gate(host.hooks)

    const calls = [
      settle(wrapper(call("ses_w81", "c81a", "ls a"))),
      settle(wrapper(call("ses_w81", "c81b", "ls b"))),
      settle(wrapper(call("ses_w81", "c81c", "ls c"))),
    ]
    await cardsOpen(3)

    const settings = await host.calls.rpc[0].handlers.getWatchdogSettings({})
    expect(settings.effective.sessionCap).toBe(3)
    expect(settings.envOverrides).toContain("sessionCap")
    expect(settings.persisted.sessionCap).toBe(1)
    // No call waited: the persisted cap of 1 was overridden, not enforced.
    expect(since().some((row) => row.waiting === true)).toBe(false)

    for (const card of posted) {
      await host.push({ type: "form.replied", data: { id: card.card.id, answer: { decision: "allow" } } })
    }
    expect(await Promise.all(calls)).toEqual(["allowed", "allowed", "allowed"])
  })

  test("watchdogStatus reports the capability verdict, live counts, and durable ledger", async () => {
    arm()
    nodes("human")
    const host = fakeHost()
    await plugin.setup(host.ctx)
    const handlers = host.calls.rpc[0].handlers

    const idle = await handlers.watchdogStatus({})
    expect(idle.on).toBe(false)
    expect(idle.chain).toEqual({ status: "passed", reason: "the capability gate passed", wired: true })
    expect(idle.pending.inFlight).toBe(0)
    expect(idle.pending.waiting).toBe(0)
    expect(idle.pending.durable).toBe(0)
    expect(idle.pending.durableUnreadable).toBe(false)
    expect(idle.effective.activeOperations).toBe(0)
    expect(idle.effective.overlapping).toEqual([])
    expect(idle.recordsReadable).toBe(true)

    const wrapper = gate(host.hooks)
    const first = settle(wrapper(call("ses_w82", "c82a", "ls a")))
    await cardsOpen(1)
    const busy = await handlers.watchdogStatus({})
    // The page switch is off (page state only) while a review is live: the
    // status the page renders must carry the real counts in this state.
    expect(busy.on).toBe(false)
    expect(busy.pending.inFlight).toBe(1)
    expect(busy.pending.durable).toBe(1)
    expect(busy.pending.durableUnreadable).toBe(false)

    await host.push({ type: "form.replied", data: { id: posted[0].card.id, answer: { decision: "allow" } } })
    expect(await first).toBe("allowed")
    const settledStatus = await handlers.watchdogStatus({})
    expect(settledStatus.pending.inFlight).toBe(0)
    expect(settledStatus.pending.durable).toBe(0)
  })

  test("watchdogStatus lists a live pending human review, and its card can be reopened without authorizing anything", async () => {
    arm()
    nodes("human")
    const host = fakeHost()
    await plugin.setup(host.ctx)
    const handlers = host.calls.rpc[0].handlers
    const wrapper = gate(host.hooks)
    const first = settle(wrapper(call("ses_w90", "c90a", "ls a")))
    await cardsOpen(1)

    const status = await handlers.watchdogStatus({})
    expect(status.pending.reviews).toHaveLength(1)
    const row = status.pending.reviews[0]
    expect(row.sessionID).toBe("ses_w90")
    expect(row.tool).toBe("shell")
    expect(row.action).toBe("shell")
    expect(row.stage).toBe("human")
    expect(row.interrupted).toBe(false)
    expect(typeof row.ageMs).toBe("number")
    // The row is display fields and an age: nothing of the call's arguments.
    expect(JSON.stringify(row)).not.toContain("ls a")

    const reopened = await handlers.reopenPendingReview({ itemID: row.id })
    expect(reopened).toEqual({ ok: true, reopened: true })
    // The same form id is posted again, so the one waiter still answers it.
    expect(posted).toHaveLength(2)
    expect(posted[1].card.id).toBe(posted[0].card.id)
    // Nothing was authorized: the call is still held until the human answers.
    expect(since().some((entry) => entry.event === "chain_decision" && entry.itemID === row.id)).toBe(false)

    await host.push({ type: "form.replied", data: { id: posted[0].card.id, answer: { decision: "allow" } } })
    expect(await first).toBe("allowed")
    const after = await handlers.watchdogStatus({})
    expect(after.pending.reviews).toEqual([])
  })

  test("a review a restart reported is listed as interrupted, and no card can be reopened for it", async () => {
    // A human review the previous process was holding. This process inherits the
    // slot, reports it interrupted, and never offers a card nothing would answer.
    process.env.WATCHDOG_CHAIN = "1"
    gateVerdict()
    nodes("human")
    const key = budgetKey("ses_prev_90")
    const home = chainStateHome()
    mkdirSync(home, { recursive: true })
    writeFileSync(
      join(home, CHAIN_BUDGET_FILE),
      JSON.stringify({ sessions: { [key]: [{ id: "wd_prev.1", stage: "human", tool: "shell", action: "shell", at: Date.now() - 60000 }] } }),
    )
    const host = fakeHost({ effect: () => "deny" })
    await plugin.setup(host.ctx)
    const handlers = host.calls.rpc[0].handlers

    // Another session's call bootstraps the reconciliation; it denies at the
    // host check, so the test never parks a card of its own.
    expect(await settle(gate(host.hooks)(call("ses_new_90", "c90b", "ls b")))).not.toBe("allowed")

    const status = await handlers.watchdogStatus({})
    const row = status.pending.reviews.find((entry: any) => entry.id === "wd_prev.1")
    expect(row).toBeDefined()
    expect(row.interrupted).toBe(true)
    expect(row.sessionID).toBe(`${key.slice(0, 9)}…`)
    // An age survives the restart because the ledger records the admission time.
    expect(row.ageMs).toBeGreaterThanOrEqual(60000)

    const refused = await handlers.reopenPendingReview({ itemID: "wd_prev.1" })
    expect(refused.ok).toBe(false)
    expect(refused.reopened).toBe(false)
    expect(String(refused.reason)).toContain("interrupted")
    // The command names the interruption instead of promising a card.
    const line = await commands["permission-latest"].execute({ sessionID: "ses_prev_90", prompt: { text: "" } })
    expect(String(line.content)).toContain("interrupted")
    expect(posted).toHaveLength(0)
  })

  test("permission-latest reads the durable ledger too, so a restart's interruption is named before any admit", async () => {
    // A review the previous process held, with no call admitted yet in this one:
    // the runtime has reconciled nothing, so only the ledger knows about it. The
    // page already lists it; the command must give the same answer, never the
    // plain "nothing pending" line.
    process.env.WATCHDOG_CHAIN = "1"
    gateVerdict()
    nodes("human")
    const key = budgetKey("ses_prev_91")
    const home = chainStateHome()
    mkdirSync(home, { recursive: true })
    writeFileSync(
      join(home, CHAIN_BUDGET_FILE),
      JSON.stringify({ sessions: { [key]: [{ id: "wd_prev.2", stage: "human", tool: "shell", action: "shell", at: Date.now() - 60000 }] } }),
    )
    const host = fakeHost()
    await plugin.setup(host.ctx)
    const handlers = host.calls.rpc[0].handlers

    const status = await handlers.watchdogStatus({})
    expect(status.pending.reviews.some((row: any) => row.id === "wd_prev.2" && row.interrupted)).toBe(true)

    const line = await commands["permission-latest"].execute({ sessionID: "ses_prev_91", prompt: { text: "" } })
    expect(String(line.content)).toContain("interrupted")
    // Reading the ledger grants nothing: no card is posted for it.
    expect(posted).toHaveLength(0)
  })

  test("permission-latest reopens the newest pending review for the session, and says so plainly when there is none", async () => {
    arm()
    nodes("human")
    process.env.WATCHDOG_CHAIN_CAP = "3"
    const host = fakeHost()
    await plugin.setup(host.ctx)
    const command = commands["permission-latest"]
    expect(command).toBeDefined()
    const wrapper = gate(host.hooks)

    const first = settle(wrapper(call("ses_w95", "c95a", "ls a")))
    const second = settle(wrapper(call("ses_w95", "c95b", "ls b")))
    await cardsOpen(2)

    const reopened = await command.execute({ sessionID: "ses_w95", prompt: { text: "" } })
    expect(String(reopened.content)).toContain("Reopened the newest pending human review")
    expect(posted).toHaveLength(3)
    // The newest review, not the first one posted.
    expect(posted[2].card.id).toBe(posted[1].card.id)
    // A session that holds nothing is told so, plainly, and no card is posted
    // for it: another session's review is not its own to reopen.
    const other = await command.execute({ sessionID: "ses_w96", prompt: { text: "" } })
    expect(other.content).toBe("No pending human review to reopen.")
    expect(posted).toHaveLength(3)

    for (const card of [posted[0], posted[1]]) {
      await host.push({ type: "form.replied", data: { id: card.card.id, answer: { decision: "allow" } } })
    }
    expect(await Promise.all([first, second])).toEqual(["allowed", "allowed"])
    const none = await command.execute({ sessionID: "ses_w95", prompt: { text: "" } })
    expect(none.content).toBe("No pending human review to reopen.")
  })

  test("a refused wrapper registration is not reported as wired, even once the switch is on", async () => {
    // An off chain whose host refused execute.before has no wrapper. Turning the
    // switch on afterwards makes the chain read as enabled, and the status must
    // still say that nothing is wired: the operator needs that difference.
    delete process.env.WATCHDOG_CHAIN
    gateVerdict()
    const opts: any = {}
    const host = fakeHost(opts)
    opts.rejectHook = (name: string) => name === "execute.before"
    await plugin.setup(host.ctx)
    expect(host.hooks["execute.before"]).toBeUndefined()
    process.env.WATCHDOG_CHAIN = "1"
    const status = await host.calls.rpc[0].handlers.watchdogStatus({})
    expect(status.chain).toEqual({ status: "passed", reason: "the capability gate passed", wired: false })
  })

  test("an unarmed deployment reports the chain off, and the page's own switches are not activation gates", async () => {
    const base = state.loadState()
    state.saveState({ ...base, watchdog: { ...base.watchdog, on: true } })
    const host = fakeHost()
    await plugin.setup(host.ctx)
    const status = await host.calls.rpc[0].handlers.watchdogStatus({})
    expect(status.on).toBe(true)
    // The switch is off, but the wrapper exists: `wired` reports the
    // registration, not the switch, so an operator who turns the chain on gets a
    // surface that can actually judge. `status` still says off.
    expect(status.chain).toEqual({ status: "off", reason: "the capability switch is off", wired: true })
    // The page's pair of switches is not a third activation gate: with the chain
    // switch off and no gate file, the wrapper #21 always registers is inert —
    // one wrapper that passes every call through, checks nothing, and holds
    // nothing, exactly as before the page existed.
    expect(host.hooks["execute.before"] ?? []).toHaveLength(1)
    expect(host.calls.checks).toHaveLength(0)
  })

  test("armed with no node list anywhere, the default all-on posture still reviews", async () => {
    // No `nodes()` call, no persisted list: the migrated default nodes are
    // empty, and the documented default is every node on. The supervisor
    // answers through the fake generate hook, so a review only happens if
    // the default nodes survived the migration.
    arm()
    const host = fakeHost({ generate: (request) => allowReply(request.prompt) })
    await plugin.setup(host.ctx)
    const outcome = await gate(host.hooks)(call("ses_w84", "c84", "ls build"))
    expect(outcome).toBeUndefined()
    const decision = since().find((row) => row.event === "chain_decision")
    expect(decision?.verdict).toBe("allow")
  })
})

describe("the /jev-log families (ticket #23)", () => {
  // The log is append-only across this suite: each case writes more rows than the
  // 20-row window it asserts on, so an earlier case cannot leak into it.
  const tag = () => `l${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

  async function logCommand(): Promise<any> {
    const host = fakeHost()
    await plugin.setup(host.ctx)
    const command = commands["jev-log"]
    expect(command).toBeDefined()
    return command
  }

  function writeJev(prefix: string, n: number): void {
    for (let i = 0; i < n; i++) {
      state.logCall({ hook: "hook_tool_risk", tool: "shell", decisions: [{ id: `${prefix}jev${i}`, value: "allow", confident: true }], inputTokens: 10 })
    }
  }

  function writeChain(prefix: string, n: number): void {
    for (let i = 0; i < n; i++) state.logCall({ hook: "hook_watchdog_chain", error: `${prefix}chain${i}` })
  }

  test("the default answer shows only Jev rows and is not under-filled by a chain-heavy tail", async () => {
    const command = await logCommand()
    const p = tag()
    writeJev(p, 21)
    // A chain-heavy tail: the last 21 lines of the file are all chain rows.
    writeChain(p, 21)
    const text = String((await command.execute({ sessionID: "ses_log_1", prompt: { text: "" } })).content)
    const lines = text.split("\n")
    expect(lines).toHaveLength(20)
    expect(text).toContain(`${p}jev20`)
    expect(text).toContain(`${p}jev19`)
    expect(text).not.toContain(`${p}jev0`)
    expect(text).not.toContain(`${p}chain`)
    expect(text).not.toContain("hook_watchdog_chain")
  })

  test("/jev-log chain shows chain audit rows even when Jev rows are the recent tail", async () => {
    const command = await logCommand()
    const p = tag()
    writeChain(p, 21)
    writeJev(p, 21)
    // A command failure logs under the command's own name, not the chain family.
    state.logCall({ hook: "jev-model", error: `${p}command` })
    const text = String((await command.execute({ sessionID: "ses_log_2", prompt: { text: "chain" } })).content)
    expect(text.split("\n")).toHaveLength(20)
    expect(text).toContain(`${p}chain20`)
    expect(text).toContain("hook_watchdog_chain")
    expect(text).not.toContain(`${p}jev20`)
    expect(text).not.toContain(`${p}command`)
  })

  test("/jev-log all shows the unfiltered tail, command-name rows included", async () => {
    const command = await logCommand()
    const p = tag()
    writeJev(p, 1)
    writeChain(p, 1)
    state.logCall({ hook: "jev-model", error: `${p}command` })
    const text = String((await command.execute({ sessionID: "ses_log_3", prompt: { text: "all" } })).content)
    expect(text).toContain(`${p}jev0`)
    expect(text).toContain(`${p}chain0`)
    expect(text).toContain(`${p}command`)
  })

  test("an unknown argument answers with the accepted values instead of rows", async () => {
    const command = await logCommand()
    const p = tag()
    writeJev(p, 1)
    const text = String((await command.execute({ sessionID: "ses_log_4", prompt: { text: "bogus" } })).content)
    expect(text).toContain("/jev-log chain")
    expect(text).toContain("/jev-log all")
    expect(text).not.toContain(`${p}jev0`)
  })

  test("/jev-log jev names the default explicitly, and an uppercase argument folds to it", async () => {
    const command = await logCommand()
    const p = tag()
    writeJev(p, 21)
    writeChain(p, 21)
    for (const argument of ["jev", "JEV"]) {
      const text = String((await command.execute({ sessionID: "ses_log_6", prompt: { text: argument } })).content)
      expect(text.split("\n")).toHaveLength(20)
      expect(text).toContain(`${p}jev20`)
      expect(text).not.toContain(`${p}chain20`)
    }
  })

  test("/jev-log chain renders a real audit row's fields and no fabricated cost", async () => {
    // The chain logs stage and verdict rows, not model rows: no decisions, no
    // token count. The line must carry the row's fields and no cost at all.
    const command = await logCommand()
    const p = tag()
    state.logCall({
      hook: "hook_watchdog_chain",
      itemID: `${p}item`,
      event: "chain_decision",
      stage: "final",
      verdict: "allow",
      reason: `${p}reason`,
    })
    const text = String((await command.execute({ sessionID: "ses_log_5", prompt: { text: "chain" } })).content)
    const line = text.split("\n")[0]
    expect(line).toContain("hook_watchdog_chain")
    expect(line).toContain("chain_decision")
    expect(line).toContain("final")
    expect(line).toContain("allow")
    expect(line).toContain(`${p}reason`)
    expect(line).not.toContain("undefined")
    expect(line).not.toContain("NaN")
    expect(line).not.toContain("tok")
  })

  test("a row without decisions is an audit row even when it carries a token count", async () => {
    const command = await logCommand()
    const p = tag()
    state.logCall({ hook: "hook_skill_pick", event: `${p}event`, inputTokens: 7 })
    const text = String((await command.execute({ sessionID: "ses_log_7", prompt: { text: "" } })).content)
    const line = text.split("\n")[0]
    expect(line).toContain(`${p}event`)
    expect(line).not.toContain("tok")
  })
})

describe("ticket #19: the composed integration pass", () => {
  const call = (sessionID: string, id: string, command: string) => ({ sessionID, tool: "shell", input: { command }, id })

  const banOf = (sessionID: string) => readSnapshot(sessionID).snap?.sessionBan

  const operationIDOf = (sessionID: string) => {
    const read = readAbortRecords()
    if (!read.ok) throw new Error("unreachable")
    const matches = read.records.filter((entry) => entry.operation.sessionID === sessionID)
    return matches[matches.length - 1]!.operation.id
  }

  const enableReceipts = (over: Record<string, unknown> = {}) => {
    state.setFeature("hook_abort_receipts", true)
    state.setFeatureConfig("hook_abort_receipts", "webhook", "http://127.0.0.1:9/unused")
    state.setFeatureConfig("hook_abort_receipts", "maxAttempts", over.maxAttempts ?? 1)
    state.setFeatureConfig("hook_abort_receipts", "retryDelayMs", over.retryDelayMs ?? 1)
  }
  const disableReceipts = () => state.setFeature("hook_abort_receipts", false)

  const recorder = (behavior: "deliver" | "throw" | "park") => {
    const posts: Array<{ url: string; body: any }> = []
    const waits: Array<() => void> = []
    let parked = false
    return {
      posts,
      parkAll: () => {
        parked = true
      },
      releaseAll: () => {
        parked = false
        for (const resolve of waits.splice(0)) resolve()
      },
      transport: async (url: string, body: string) => {
        posts.push({ url, body: JSON.parse(body) })
        if (behavior === "throw") throw new Error("the receipt outage")
        if (parked) await new Promise<void>((resolve) => waits.push(resolve))
        return true
      },
    }
  }

  test("the writer's own gate file drives the chain: a blocked record refuses, a passed record activates", async () => {
    // The fixtures below are synthetic sheets: they prove the writer's FILE
    // FORM is what the chain consumes. No host capability is claimed here.
    process.env.WATCHDOG_CHAIN = "1"
    ungate()
    const blocked = writeCapabilityGate(
      JSON.stringify({
        source: { kind: "real-host", date: "synthetic fixture" },
        items: [{ capability: "c3_cancellation", verdict: "failed", note: "fixture: the host cannot cancel" }],
      }),
    )
    expect(blocked.ok && blocked.gate).toBe("blocked")
    nodes("human")
    const host = fakeHost()
    await plugin.setup(host.ctx)
    expect(announcements()[0]?.reason).toBe("the capability gate has not passed")
    // A blocked gate leaves the chain inert: the call passes through exactly
    // as it would with no Watchdog, and nothing is judged or authorized.
    const passedThrough = await gate(host.hooks)(call("ses_t19g", "cg19", "ls a")).then(
      () => "allowed",
      (error: Error) => error.message,
    )
    expect(passedThrough).toBe("allowed")
    expect(since().some((row) => row.event === "chain_stage")).toBe(false)

    const verified = REQUIRED_GATE_IDS.map((id: string) => ({ capability: id, verdict: "verified", note: `fixture sheet: ${id}` }))
    const passed = writeCapabilityGate(
      JSON.stringify({ source: { kind: "real-host", date: "synthetic fixture" }, items: verified }),
    )
    expect(passed.ok && passed.gate).toBe("passed")
    // The gate file is read per call, so the verdict written while the process
    // runs activates the next call.
    const wrapper = gate(host.hooks)
    const held = settle(wrapper(call("ses_t19g", "cg19b", "ls b")))
    await cardsOpen(1)
    await host.push({ type: "form.replied", data: { id: posted[0].card.id, answer: { decision: "allow" } } })
    expect(await held).toBe("allowed")
    const status = await host.calls.rpc[0].handlers.watchdogStatus({})
    expect(status.chain).toEqual({ status: "passed", reason: "the capability gate passed", wired: true })
    ungate()
  })

  test("the four races in one serialized flow: no stale authorization, no duplicate execution", async () => {
    arm()
    nodes("human")
    enableReceipts()
    const rec = recorder("deliver")
    setReceiptTransport(rec.transport)
    const ROOT = "ses_t19_r1r"
    const CHILD = "ses_t19_r1c"
    const SELF = "ses_t19_r1s"
    const tree = {
      sessions: [{ id: ROOT }, { id: CHILD, parentID: ROOT }, { id: SELF, parentID: ROOT }],
      parentOf: (id: string) => (id === CHILD || id === SELF ? ROOT : null),
    }
    try {
      const host = fakeHost(tree)
      await plugin.setup(host.ctx)
      const handlers = host.calls.rpc[0].handlers
      const wrapper = gate(host.hooks)

      // Race one, execution-versus-deny: two calls held in the child; a deny
      // for the second cancels only that call and aborts nothing.
      const one = settle(wrapper(call(CHILD, "cr1a", "ls a")))
      await cardsOpen(1)
      const two = settle(wrapper(call(CHILD, "cr1b", "ls b")))
      await cardsOpen(2)
      await host.push({ type: "form.replied", data: { id: posted[1].card.id, answer: { decision: "deny" } } })
      expect(await two).toContain("did not run")
      const denyRow = since().find((row) => row.event === "chain_deny")
      expect(denyRow?.shape).toBe("queued")
      expect(host.calls.interrupts).toEqual([])
      expect(banOf(CHILD)).toBeUndefined()

      // Race two, abort-versus-allow: the abort lands while the first call is
      // still held, so its card is cancelled and the scope is contained.
      const aborted = await handlers.abortOperation({ sessionID: CHILD })
      expect(aborted.ok).toBe(true)
      expect(await one).toContain("did not run")
      expect(banOf(CHILD)?.kind).toBe("subtree")

      // Race three, reply-versus-cancellation: the late allow for the removed
      // card decides nothing and authorizes nothing.
      await host.push({ type: "form.replied", data: { id: posted[0].card.id, answer: { decision: "allow" } } })
      await ticks(8)
      expect(since().some((row) => row.event === "chain_decision" && row.verdict === "allow")).toBe(false)
      expect(posted).toHaveLength(2)
      expect(host.calls.prompts).toEqual([])

      // Race four, release-versus-abort: the ancestor's abort lands before the
      // child's operation is released, so the release clears only its own rows
      // and the continuation is prevented at the boundary.
      const rootAbort = await handlers.abortOperation({ sessionID: ROOT })
      expect(rootAbort.ok).toBe(true)
      const released = await handlers.releaseOperation({ operationID: operationIDOf(CHILD), continue: true })
      expect(released.ok).toBe(true)
      expect(released.covered).toEqual([CHILD])
      expect(released.continued).toBe("prevented")
      expect(host.calls.prompts).toEqual([])

      // One receipt per operation, one queue notice for the child's parent, and
      // no wake anywhere: the ancestor has no parent, so its notice is absent.
      await ticks(10)
      expect(rec.posts).toHaveLength(2)
      expect(host.calls.syntheticNotes).toHaveLength(1)
      expect(host.calls.syntheticNotes[0].sessionID).toBe(ROOT)
      expect(host.calls.syntheticNotes[0].delivery).toBe("queue")

      // A restart over the same durable store keeps every restriction.
      const after = fakeHost(tree)
      await plugin.setup(after.ctx)
      const childRefused = await latestGate(after.hooks)(call(CHILD, "cr1c", "ls c")).then(
        () => "allowed",
        (error: Error) => error.message,
      )
      expect(childRefused).toContain("did not run")
      const selfRefused = await latestGate(after.hooks)(call(SELF, "cr1d", "ls d")).then(
        () => "allowed",
        (error: Error) => error.message,
      )
      expect(selfRefused).toContain("did not run")
      expect(after.calls.prompts).toEqual([])
    } finally {
      setReceiptTransport(null)
      disableReceipts()
    }
  })

  test("one admission pipeline together: partial batch, bounded repair exhaustion, immutable decisions, sibling budgets, indefinite Human pending, restart restoration", async () => {
    arm()
    nodes("jev,supervisor,human")
    process.env.WATCHDOG_CHAIN_CAP = "2"
    process.env.WATCHDOG_CHAIN_JEV_BATCH_MAX = "2"
    process.env.WATCHDOG_CHAIN_JEV_BATCH_MS = "100"
    const base = state.loadState()
    state.saveState({ ...base, endpoint: `http://127.0.0.1:${server.port}/decisions`, model: "test-model", protocol: "systemone" })
    state.writeKey("test-key")
    // The provider leaves the second and third items unanswered, so they
    // propagate; the supervisor generate is malformed on every ask, so repair
    // runs once and exhaustion escalates each item to the human.
    omitAnswers = (payload) =>
      (payload?.state?.calls ?? [])
        .filter((entry: any) => entry?.input?.command === "ls y" || entry?.input?.command === "ls z")
        .map((entry: any) => entry.id)
    const garbage = () => "not a json object at all"
    const host = fakeHost({ generate: garbage })
    await plugin.setup(host.ctx)
    const wrapper = gate(host.hooks)
    const A = "ses_t19_pA"
    const B = "ses_t19_pB"

    // A partial batch decides the item it answered; the omitted item escalates.
    const a1 = settle(wrapper(call(A, "cpa1", "ls x")))
    const a2 = settle(wrapper(call(A, "cpa2", "ls y")))
    expect(await a1).toBe("allowed")
    await cardsOpen(1)
    const a1ID = String((decisions[0]?.state?.calls ?? []).find((entry: any) => entry?.input?.command === "ls x")?.id ?? "")
    expect(a1ID).not.toBe("")
    const a2ID = String((decisions[0]?.state?.calls ?? []).find((entry: any) => entry?.input?.command === "ls y")?.id ?? "")
    expect(a2ID).not.toBe("")

    // The repair bound is one re-ask: two supervisor generates per item, then
    // unavailability, then the human card. No original tool reruns anywhere.
    const a3 = settle(wrapper(call(A, "cpa3", "ls z")))
    await cardsOpen(2)
    const supervisorAsks = host.calls.generate.filter((request: any) => idsIn(request.prompt).length > 0)
    const a2Asks = supervisorAsks.filter((request: any) => idsIn(request.prompt).includes(a2ID))
    expect(a2Asks).toHaveLength(2)

    // The partial batch's accepted allow for a1 exists as exactly one
    // decision row: nothing re-judges the settled item afterwards.
    const a1Decisions = since().filter((row) => row.event === "chain_decision" && row.itemID === a1ID)
    expect(a1Decisions).toHaveLength(1)
    expect(a1Decisions[0].verdict).toBe("allow")

    // The Human items pend indefinitely and keep their slots: the cap is two,
    // both are held, and the third call in A waits at the budget instead.
    await ticks(30)
    expect(posted).toHaveLength(2)
    const a4 = settle(wrapper(call(A, "cpa4", "ls w")))
    await ticks(10)
    expect(posted).toHaveLength(2)
    const waiting = since().find((row) => row.waiting === true)
    expect(waiting?.held).toBe(2)

    // Sibling budgets are independent: B admits and decides while A is full.
    const b1 = settle(wrapper(call(B, "cpb1", "ls b")))
    expect(await b1).toBe("allowed")

    // The human approves one pending item: its slot frees, and the waiting
    // call is admitted and decided, never left waiting on a dead budget.
    await host.push({ type: "form.replied", data: { id: posted[0].card.id, answer: { decision: "allow" } } })
    expect(await a2).toBe("allowed")
    expect(await a4).toBe("allowed")

    // An accepted decision is immutable: a duplicate reply for the answered
    // card finds no hold, and the settled allow is never re-decided.
    await host.push({ type: "form.replied", data: { id: posted[0].card.id, answer: { decision: "deny" } } })
    await ticks(8)
    const a2Decisions = since().filter((row) => row.event === "chain_decision" && row.itemID === a2ID)
    expect(a2Decisions).toHaveLength(1)
    expect(a2Decisions[0].verdict).toBe("allow")

    // Restart with one item still pending: the hold resolves, the interrupted
    // slot is reported once and kept until its own session continues, and a
    // late card answer for the retired hold authorizes nothing. A same-host
    // re-setup is the restart: the old runtime's pending hold is settled by
    // the handover.
    await plugin.setup(host.ctx)
    expect(await a3).toContain("did not run")
    const nextGate = latestGate(host.hooks)
    const b2 = settle(nextGate(call(B, "cpb2", "ls c")))
    expect(await b2).toBe("allowed")
    const restored = since().filter((row) => row.restored === true)
    expect(restored).toHaveLength(1)
    for (const row of restored) {
      expect(row.verdict).toBe("unresolved")
      expect(String(row.reason)).toContain("not approved")
    }
    // The item pending across the restart is a3: its jev ask is the second
    // decisions payload, and the late answer must decide nothing for it.
    const a3ID = String(
      (decisions.find((payload: any) => (payload?.state?.calls ?? []).some((entry: any) => entry?.input?.command === "ls z"))?.state?.calls ?? [])
        .find((entry: any) => entry?.input?.command === "ls z")?.id ?? "",
    )
    expect(a3ID).not.toBe("")
    await host.push({ type: "form.replied", data: { id: posted[1].card.id, answer: { decision: "allow" } } })
    await ticks(8)
    expect(since().filter((row) => row.event === "chain_decision" && row.verdict === "allow").some((row) => row.itemID === a3ID)).toBe(false)

    // Its own session continues: the dead slots are disposed and A is admitted
    // again through the whole pipeline.
    const a5 = settle(nextGate(call(A, "cpa5", "ls v")))
    expect(await a5).toBe("allowed")
  })

  test("overlapping aborts through selected-only continuation, operation-scoped release, revocation, restart, and reconnect", async () => {
    arm()
    nodes("human")
    const ROOT = "ses_t19_or"
    const CHILD = "ses_t19_oc"
    const SELF = "ses_t19_os"
    const tree = {
      sessions: [{ id: ROOT }, { id: CHILD, parentID: ROOT }, { id: SELF, parentID: ROOT }],
      parentOf: (id: string) => (id === CHILD || id === SELF ? ROOT : null),
    }
    const host = fakeHost(tree)
    await plugin.setup(host.ctx)
    const handlers = host.calls.rpc[0].handlers
    const wrapper = gate(host.hooks)

    // A cancelled job to keep dead: a held call in the child.
    const held = settle(wrapper(call(CHILD, "cov1", "ls a")))
    await cardsOpen(1)

    // An old approval exists for the child before any abort.
    const ttl = state.loadState().approveTtl
    recordApproval(
      { token: "tok_t19", sessionID: CHILD, action: "shell", resources: [], subject: "ls", reason: "review", ts: new Date().toISOString() },
      ttl,
    )

    // Two independent operations: the child's own and the ancestor's subtree.
    await handlers.abortOperation({ sessionID: CHILD })
    await handlers.abortOperation({ sessionID: ROOT })
    expect(await held).toContain("did not run")
    const childOp = operationIDOf(CHILD)
    const rootOp = operationIDOf(ROOT)

    // Old approvals never resurrect: the recorded approval does not run the
    // call through the covered scope.
    const refused = await wrapper(call(CHILD, "cov2", "ls b")).then(
      () => "allowed",
      (error: Error) => error.message,
    )
    expect(refused).toContain("did not run")

    // The ancestor's release continues the selected session only, and lifts
    // only itself: the child keeps its own operation's coverage.
    const rootRelease = await handlers.releaseOperation({ operationID: rootOp, continue: true })
    expect(rootRelease.continued).toBe("sent")
    expect(host.calls.prompts).toEqual([{ sessionID: ROOT, text: RELEASE_CONTINUE_TEXT }])
    expect(banOf(CHILD)?.kind).toBe("subtree")
    expect(banOf(ROOT)).toBeUndefined()

    // Reconnect and restart: a new runtime over the same store answers the
    // retried release with "already" and never repeats the prompt.
    const after = fakeHost(tree)
    await plugin.setup(after.ctx)
    const retried = await after.calls.rpc[0].handlers.releaseOperation({ operationID: rootOp, continue: true })
    expect(retried.continued).toBe("already")
    expect(after.calls.prompts).toEqual([])
    // No cancelled job resurrects: the child is still covered by its own
    // operation, and nothing was ever resumed for it.
    const stillRefused = await latestGate(after.hooks)(call(CHILD, "cov3", "ls c")).then(
      () => "allowed",
      (error: Error) => error.message,
    )
    expect(stillRefused).toContain("did not run")

    // No cancelled job resurrects: the tree runs again through the normal chain.
    const final = await after.calls.rpc[0].handlers.releaseOperation({ operationID: childOp })
    expect(final.continued).toBe("not-requested")
    expect(after.calls.prompts).toEqual([])
    const reopened = settle(latestGate(after.hooks)(call(CHILD, "cov4", "ls d")))
    await cardsOpen(2)
    await after.push({ type: "form.replied", data: { id: posted[1].card.id, answer: { decision: "allow" } } })
    expect(await reopened).toBe("allowed")
  })

  test("a receipt outage never delays containment and stays bounded", async () => {
    arm()
    nodes("human")
    enableReceipts({ maxAttempts: 2, retryDelayMs: 1 })
    const rec = recorder("throw")
    setReceiptTransport(rec.transport)
    const ROOT = "ses_t19_outr"
    const CHILD = "ses_t19_outc"
    const GRAND = "ses_t19_outg"
    const tree = { sessions: [{ id: ROOT }, { id: CHILD, parentID: ROOT }, { id: GRAND, parentID: CHILD }] }
    try {
      const host = fakeHost(tree)
      await plugin.setup(host.ctx)
      const handlers = host.calls.rpc[0].handlers

      // Containment is sealed and durable before a single delivery pass ends.
      const child = await handlers.abortOperation({ sessionID: CHILD })
      expect(child.ok).toBe(true)
      expect(banOf(CHILD)?.kind).toBe("subtree")
      expect(banOf(GRAND)?.kind).toBe("subtree")

      // The outage is bounded: two throwing attempts per receipt, then failed.
      await ticks(30)
      expect(rec.posts.length).toBeGreaterThanOrEqual(2)
      const listed = await handlers.abortOperations({})
      const childRow = listed.operations.find((entry: any) => entry.sessionID === CHILD)
      expect(childRow.delivery).toEqual({ receipt: "failed", attempts: 2, notice: "delivered" })

      // The parent notice still landed without waking or resuming the parent.
      expect(host.calls.prompts).toEqual([])
      expect(host.calls.syntheticNotes).toHaveLength(1)
      expect(host.calls.syntheticNotes[0].sessionID).toBe(ROOT)
      expect(host.calls.syntheticNotes[0].delivery).toBe("queue")
    } finally {
      setReceiptTransport(null)
      disableReceipts()
    }
  })

  test("notices under a parent abort are suppressed after the boundary, with no wake and no resume", async () => {
    arm()
    nodes("human")
    enableReceipts({ maxAttempts: 1 })
    const rec = recorder("park")
    setReceiptTransport(rec.transport)
    const ROOT = "ses_t19_pmr"
    const CHILD = "ses_t19_pmc"
    const GRAND = "ses_t19_pmg"
    const tree = { sessions: [{ id: ROOT }, { id: CHILD, parentID: ROOT }, { id: GRAND, parentID: CHILD }] }
    try {
      const host = fakeHost(tree)
      await plugin.setup(host.ctx)
      const handlers = host.calls.rpc[0].handlers

      // The child's delivery parks mid-pass, then the parent itself is
      // aborted: the parked notice must not wake or resume the parent.
      rec.parkAll()
      const child = await handlers.abortOperation({ sessionID: GRAND })
      expect(child.ok).toBe(true)
      const parentAbort = await handlers.abortOperation({ sessionID: CHILD })
      expect(parentAbort.ok).toBe(true)
      rec.releaseAll()
      await ticks(12)

      // The grandchild's notice is suppressed by the boundary check: its
      // direct parent was aborted while the receipt was parked. The child's
      // own notice reaches its live parent as one queue write, never a wake.
      expect(host.calls.syntheticNotes).toHaveLength(1)
      expect(host.calls.syntheticNotes[0].sessionID).toBe(ROOT)
      expect(host.calls.syntheticNotes[0].delivery).toBe("queue")
      expect(host.calls.prompts).toEqual([])
      const listed = await handlers.abortOperations({})
      const grandRow = listed.operations.find((entry: any) => entry.sessionID === GRAND)
      expect(grandRow.delivery).toEqual({ receipt: "delivered", attempts: 1, notice: "suppressed" })
      const childRow = listed.operations.find((entry: any) => entry.sessionID === CHILD)
      expect(childRow.delivery).toEqual({ receipt: "delivered", attempts: 1, notice: "delivered" })
    } finally {
      setReceiptTransport(null)
      disableReceipts()
    }
  })
})
