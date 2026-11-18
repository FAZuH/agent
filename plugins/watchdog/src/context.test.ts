/**
 * Self-check for the history snapshot. Pure: no state files, no network, no ctx.
 *
 *   bun test plugins/watchdog/src/context.test.ts
 */

import { afterEach, describe, expect, test } from "bun:test"
import {
  MAX_SNAPSHOT_BYTES,
  MAX_SNAPSHOT_ENTRIES,
  buildSnapshot,
  clearSnapshotCache,
  snapshotFor,
  snapshotIsUsable,
} from "./context.ts"

afterEach(() => clearSnapshotCache())

const user = (text: string, id = "m1") => ({ id, role: "user", content: text })
const bytes = (text: string) => new TextEncoder().encode(text).length

describe("shape variants", () => {
  test("accepts a bare array of messages", () => {
    const snap = buildSnapshot([user("hello", "m1"), { id: "m2", role: "assistant", content: "hi" }])
    expect(snap.complete).toBe(true)
    expect(snap.seen).toBe(2)
    expect(snap.entries.map((e) => e.text)).toEqual(["hello", "hi"])
    expect(snap.entries.map((e) => e.role)).toEqual(["user", "assistant"])
  })

  test("accepts {messages: [...]}", () => {
    const snap = buildSnapshot({ messages: [user("wrapped", "w1")], other: 1 })
    expect(snap.complete).toBe(true)
    expect(snap.entries[0].text).toBe("wrapped")
    expect(snap.entries[0].id).toBe("w1")
  })

  test("accepts {parts: [...]}, including bare string parts", () => {
    const snap = buildSnapshot({ parts: ["a", "b"] })
    expect(snap.entries.map((e) => e.text)).toEqual(["a", "b"])
  })
})

describe("bounds", () => {
  test("bounds total bytes and marks the snapshot bounded", () => {
    const raw = Array.from({ length: 10 }, (_, i) => user("x".repeat(2000), `m${i}`))
    const snap = buildSnapshot(raw)
    const total = snap.entries.reduce((n, e) => n + bytes(e.text), 0)
    expect(total).toBeLessThanOrEqual(MAX_SNAPSHOT_BYTES)
    expect(snap.bounded).toBe(true)
    expect(snap.entries.length).toBeLessThan(10)
  })

  test("bounds the entry count", () => {
    const raw = Array.from({ length: MAX_SNAPSHOT_ENTRIES + 10 }, (_, i) => user(`m${i}`, `id${i}`))
    const snap = buildSnapshot(raw)
    expect(snap.entries.length).toBeLessThanOrEqual(MAX_SNAPSHOT_ENTRIES)
    expect(snap.bounded).toBe(true)
  })

  test("keeps the newest messages when over the count bound", () => {
    const raw = Array.from({ length: MAX_SNAPSHOT_ENTRIES + 5 }, (_, i) => user(`m${i}`, `id${i}`))
    const snap = buildSnapshot(raw)
    expect(snap.entries[snap.entries.length - 1].text).toBe(`m${MAX_SNAPSHOT_ENTRIES + 4}`)
  })

  test("retains system entries (inherited parent restrictions) across truncation", () => {
    const raw = [
      { role: "system", content: "PARENT RESTRICTION: no network" },
      ...Array.from({ length: MAX_SNAPSHOT_ENTRIES + 5 }, (_, i) => user(`m${i}`, `id${i}`)),
    ]
    const snap = buildSnapshot(raw)
    expect(snap.bounded).toBe(true)
    expect(snap.entries.some((e) => e.role === "system" && e.text.includes("PARENT RESTRICTION"))).toBe(true)
  })
})

describe("redaction", () => {
  test("redacts tokens, keys, passwords and auth headers but keeps role and provenance", () => {
    const text = "api_key=sk-abcdefghijklmnopqrstuvwxyz Authorization: Bearer abcdefghijklmnop1234 password: hunter2"
    const snap = buildSnapshot([user(text, "secret-msg")])
    const out = snap.entries[0].text
    expect(out).not.toContain("sk-abcdefghijklmnopqrstuvwxyz")
    expect(out).not.toContain("abcdefghijklmnop1234")
    expect(out).not.toContain("hunter2")
    expect(out).toContain("[redacted")
    expect(snap.entries[0].role).toBe("user")
    expect(snap.entries[0].id).toBe("secret-msg")
  })

  test("Bearer/Basic redaction leaves a clean marker and preserves the scheme", () => {
    const text = "client sent Bearer abcdefghijklmnopqrstuvwxyz then Basic ZXhhbXBsZTpzZWNyZXQxMjM0"
    const snap = buildSnapshot([user(text, "auth-msg")])
    const out = snap.entries[0].text
    expect(out).not.toContain("$1")
    expect(out).toContain("Bearer [redacted:token]")
    expect(out).toContain("Basic [redacted:token]")
    expect(out).not.toContain("abcdefghijklmnopqrstuvwxyz")
    expect(out).not.toContain("ZXhhbXBsZTpzZWNyZXQxMjM0")
  })
})

