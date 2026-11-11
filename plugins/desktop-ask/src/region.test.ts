import { describe, expect, test } from "bun:test"

import { parseRegion, toLayout } from "./region.ts"

describe("parseRegion", () => {
  test("bare size starts at the image origin", () => {
    expect(parseRegion("200x100")).toEqual({ x: 0, y: 0, width: 200, height: 100 })
  })

  test("positioned size keeps the image pixel", () => {
    expect(parseRegion("40,30 200x100")).toEqual({ x: 40, y: 30, width: 200, height: 100 })
  })

  test("junk and zero size are rejected", () => {
    expect(parseRegion("0x100")).toBeUndefined()
    expect(parseRegion("200")).toBeUndefined()
  })
})

describe("toLayout", () => {
  test("adds the layout origin grim expects", () => {
    expect(toLayout({ x: 40, y: 30, width: 200, height: 100 }, { x: 332, y: -68 })).toBe("372,-38 200x100")
  })
})
