import { describe, expect, test } from "bun:test"

import { answerFrom, clip, textOf } from "./answer.ts"

const assistant = (created: number, text: string, extra: any[] = []) => ({
  type: "assistant",
  time: { created },
  content: [...extra, { type: "text", text }],
})

describe("textOf", () => {
  test("joins text parts and drops reasoning and tools", () => {
    const message = {
      type: "assistant",
      content: [
        { type: "reasoning", text: "thinking" },
        { type: "text", text: "first" },
        { type: "tool", text: "not text" },
        { type: "text", text: "second" },
      ],
    }
    expect(textOf(message)).toBe("first\nsecond")
  })
})

describe("answerFrom", () => {
  const since = 1000

  test("ignores the previous turn", () => {
    const messages = [assistant(900, "old answer")]
    expect(answerFrom(messages, since)).toBeUndefined()
  })

  test("takes the newest answer after the prompt", () => {
    const messages = [assistant(1100, "draft"), assistant(1200, "final"), { type: "user", time: { created: 1050 } }]
    expect(answerFrom(messages, since)).toBe("final")
  })

  test("ignores idle markers and non-array input", () => {
    expect(answerFrom([{ type: "idle", time: { created: 1300 } }], since)).toBeUndefined()
    expect(answerFrom(undefined, since)).toBeUndefined()
  })

  test("strips the copy block", () => {
    const messages = [assistant(1100, "Here:\n<copy>the thing</copy>\n\nCompleted: x")]
    expect(answerFrom(messages, since)).toBe("the thing")
  })
})

describe("clip", () => {
  test("returns the whole reply when there is no copy block", () => {
    expect(clip("READY".trim())).toBe("READY")
  })

  test("takes the first block", () => {
    expect(clip("<copy>one</copy> <copy>two</copy>")).toBe("one")
  })

  test("survives a multiline block", () => {
    expect(clip("<copy>\nline a\nline b\n</copy>")).toBe("line a\nline b")
  })
})
