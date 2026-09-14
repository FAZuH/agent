import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { appendMessage, removeBlock, upsertTailBlock } from "./core.ts"
import { phaseOf } from "./index.ts"

const assistant = (parts: any[], completed?: number) => ({
  type: "assistant",
  time: { completed },
  content: parts,
})

describe("phaseOf", () => {
  const done = Date.now()

  test("open tool call wins (most recent part is current activity)", () => {
    const msgs = [assistant([{ type: "reasoning", text: "hmm" }, { type: "tool", name: "bash", state: { status: "running" } }])]
    expect(phaseOf(msgs)).toBe("Running tool: bash")
  })

  test("finished tool with no successor → Working…", () => {
    const msgs = [assistant([{ type: "tool", name: "bash", state: { status: "completed" } }])]
    expect(phaseOf(msgs)).toBe("Working…")
  })

  test("streaming reasoning → Thinking… (even with older finished tool parts)", () => {
    const msgs = [assistant([
      { type: "tool", name: "bash", state: { status: "completed" } },
      { type: "reasoning", text: "let me think" },
    ])]
    expect(phaseOf(msgs)).toBe("Thinking…")
  })

  test("streaming text → Writing… (reasoning part lingers after it ends)", () => {
    const msgs = [assistant([
      { type: "reasoning", text: "done thinking" },
      { type: "text", text: "partial answer" },
    ])]
    expect(phaseOf(msgs)).toBe("Writing…")
  })

  test("completed message → Working… regardless of parts", () => {
    const msgs = [assistant([{ type: "text", text: "all done" }], done)]
    expect(phaseOf(msgs)).toBe("Working…")
  })

  test("no assistant message (only the user prompt so far) → Working…", () => {
    expect(phaseOf([{ type: "user", content: [{ type: "text", text: "hi" }] }])).toBe("Working…")
    expect(phaseOf([])).toBe("Working…")
  })
})

describe("removeBlock / upsertTailBlock", () => {
  const dir = mkdtempSync(join(tmpdir(), "md-link-"))
  const file = join(dir, "mirror.md")
  const block = (key: string, text: string) => appendMessage(file, { text, markerKey: key }, null)

  test("tail upsert writes once and no-ops on unchanged text", () => {
    writeFileSync(file, "", "utf-8")
    expect(block("msg_1", "first reply")).toBe("written")
    expect(upsertTailBlock(file, { text: "> [!info] ⏳ Thinking…", markerKey: "thinking" }, null)).toBe("written")
    expect(upsertTailBlock(file, { text: "> [!info] ⏳ Thinking…", markerKey: "thinking" }, null)).toBe("duplicate")
    expect(upsertTailBlock(file, { text: "> [!info] ⏳ Running tool: bash", markerKey: "thinking" }, null)).toBe("updated")
    const c = readFileSync(file, "utf-8")
    expect(c.includes("> [!info] ⏳ Running tool: bash")).toBe(true)
    expect(c.trimEnd().endsWith("> [!info] ⏳ Running tool: bash")).toBe(true)
    expect(c.includes("first reply")).toBe(true)
  })

  test("repositions to tail after a QA block appended mid-run", () => {
    expect(block("qa-ask-1", "> [!question] Quiz")).toBe("written")
    expect(upsertTailBlock(file, { text: "> [!info] ⏳ Thinking…", markerKey: "thinking" }, null)).toBe("written")
    const c = readFileSync(file, "utf-8")
    expect(c.indexOf("> [!question] Quiz")).toBeLessThan(c.indexOf("⏳ Thinking…"))
    expect(c.trimEnd().endsWith("> [!info] ⏳ Thinking…")).toBe(true)
  })

  test("removeBlock drops exactly its key, returns false when absent", () => {
    expect(removeBlock(file, "thinking")).toBe(true)
    expect(removeBlock(file, "thinking")).toBe(false)
    const c = readFileSync(file, "utf-8")
    expect(c.includes("Thinking…")).toBe(false)
    expect(c.includes("first reply")).toBe(true)
    expect(c.includes("> [!question] Quiz")).toBe(true)
  })

  afterAll(() => rmSync(dir, { recursive: true, force: true }))
})
