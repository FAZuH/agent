/**
 * The file store: one JSON file per session, capped, atomic, and safe against
 * a session id that would escape the state directory.
 *
 *   bun test src/store.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

let dir: string
let store: typeof import("./store.ts")
const prompt = (id: string, sessionID = "ses_1", at = 1) => ({ id, sessionID, at, title: id })

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "prompt-store-"))
  process.env.OPENCODE_PROMPT_STATE_HOME = dir
  store = await import("./store.ts")
})

afterAll(() => {
  delete process.env.OPENCODE_PROMPT_STATE_HOME
  rmSync(dir, { recursive: true, force: true })
})

describe("appendPrompt / readPrompts", () => {
  test("round-trips and caps the list", () => {
    for (let index = 1; index <= 5; index++) store.appendPrompt(prompt(`p${index}`), 3)
    expect(store.readPrompts("ses_1").map((item) => item.id)).toEqual(["p3", "p4", "p5"])
  })

  test("a broken file reads as empty", () => {
    writeFileSync(join(store.PROMPTS_DIR, "ses_bad.json"), "{not json")
    expect(store.readPrompts("ses_bad")).toEqual([])
  })

  test("an unsafe session id writes nothing", () => {
    expect(() => store.appendPrompt(prompt("p1", "../../escape"))).toThrow()
    expect(store.readPrompts("../../escape")).toEqual([])
  })

  test("a foreign record is dropped on read", () => {
    writeFileSync(
      join(store.PROMPTS_DIR, "ses_mixed.json"),
      JSON.stringify([prompt("ok"), { id: "bad" }]),
    )
    expect(store.readPrompts("ses_mixed").map((item) => item.id)).toEqual(["ok"])
  })

  test("updatePrompt patches one record in place", () => {
    store.appendPrompt(prompt("u1", "ses_u", 1))
    store.appendPrompt(prompt("u2", "ses_u", 2))
    const updated = store.updatePrompt("ses_u", "u1", (item) => ({ ...item, title: "patched" }))
    expect(updated?.title).toBe("patched")
    expect(store.readPrompts("ses_u").map((item) => item.title)).toEqual(["patched", "u2"])
    expect(store.updatePrompt("ses_u", "missing", (item) => item)).toBeUndefined()
  })

  test("claimPrompt wins once and then refuses", () => {
    store.appendPrompt(prompt("c1", "ses_c", 1))
    const taken = (item: any) => Boolean(item.answeredAt)
    const claim = () =>
      store.claimPrompt("ses_c", "c1", taken, (item) => ({ ...item, answeredAt: 7 }))
    expect(claim()?.answeredAt).toBe(7)
    expect(claim()).toBeUndefined()
    expect(store.readPrompts("ses_c")[0]?.answeredAt).toBe(7)
    expect(store.claimPrompt("ses_c", "missing", taken, (item) => item)).toBeUndefined()
  })

  test("readMany merges sessions oldest first and caps the view", () => {
    store.appendPrompt(prompt("a1", "ses_a", 1))
    store.appendPrompt(prompt("a2", "ses_a", 3))
    store.appendPrompt(prompt("b1", "ses_b", 2))
    expect(store.readMany(["ses_a", "ses_b"]).map((item) => item.id)).toEqual(["a1", "b1", "a2"])
    expect(store.readMany(["ses_a", "ses_b"], 2).map((item) => item.id)).toEqual(["b1", "a2"])
  })

  test("the file is written whole, never left half-written", () => {
    store.appendPrompt(prompt("atomic"))
    const raw = readFileSync(join(store.PROMPTS_DIR, "ses_1.json"), "utf8")
    expect(() => JSON.parse(raw)).not.toThrow()
  })
})
