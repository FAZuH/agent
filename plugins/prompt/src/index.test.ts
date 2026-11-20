/**
 * The server half end to end, with a fake host: the tool registers, a prompt
 * reaches the store and the RPC list, an answer marks the record and reaches
 * the reporting session, and empty calls are refused.
 *
 *   bun test src/index.test.ts
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

let dir: string
let plugin: any
let tools: any[]
let handlers: Record<string, any>
let prompts: string[]
let deliveries: string[]
let store: typeof import("./store.ts")
let formEmit: (event: any) => void
let emits: { topic: string; payload: any }[]

/** One plugin setup, as the host does per location. */
async function setupHost() {
  const waiters: ((result: IteratorResult<any>) => void)[] = []
  const stream = {
    [Symbol.asyncIterator]() {
      return this
    },
    next() {
      return new Promise<IteratorResult<any>>((resolve) => waiters.push(resolve))
    },
  }
  formEmit = (event: any) => {
    const waiter = waiters.shift()
    if (waiter) waiter({ value: event, done: false })
  }
  const localTools: any[] = []
  const localHandlers: Record<string, any> = {}
  await plugin.setup({
    tool: { transform: async (fn: any) => fn({ add: (tool: any) => localTools.push(tool) }) },
    command: { transform: async (fn: any) => fn({ add: (_command: any) => {} }) },
    event: { subscribe: () => stream },
    session: {
      prompt: async (input: any) => {
        prompts.push(String(input?.text ?? ""))
        deliveries.push(String(input?.delivery ?? ""))
      },
    },
    rpc: {
      register: async (_contract: any, registered: Record<string, any>) => {
        Object.assign(localHandlers, registered)
        return {
          events: {
            emit: async (topic: string, payload: any) => {
              emits.push({ topic, payload })
            },
          },
        }
      },
    },
  })
  return { tools: localTools, handlers: localHandlers }
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "prompt-plugin-"))
  process.env.OPENCODE_PROMPT_STATE_HOME = dir
  process.env.OPENCODE_PROMPT_NO_NATIVE_FORM = "1"
  tools = []
  handlers = {}
  prompts = []
  deliveries = []
  emits = []
  plugin = (await import("./index.ts")).default
  store = await import("./store.ts")
  const host = await setupHost()
  tools.push(...host.tools)
  Object.assign(handlers, host.handlers)
})

afterAll(() => {
  delete process.env.OPENCODE_PROMPT_STATE_HOME
  delete process.env.OPENCODE_PROMPT_NO_NATIVE_FORM
  rmSync(dir, { recursive: true, force: true })
})

