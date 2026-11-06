import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { copyAnswer, createHandlers, type Host } from "./handlers.ts"
import { readTarget, writeTarget, type Target } from "./state.ts"

const roots: string[] = []
const makeRoot = () => {
  const root = mkdtempSync(join(tmpdir(), "desktop-ask-handlers-"))
  roots.push(root)
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function makeHost(overrides: Partial<Host> = {}) {
  const root = makeRoot()
  const prompts: any[] = []
  const copies: string[] = []
  const sessions = new Map([
    ["ses_target", { title: "Game help", directory: "/tmp/target-project" }],
    ["ses_other", { title: "Other", directory: "/tmp/other-project" }],
  ])
  const promptTime = Date.parse("2026-11-06T00:00:00.100Z")
  const host: Host = {
    root,
    now: () => new Date("2026-11-06T00:00:00.000Z"),
    directory: "/tmp/project",
    capture: () => ({ ok: true, path: join(root, "shots", "1.png") }),
    activeWindow: () => "Brave - Inbox",
    session: async (id) => sessions.get(id),
    prompt: async (input) => {
      prompts.push(input)
      return { id: "msg_prompt", created: promptTime }
    },
    status: async () => ({ busy: false, idleAt: promptTime + 900 }),
    context: async () => [
      {
        type: "assistant",
        time: { created: promptTime + 800 },
        content: [{ type: "text", text: "<copy>the answer</copy>" }],
      },
    ],
    copy: (value) => {
      copies.push(value)
      return true
    },
    copyPollMs: 1,
    copyTimeoutMs: 200,
    ...overrides,
  }
  return { host, root, prompts, copies, sessions, promptTime }
}

describe("arm", () => {
  test("stores one target and names it as the only target", async () => {
    const { host, root } = makeHost()
    const handlers = createHandlers(host)
    const result = await handlers.arm({ sessionID: "ses_target", instruction: "Tell me the selected enemy." })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.text).toContain("the only target")
    expect(readTarget(root)?.sessionID).toBe("ses_target")
    expect(readTarget(root)?.delivery).toBe("queue")
    expect(readTarget(root)?.directory).toBe("/tmp/target-project")
  })

  test("re-arming another session replaces the target and resets the count", async () => {
    const { host, root } = makeHost()
    const handlers = createHandlers(host)
    await handlers.arm({ sessionID: "ses_target", instruction: "first" })
    writeTarget({ ...(readTarget(root) as Target), triggers: 4 }, root)
    await handlers.arm({ sessionID: "ses_other", instruction: "second" })
    const target = readTarget(root)
    expect(target?.sessionID).toBe("ses_other")
    expect(target?.triggers).toBe(0)
  })

  test("rejects an empty instruction", async () => {
    const { host } = makeHost()
    const result = await createHandlers(host).arm({ sessionID: "ses_target", instruction: " " })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.type).toBe("invalid_instruction")
  })

  test("rejects a session that does not exist", async () => {
    const { host } = makeHost()
    const result = await createHandlers(host).arm({ sessionID: "ses_missing", instruction: "look" })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.type).toBe("no_session")
  })
})

