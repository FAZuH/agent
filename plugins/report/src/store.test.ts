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
const report = (id: string, sessionID = "ses_1", at = 1) =>
  ({ id, kind: "post-task", sessionID, at, title: id }) as const

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "report-store-"))
  process.env.REPORT_STATE_HOME = dir
  store = await import("./store.ts")
})

afterAll(() => {
  delete process.env.REPORT_STATE_HOME
  rmSync(dir, { recursive: true, force: true })
})

describe("appendReport / readReports", () => {
  test("round-trips and caps the list", () => {
    for (let index = 1; index <= 5; index++) store.appendReport(report(`r${index}`), 3)
    expect(store.readReports("ses_1").map((item) => item.id)).toEqual(["r3", "r4", "r5"])
  })

  test("a broken file reads as empty", () => {
    writeFileSync(join(store.REPORTS_DIR, "ses_bad.json"), "{not json")
    expect(store.readReports("ses_bad")).toEqual([])
  })

  test("an unsafe session id writes nothing", () => {
    expect(() => store.appendReport(report("r1", "../../escape"))).toThrow()
    expect(store.readReports("../../escape")).toEqual([])
  })

  test("a foreign record is dropped on read", () => {
    writeFileSync(
      join(store.REPORTS_DIR, "ses_mixed.json"),
      JSON.stringify([report("ok"), { id: "bad", kind: "other" }]),
    )
    expect(store.readReports("ses_mixed").map((item) => item.id)).toEqual(["ok"])
  })

  test("updateReport patches one record in place", () => {
    store.appendReport(report("u1", "ses_u", 1))
    store.appendReport(report("u2", "ses_u", 2))
    const updated = store.updateReport("ses_u", "u1", (item) => ({ ...item, title: "patched" }))
    expect(updated?.title).toBe("patched")
    expect(store.readReports("ses_u").map((item) => item.title)).toEqual(["patched", "u2"])
    expect(store.updateReport("ses_u", "missing", (item) => item)).toBeUndefined()
  })

  test("readMany merges sessions oldest first and caps the view", () => {
    store.appendReport(report("a1", "ses_a", 1))
    store.appendReport(report("a2", "ses_a", 3))
    store.appendReport(report("b1", "ses_b", 2))
    expect(store.readMany(["ses_a", "ses_b"]).map((item) => item.id)).toEqual(["a1", "b1", "a2"])
    expect(store.readMany(["ses_a", "ses_b"], 2).map((item) => item.id)).toEqual(["b1", "a2"])
  })

  test("the file is written whole, never left half-written", () => {
    store.appendReport(report("atomic"))
    const raw = readFileSync(join(store.REPORTS_DIR, "ses_1.json"), "utf8")
    expect(() => JSON.parse(raw)).not.toThrow()
  })
})
