/**
 * The server half end to end, with a fake host: all three tools register, a
 * report reaches the store and the RPC list, updates merge in place, an
 * answer marks the record and reaches the reporting session, and empty calls
 * are refused.
 *
 *   bun test src/index.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

let dir: string
let plugin: any
let tools: any[]
let handlers: Record<string, any>
let prompts: string[]
let deliveries: string[]
let store: typeof import("./store.ts")

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "report-plugin-"))
  process.env.REPORT_STATE_HOME = dir
  tools = []
  handlers = {}
  prompts = []
  deliveries = []
  plugin = (await import("./index.ts")).default
  store = await import("./store.ts")
  await plugin.setup({
    tool: { transform: async (fn: any) => fn({ add: (tool: any) => tools.push(tool) }) },
    session: {
      prompt: async (input: any) => {
        prompts.push(String(input?.text ?? ""))
        deliveries.push(String(input?.delivery ?? ""))
      },
    },
    rpc: {
      register: async (_contract: any, registered: Record<string, any>) => {
        Object.assign(handlers, registered)
        return { events: { emit: async () => {} } }
      },
    },
  })
})

afterAll(() => {
  delete process.env.REPORT_STATE_HOME
  rmSync(dir, { recursive: true, force: true })
})

describe("tools", () => {
  test("post_task saves a report and the RPC lists it", async () => {
    const post = tools.find((tool) => tool.name === "post_task")
    const result = await post.execute(
      {
        description: "Shipped the report",
        completed: ["shipped"],
        hiccups: [{ problem: "p", cause: "c", fix: "f" }],
        prompts: { questions: [{ title: "pick", body: "why", recommendation: "this" }] },
      },
      { sessionID: "ses_1" },
    )
    expect(result.content).toContain("Saved as post-task")
    const stored = store.readReports("ses_1")
    expect(stored).toHaveLength(1)
    expect(stored[0]?.sections?.completed).toEqual(["shipped"])
    expect(stored[0]?.prompts).toBeUndefined()
    expect(stored[0]?.rev).toBe(1)
    expect((await handlers.list({ sessionIDs: ["ses_1"] })).reports).toHaveLength(1)
  })

  test("report_update patches only the named sections and bumps rev", async () => {
    const update = tools.find((tool) => tool.name === "report_update")
    const result = await update.execute({ next: ["follow up"] }, { sessionID: "ses_1" })
    expect(result.content).toContain("(rev 2)")
    const stored = store.readReports("ses_1")[0]!
    expect(stored.sections?.completed).toEqual(["shipped"])
    expect(stored.sections?.next).toEqual(["follow up"])
    expect(stored.rev).toBe(2)
  })

  test("report_update with an unknown id changes nothing", async () => {
    const update = tools.find((tool) => tool.name === "report_update")
    const result = await update.execute({ id: "nope", completed: ["x"] }, { sessionID: "ses_1" })
    expect(result.content).toContain("no report nope")
    expect(store.readReports("ses_1")[0]?.rev).toBe(2)
  })

  test("prompt_user saves prompts", async () => {
    const prompt = tools.find((tool) => tool.name === "prompt_user")
    const result = await prompt.execute(
      { description: "One procedure", procedures: [{ title: "run", steps: ["one"] }] },
      { sessionID: "ses_2" },
    )
    expect(result.content).toContain("Saved as prompts")
    expect(store.readReports("ses_2")[0]?.kind).toBe("prompt-user")
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
      reportID: id,
      answers: { "0": "one" },
    })
    expect(result.ok).toBe(true)
    expect(result.delivered).toBe(true)
    expect(deliveries.at(-1)).toBe("steer")
    expect(prompts.at(-1)).toContain("1. pick one: one")
    const stored = store.readReports("ses_3")[0]!
    expect(stored.answers?.["0"]).toBe("one")
    expect(stored.answeredAt).toBeGreaterThan(0)
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
      reportID: id,
      answers: { "0": "queued" },
      mode: "queue",
    })
    expect(result.delivered).toBe(true)
    expect(deliveries.at(-1)).toBe("queue")
    expect(prompts.at(-1)).toContain("1. queue question: queued")
    const stored = store.readReports("ses_queue")[0]!
    expect(stored.answers?.["0"]).toBe("queued")
    expect(stored.answeredAt).toBeGreaterThan(0)
  })

  test("dismiss marks the prompts handled without an answer", async () => {
    const prompt = tools.find((tool) => tool.name === "prompt_user")
    const created = await prompt.execute(
      { description: "Dismiss me", questions: [{ title: "obsolete", body: "already handled" }] },
      { sessionID: "ses_dismiss" },
    )
    const id = String(created.content).match(/([a-z0-9-]+);/)?.[1]
    const result = await handlers.dismiss({ sessionID: "ses_dismiss", reportID: id })
    expect(result.ok).toBe(true)
    const stored = store.readReports("ses_dismiss")[0]!
    expect(stored.dismissedAt).toBeGreaterThan(0)
    expect(stored.answeredAt).toBeUndefined()
    expect(stored.answers).toBeUndefined()
    expect(prompts.some((text) => text.includes("Dismiss me"))).toBe(false)
    expect((await handlers.dismiss({ sessionID: "ses_dismiss", reportID: "missing" })).ok).toBe(false)
  })

  test("read marks the report read without bumping rev", async () => {
    const result = await handlers.read({ sessionID: "ses_3", reportID: store.readReports("ses_3")[0]!.id })
    expect(result.ok).toBe(true)
    const stored = store.readReports("ses_3")[0]!
    expect(stored.readAt).toBeGreaterThan(0)
    expect(stored.rev).toBe(1)
    expect((await handlers.read({ sessionID: "ses_3", reportID: "missing" })).ok).toBe(false)
  })

  test("an empty call is refused", async () => {
    const post = tools.find((tool) => tool.name === "post_task")
    const result = await post.execute({ description: "Empty" }, { sessionID: "ses_4" })
    expect(result.content).toContain("no sections")
    expect(store.readReports("ses_4")).toHaveLength(0)
  })

  test("a missing description is refused", async () => {
    const post = tools.find((tool) => tool.name === "post_task")
    const result = await post.execute({ completed: ["x"] }, { sessionID: "ses_desc" })
    expect(result.content).toContain("description is required")
    expect(store.readReports("ses_desc")).toHaveLength(0)
  })

  test("a call without a session is refused", async () => {
    const post = tools.find((tool) => tool.name === "post_task")
    const result = await post.execute({ description: "No session", completed: ["x"] }, {})
    expect(result.content).toContain("no session")
  })
})