describe("trigger", () => {
  const arm = async (host: Host) => {
    const handlers = createHandlers(host)
    const result = await handlers.arm({ sessionID: "ses_target", instruction: "Tell me the selected enemy." })
    expect(result.ok).toBe(true)
    return handlers
  }

  test("refuses when nothing is armed", async () => {
    const { host } = makeHost()
    const result = await createHandlers(host).trigger({})
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.type).toBe("not_armed")
  })

  test("sends the capture as a file attachment and increments the count", async () => {
    const { host, root, prompts } = makeHost()
    const handlers = await arm(host)
    const result = await handlers.trigger({ source: "keybind" })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.trigger).toBe(1)
    expect(result.value.delivery).toBe("queue")
    expect(prompts.length).toBe(1)
    expect(prompts[0].files[0].uri.startsWith("file://")).toBe(true)
    expect(prompts[0].files[0].uri.endsWith("/shots/1.png")).toBe(true)
    expect(prompts[0].text).toContain("<instruction>\nTell me the selected enemy.\n</instruction>")
    expect(prompts[0].text).toContain("Active window: Brave - Inbox")
    expect(readTarget(root)?.triggers).toBe(1)
  })

  test("uses a one-off instruction and delivery without changing the armed ones", async () => {
    const { host, root, prompts } = makeHost()
    const handlers = await arm(host)
    const result = await handlers.trigger({ ask: "Read the error line.", delivery: "steer" })
    expect(result.ok).toBe(true)
    expect(prompts[0].text).toContain("Read the error line.")
    expect(prompts[0].text).toContain("(This instruction applies to this trigger only.)")
    expect(prompts[0].delivery).toBe("steer")
    expect(readTarget(root)?.instruction).toBe("Tell me the selected enemy.")
    expect(readTarget(root)?.delivery).toBe("queue")
  })

  test("capture failure sends nothing", async () => {
    const { host, root, prompts } = makeHost({ capture: () => ({ ok: false, error: "grim failed" }) })
    const handlers = await arm(host)
    const result = await handlers.trigger({})
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.type).toBe("capture_failed")
    expect(prompts.length).toBe(0)
    expect(readTarget(root)?.triggers).toBe(0)
  })

  test("prompt failure keeps the count", async () => {
    const { host, root } = makeHost({
      prompt: async () => {
        throw new Error("session busy")
      },
    })
    const handlers = await arm(host)
    const result = await handlers.trigger({})
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.type).toBe("prompt_failed")
    expect(readTarget(root)?.triggers).toBe(0)
  })

  test("a gone target is cleared", async () => {
    const { host, root } = makeHost()
    const handlers = await arm(host)
    host.session = async () => undefined
    const result = await handlers.trigger({})
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.type).toBe("no_session")
    expect(readTarget(root)).toBeUndefined()
  })
})

describe("status and disarm", () => {
  test("report the target until it is cleared", async () => {
    const { host } = makeHost()
    const handlers = createHandlers(host)
    expect(handlers.status().ok).toBe(true)
    await handlers.arm({ sessionID: "ses_target", instruction: "look" })
    const status = handlers.status()
    expect(status.ok).toBe(true)
    if (!status.ok) return
    expect(status.value.target?.sessionID).toBe("ses_target")
    expect(handlers.disarm().ok).toBe(true)
    const cleared = handlers.status()
    expect(cleared.ok).toBe(true)
    if (!cleared.ok) return
    expect(cleared.value.target).toBeUndefined()
  })
})

describe("copy the answer", () => {
  test("waits for a busy turn to end, then copies the tagged text", async () => {
    let calls = 0
    const { host, copies, promptTime } = makeHost()
    host.status = async () => ({ busy: ++calls < 3, idleAt: promptTime + 900 })
    const result = await copyAnswer(host, "ses_target", promptTime)
    expect(result.ok).toBe(true)
    expect(copies).toEqual(["the answer"])
    expect(calls).toBe(3)
  })

  test("does not copy an answer from before the prompt", async () => {
    const { host, copies, promptTime } = makeHost()
    host.context = async () => [
      { type: "assistant", time: { created: promptTime - 500 }, content: [{ type: "text", text: "old" }] },
    ]
    const result = await copyAnswer(host, "ses_target", promptTime)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.type).toBe("timeout")
    expect(copies).toEqual([])
  })

  test("reports a clipboard that took nothing", async () => {
    const { host, promptTime } = makeHost()
    host.copy = () => false
    const result = await copyAnswer(host, "ses_target", promptTime)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.type).toBe("copy_failed")
  })

  test("trigger starts the copy in the background", async () => {
    const { host, copies } = makeHost()
    const handlers = createHandlers(host)
    await handlers.arm({ sessionID: "ses_target", instruction: "look" })
    const result = await handlers.trigger({})
    expect(result.ok).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(copies).toEqual(["the answer"])
  })

  test("trigger with copy false leaves the clipboard alone", async () => {
    const { host, copies } = makeHost()
    const handlers = createHandlers(host)
    await handlers.arm({ sessionID: "ses_target", instruction: "look" })
    const result = await handlers.trigger({ copy: false })
    expect(result.ok).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(copies).toEqual([])
  })
})
