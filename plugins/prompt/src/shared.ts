/**
 * Shared rules for the prompt plugin: the record a `prompt_user` call writes,
 * how it reads as Markdown, and the fields the host's inline form shows. Pure
 * data and formatting only.
 *
 * A prompt used to be plain text at the end of a reply. Here it is a record:
 * the agent calls the tool, the user answers in the Prompts view, and the
 * reply keeps only the answer.
 */

export interface Question {
  title: string
  body: string
  recommendation?: string
}

export interface Procedure {
  title: string
  description?: string
  steps: string[]
}

/** The content a prompt carries: procedures to run and questions to answer. */
export interface Prompts {
  procedures?: Procedure[]
  questions?: Question[]
}

/** One field of a native host form, the inline card the question tool uses. */
export interface FormField {
  key: string
  title: string
  description?: string
  type: "string"
  required?: boolean
  custom?: boolean
  placeholder?: string
  options?: { value: string; label: string }[]
}

export interface Prompt {
  id: string
  sessionID: string
  /** Epoch milliseconds. */
  at: number
  /** One line for lists: the first question, else the first procedure. */
  title: string
  /** A short label for the slot, max 35 characters. */
  description?: string
  prompts?: Prompts
  /** The user's answers, keyed by question index. */
  answers?: Record<string, string>
  /** When the user answered the prompts. */
  answeredAt?: number
  /** When the user dismissed the prompts without answering them. */
  dismissedAt?: number
}

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "")

function list(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map(text).filter(Boolean)
}

function procedures(value: unknown): Procedure[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return []
    const row = item as Record<string, unknown>
    const title = text(row.title)
    const steps = list(row.steps)
    if (!title && steps.length === 0) return []
    return [{ title, description: text(row.description) || undefined, steps }]
  })
}

function questions(value: unknown): Question[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return []
    const row = item as Record<string, unknown>
    const title = text(row.title)
    const body = text(row.body)
    if (!title && !body) return []
    return [{ title, body, recommendation: text(row.recommendation) || undefined }]
  })
}

export function promptsOf(value: unknown): Prompts {
  const row = value && typeof value === "object" ? (value as Record<string, unknown>) : {}
  const proceduresList = procedures(row.procedures)
  const questionsList = questions(row.questions)
  return {
    ...(proceduresList.length ? { procedures: proceduresList } : {}),
    ...(questionsList.length ? { questions: questionsList } : {}),
  }
}

/** True when a call carries nothing the view could show. */
export function isEmpty(prompts: Prompts): boolean {
  return !prompts.procedures?.length && !prompts.questions?.length
}

/** The short label a slot shows: the required description, else the title. */
export function descriptionOf(prompt: Prompt): string {
  return prompt.description?.trim() || titleOf(prompt)
}

/** Questions and procedures as prose and lists, not bullets of bullets. */
export function promptMarkdown(prompts: Prompts | undefined, answers: Record<string, string> = {}): string {
  if (!prompts) return ""
  const parts: string[] = []
  const procedureList = prompts.procedures ?? []
  if (procedureList.length) {
    parts.push("### 🏁 Procedures")
    for (const [index, procedure] of procedureList.entries()) {
      parts.push(`**P${index + 1}: ${procedure.title}**`)
      if (procedure.description) parts.push(procedure.description)
      if (procedure.steps.length) parts.push(procedure.steps.map((step, at) => `${at + 1}. ${step}`).join("\n"))
      parts.push("")
    }
  }
  const questionList = prompts.questions ?? []
  if (questionList.length) {
    parts.push("### ❓ Questions")
    for (const [index, question] of questionList.entries()) {
      parts.push(`**Q${index + 1}: ${question.title}**`)
      if (question.body) parts.push(question.body)
      if (question.recommendation) parts.push(`> ➡️ ${question.recommendation}`)
      const answer = answers[String(index)]
      if (answer) parts.push(`> **Answer:** ${answer}`)
      parts.push("")
    }
  }
  return parts.join("\n").trim()
}

/** The record as Markdown, for a view's Markdown renderer. */
export function markdownOf(prompt: Prompt): string {
  return ["## Prompts", "", promptMarkdown(prompt.prompts, prompt.answers ?? {})].join("\n").trim()
}

/** The record has questions and no answer or dismissal yet. */
export function needsAnswer(prompt: Prompt): boolean {
  return (prompt.prompts?.questions?.length ?? 0) > 0 && !prompt.answeredAt && !prompt.dismissedAt
}

/** One group per session, oldest prompt first. */
export interface PromptGroup {
  sessionID: string
  prompts: Prompt[]
}

/** The records still waiting for the user. */
export function attentionOf(prompts: readonly Prompt[]): Prompt[] {
  return prompts.filter(needsAnswer)
}

/**
 * The next session group in a list, wrapping at the ends. With `attention`
 * set, a group with nothing needing it is skipped. Used by the history's
 * Ctrl+Up/Down, over the list the history was opened from.
 */
