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
    reopen: async () => ({ ok: true }),
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

test("a family larger than the contract limit is loaded in batches", async () => {
  const sizes: number[] = []
  const { view, states } = harness({
    list: async ({ sessionIDs }) => {
      sizes.push(sessionIDs.length)
      return { prompts: [] }
    },
  })
  const ids = Array.from({ length: 250 }, (_, i) => `ses_${i}`).concat("ses_0")

  await view.load(ids)

  expect(sizes).toEqual([200, 50])
  expect(states.at(-1)).toEqual({ prompts: [], loading: false })
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

test("reopen sends the selected prompt id and refreshes the family", async () => {
  const sent: unknown[] = []
  let records = [prompt]
  const { view, states } = harness({
    list: async () => ({ prompts: records }),
    reopen: async (input) => {
      sent.push(input)
      records = [{ ...prompt, answeredAt: 2 }]
      return { ok: true }
    },
  })
  await view.load(["ses_child"])

  await view.reopen("ses_child", "desktop-check")

  expect(sent).toEqual([{ sessionID: "ses_child", promptID: "desktop-check" }])
  expect(states.at(-1)?.prompts[0]?.answeredAt).toBe(2)
  view.dispose()
})

test("reopen without a prompt id asks the server for the latest", async () => {
  const sent: unknown[] = []
  const { view } = harness({
    reopen: async (input) => {
      sent.push(input)
      return { ok: true }
    },
  })

  await view.reopen("ses_child")

  expect(sent).toEqual([{ sessionID: "ses_child", promptID: undefined }])
  view.dispose()
})

test.each([
  ["a returned reason", async () => ({ ok: false as const, reason: "Already answered" }), "Already answered"],
  ["a thrown object", async () => { throw { message: "Server unreachable" } }, "Server unreachable"],
] as const)("reopen reports %s", async (_name, reopen, expected) => {
  const { view, errors } = harness({ reopen })

  await view.reopen("ses_child", "desktop-check")

  expect(errors).toEqual([expected])
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
