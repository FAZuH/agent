import { describe, expect, test } from "bun:test"
import { displayOrder } from "./index.ts"
import { quizDisplayLabels } from "../../md-link/src/index.ts"

// Parity: quiz_ask's form order and md-link's mirror order must agree.
// Quiz side = displayOrder (post-normalize); mirror side = quizDisplayLabels
// (raw input). Fixtures here are already clean (no empty labels), so
// normalize is the identity and the two must produce identical sequences.
describe("quiz/md-link display-order parity", () => {
  test("bug report: recurrence options agree after sort", () => {
    const raw = [
      { label: "T(n)=T(n-1)+Θ(1)" },
      { label: "T(n)=T(n/2)+Θ(n)" },
      { label: "T(n)=2T(n-1)+Θ(n)" },
      { label: "T(n)=T(n-1)+Θ(n)" },
    ]
    const quiz = displayOrder(raw.map((o) => ({ ...o, value: o.label }))).map((o) => o.label)
    expect(quizDisplayLabels(raw)).toEqual(quiz)
    expect(quiz).toEqual([
      "T(n)=2T(n-1)+Θ(n)",
      "T(n)=T(n-1)+Θ(1)",
      "T(n)=T(n-1)+Θ(n)",
      "T(n)=T(n/2)+Θ(n)",
    ])
  })

  test("already-sorted input stays put; reverse input converges", () => {
    const sorted = [{ label: "a" }, { label: "b" }, { label: "c" }]
    const quiz = displayOrder(sorted.map((o) => ({ ...o, value: o.label }))).map((o) => o.label)
    expect(quizDisplayLabels(sorted)).toEqual(["a", "b", "c"])
    expect(quizDisplayLabels([...sorted].reverse())).toEqual(quiz)
  })

  test("codepoint order (uppercase before lowercase), stable on ties", () => {
    const raw = [{ label: "b" }, { label: "a" }, { label: "A" }]
    const quiz = displayOrder(raw.map((o) => ({ ...o, value: o.label }))).map((o) => o.label)
    expect(quiz).toEqual(["A", "a", "b"])
    expect(quizDisplayLabels(raw)).toEqual(quiz)
  })

  test("shuffle=false preserves input order on the mirror side", () => {
    const raw = [{ label: "zebra" }, { label: "apple" }, { label: "mango" }]
    expect(quizDisplayLabels(raw, false)).toEqual(["zebra", "apple", "mango"])
  })

  test("mirror drops empty labels like quiz normalizeOptions", () => {
    const raw = [{ label: "  " }, { label: "b" }, {}, { label: "a" }]
    expect(quizDisplayLabels(raw)).toEqual(["a", "b"])
  })

  test("descriptions do not affect ordering", () => {
    const raw = [
      { label: "b", description: "second" },
      { label: "a", description: "first" },
    ]
    const quiz = displayOrder(raw.map((o) => ({ ...o, value: o.label }))).map((o) => o.label)
    expect(quizDisplayLabels(raw)).toEqual(quiz)
  })
})