describe("enriched input", () => {
  test("keeps tool-labelled text for context entries that carry tool input", () => {
    const raw = [
      {
        id: "m1",
        role: "assistant",
        parts: [
          { type: "text", text: "I will check the build." },
          { type: "tool", name: "bash", state: { input: { command: "npm run build" }, output: "build ok" } },
        ],
      },
    ]
    const snap = buildSnapshot(raw)
    expect(snap.complete).toBe(true)
    const text = snap.entries[0].text
    expect(text).toContain("[tool:bash]")
    expect(text).toContain("npm run build")
    expect(text).toContain("build ok")
    expect(text).toContain("I will check the build.")
    expect(buildSnapshot({ unexpected: true }).complete).toBe(false)
  })
})

describe("role labels", () => {
  test("labels roles from role, info.role, type, and tool parts", () => {
    const raw = [
      { role: "user", content: "u" },
      { info: { role: "assistant" }, content: "a" },
      { role: "tool", content: "t" },
      { role: "system", content: "s" },
      { type: "tool", parts: [{ type: "tool", state: { output: "tool-out" } }] },
      { content: "?", foo: 1 },
    ]
    const snap = buildSnapshot(raw)
    expect(snap.entries.map((e) => e.role)).toEqual(["user", "assistant", "tool", "system", "tool", "unknown"])
    expect(snap.entries.some((e) => e.text.includes("tool-out"))).toBe(true)
  })
})

describe("incomplete marker", () => {
  test("marks unrecognised shapes incomplete rather than silently empty", () => {
    for (const raw of [undefined, null, 42, "text", { foo: 1 }]) {
      const snap = buildSnapshot(raw)
      expect(snap.complete).toBe(false)
      expect(typeof snap.incomplete).toBe("string")
      expect(snap.entries).toEqual([])
    }
  })

  test("an empty array is complete, not incomplete", () => {
    const snap = buildSnapshot([])
    expect(snap.complete).toBe(true)
    expect(snap.entries).toEqual([])
  })
})

describe("cache", () => {
  test("reuses the snapshot for the same session and revision", () => {
    const a = snapshotFor("ses_1", [user("one", "m1")])
    const b = snapshotFor("ses_1", [user("one", "m1")])
    expect(b).toBe(a)
  })

  test("an edit to an existing message invalidates the cache", () => {
    const a = snapshotFor("ses_1", [user("one", "m1"), user("two", "m2")])
    const b = snapshotFor("ses_1", [user("ONE EDITED", "m1"), user("two", "m2")])
    expect(b).not.toBe(a)
    expect(b.entries[0].text).toBe("ONE EDITED")
  })

  test("misses when the message count, last id, or session changes", () => {
    const a = snapshotFor("ses_1", [user("one", "m1")])
    const b = snapshotFor("ses_1", [user("one", "m1"), user("two", "m2")])
    const c = snapshotFor("ses_1", [user("one", "m9")])
    const d = snapshotFor("ses_2", [user("one", "m1")])
    expect(b).not.toBe(a)
    expect(c).not.toBe(a)
    expect(d).not.toBe(a)
  })

  test("clearSnapshotCache forces a rebuild", () => {
    const a = snapshotFor("ses_1", [user("one", "m1")])
    clearSnapshotCache()
    const b = snapshotFor("ses_1", [user("one", "m1")])
    expect(b).not.toBe(a)
  })
})

describe("snapshotIsUsable", () => {
  test("true only for a complete snapshot that has entries", () => {
    expect(snapshotIsUsable(buildSnapshot([user("hello", "m1")]))).toBe(true)
    expect(snapshotIsUsable(buildSnapshot([]))).toBe(false)
    expect(snapshotIsUsable(buildSnapshot(undefined))).toBe(false)
    expect(snapshotIsUsable(buildSnapshot([{ role: "user", content: "" }]))).toBe(false)
  })
})