describe("tools", () => {
  test("prompt_user is non-blocking by default", () => {
    const tool = tools.find((item) => item.name === "prompt_user")
    expect(tool?.input.properties.block.default).toBe(false)
    expect(tool?.description).toContain("non-blocking by default")
  })

  test("prompt_user saves the procedures and questions the RPC lists", async () => {
    const prompt = tools.find((tool) => tool.name === "prompt_user")
    const result = await prompt.execute(
      {
        description: "Run and pick",
        procedures: [{ title: "run", steps: ["one"] }],
        questions: [{ title: "pick", body: "why", recommendation: "this" }],
      },
      { sessionID: "ses_1" },
    )
    expect(result.content).toContain("Saved as prompt")
    const stored = store.readPrompts("ses_1")
    expect(stored).toHaveLength(1)
    expect(stored[0]?.prompts?.procedures).toEqual([{ title: "run", description: undefined, steps: ["one"] }])
    expect(stored[0]?.prompts?.questions?.[0]?.title).toBe("pick")
    expect((await handlers.list({ sessionIDs: ["ses_1"] })).prompts).toHaveLength(1)
  })

  test("answer records the answers and prompts the reporting session", async () => {
    const prompt = tools.find((tool) => tool.name === "prompt_user")
    const created = await prompt.execute(
      { description: "Pick one", questions: [{ title: "pick one", body: "why" }] },
      { sessionID: "ses_3" },
    )
    const id = String(created.content).match(/([a-z0-9-]+);/)?.[1]
    const result = await handlers.answer({
      sessionID: "ses_3",
      promptID: id,
      answers: { "0": "one" },
    })
    expect(result.ok).toBe(true)
    expect(result.delivered).toBe(true)
    expect(deliveries.at(-1)).toBe("steer")
    expect(prompts.at(-1)).toBe("# Prompt: Pick one\n\npick one\none")
    const stored = store.readPrompts("ses_3")[0]!
    expect(stored.answers?.["0"]).toBe("one")
    expect(stored.answeredAt).toBeGreaterThan(0)
  })

  test("a repeated answer delivers nothing the second time", async () => {
    const prompt = tools.find((tool) => tool.name === "prompt_user")
    const created = await prompt.execute(
      { description: "Answer once", questions: [{ title: "only once", body: "dup" }] },
      { sessionID: "ses_dup" },
    )
    const id = String(created.content).match(/([a-z0-9-]+);/)?.[1]
    const before = prompts.length
    const first = await handlers.answer({ sessionID: "ses_dup", promptID: id, answers: { "0": "one" } })
    const second = await handlers.answer({ sessionID: "ses_dup", promptID: id, answers: { "0": "one" } })
    expect(first.delivered).toBe(true)
    expect(second.delivered).toBe(false)
    expect(second.duplicate).toBe(true)
    expect(prompts.length).toBe(before + 1)
  })

  test("a repeated answer to a blocking prompt posts the text once", async () => {
    const prompt = tools.find((tool) => tool.name === "prompt_user")
    const pending = prompt.execute(
      { description: "Block dup", block: true, questions: [{ title: "blocked", body: "wait" }] },
      { sessionID: "ses_blockdup" },
    )
    const id = store.readPrompts("ses_blockdup")[0]!.id
    const before = prompts.length
    const first = await handlers.answer({ sessionID: "ses_blockdup", promptID: id, answers: { "0": "yeah" } })
    const second = await handlers.answer({ sessionID: "ses_blockdup", promptID: id, answers: { "0": "yeah" } })
    expect(first.delivered).toBe(true)
    expect(second.duplicate).toBe(true)
    expect((await pending).content).toContain("blocked\nyeah")
    expect(prompts.length).toBe(before)
  })

  test("answer with queue uses queue delivery", async () => {
    const prompt = tools.find((tool) => tool.name === "prompt_user")
    const created = await prompt.execute(
      { description: "Queue it", questions: [{ title: "queue question", body: "queue it" }] },
      { sessionID: "ses_queue" },
    )
    const id = String(created.content).match(/([a-z0-9-]+);/)?.[1]
    const result = await handlers.answer({
      sessionID: "ses_queue",
      promptID: id,
      answers: { "0": "queued" },
      mode: "queue",
    })
    expect(result.delivered).toBe(true)
    expect(deliveries.at(-1)).toBe("queue")
    expect(prompts.at(-1)).toBe("# Prompt: Queue it\n\nqueue question\nqueued")
    const stored = store.readPrompts("ses_queue")[0]!
    expect(stored.answers?.["0"]).toBe("queued")
    expect(stored.answeredAt).toBeGreaterThan(0)
  })

  test("dismiss marks the prompt handled without an answer", async () => {
    const prompt = tools.find((tool) => tool.name === "prompt_user")
    const created = await prompt.execute(
      { description: "Dismiss me", questions: [{ title: "obsolete", body: "already handled" }] },
      { sessionID: "ses_dismiss" },
    )
    const id = String(created.content).match(/([a-z0-9-]+);/)?.[1]
    const result = await handlers.dismiss({ sessionID: "ses_dismiss", promptID: id })
    expect(result.ok).toBe(true)
    const stored = store.readPrompts("ses_dismiss")[0]!
    expect(stored.dismissedAt).toBeGreaterThan(0)
    expect(stored.answeredAt).toBeUndefined()
    expect(stored.answers).toBeUndefined()
    expect(prompts.some((text) => text.includes("Dismiss me"))).toBe(false)
    expect((await handlers.dismiss({ sessionID: "ses_dismiss", promptID: "missing" })).ok).toBe(false)
  })

  test("an answer to a missing prompt is refused", async () => {
    const result = await handlers.answer({ sessionID: "ses_3", promptID: "missing", answers: { "0": "x" } })
    expect(result.ok).toBe(false)
    expect(result.delivered).toBe(false)
  })

  test("a call with nothing to show is refused", async () => {
    const prompt = tools.find((tool) => tool.name === "prompt_user")
    const result = await prompt.execute({ description: "Empty" }, { sessionID: "ses_4" })
    expect(result.content).toContain("no procedures or questions")
    expect(store.readPrompts("ses_4")).toHaveLength(0)
  })

  test("a missing description is refused", async () => {
    const prompt = tools.find((tool) => tool.name === "prompt_user")
    const result = await prompt.execute(
      { questions: [{ title: "q", body: "" }] },
      { sessionID: "ses_desc" },
    )
    expect(result.content).toContain("description is required")
    expect(store.readPrompts("ses_desc")).toHaveLength(0)
  })

  test("a call without a session is refused", async () => {
    const prompt = tools.find((tool) => tool.name === "prompt_user")
    const result = await prompt.execute(
      { description: "No session", questions: [{ title: "q", body: "" }] },
      {},
    )
    expect(result.content).toContain("no session")
  })

  test("block waits for the answer and returns it without a second prompt", async () => {
    const prompt = tools.find((tool) => tool.name === "prompt_user")
    const pending = prompt.execute(
      {
        description: "Block one",
        block: true,
        questions: [{ title: "block q", body: "wait for it" }],
      },
      { sessionID: "ses_block" },
    )
    const id = store.readPrompts("ses_block")[0]!.id
    const before = prompts.length
    const result = await handlers.answer({
      sessionID: "ses_block",
      promptID: id,
      answers: { "0": "yes" },
    })
    expect(result.delivered).toBe(true)
    const toolResult = await pending
    expect(toolResult.content).toContain("# Prompt: Block one")
    expect(toolResult.content).toContain("block q\nyes")
    expect(prompts.length).toBe(before)
    const stored = store.readPrompts("ses_block")[0]!
    expect(stored.answeredAt).toBeGreaterThan(0)
    expect(stored.answers?.["0"]).toBe("yes")
  })

  test("a blocking prompt resolves when the answer lands on another instance", async () => {
    const second = await setupHost()
    const prompt = tools.find((tool) => tool.name === "prompt_user")
    const pending = prompt.execute(
      {
        description: "Cross instance",
        block: true,
        questions: [{ title: "cross q", body: "wait for it" }],
      },
      { sessionID: "ses_cross" },
    )
    const id = store.readPrompts("ses_cross")[0]!.id
    const before = prompts.length
    const result = await second.handlers.answer({
      sessionID: "ses_cross",
      promptID: id,
      answers: { "0": "yes" },
    })
    expect(result.delivered).toBe(true)
    const toolResult: any = await Promise.race([
      pending,
      Bun.sleep(500).then(() => ({ content: "timeout" })),
    ])
    expect(toolResult.content).not.toBe("timeout")
    expect(toolResult.content).toContain("cross q\nyes")
    expect(prompts.length).toBe(before)
  })

  test("an interrupted blocking prompt leaves the late answer as a message", async () => {
    const prompt = tools.find((tool) => tool.name === "prompt_user")
    const controller = new AbortController()
    const pending = prompt.execute(
      {
        description: "Interrupted",
        block: true,
        questions: [{ title: "stop", body: "x" }],
      },
      { sessionID: "ses_abort", abort: controller.signal },
    )
    const id = store.readPrompts("ses_abort")[0]!.id
    controller.abort()
    const toolResult = await pending
    expect(toolResult.content).toContain("interrupted")
    const before = prompts.length
    const result = await handlers.answer({
      sessionID: "ses_abort",
      promptID: id,
      answers: { "0": "late" },
    })
    expect(result.delivered).toBe(true)
    expect(prompts.length).toBe(before + 1)
  })

  test("block resolves on dismiss", async () => {
    const prompt = tools.find((tool) => tool.name === "prompt_user")
    const pending = prompt.execute(
      {
        description: "Block dismiss",
        block: true,
        questions: [{ title: "dismiss q", body: "not now" }],
      },
      { sessionID: "ses_block_dismiss" },
    )
    const id = store.readPrompts("ses_block_dismiss")[0]!.id
    await handlers.dismiss({ sessionID: "ses_block_dismiss", promptID: id })
    const toolResult = await pending
    expect(toolResult.content).toContain("dismissed")
    expect(store.readPrompts("ses_block_dismiss")[0]?.dismissedAt).toBeGreaterThan(0)
  })

  test("block resolves on defer and leaves the prompt unanswered", async () => {
    const prompt = tools.find((tool) => tool.name === "prompt_user")
    const pending = prompt.execute(
      {
        description: "Block defer",
        block: true,
        questions: [{ title: "defer q", body: "later" }],
      },
      { sessionID: "ses_block_defer" },
    )
    const id = store.readPrompts("ses_block_defer")[0]!.id
    const result = await handlers.defer({ sessionID: "ses_block_defer", promptID: id })
    expect(result.ok).toBe(true)
    const toolResult = await pending
    expect(toolResult.content).toContain("deferred")
    const stored = store.readPrompts("ses_block_defer")[0]!
    expect(stored.answeredAt).toBeUndefined()
    expect(stored.dismissedAt).toBeUndefined()
  })

  test("block requires at least one question", async () => {
    const prompt = tools.find((tool) => tool.name === "prompt_user")
    const result = await prompt.execute(
      {
        description: "Block procedure",
        block: true,
        procedures: [{ title: "run", steps: ["one"] }],
      },
      { sessionID: "ses_block_procedure" },
    )
    expect(result.content).toContain("block requires at least one question")
    expect(store.readPrompts("ses_block_procedure")).toHaveLength(0)
  })

  test("reopen refuses a prompt that does not exist", async () => {
    const result = await handlers.reopen({ sessionID: "ses_missing", promptID: "no-such-prompt" })
    expect(result.ok).toBe(false)
    expect(result.reason).toContain("no longer available")
  })

  test("reopening another card closes the one on screen first", async () => {
    const priorState = process.env.XDG_STATE_HOME
    const priorOff = process.env.OPENCODE_PROMPT_NO_NATIVE_FORM
    const tmp = mkdtempSync(join(tmpdir(), "prompt-reopen-"))
    mkdirSync(join(tmp, "opencode"), { recursive: true })
    writeFileSync(
      join(tmp, "opencode", "service.json"),
      JSON.stringify({ url: "http://127.0.0.1:4199", password: "x" }),
    )
    process.env.XDG_STATE_HOME = tmp
    delete process.env.OPENCODE_PROMPT_NO_NATIVE_FORM
    const originalFetch = globalThis.fetch
    const calls: { method: string; url: string }[] = []
    globalThis.fetch = (async (input: any, init: any) => {
      calls.push({ method: String(init?.method), url: String(input) })
      return new Response("", { status: 200 })
    }) as typeof globalThis.fetch
    try {
      const sid = "ses_reopen_swap"
      for (const id of ["pA", "pB"]) {
        store.appendPrompt({
          id,
          sessionID: sid,
          at: 1,
          title: id,
          description: id,
          prompts: { questions: [{ title: `${id} q`, body: "", recommendation: id }] },
        })
      }
      expect((await handlers.reopen({ sessionID: sid, promptID: "pA" })).ok).toBe(true)
      calls.length = 0
      expect((await handlers.reopen({ sessionID: sid, promptID: "pB" })).ok).toBe(true)
      expect(calls.map((call) => call.method)).toEqual(["DELETE", "POST"])
      expect(calls[0]!.url).toContain("/form/frm_prompt_pA")
      expect(calls[1]!.url).toContain(`/api/session/${sid}/form`)
    } finally {
      globalThis.fetch = originalFetch
      if (priorState === undefined) delete process.env.XDG_STATE_HOME
      else process.env.XDG_STATE_HOME = priorState
      if (priorOff === undefined) delete process.env.OPENCODE_PROMPT_NO_NATIVE_FORM
      else process.env.OPENCODE_PROMPT_NO_NATIVE_FORM = priorOff
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  test("dismissAll clears only awaiting prompts and reports the count", async () => {
    const sid = "ses_dismiss_all"
    for (const [id, patch] of [
      ["da-open", {}],
      ["da-answered", { answeredAt: 1 }],
      ["da-dismissed", { dismissedAt: 1 }],
    ] as const) {
      store.appendPrompt({
        id,
        sessionID: sid,
        at: 1,
        title: id,
        description: id,
        prompts: { questions: [{ title: `${id} q`, body: "", recommendation: "ok" }] },
        ...patch,
      })
    }

    const result = await handlers.dismissAll({ sessionIDs: [sid] })

    expect(result).toEqual({ ok: true, count: 1 })
    const records = store.readPrompts(sid)
    expect(records.find((record) => record.id === "da-open")?.dismissedAt).toBeGreaterThan(0)
    expect(records.find((record) => record.id === "da-answered")?.dismissedAt).toBeUndefined()
    expect(records.find((record) => record.id === "da-dismissed")?.dismissedAt).toBe(1)
  })

  test("dismissAll dismisses a procedure-only prompt with no questions", async () => {
    const sid = "ses_dismiss_all_procedure"
    store.appendPrompt({
      id: "da-procedure",
      sessionID: sid,
      at: 1,
      title: "Procedure only",
      description: "Procedure only",
      prompts: { procedures: [{ title: "run", description: undefined, steps: ["one"] }] },
    })

    const result = await handlers.dismissAll({ sessionIDs: [sid] })

    expect(result).toEqual({ ok: true, count: 1 })
    expect(store.readPrompts(sid)[0]?.dismissedAt).toBeGreaterThan(0)
  })

  test("dismissAll counts unresolved prompts across every session in the family", async () => {
    store.appendPrompt({
      id: "bulk-a",
      sessionID: "ses_bulk_a",
      at: 1,
      title: "Bulk A",
      description: "Bulk A",
      prompts: { questions: [{ title: "A question", body: "" }] },
    })
    store.appendPrompt({
      id: "bulk-b",
      sessionID: "ses_bulk_b",
      at: 1,
      title: "Bulk B",
      description: "Bulk B",
      prompts: { questions: [{ title: "B question", body: "" }] },
    })

    const result = await handlers.dismissAll({ sessionIDs: ["ses_bulk_a", "ses_bulk_b"] })

    expect(result).toEqual({ ok: true, count: 2 })
    expect(store.readPrompts("ses_bulk_a")[0]?.dismissedAt).toBeGreaterThan(0)
    expect(store.readPrompts("ses_bulk_b")[0]?.dismissedAt).toBeGreaterThan(0)
  })

  test("an empty native-card answer stays unanswered", async () => {
    const prompt = tools.find((tool) => tool.name === "prompt_user")
    const pending = prompt.execute(
      {
        description: "Card fallback",
        block: true,
        questions: [{ title: "card q", body: "wait", recommendation: "the recommendation" }],
      },
      { sessionID: "ses_card" },
    )
    const id = store.readPrompts("ses_card")[0]!.id
    formEmit({
      type: "form.replied",
      data: { id: `frm_prompt_${id}`, sessionID: "ses_card", answer: {} },
    })
    const result = await pending
    expect(result.content).toContain("card q\nNot answered")
    expect(result.content).not.toContain("the recommendation")
    const answered = store.readPrompts("ses_card")[0]
    expect(answered?.answers?.["0"]).toBeUndefined()
    expect(answered?.answeredAt).toBeGreaterThan(0)
  })
})

describe("settings RPC", () => {
  const file = () => join(dir, "settings.json")

  // Each test owns the settings file: the store is one JSON in the state home.
  beforeEach(() => rmSync(file(), { force: true }))

  test("getSettings returns both visibility defaults when no file exists", async () => {
    expect(await handlers.getSettings({})).toEqual({ sidebar: true, showPrompts: true })
  })

  test("setSetting persists one toggle and getSettings reads it back", async () => {
    expect(await handlers.setSetting({ key: "showPrompts", value: false })).toEqual({ ok: true })
    expect(await handlers.getSettings({})).toEqual({ sidebar: true, showPrompts: false })
    expect(JSON.parse(readFileSync(file(), "utf8"))).toEqual({ sidebar: true, showPrompts: false })
  })

  test("setSetting refuses a key outside the two real settings", async () => {
    const result = await handlers.setSetting({ key: "theme", value: true })
    expect(result.ok).toBe(false)
    expect(result.error).toContain("key")
    expect(existsSync(file())).toBe(false)
  })

  test("setSetting refuses a non-boolean value", async () => {
    const result = await handlers.setSetting({ key: "sidebar", value: "yes" })
    expect(result.ok).toBe(false)
    expect(result.error).toContain("boolean")
  })

  test("a successful mutation emits changed with the settings topic", async () => {
    emits.length = 0
    await handlers.setSetting({ key: "sidebar", value: false })
    expect(emits).toContainEqual({ topic: "changed", payload: { topic: "settings" } })
  })

  test("a rejected mutation emits nothing", async () => {
    emits.length = 0
    await handlers.setSetting({ key: "sidebar", value: 1 })
    expect(emits).toEqual([])
  })
})
