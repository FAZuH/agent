/**
 * Self-check for the tell rules. No host and no network: the point is that
 * the parsing, the tree walk, and the filter hold up on their own, because
 * those three decide where a message goes and what it says.
 *
 *   bun test src/tell.test.ts
 */

import { describe, expect, test } from "bun:test"

import { argsOf, descendants, filterRows, isDescendant, parseTarget, trigger, type SessionRow } from "./shared.ts"

const row = (id: string, parentID?: string, title?: string, agent?: string): SessionRow => ({ id, parentID, title, agent })

describe("parseTarget", () => {
  test("splits the target from the message", () => {
    const parsed = parseTarget("ses_child do the thing")
    expect(parsed.target).toBe("ses_child")
    expect(parsed.message).toBe("do the thing")
    expect(parsed.error).toBeUndefined()
  })

  test("keeps a flag out of the target", () => {
    const parsed = parseTarget("--queue ses_child do the thing")
    expect(parsed.target).toBe("ses_child")
    expect(parsed.message).toBe("do the thing")
    expect(parsed.delivery).toBe("queue")
  })

  test("reads the steer flag", () => {
    expect(parseTarget("--steer ses_child hello").delivery).toBe("steer")
  })

  test("a flag that is not the first token is part of the message", () => {
    const parsed = parseTarget("ses_child --queue hello")
    expect(parsed.target).toBe("ses_child")
    expect(parsed.message).toBe("--queue hello")
    expect(parsed.delivery).toBeUndefined()
  })

  test("a message with no target is a usage error", () => {
    expect(parseTarget("").error).toBeTruthy()
    expect(parseTarget("ses_child").error).toBeTruthy()
  })

  test("a target with no message is a usage error", () => {
    expect(parseTarget("ses_child   ").error).toBeTruthy()
  })

  test("a flag with no message is still a usage error", () => {
    expect(parseTarget("--queue ses_child").error).toBeTruthy()
  })
})

describe("descendants", () => {
  test("finds the children and the grandchildren", () => {
    const rows = [row("ses_root"), row("ses_a", "ses_root"), row("ses_b", "ses_a"), row("ses_c", "ses_root")]
    const found = descendants(rows, "ses_root")
    expect(found.map((r) => r.id)).toEqual(["ses_a", "ses_b", "ses_c"])
    expect(found.map((r) => r.depth)).toEqual([1, 2, 1])
  })

  test("leaves out the sessions that are not under the root", () => {
    const rows = [row("ses_root"), row("ses_other", "ses_elsewhere"), row("ses_a", "ses_root")]
    expect(descendants(rows, "ses_root").map((r) => r.id)).toEqual(["ses_a"])
  })

  test("the root itself is not a descendant of itself", () => {
    expect(descendants([row("ses_root")], "ses_root")).toEqual([])
  })

  test("a cycle does not loop", () => {
    const rows = [row("ses_a", "ses_b"), row("ses_b", "ses_a")]
    expect(descendants(rows, "ses_a").map((r) => r.id)).toEqual(["ses_b"])
  })
})

describe("isDescendant", () => {
  const tree: Record<string, string> = {
    ses_root: "",
    ses_child: "ses_root",
    ses_grand: "ses_child",
    ses_other: "ses_elsewhere",
  }
  const parentOf = (id: string) => tree[id] || undefined

  test("a child sits under its parent", async () => {
    expect(await isDescendant(parentOf, "ses_root", "ses_child")).toBe(true)
  })

  test("a grandchild sits under its grandparent", async () => {
    expect(await isDescendant(parentOf, "ses_root", "ses_grand")).toBe(true)
  })

  test("a sibling does not sit under the other one", async () => {
    expect(await isDescendant(parentOf, "ses_child", "ses_other")).toBe(false)
  })

  test("an ancestor does not sit under its descendant", async () => {
    expect(await isDescendant(parentOf, "ses_child", "ses_root")).toBe(false)
  })

  test("an unrelated session sits under nothing", async () => {
    expect(await isDescendant(parentOf, "ses_root", "ses_stranger")).toBe(false)
  })

  test("a cycle ends the walk", async () => {
    const cyclic = (id: string) => (id === "ses_a" ? "ses_b" : "ses_a")
    expect(await isDescendant(cyclic, "ses_c", "ses_a")).toBe(false)
  })
})

describe("filterRows", () => {
  const rows = descendants(
    [row("ses_root"), row("ses_a", "ses_root", "Verify law guide URLs", "research"), row("ses_b", "ses_root", "Write the report", "general")],
    "ses_root",
  )

  test("an empty query keeps every row", () => {
    expect(filterRows(rows, "").length).toBe(2)
  })

  test("matches the title", () => {
    expect(filterRows(rows, "law").map((r) => r.id)).toEqual(["ses_a"])
  })

  test("matches the agent", () => {
    expect(filterRows(rows, "general").map((r) => r.id)).toEqual(["ses_b"])
  })

  test("matches the session id", () => {
    expect(filterRows(rows, "ses_b").map((r) => r.id)).toEqual(["ses_b"])
  })

  test("every word has to match", () => {
    expect(filterRows(rows, "write report").map((r) => r.id)).toEqual(["ses_b"])
    expect(filterRows(rows, "write law").length).toBe(0)
  })

  test("the case does not matter", () => {
    expect(filterRows(rows, "LAW").map((r) => r.id)).toEqual(["ses_a"])
  })

  test("an accent does not matter", () => {
    const accented = descendants([row("ses_root"), row("ses_a", "ses_root", "Planéta guide", "research")], "ses_root")
    expect(filterRows(accented, "planeta").map((r) => r.id)).toEqual(["ses_a"])
  })
})

describe("argsOf", () => {
  test("takes what follows the command name", () => {
    expect(argsOf("/tell ses_child hello")).toBe("ses_child hello")
  })

  test("says no to a line that is not the command", () => {
    expect(argsOf("tell ses_child")).toBeUndefined()
    expect(argsOf("/other ses_child")).toBeUndefined()
  })
})

describe("trigger", () => {
  test("opens on the command and one word", () => {
    expect(trigger("/tell ")?.query).toBe("")
    expect(trigger("/tell law")?.query).toBe("law")
  })

  test("closes when the message starts", () => {
    expect(trigger("/tell ses_child hello")).toBeUndefined()
  })

  test("stays closed for another command", () => {
    expect(trigger("/aside ")).toBeUndefined()
  })
})
