import { describe, expect, test } from "bun:test"
import { DEFAULT_OPENER, openArgs } from "./core.ts"

const FILE = "/home/tester/Notes/Learn/link_Quiz question order mismatch.md"

describe("openArgs", () => {
  test("default template → xdg-open obsidian URI with encoded path", () => {
    expect(openArgs(undefined, FILE)).toEqual([
      "xdg-open",
      `obsidian://open?path=${encodeURIComponent(FILE)}`,
    ])
    expect(openArgs("", FILE)).toEqual(openArgs(DEFAULT_OPENER, FILE))
  })

  test("{uri} encodes spaces and special chars; {path} stays raw", () => {
    const argv = openArgs("glow {path}", "/tmp/a b#c.md")
    expect(argv).toEqual(["glow", "/tmp/a b#c.md"])
    expect(openArgs("op {uri}", "/tmp/a b.md")).toEqual(["op", encodeURIComponent("/tmp/a b.md")])
  })

  test("multi-space/tab splitting, placeholders substituted per arg", () => {
    expect(openArgs("  code\t-r   {path} ", "/n/v.md")).toEqual(["code", "-r", "/n/v.md"])
  })

  test("template without placeholders passes the file nowhere (opener's business)", () => {
    expect(openArgs("obsidian", "/x/y.md")).toEqual(["obsidian"])
  })
})
