import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { utimesSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { prune } from "./shot.ts"

const roots: string[] = []
const makeRoot = () => {
  const root = mkdtempSync(join(tmpdir(), "desktop-ask-shots-"))
  roots.push(root)
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("prune", () => {
  test("keeps the newest shots and removes the rest", () => {
    const dir = makeRoot()
    for (let i = 0; i < 6; i++) {
      const path = join(dir, `${i}.png`)
      writeFileSync(path, "x")
      utimesSync(path, new Date(2026, 0, 1, 0, 0, i), new Date(2026, 0, 1, 0, 0, i))
    }
    prune(dir, 2)
    expect(readdirSync(dir).sort()).toEqual(["4.png", "5.png"])
  })

  test("leaves a missing directory alone", () => {
    expect(() => prune(join(tmpdir(), "desktop-ask-does-not-exist"))).not.toThrow()
  })

  test("ignores files that are not png", () => {
    const dir = makeRoot()
    writeFileSync(join(dir, "note.txt"), "x")
    prune(dir, 0)
    expect(readdirSync(dir)).toEqual(["note.txt"])
  })
})
