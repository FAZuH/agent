import { expect, test } from "bun:test"
import {
  createPromptView,
  type PromptDialogs,
  type PromptRPC,
  type PromptViewState,
} from "./gui-controller.ts"
import type { Prompt } from "./shared.ts"

const prompt: Prompt = {
  id: "desktop-check",
  sessionID: "ses_child",
  at: 1,
  title: "Which delivery?",
  description: "Desktop check",
  prompts: { questions: [{ title: "Which delivery?", body: "Choose a lane.", recommendation: "Queue" }] },
}

function harness(overrides: Partial<PromptRPC> = {}, dialogOverrides: Partial<PromptDialogs> = {}) {
  const states: PromptViewState[] = []
  const errors: string[] = []
  const rpc: PromptRPC = {
    list: async () => ({ prompts: [prompt] }),
    answer: async () => ({ ok: true, delivered: true }),
    dismiss: async () => ({ ok: true }),
    defer: async () => ({ ok: true }),
    subscribe: () => () => {},
    ...overrides,
  }
  const dialogs: PromptDialogs = {
    update: (state) => states.push(state),
    question: async () => "Use queue",
    delivery: async () => "steer",
    error: (message) => errors.push(message),
    ...dialogOverrides,
  }
  return { view: createPromptView(rpc, dialogs), states, errors }
}

test("loads the routed family and exposes loading then its prompts", async () => {
  const requests: string[][] = []
  const { view, states } = harness({
    list: async ({ sessionIDs }) => {
      requests.push(sessionIDs)
      return { prompts: [prompt] }
    },
  })

  await view.load(["ses_parent", "ses_child"])

  expect(requests).toEqual([["ses_parent", "ses_child"]])
  expect(states).toEqual([
    { prompts: [], loading: true },
    { prompts: [prompt], loading: false },
  ])
  view.dispose()
})

test("a failed list exposes an error and a later load can recover", async () => {
  let unavailable = true
  const { view, states } = harness({
    list: async () => {
      if (unavailable) throw new Error("Sidecar unavailable")
      return { prompts: [] }
    },
  })

  await view.load(["ses_parent"])
  expect(states.at(-1)).toEqual({ prompts: [], loading: false, error: "Sidecar unavailable" })
  unavailable = false
  await view.load(["ses_parent"])
  expect(states.at(-1)).toEqual({ prompts: [], loading: false })
  view.dispose()
})

test.each(["steer", "queue"] as const)(
  "sends a blank answer's recommendation with %s delivery",
  async (mode) => {
    const sent: unknown[] = []
    const { view } = harness(
      {
        answer: async (input) => {
          sent.push(input)
          return { ok: true, delivered: true }
        },
      },
      { question: async () => "  ", delivery: async () => mode },
    )

    await view.answer(prompt)

    expect(sent).toEqual([
      {
        sessionID: "ses_child",
        promptID: "desktop-check",
        answers: { "0": "Queue" },
        mode,
      },
    ])
    view.dispose()
  },
)

test.each(["question", "delivery"] as const)(
  "cancelling the %s defers without answering",
  async (cancelled) => {
    const sent: unknown[] = []
    const deferred: unknown[] = []
    const { view } = harness(
      {
        answer: async (input) => {
          sent.push(input)
          return { ok: true, delivered: true }
        },
        defer: async (input) => {
          deferred.push(input)
          return { ok: true }
        },
      },
      {
        question: async () => (cancelled === "question" ? undefined : "Queue"),
        delivery: async () => (cancelled === "delivery" ? undefined : "steer"),
      },
    )

    await view.answer(prompt)

    expect(sent).toEqual([])
    expect(deferred).toEqual([{ sessionID: "ses_child", promptID: "desktop-check" }])
    view.dispose()
  },
)

test.each(["answer", "dismiss", "defer"] as const)(
  "reports a failed %s without hiding it",
  async (action) => {
    const { view, errors } = harness(
      {
        answer: async () => ({ ok: true, delivered: false, error: "Delivery unavailable" }),
        dismiss: async () => ({ ok: false }),
        defer: async () => {
          throw new Error("Delivery unavailable")
        },
      },
      { question: async () => (action === "defer" ? undefined : "Queue") },
    )

    await (action === "dismiss" ? view.dismiss(prompt) : view.answer(prompt))

    expect(errors).toEqual([action === "dismiss" ? "Could not dismiss prompt" : "Delivery unavailable"])
    view.dispose()
  },
)

test("dismisses the selected prompt and refreshes its family", async () => {
  const dismissed: unknown[] = []
  let records = [prompt]
  const { view, states } = harness({
    list: async () => ({ prompts: records }),
    dismiss: async (input) => {
      dismissed.push(input)
      records = [{ ...prompt, dismissedAt: 2 }]
      return { ok: true }
    },
  })
  await view.load(["ses_child"])

  await view.dismiss(prompt)

  expect(dismissed).toEqual([{ sessionID: "ses_child", promptID: "desktop-check" }])
  expect(states.at(-1)?.prompts[0]?.dismissedAt).toBe(2)
  view.dispose()
})

test("family events refresh the view; unrelated events and disposed views do not", async () => {
  let changed: (event: { sessionID: string; prompt: Prompt }) => void = () => {}
  let unsubscribed = false
  const requests: string[][] = []
  const { view } = harness({
    list: async ({ sessionIDs }) => {
      requests.push(sessionIDs)
      return { prompts: [prompt] }
    },
    subscribe: (listener) => {
      changed = listener
      return () => {
        unsubscribed = true
      }
    },
  })
  await view.load(["ses_parent", "ses_child"])

  changed({ sessionID: "ses_fork", prompt })
  changed({ sessionID: "ses_child", prompt })
  view.dispose()
  changed({ sessionID: "ses_child", prompt })

  expect(requests).toEqual([
    ["ses_parent", "ses_child"],
    ["ses_parent", "ses_child"],
  ])
  expect(unsubscribed).toBe(true)
})

test("an old family request cannot replace the newly routed family", async () => {
  let finishOld: (value: { prompts: Prompt[] }) => void = () => {}
  const old = new Promise<{ prompts: Prompt[] }>((resolve) => {
    finishOld = resolve
  })
  const { view, states } = harness({
    list: async ({ sessionIDs }) => (sessionIDs[0] === "ses_old" ? old : { prompts: [] }),
  })
  const first = view.load(["ses_old"])
  await view.load(["ses_new"])

  finishOld({ prompts: [prompt] })
  await first

  expect(states.at(-1)).toEqual({ prompts: [], loading: false })
  view.dispose()
})