export function nextSessionOf(
  sessions: readonly PromptGroup[],
  currentID: string,
  delta: 1 | -1,
  attention: boolean,
): PromptGroup | undefined {
  if (sessions.length < 2) return undefined
  const from = sessions.findIndex((group) => group.sessionID === currentID)
  if (from < 0) return undefined
  for (let step = 1; step <= sessions.length; step++) {
    const at = (((from + delta * step) % sessions.length) + sessions.length) % sessions.length
    const group = sessions[at]
    if (!group || group.sessionID === currentID) continue
    if (attention && attentionOf(group.prompts).length === 0) continue
    return group
  }
  return undefined
}

export function groupBySession(prompts: readonly Prompt[]): PromptGroup[] {
  const map = new Map<string, Prompt[]>()
  for (const prompt of prompts) {
    const list = map.get(prompt.sessionID)
    if (list) list.push(prompt)
    else map.set(prompt.sessionID, [prompt])
  }
  return [...map.entries()].map(([sessionID, list]) => ({
    sessionID,
    prompts: list.slice().sort((a, b) => a.at - b.at),
  }))
}

/**
 * What the agent reads after the user answers. It mirrors the host's question
 * card: a titled block, then one question with its answer under it.
 */
export function answerText(prompt: Prompt, answers: Record<string, string>): string {
  const pairs: string[] = []
  for (const [index, question] of (prompt.prompts?.questions ?? []).entries()) {
    const answer = answers[String(index)]?.trim()
    if (answer) pairs.push(`${question.title.trim()}\n${answer}`)
  }
  return [`# Prompt: ${descriptionOf(prompt)}`, ...pairs].join("\n\n").trimEnd()
}

/** Our form ids carry the prompt id behind this prefix; other forms do not. */
const FORM_PREFIX = "frm_prompt_"

/** The native form id for one prompt record. */
export function formIDOf(promptID: string): string {
  return `${FORM_PREFIX}${promptID}`
}

/** The prompt a native form belongs to, or nothing when the form is not ours. */
export function promptIDOfForm(formID: string): string | undefined {
  const id = String(formID ?? "")
  if (!id.startsWith(FORM_PREFIX)) return undefined
  const promptID = id.slice(FORM_PREFIX.length)
  return promptID || undefined
}

/** How much of a question body the chat form shows before it points at the record. */
export const FORM_DESCRIPTION_MAX_LINES = 12
export const FORM_DESCRIPTION_MAX_CHARS = 1200

/**
 * The host draws a form field's description as plain text with no height cap
 * or scroll, so one long question body fills the chat card. Keep whole lines
 * within a small budget and point at the full text in the Prompts section.
 */
export function formDescription(body: string | undefined): string | undefined {
  const content = String(body ?? "").trim()
  if (!content) return undefined
  const kept: string[] = []
  let used = 0
  let cut = false
  for (const line of content.split("\n")) {
    if (kept.length >= FORM_DESCRIPTION_MAX_LINES) {
      cut = true
      break
    }
    const room = FORM_DESCRIPTION_MAX_CHARS - used
    if (room <= 0) {
      cut = true
      break
    }
    if (line.length > room) {
      kept.push(`${line.slice(0, Math.max(0, room - 1)).trimEnd()}…`)
      cut = true
      break
    }
    kept.push(line)
    used += line.length + 1
  }
  if (cut) kept.push("… full text in the Prompts section")
  return kept.join("\n")
}

/**
 * The inline form fields for a prompt record: one string field per question,
 * with the recommendation as the first option and free text still allowed.
 */
export function formFieldsOf(prompt: Prompt): FormField[] {
  return (prompt.prompts?.questions ?? []).map((question, index) => {
    const recommendation = question.recommendation?.trim()
    const description = formDescription(question.body)
    return {
      key: `q${index}`,
      title: question.title || `Question ${index + 1}`,
      ...(description ? { description } : {}),
      type: "string" as const,
      custom: true,
      ...(recommendation
        ? {
            placeholder: recommendation,
            options: [{ value: recommendation, label: `${recommendation} (Recommended)` }],
          }
        : {}),
    }
  })
}

/** The record's answers, from a native form's `q0` style answer map. */
export function answersOfForm(answer: Record<string, unknown> | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(answer ?? {})) {
    const index = String(key).replace(/^q/, "")
    if (!/^\d+$/.test(index)) continue
    const answerText = Array.isArray(value)
      ? value.map((item) => String(item)).filter(Boolean).join(", ")
      : value === undefined || value === null
        ? ""
        : String(value).trim()
    if (answerText) out[index] = answerText
  }
  return out
}

/** The first question the list can show, else the first procedure, else a default. */
export function titleOf(prompt: Prompt): string {
  const title = prompt.prompts?.questions?.[0]?.title ?? prompt.prompts?.procedures?.[0]?.title
  return title || "Prompts"
}

/** Coarse age for lists: now, 5m, 3h, 2d. */
export function ago(at: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000))
  if (seconds < 60) return "now"
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours}h`
  return `${Math.round(hours / 24)}d`
}

/** A stable id for one record: time plus a short random suffix. */
export function promptID(now = Date.now()): string {
  return `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}
