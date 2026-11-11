/**
 * Self-check for the maxForks slots. The reservation is the point: two asks
 * that start in the same turn must still obey the cap.
 *
 *   bun test src/forks.test.ts
 */

import { describe, expect, test } from "bun:test"

import { createForkSlots } from "./forks.ts"

describe("fork slots", () => {
  test("zero means unlimited", () => {
    const slots = createForkSlots()
    expect("token" in slots.reserve("ses_parent", 0)).toBe(true)
    expect("token" in slots.reserve("ses_parent", 0)).toBe(true)
    expect(slots.running("ses_parent")).toBe(2)
  })

  test("two reservations in one turn obey the cap", () => {
    const slots = createForkSlots()
    expect("token" in slots.reserve("ses_parent", 1)).toBe(true)
    const second = slots.reserve("ses_parent", 1)
    expect("error" in second).toBe(true)
    if ("error" in second) expect(second.error).toContain("maxForks=1")
  })

  test("confirm replaces the reservation and release frees the slot", () => {
    const slots = createForkSlots()
    const first = slots.reserve("ses_parent", 1)
    if (!("token" in first)) throw new Error("expected a reservation")
    slots.confirm("ses_parent", first.token, "ses_fork")
    expect(slots.running("ses_parent")).toBe(1)
    expect("error" in slots.reserve("ses_parent", 1)).toBe(true)
    slots.release("ses_parent", "ses_fork")
    expect(slots.running("ses_parent")).toBe(0)
    expect("token" in slots.reserve("ses_parent", 1)).toBe(true)
  })

  test("parents do not share a cap", () => {
    const slots = createForkSlots()
    expect("token" in slots.reserve("ses_a", 1)).toBe(true)
    expect("token" in slots.reserve("ses_b", 1)).toBe(true)
  })
})
