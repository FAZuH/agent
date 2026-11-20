import { describe, expect, test } from "bun:test"
import { buildAddArgs, buildEditArgs, buildToggleArgs, octaskBin } from "./shared.ts"

describe("buildAddArgs", () => {
  test("builds an agent job", () => {
    const result = buildAddArgs({
      name: "digest",
      agent: "general",
      prompt: "check mail",
      workdir: "/tmp/project",
      schedule: "*-*-* 09:00:00",
      persistent: true,
      dirty_only: true,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.args).toEqual([
      "add",
      "digest",
      "--agent",
      "general",
      "--prompt",
      "check mail",
      "--workdir",
      "/tmp/project",
      "--oncalendar",
      "*-*-* 09:00:00",
      "--persistent",
      "--dirty-only",
    ])
  })

  test("builds an exec job", () => {
    const result = buildAddArgs({ name: "ping", exec: "curl example.com" })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.args).toEqual(["add", "ping", "--exec", "curl example.com"])
  })

  test("rejects an agent job without workdir", () => {
    const result = buildAddArgs({ name: "x", agent: "general", prompt: "do it" })
    expect(result.ok).toBe(false)
  })
})

describe("buildEditArgs", () => {
  test("adds negation flags and dry-run", () => {
    const result = buildEditArgs({ name: "digest", no_model: true, no_dirty_only: true, dry_run: true })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.args).toEqual([
      "edit",
      "digest",
      "--no-model",
      "--no-dirty-only",
      "--dry-run",
    ])
  })

  test("rejects exec on edit", () => {
    expect(buildEditArgs({ name: "x", exec: "true" }).ok).toBe(false)
  })
})

describe("buildToggleArgs", () => {
  test("supports all and dry-run", () => {
    const result = buildToggleArgs("disable", { all: true, dry_run: true })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.args).toEqual(["disable", "--all", "--dry-run"])
  })

  test("rejects name together with all", () => {
    expect(buildToggleArgs("enable", { name: "x", all: true }).ok).toBe(false)
  })
})

test("octaskBin honours the override", () => {
  const previous = process.env.OCTASK_BIN
  process.env.OCTASK_BIN = "/tmp/octask-test"
  expect(octaskBin()).toBe("/tmp/octask-test")
  if (previous === undefined) delete process.env.OCTASK_BIN
  else process.env.OCTASK_BIN = previous
})
