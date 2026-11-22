/**
 * The chain wiring suite runs in its own bun process.
 *
 * `lib/jev/state.ts` fixes its settings and log paths when it is first imported,
 * and bun shares one module registry across every test file in a run: whichever
 * file imported first owns those paths. The cases in `chain-wiring.cases.ts` are
 * therefore run here as a child process, where nothing else has imported the
 * library and every path the suite touches is inside that run's own scratch.
 *
 *   bun test plugins/watchdog/src/chain-wiring.test.ts
 */

import { describe, expect, test } from "bun:test"
import { join } from "node:path"

const CASES = join(import.meta.dir, "chain-wiring.cases.ts")

describe("chain wiring", () => {
  test("passes in its own process", () => {
    const child = Bun.spawnSync({
      cmd: [process.execPath, "test", "--timeout", "20000", CASES],
      stdout: "pipe",
      stderr: "pipe",
    })
    const out = `${child.stdout.toString()}${child.stderr.toString()}`
    if (child.exitCode !== 0) throw new Error(`the chain wiring suite failed:\n${out}`)
    // 74 cases today: a much smaller run means cases stopped being collected.
    expect(Number(out.match(/(\d+) pass/)?.[1] ?? "0")).toBeGreaterThanOrEqual(70)
  }, 60_000)
})
