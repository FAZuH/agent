/**
 * Self-check for report batching. The window is the point: several forks
 * finishing together must wake the asking session once, with every report's
 * tags intact.
 *
 *   bun test src/queue.test.ts
 */

import { describe, expect, test } from "bun:test"

import { createReportBatcher } from "./queue.ts"

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const recorder = () => {
  const calls: { parentID: string; text: string }[] = []
  return {
    calls,
    deliver: (parentID: string, text: string) => {
      calls.push({ parentID, text })
    },
  }
}

describe("report batching", () => {
  test("a zero window delivers each report immediately", () => {
    const seen = recorder()
    const batcher = createReportBatcher(seen.deliver, () => 0)
    batcher.push("ses_parent", "<branch>one</branch>")
    batcher.push("ses_parent", "<branch>two</branch>")
    expect(seen.calls).toHaveLength(2)
    expect(batcher.size()).toBe(0)
  })

  test("reports inside the window leave as one prompt, in order", async () => {
    const seen = recorder()
    const batcher = createReportBatcher(seen.deliver, () => 20)
    batcher.push("ses_parent", "<branch>one</branch>")
    batcher.push("ses_parent", "<branch>two</branch>")
    expect(seen.calls).toHaveLength(0)
    expect(batcher.size()).toBe(1)
    await wait(60)
    expect(seen.calls).toHaveLength(1)
    expect(seen.calls[0]).toEqual({
      parentID: "ses_parent",
      text: "<branch>one</branch>\n\n<branch>two</branch>",
    })
    expect(batcher.size()).toBe(0)
  })

  test("different parents keep separate batches", async () => {
    const seen = recorder()
    const batcher = createReportBatcher(seen.deliver, () => 20)
    batcher.push("ses_a", "a1")
    batcher.push("ses_b", "b1")
    batcher.push("ses_a", "a2")
    await wait(60)
    expect(seen.calls).toHaveLength(2)
    expect(seen.calls.map((call) => call.parentID).sort()).toEqual(["ses_a", "ses_b"])
    expect(seen.calls.find((call) => call.parentID === "ses_a")?.text).toBe("a1\n\na2")
  })
})
