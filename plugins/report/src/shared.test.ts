/**
 * Self-check for the report shapes. No host: these decide what the view
 * lists, what each block says, and what an empty tool call does.
 *
 *   bun test src/shared.test.ts
 */

import { describe, expect, test } from "bun:test"

import {
  ago,
  answerText,
  answersOfForm,
  blocksOf,
  descriptionOf,
  dotState,
  formFieldsOf,
  formIDOf,
  groupBySession,
  isEmpty,
  markdownOf,
  needsAnswer,
  promptMarkdown,
  promptsOf,
  reportDotState,
  reportIDOfForm,
  sectionsOf,
  stampOf,
  titleOf,
  type Report,
} from "./shared.ts"

const base = { id: "r1", kind: "post-task" as const, sessionID: "ses_1", at: 1000, title: "" }

describe("sectionsOf", () => {
  test("keeps non-empty sections only", () => {
    const sections = sectionsOf({
      completed: ["a", " ", "b"],
      deviations: [],
      hiccups: [{ problem: "p", cause: "c", fix: "f" }, {}],
      failed: ["x"],
      next: ["y"],
      noise: "dropped",
    })
    expect(sections.completed).toEqual(["a", "b"])
    expect(sections.deviations).toBeUndefined()
    expect(sections.hiccups).toEqual([{ problem: "p", cause: "c", fix: "f" }])
    expect(sections.failed).toEqual(["x"])
    expect(sections.next).toEqual(["y"])
  })
})

describe("promptsOf", () => {
  test("keeps procedures and questions, drops empty rows", () => {
    const prompts = promptsOf({
      procedures: [{ title: "run", description: "one step", steps: ["a", "", "b"] }, { title: "" }],
      questions: [{ title: "pick", body: "why", recommendation: "this" }, {}],
    })
    expect(prompts.procedures).toEqual([{ title: "run", description: "one step", steps: ["a", "b"] }])
    expect(prompts.questions).toEqual([{ title: "pick", body: "why", recommendation: "this" }])
  })
})

describe("isEmpty", () => {
  test("an all-empty record is empty", () => {
    expect(isEmpty({}, {})).toBe(true)
    expect(isEmpty({ completed: ["x"] }, {})).toBe(false)
    expect(isEmpty({}, { questions: [{ title: "q", body: "" }] })).toBe(false)
  })
})

describe("titleOf", () => {
  test("the first section item wins", () => {
    expect(titleOf({ ...base, sections: { completed: ["shipped"] } })).toBe("shipped")
  })

  test("falls back to the first question, then a default", () => {
    expect(titleOf({ ...base, kind: "prompt-user", prompts: { questions: [{ title: "Pick one", body: "" }] } })).toBe(
      "Pick one",
    )
    expect(titleOf({ ...base })).toBe("Post task")
  })
})

describe("blocksOf", () => {
  test("post-task sections render in the report order", () => {
    const report: Report = {
      ...base,
      title: "done",
      sections: {
        completed: ["one"],
        deviations: ["two"],
        hiccups: [{ problem: "p", cause: "c", fix: "f" }],
        failed: ["four"],
        next: ["five"],
      },
      prompts: { questions: [{ title: "pick", body: "why", recommendation: "this" }] },
    }
    expect(blocksOf(report).map((block) => block.title)).toEqual([
      "Completed",
      "Deviations",
      "Hiccups",
      "Failed / skipped",
      "Next",
      "Needs your decision",
    ])
    expect(blocksOf(report)[2].lines[0]).toBe("p | cause: c | fix: f")
    expect(blocksOf(report)[5].lines.join("\n")).toContain("❓ Q1: pick")
  })

  test("prompt-user separates procedures from questions", () => {
    const report: Report = {
      ...base,
      kind: "prompt-user",
      prompts: {
        procedures: [{ title: "run it", steps: ["one", "two"] }],
        questions: [{ title: "pick", body: "", recommendation: "this" }],
      },
    }
    expect(blocksOf(report).map((block) => block.title)).toEqual(["Procedures", "Questions"])
  })
})

describe("descriptionOf", () => {
  test("the required description wins over the old title", () => {
    expect(descriptionOf({ ...base, description: "Short label" })).toBe("Short label")
    expect(descriptionOf({ ...base, sections: { completed: ["long title"] } })).toBe("long title")
  })
})

describe("promptMarkdown", () => {
  test("questions are prose with a quoted recommendation, not nested bullets", () => {
    const text = promptMarkdown({ questions: [{ title: "Pick", body: "Which one?", recommendation: "this" }] })
    expect(text).toContain("### ❓ Questions")
    expect(text).toContain("**Q1: Pick**")
    expect(text).toContain("Which one?")
    expect(text).toContain("> ➡️ this")
    expect(text).not.toContain("- **Q1")
  })
})

describe("markdownOf", () => {
  test("a post-task record becomes a markdown page", () => {
    const text = markdownOf({ ...base, title: "x", sections: { completed: ["done"] } })
    expect(text).toContain("## Post Task")
    expect(text).toContain("### ✅ Completed")
    expect(text).toContain("- done")
  })
})

describe("groupBySession", () => {
  test("one group per session, oldest report first", () => {
    const groups = groupBySession([
      { ...base, id: "a2", sessionID: "a", at: 2 },
      { ...base, id: "b1", sessionID: "b", at: 3 },
      { ...base, id: "a1", sessionID: "a", at: 1 },
    ])
    expect(groups.map((group) => group.sessionID)).toEqual(["a", "b"])
    expect(groups[0]?.reports.map((report) => report.id)).toEqual(["a1", "a2"])
  })
})

