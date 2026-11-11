/**
 * Self-check for the desktop-control rules. No host, no X server, no commands:
 * the point is that target matching and chord parsing are right, because those
 * decide which window gets raised and which key actually lands.
 *
 *   bun test src/shared.test.ts
 */

import { describe, expect, test } from "bun:test"

import { formatWindows, matchWindow, parseChord, parseRegion, type DeskWindow } from "./shared.ts"

const win = (partial: Partial<DeskWindow>): DeskWindow => ({
  address: "0x1",
  stableId: "1000",
  class: "kitty",
  title: "fazuh:~",
  x: 0,
  y: 0,
  width: 800,
  height: 600,
  workspace: "1",
  monitor: 0,
  focused: false,
  xwayland: false,
  ...partial,
})

describe("matchWindow", () => {
  const list = [
    win({ address: "0xaa", class: "kitty", title: "fazuh:~" }),
    win({ address: "0xbb", class: "steam_app_1", title: "Project notes", xwayland: true }),
    win({ address: "0xcc", class: "brave-browser", title: "kitty documentation" }),
  ]

  test("address is exact", () => {
    expect(matchWindow(list, "0xbb")?.class).toBe("steam_app_1")
    expect(matchWindow(list, "0xBB")?.class).toBe("steam_app_1")
    expect(matchWindow(list, "0xdd")).toBeUndefined()
  })

  test("class: is exact before substring", () => {
    expect(matchWindow(list, "class:kitty")?.address).toBe("0xaa")
    expect(matchWindow(list, "class:brave")?.address).toBe("0xcc")
  })

  test("title: ignores class", () => {
    expect(matchWindow(list, "title:notes")?.address).toBe("0xbb")
    expect(matchWindow(list, "title:kitty")?.address).toBe("0xcc")
  })

  test("a bare word prefers an exact class over a title mention", () => {
    expect(matchWindow(list, "kitty")?.address).toBe("0xaa")
  })

  test("empty and missing targets find nothing", () => {
    expect(matchWindow(list, "  ")).toBeUndefined()
  })
})

describe("parseChord", () => {
  test("single key", () => {
    expect(parseChord("Return")).toEqual({ mods: [], key: "Return" })
  })

  test("modifiers keep press order", () => {
    expect(parseChord("ctrl+shift+t")).toEqual({ mods: ["ctrl", "shift"], key: "t" })
  })

  test("aliases collapse onto one modifier", () => {
    expect(parseChord("super+win+1").mods).toEqual(["logo"])
  })

  test("lowercase enter becomes Return", () => {
    expect(parseChord("enter").key).toBe("Return")
  })

  test("a trailing plus is the plus key", () => {
    expect(parseChord("ctrl++")).toEqual({ mods: ["ctrl"], key: "+" })
  })

  test("an unknown modifier is an error, not a silent key", () => {
    expect(() => parseChord("hyper+t")).toThrow()
  })

  test("empty is an error", () => {
    expect(() => parseChord("   ")).toThrow()
  })
})

describe("parseRegion", () => {
  test("bare size starts at the image origin", () => {
    expect(parseRegion("200x100")).toEqual({ x: 0, y: 0, width: 200, height: 100 })
  })

  test("positioned size keeps the image pixel", () => {
    expect(parseRegion("40,30 200x100")).toEqual({ x: 40, y: 30, width: 200, height: 100 })
  })

  test("spaces around the comma are accepted", () => {
    expect(parseRegion("40, 30 200x100")).toEqual({ x: 40, y: 30, width: 200, height: 100 })
  })

  test("layout coordinates are not a third syntax", () => {
    expect(parseRegion("333,-67 1534x932")).toEqual({ x: 333, y: -67, width: 1534, height: 932 })
  })

  test("zero size and junk are rejected", () => {
    expect(parseRegion("0x100")).toBeUndefined()
    expect(parseRegion("200")).toBeUndefined()
    expect(parseRegion("200x100+40+30")).toBeUndefined()
  })
})

describe("formatWindows", () => {
  test("names the backend each window takes", () => {
    const text = formatWindows([win({ xwayland: true, focused: true })])
    expect(text).toContain("xwayland")
    expect(text).toContain("focused")
  })

  test("empty list says so", () => {
    expect(formatWindows([])).toBe("no windows")
  })
})
