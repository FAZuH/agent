/**
 * RPC failures reach the GUI as plain objects. They must render as text, not
 * "[object Object]".
 *
 *   bun test src/gui-controller.test.ts
 */
import { describe, expect, test } from "bun:test"

import { createPromptView, errorText, type PromptDialogs, type PromptRPC, type PromptViewState } from "./gui-controller.ts"
import type { Prompt } from "./shared.ts"

const prompt: Prompt = {
  id: "desktop-check",
  sessionID: "ses_child",
  at: 1,
  title: "Which delivery?",
  description: "Desktop check",
  prompts: { questions: [{ title: "Which delivery?", body: "Choose a lane." }] },
}

function harness(overrides: Partial<PromptRPC> = {}, dialogOverrides: Partial<PromptDialogs> = {}) {
  const states: PromptViewState[] = []
  const errors: string[] = []
  const rpc: PromptRPC = {
    list: async () => ({ prompts: [prompt] }),
    reopen: async () => ({ ok: true }),
    dismiss: async () => ({ ok: true }),
    dismissAll: async () => ({ ok: true, count: 0 }),
    subscribe: () => () => {},
    ...overrides,
  }
  const dialogs: PromptDialogs = {
    update: (state) => states.push(state),
    error: (message) => errors.push(message),
    ...dialogOverrides,
  }
  return { view: createPromptView(rpc, dialogs), states, errors }
}

describe("errorText", () => {
  test("reads an Error message", () => {
    expect(errorText(new Error("boom"))).toBe("boom")
  })

  test("reads a plain RPC error object", () => {
    expect(errorText({ _tag: "RpcError", type: "rpc.invalid_input", message: "Expected object" })).toBe(
      "Expected object",
    )
  })

  test("reads a nested error object", () => {
    expect(errorText({ reason: { message: "server unreachable" } })).toBe("server unreachable")
  })

  test("falls back to String for unknown values", () => {
    expect(errorText(42)).toBe("42")
  })
})

describe("dismiss", () => {
  test("sends the prompt id and reloads the family on success", async () => {
    const sent: unknown[] = []
    let lists = 0
    let records = [prompt]
    const { view, states } = harness({
      list: async () => {
        lists++
        return { prompts: records }
      },
      dismiss: async (input) => {
        sent.push(input)
        records = [{ ...prompt, dismissedAt: 2 }]
        return { ok: true }
      },
    })
    await view.load(["ses_child"])
    expect(lists).toBe(1)

    await view.dismiss("ses_child", "desktop-check")

    expect(sent).toEqual([{ sessionID: "ses_child", promptID: "desktop-check" }])
    expect(lists).toBe(2)
    expect(states.at(-1)?.prompts[0]?.dismissedAt).toBe(2)
    view.dispose()
  })

  test("reports a plain-object failure without changing state", async () => {
    const { view, errors, states } = harness({
      list: async () => ({ prompts: [prompt] }),
      dismiss: async () => {
        throw { message: "Server unreachable" }
      },
    })
    await view.load(["ses_child"])

    await view.dismiss("ses_child", "desktop-check")

    expect(errors).toEqual(["Server unreachable"])
    expect(states.at(-1)?.prompts[0]?.dismissedAt).toBeUndefined()
    view.dispose()
  })
})
