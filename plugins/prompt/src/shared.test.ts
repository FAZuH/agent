/**
 * Self-check for the prompt shapes. No host: these decide what the view lists,
 * how a record reads as Markdown, and what the inline form asks.
 *
 *   bun test src/shared.test.ts
 */

import { describe, expect, test } from "bun:test"

import {
  ago,
  answerText,
  answersOfForm,
  attentionOf,
  descriptionOf,
  formDescription,
  formFieldsOf,
  formIDOf,
  groupBySession,
  isEmpty,
  markdownOf,
  needsAnswer,
  nextSessionOf,
  promptMarkdown,
  promptsOf,
  promptIDOfForm,
  reopenFormIDOf,
  titleOf,
  type Prompt,
  type PromptGroup,
} from "./shared.ts"

const base = { id: "p1", sessionID: "ses_1", at: 1000, title: "" }
const question = { title: "pick", body: "" }

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
  test("a call with nothing to show is empty", () => {
    expect(isEmpty({})).toBe(true)
    expect(isEmpty({ questions: [{ title: "q", body: "" }] })).toBe(false)
    expect(isEmpty({ procedures: [{ title: "run", steps: ["one"] }] })).toBe(false)
  })
})

describe("titleOf", () => {
  test("the first question wins, then the first procedure, then a default", () => {
    expect(titleOf({ ...base, prompts: { questions: [{ title: "Pick one", body: "" }] } })).toBe("Pick one")
    expect(titleOf({ ...base, prompts: { procedures: [{ title: "Run it", steps: [] }] } })).toBe("Run it")
    expect(titleOf({ ...base })).toBe("Prompts")
  })
})

