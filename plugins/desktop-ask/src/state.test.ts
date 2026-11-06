import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { clearTarget, readLastCopy, readTarget, targetPath, writeLastCopy, writeTarget, type Target } from "./state.ts"

const roots: string[] = []
const makeRoot = () => {
  const root = mkdtempSync(join(tmpdir(), "desktop-ask-state-"))
  roots.push(root)
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const target: Target = {
  sessionID: "ses_one",
  directory: "/tmp/project",
  title: "One",
  instruction: "look at the screen",
  delivery: "queue",
  armedAt: "2026-11-06T00:00:00.000Z",
  triggers: 0,
}

describe("target state", () => {
  test("round-trips", () => {
    const root = makeRoot()
    writeTarget(target, root)
    expect(readTarget(root)).toEqual(target)
  })

  test("is absent before arming", () => {
    expect(readTarget(makeRoot())).toBeUndefined()
  })

  test("rejects a missing instruction", () => {
    const root = makeRoot()
    writeTarget({ ...target, instruction: "  " }, root)
    expect(readTarget(root)).toBeUndefined()
  })

  test("defaults delivery to queue and triggers to zero", () => {
    const root = makeRoot()
    writeTarget({ ...target, delivery: "weird" as any, triggers: undefined as any }, root)
    const read = readTarget(root)
    expect(read?.delivery).toBe("queue")
    expect(read?.triggers).toBe(0)
  })

  test("clears only when armed", () => {
    const root = makeRoot()
    expect(clearTarget(root)).toBe(false)
    writeTarget(target, root)
    expect(clearTarget(root)).toBe(true)
    expect(readTarget(root)).toBeUndefined()
    expect(targetPath(root)).toContain("target.json")
  })

  test("round-trips the last copy record", () => {
    const root = makeRoot()
    expect(readLastCopy(root)).toBeUndefined()
    writeLastCopy({ at: "2026-11-06T00:02:00.000Z", ok: true, chars: 12, preview: "the answer" }, root)
    expect(readLastCopy(root)?.chars).toBe(12)
    writeLastCopy({ at: "2026-11-06T00:03:00.000Z", ok: false, error: "timeout" }, root)
    expect(readLastCopy(root)?.error).toBe("timeout")
  })
})
