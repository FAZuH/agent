/**
 * Self-check for the announce rules. No host and no network: the parsing,
 * target selection, and framing decide where each message goes and what it
 * says, so they hold up on their own.
 *
 *   bun test src/announce.test.ts
 */

import { describe, expect, test } from "bun:test"

import {
  activeSet,
  allSessions,
  deliverAll,
  descendants,
  formatAnnouncement,
  requireMessage,
  requireSession,
  runningIDs,
  targets,
  type SessionRow,
} from "./shared.ts"

describe("requireMessage", () => {
  test("returns the text after the command name", () => {
    expect(requireMessage("ship it")).toBe("ship it")
  })

  test("keeps inner spacing but drops outer whitespace", () => {
    expect(requireMessage("  ship   it  ")).toBe("ship   it")
  })

  test("throws a usage error for empty text", () => {
    expect(() => requireMessage("   ")).toThrow(/Usage:/)
  })
})

describe("requireSession", () => {
  test("returns the caller session id", () => {
    expect(requireSession("ses_caller")).toBe("ses_caller")
  })

  test("throws when the session id is absent", () => {
    expect(() => requireSession(undefined)).toThrow("announce failed: no session.")
  })

  test("throws when the session id is empty", () => {
    expect(() => requireSession("")).toThrow("announce failed: no session.")
  })
})

describe("activeSet", () => {
  test("unwraps data and keeps only running ids", () => {
    const raw = JSON.stringify({
      data: {
        ses_6f2a: { type: "running" },
        ses_9c11: { type: "running" },
        ses_dead: { type: "idle" },
      },
    })
    expect([...activeSet(raw, "", true)].sort()).toEqual(["ses_6f2a", "ses_9c11"])
  })

  test("accepts a root object with no data wrapper", () => {
    const raw = JSON.stringify({ ses_a1: { type: "running" } })
    expect([...activeSet(raw, "", true)]).toEqual(["ses_a1"])
  })

  test("throws with stderr when the lookup fails", () => {
    expect(() => activeSet("", "opencode2: connection refused", false)).toThrow(/connection refused/)
  })

  test("throws when stdout is not JSON", () => {
    expect(() => activeSet("not json", "", true)).toThrow(/invalid json/i)
  })
})

describe("runningIDs", () => {
  test("asks for the active endpoint and parses the result", async () => {
    const paths: string[] = []
    const set = await runningIDs(async (path) => {
      paths.push(path)
      return { stdout: JSON.stringify({ data: { ses_run1: { type: "running" } } }), stderr: "", ok: true }
    })
    expect(paths).toEqual(["/api/session/active"])
    expect([...set]).toEqual(["ses_run1"])
  })
})

const row = (id: string, parentID?: string): SessionRow => ({ id, parentID })

describe("descendants", () => {
  test("finds children and grandchildren", () => {
    const rows = [row("ses_root"), row("ses_a", "ses_root"), row("ses_b", "ses_a"), row("ses_c", "ses_root")]
    const found = descendants(rows, "ses_root")
    expect(found.map((r) => r.id)).toEqual(["ses_a", "ses_c", "ses_b"])
    expect(found.map((r) => r.depth)).toEqual([1, 1, 2])
  })

  test("leaves out unrelated sessions", () => {
    const rows = [row("ses_root"), row("ses_a", "ses_root"), row("ses_other", "ses_elsewhere")]
    expect(descendants(rows, "ses_root").map((r) => r.id)).toEqual(["ses_a"])
  })

  test("never returns the root itself", () => {
    const rows = [row("ses_root", "ses_parent"), row("ses_a", "ses_root")]
    expect(descendants(rows, "ses_root").map((r) => r.id)).toEqual(["ses_a"])
  })

  test("stops at a self-parent cycle", () => {
    expect(descendants([row("ses_loop", "ses_loop")], "ses_loop")).toEqual([])
  })
})

describe("targets", () => {
  const rows = [
    row("ses_caller"),
    row("ses_a", "ses_caller"),
    row("ses_b", "ses_a"),
    row("ses_c", "ses_caller"),
    row("ses_other", "ses_elsewhere"),
  ]

  test("global selects every running id, subagents included", () => {
    const running = new Set(["ses_a", "ses_other"])
    expect(targets("global", "ses_caller", running, rows)).toEqual(["ses_a", "ses_other"])
  })

  test("session selects the caller plus only running descendants", () => {
    const running = new Set(["ses_a", "ses_c", "ses_other"])
    expect(targets("session", "ses_caller", running, rows)).toEqual(["ses_caller", "ses_a", "ses_c"])
  })

  test("session keeps the caller even when it is not running", () => {
    expect(targets("session", "ses_caller", new Set(), rows)).toEqual(["ses_caller"])
  })

  test("global dedupes and drops empty ids", () => {
    const running = new Set(["ses_a", ""])
    expect(targets("global", "ses_caller", running, rows)).toEqual(["ses_a"])
  })
})

describe("formatAnnouncement", () => {
  test("prefixes the scope and caller and keeps the message", () => {
    expect(formatAnnouncement("global", "ses_caller", "ship it")).toBe("[announce global from ses_caller]\nship it")
  })

  test("keeps the message verbatim", () => {
    const framed = formatAnnouncement("session", "ses_9c11", "line one\nline [two]   ")
    expect(framed).toBe("[announce session from ses_9c11]\nline one\nline [two]   ")
  })
})

describe("allSessions", () => {
  test("pages through cursors and dedupes by id", async () => {
    const calls: Array<{ limit: number; cursor?: string }> = []
    const rows = await allSessions(async (input) => {
      calls.push(input)
      if (!input.cursor) return { data: [row("ses_1"), row("ses_2")], cursor: { next: "cur_2" } }
      return { data: [row("ses_2"), row("ses_3")], cursor: {} }
    })
    expect(rows.map((r) => r.id)).toEqual(["ses_1", "ses_2", "ses_3"])
    expect(calls).toEqual([
      { limit: 1000, cursor: undefined },
      { limit: 1000, cursor: "cur_2" },
    ])
  })

  test("unwraps a nested data shape", async () => {
    const rows = await allSessions(async () => ({ data: { data: [row("ses_x")], cursor: {} } }))
    expect(rows.map((r) => r.id)).toEqual(["ses_x"])
  })

  test("stops when the next cursor repeats", async () => {
    let calls = 0
    const rows = await allSessions(async () => {
      calls++
      return { data: [row(`ses_${calls}`)], cursor: { next: "same" } }
    })
    expect(rows.map((r) => r.id)).toEqual(["ses_1", "ses_2"])
    expect(calls).toBe(2)
  })
})

describe("deliverAll", () => {
  test("sends the framed text to every target", async () => {
    const calls: Array<[string, string]> = []
    await deliverAll("hello", ["ses_a", "ses_b"], async (id, text) => {
      calls.push([id, text])
    })
    expect(calls).toEqual([
      ["ses_a", "hello"],
      ["ses_b", "hello"],
    ])
  })

  test("throws one error naming a failed id without blocking the others", async () => {
    const calls: string[] = []
    await expect(
      deliverAll("hello", ["ses_a", "ses_b", "ses_c"], async (id) => {
        calls.push(id)
        if (id === "ses_b") throw new Error("dead session")
      }),
    ).rejects.toThrow(/ses_b/)
    expect(calls).toEqual(["ses_a", "ses_b", "ses_c"])
  })
})