describe("descriptionOf", () => {
  test("the required description wins over the title", () => {
    expect(descriptionOf({ ...base, description: "Short label" })).toBe("Short label")
    expect(descriptionOf({ ...base, prompts: { questions: [{ title: "Pick", body: "" }] } })).toBe("Pick")
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

  test("procedures keep their numbered steps", () => {
    const text = promptMarkdown({ procedures: [{ title: "Run", steps: ["one", "two"] }] })
    expect(text).toContain("**P1: Run**")
    expect(text).toContain("1. one")
    expect(text).toContain("2. two")
  })
})

describe("markdownOf", () => {
  test("a prompt becomes a markdown page with its answer", () => {
    const text = markdownOf({
      ...base,
      prompts: { questions: [{ title: "Pick", body: "" }] },
      answers: { "0": "the first" },
    })
    expect(text).toContain("## Prompts")
    expect(text).toContain("> **Answer:** the first")
  })

  test("an unanswered question keeps its recommendation hint and shows no answer", () => {
    const text = markdownOf({
      ...base,
      prompts: { questions: [{ title: "Pick", body: "", recommendation: "this" }] },
    })
    expect(text).toContain("> ➡️ this")
    expect(text).toContain("> **Answer:** Not answered")
  })

  test("a record with no content is just the heading", () => {
    expect(markdownOf({ ...base })).toBe("## Prompts")
  })
})

describe("groupBySession", () => {
  test("one group per session, oldest prompt first", () => {
    const groups = groupBySession([
      { ...base, id: "a2", sessionID: "a", at: 2 },
      { ...base, id: "b1", sessionID: "b", at: 3 },
      { ...base, id: "a1", sessionID: "a", at: 1 },
    ])
    expect(groups.map((group) => group.sessionID)).toEqual(["a", "b"])
    expect(groups[0]?.prompts.map((prompt) => prompt.id)).toEqual(["a1", "a2"])
  })
})

describe("needsAnswer", () => {
  test("a question with no answer and no dismissal is waiting", () => {
    expect(needsAnswer({ ...base, prompts: { questions: [question] } })).toBe(true)
    expect(needsAnswer({ ...base, prompts: { questions: [question] }, answeredAt: 5 })).toBe(false)
    expect(needsAnswer({ ...base, prompts: { questions: [question] }, dismissedAt: 5 })).toBe(false)
    expect(needsAnswer({ ...base })).toBe(false)
  })
})

describe("attentionOf", () => {
  test("keeps only the records still waiting for an answer", () => {
    const waiting = { ...base, id: "p1", prompts: { questions: [question] } }
    const answered = { ...waiting, id: "p2", answeredAt: 5 }
    const dismissed = { ...waiting, id: "p3", dismissedAt: 5 }
    expect(attentionOf([waiting, answered, dismissed]).map((prompt) => prompt.id)).toEqual(["p1"])
  })
})

describe("nextSessionOf", () => {
  const group = (id: string, prompts: Prompt[]): PromptGroup => ({ sessionID: id, prompts })
  const waiting = (id: string): Prompt => ({ ...base, id, sessionID: id, prompts: { questions: [question] } })
  const handled = (id: string): Prompt => ({ ...waiting(id), answeredAt: 5 })
  const sessions = [
    group("a", [waiting("p1")]),
    group("b", [handled("p2")]),
    group("c", [waiting("p3")]),
  ]

  test("down goes to the next group and wraps", () => {
    expect(nextSessionOf(sessions, "a", 1, false)?.sessionID).toBe("b")
    expect(nextSessionOf(sessions, "c", 1, false)?.sessionID).toBe("a")
  })

  test("up goes to the previous group and wraps", () => {
    expect(nextSessionOf(sessions, "a", -1, false)?.sessionID).toBe("c")
    expect(nextSessionOf(sessions, "b", -1, false)?.sessionID).toBe("a")
  })

  test("with attention set, a group with nothing waiting is skipped", () => {
    expect(nextSessionOf(sessions, "a", 1, true)?.sessionID).toBe("c")
    expect(nextSessionOf(sessions, "c", 1, true)?.sessionID).toBe("a")
    expect(nextSessionOf(sessions, "a", -1, true)?.sessionID).toBe("c")
  })

  test("no other group, or an unknown current group, means no move", () => {
    expect(nextSessionOf([sessions[0]!], "a", 1, false)).toBeUndefined()
    expect(nextSessionOf(sessions, "gone", 1, false)).toBeUndefined()
  })
})

describe("answerText", () => {
  test("mirrors the host question card: a titled block, question, answer", () => {
    const text = answerText(
      {
        ...base,
        description: "Pick",
        prompts: { questions: [{ title: "First?", body: "" }, { title: "Second?", body: "" }] },
      },
      { "0": "one", "1": "two" },
    )
    expect(text).toBe("# Prompt: Pick\n\nFirst?\none\n\nSecond?\ntwo")
  })

  test("falls back to the first question when there is no description", () => {
    const text = answerText({ ...base, prompts: { questions: [{ title: "First?", body: "" }] } }, {})
    expect(text).toBe("# Prompt: First?\n\nFirst?\nNot answered")
  })

  test("a skipped question is shown as not answered beside the answered ones", () => {
    const text = answerText(
      { ...base, prompts: { questions: [{ title: "First?", body: "" }, { title: "Second?", body: "" }] } },
      { "0": "one" },
    )
    expect(text).toBe("# Prompt: First?\n\nFirst?\none\n\nSecond?\nNot answered")
  })
})

describe("form ids", () => {
  test("a form id carries the prompt id back and forth", () => {
    const form = formIDOf("mht2x1-abc123")
    expect(form.startsWith("frm_")).toBe(true)
    expect(promptIDOfForm(form)).toBe("mht2x1-abc123")
  })

  test("a reopened card still points at its prompt", () => {
    expect(promptIDOfForm(reopenFormIDOf("mht2x1-abc123", 1794880000000))).toBe("mht2x1-abc123")
    expect(reopenFormIDOf("p1", 1000)).not.toBe(reopenFormIDOf("p1", 2000))
  })

  test("another plugin's form is not ours", () => {
    expect(promptIDOfForm("frm_abc123")).toBeUndefined()
    expect(promptIDOfForm("frm_prompt_")).toBeUndefined()
    expect(promptIDOfForm("")).toBeUndefined()
  })
})

describe("formFieldsOf", () => {
  const prompt: Prompt = {
    ...base,
    prompts: {
      questions: [
        { title: "Pick one", body: "why", recommendation: "the first" },
        { title: "", body: "" },
      ],
    },
  }

  test("one string field per question, keyed q0, q1", () => {
    const fields = formFieldsOf(prompt)
    expect(fields.map((field) => field.key)).toEqual(["q0", "q1"])
    expect(fields.every((field) => field.type === "string" && field.custom === true)).toBe(true)
  })

  test("the recommendation is the first option and the placeholder", () => {
    const [field] = formFieldsOf(prompt)
    expect(field?.options).toEqual([{ value: "the first", label: "the first (Recommended)" }])
    expect(field?.placeholder).toBe("the first")
    expect(field?.description).toBe("[Pick one]\n\nwhy")
  })

  test("the card text brackets the title so it reads apart from the body", () => {
    const [field] = formFieldsOf(prompt)
    expect(field?.title).toBe("Pick one")
    expect(field?.description).toBe("[Pick one]\n\nwhy")
  })

  test("a question without a body still shows its title", () => {
    const field = formFieldsOf({ ...base, prompts: { questions: [{ title: "Only title" }] } })[0]
    expect(field?.description).toBe("[Only title]")
  })

  test("a question without a recommendation stays free text", () => {
    const fields = formFieldsOf(prompt)
    expect(fields[1]?.options).toBeUndefined()
    expect(fields[1]?.placeholder).toBeUndefined()
    expect(fields[1]?.title).toBe("Question 2")
  })

  test("no questions mean no fields", () => {
    expect(formFieldsOf({ ...base })).toEqual([])
  })

  test("a short body is passed through unchanged", () => {
    expect(formDescription("first line\nsecond line")).toBe("first line\nsecond line")
    expect(formDescription("")).toBeUndefined()
    expect(formDescription(undefined)).toBeUndefined()
  })

  test("a tall body is capped and points at the full record", () => {
    const body = Array.from({ length: 40 }, (_, index) => `item ${index + 1}`).join("\n")
    const description = formDescription(body)!
    expect(description.split("\n")).toHaveLength(13)
    expect(description).toContain("item 12")
    expect(description).not.toContain("item 13")
    expect(description).toEndWith("… full text in the Prompts section")
    expect(
      formFieldsOf({ ...base, prompts: { questions: [{ title: "tall", body }] } })[0]?.description,
    ).toBe(`[tall]\n\n${description}`)
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