describe("reportDotState", () => {
  test("only unread or read, regardless of embedded questions", () => {
    const question = { title: "pick", body: "" }
    expect(reportDotState({ ...base, prompts: { questions: [question] } })).toBe("unread")
    expect(reportDotState({ ...base, readAt: 5 })).toBe("read")
    expect(reportDotState(undefined)).toBe("read")
  })
})

describe("dotState", () => {
  test("answer first, then unread, then read", () => {
    const question = { title: "pick", body: "" }
    expect(dotState({ ...base, kind: "prompt-user", prompts: { questions: [question] } })).toBe("answer")
    expect(dotState({ ...base })).toBe("unread")
    expect(dotState({ ...base, readAt: 5 })).toBe("read")
    expect(dotState(undefined)).toBe("read")
  })

  test("a dismissed prompt is not waiting for an answer", () => {
    const question = { title: "pick", body: "" }
    expect(
      dotState({ ...base, kind: "prompt-user", prompts: { questions: [question] }, dismissedAt: 5, readAt: 6 }),
    ).toBe("read")
  })
})

describe("needsAnswer", () => {
  test("any record with unanswered questions, whichever kind", () => {
    const question = { title: "pick", body: "" }
    expect(needsAnswer({ ...base, kind: "prompt-user", prompts: { questions: [question] } })).toBe(true)
    expect(needsAnswer({ ...base, kind: "post-task", prompts: { questions: [question] } })).toBe(true)
    expect(
      needsAnswer({ ...base, kind: "prompt-user", prompts: { questions: [question] }, answeredAt: 5 }),
    ).toBe(false)
    expect(
      needsAnswer({ ...base, kind: "prompt-user", prompts: { questions: [question] }, dismissedAt: 5 }),
    ).toBe(false)
    expect(needsAnswer({ ...base })).toBe(false)
  })
})

describe("answerText", () => {
  test("names the report and each question", () => {
    const text = answerText(
      { ...base, title: "Pick", prompts: { questions: [{ title: "First?", body: "" }, { title: "Second?", body: "" }] } },
      { "0": "one", "1": "two" },
    )
    expect(text).toContain('Answers to "Pick"')
    expect(text).toContain("1. First?: one")
    expect(text).toContain("2. Second?: two")
  })
})

describe("stampOf", () => {
  test("local timestamp, plus the update time when revised", () => {
    const created = new Date(2026, 10, 8, 7, 5).getTime()
    expect(stampOf({ ...base, at: created })).toBe("2026-11-08 07:05")
    expect(stampOf({ ...base, at: created, updatedAt: created + 60_000 })).toBe(
      "2026-11-08 07:05 · upd 2026-11-08 07:06",
    )
  })
})

describe("form ids", () => {
  test("a form id carries the report id back and forth", () => {
    const form = formIDOf("mht2x1-abc123")
    expect(form.startsWith("frm_")).toBe(true)
    expect(reportIDOfForm(form)).toBe("mht2x1-abc123")
  })

  test("another plugin's form is not ours", () => {
    expect(reportIDOfForm("frm_abc123")).toBeUndefined()
    expect(reportIDOfForm("frm_report_")).toBeUndefined()
    expect(reportIDOfForm("")).toBeUndefined()
  })
})

describe("formFieldsOf", () => {
  const report: Report = {
    ...base,
    kind: "prompt-user",
    prompts: {
      questions: [
        { title: "Pick one", body: "why", recommendation: "the first" },
        { title: "", body: "" },
      ],
    },
  }

  test("one string field per question, keyed q0, q1", () => {
    const fields = formFieldsOf(report)
    expect(fields.map((field) => field.key)).toEqual(["q0", "q1"])
    expect(fields.every((field) => field.type === "string" && field.custom === true)).toBe(true)
  })

  test("the recommendation is the first option and the placeholder", () => {
    const [field] = formFieldsOf(report)
    expect(field?.options).toEqual([{ value: "the first", label: "the first (Recommended)" }])
    expect(field?.placeholder).toBe("the first")
    expect(field?.description).toBe("why")
  })

  test("a question without a recommendation stays free text", () => {
    const fields = formFieldsOf(report)
    expect(fields[1]?.options).toBeUndefined()
    expect(fields[1]?.placeholder).toBeUndefined()
    expect(fields[1]?.title).toBe("Question 2")
  })

  test("no questions mean no fields", () => {
    expect(formFieldsOf({ ...base })).toEqual([])
  })
})

describe("answersOfForm", () => {
  test("keys q0, q1 map to the record's question indexes", () => {
    expect(answersOfForm({ q0: " one ", q1: "two" })).toEqual({ "0": "one", "1": "two" })
  })

  test("a multiselect joins its choices", () => {
    expect(answersOfForm({ q0: ["a", "b"] })).toEqual({ "0": "a, b" })
  })

  test("empty answers and foreign keys are left out", () => {
    expect(answersOfForm({ q0: "", q1: "  ", key: "x", q2: null })).toEqual({})
    expect(answersOfForm(undefined)).toEqual({})
  })
})

describe("ago", () => {
  test("coarse buckets", () => {
    expect(ago(1000, 1000 + 20_000)).toBe("now")
    expect(ago(1000, 1000 + 5 * 60_000)).toBe("5m")
    expect(ago(1000, 1000 + 3 * 3_600_000)).toBe("3h")
    expect(ago(1000, 1000 + 2 * 86_400_000)).toBe("2d")
  })
})
