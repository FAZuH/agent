/**
 * The server-side card must use the kind Desktop and web actually render.
 *
 *   bun test src/form.test.ts
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { openNativeForm } from "./form.ts"
import type { Prompt } from "./shared.ts"

let state: string
let originalFetch: typeof globalThis.fetch
let calls: { method: string; url: string; body: any }[]

const prompt: Prompt = {
  id: "pw1-abc123",
  sessionID: "ses_1",
  at: 1000,
  title: "Pick one",
  description: "Choose",
  prompts: { questions: [{ title: "Pick one", body: "why", recommendation: "first" }] },
}

beforeAll(() => {
  state = mkdtempSync(join(tmpdir(), "prompt-form-"))
  process.env.XDG_STATE_HOME = state
  delete process.env.OPENCODE_PROMPT_NO_NATIVE_FORM
  mkdirSync(join(state, "opencode"), { recursive: true })
  writeFileSync(
    join(state, "opencode", "service.json"),
    JSON.stringify({ url: "http://127.0.0.1:4099", password: "secret" }),
  )
  originalFetch = globalThis.fetch
  calls = []
  globalThis.fetch = (async (input: any, init: any) => {
    calls.push({ method: init?.method, url: String(input), body: JSON.parse(init.body) })
    return new Response("", { status: 200 })
  }) as typeof globalThis.fetch
})

afterAll(() => {
  globalThis.fetch = originalFetch
  delete process.env.XDG_STATE_HOME
  rmSync(state, { recursive: true, force: true })
})

describe("openNativeForm", () => {
  test("posts a question-kind form the web client renders", async () => {
    const opened = await openNativeForm(prompt)
    expect(opened?.created).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.method).toBe("POST")
    expect(calls[0]!.url).toBe("http://127.0.0.1:4099/api/session/ses_1/form")
    expect(calls[0]!.body.id).toBe("frm_prompt_pw1-abc123")
    expect(calls[0]!.body.metadata.kind).toBe("question")
    expect(calls[0]!.body.fields[0]).toMatchObject({ key: "q0", type: "string" })
    expect(calls[0]!.body.fields[0].title).toBe("Pick one")
    expect(calls[0]!.body.fields[0].description).toBe("[Pick one]\n\nwhy")
    expect(calls[0]!.body.fields[0].options[0].value).toBe("first")
  })

  test("a reopen gets a new id", async () => {
    await openNativeForm(prompt, true)
    expect(calls.at(-1)!.body.id).not.toBe("frm_prompt_pw1-abc123")
    expect(calls.at(-1)!.body.id.startsWith("frm_prompt_pw1-abc123_r")).toBe(true)
  })

  test("an existing card is reported, not reopened", async () => {
    globalThis.fetch = (async () => new Response("", { status: 409 })) as typeof globalThis.fetch
    const opened = await openNativeForm(prompt)
    expect(opened).toEqual({ id: "frm_prompt_pw1-abc123", created: false })
    globalThis.fetch = (async (_input: any, init: any) => {
      calls.push({ method: init?.method, url: String(_input), body: JSON.parse(init.body) })
      return new Response("", { status: 200 })
    }) as typeof globalThis.fetch
  })

  test("no questions means no card", async () => {
    const before = calls.length
    expect(await openNativeForm({ ...prompt, prompts: {} })).toBeUndefined()
    expect(calls.length).toBe(before)
  })
})
