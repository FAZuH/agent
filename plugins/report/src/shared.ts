/**
 * Shared rules for the report plugin: the record shape the tools write, the
 * section blocks the TUI and the GUI render, and the one-line title that
 * both list from. Pure data and formatting only, so the GUI bundle can
 * import it without Node.
 *
 * The report and the prompts used to be plain text at the end of a reply.
 * Here they are records: the agent calls a tool, the user reads the Reports
 * view, and the reply keeps only the answer.
 */

export type ReportKind = "post-task" | "prompt-user"

export interface Hiccup {
  problem: string
  cause: string
  fix: string
}

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

export interface PostTaskSections {
  completed?: string[]
  deviations?: string[]
  hiccups?: Hiccup[]
  failed?: string[]
  next?: string[]
}

export interface Report {
  id: string
  kind: ReportKind
  sessionID: string
  /** Epoch milliseconds. */
  at: number
  /** One line for lists: the first item, else the first question, else a default. */
  title: string
  /** A short label for the slot, max 35 characters. */
  description?: string
  sections?: PostTaskSections
  prompts?: Prompts
  /** Content revision: 1 on creation, +1 per `report_update`. */
  rev?: number
  /** When the content was last updated. */
  updatedAt?: number
  /** The user's answers, keyed by question index. */
  answers?: Record<string, string>
  /** When the user answered the prompts. */
  answeredAt?: number
  /** When the user dismissed the prompts without answering them. */
  dismissedAt?: number
  /** When the user opened this report. */
  readAt?: number
}

/** A titled group of lines, the one shape both views render. */
export interface Block {
  title: string
  lines: string[]
}

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "")

function list(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map(text).filter(Boolean)
}

function hiccups(value: unknown): Hiccup[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return []
    const row = item as Record<string, unknown>
    const problem = text(row.problem)
    const cause = text(row.cause)
    const fix = text(row.fix)
    if (!problem && !cause && !fix) return []
    return [{ problem, cause, fix }]
  })
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

export function sectionsOf(value: unknown): PostTaskSections {
  const row = value && typeof value === "object" ? (value as Record<string, unknown>) : {}
  const hiccupList = hiccups(row.hiccups)
  return {
    ...(list(row.completed).length ? { completed: list(row.completed) } : {}),
    ...(list(row.deviations).length ? { deviations: list(row.deviations) } : {}),
    ...(hiccupList.length ? { hiccups: hiccupList } : {}),
    ...(list(row.failed).length ? { failed: list(row.failed) } : {}),
    ...(list(row.next).length ? { next: list(row.next) } : {}),
  }
}

/** True when a record carries nothing the views could show. */
export function isEmpty(sections: PostTaskSections, prompts: Prompts): boolean {
  return (
    Object.keys(sections).length === 0 &&
    !prompts.procedures?.length &&
    !prompts.questions?.length
  )
}

/** The `Q1`/`P1` style label the skills use, in order. */
function promptBlocks(prompts: Prompts | undefined, answers: Record<string, string> = {}): string[] {
  if (!prompts) return []
  const lines: string[] = []
  for (const [index, procedure] of (prompts.procedures ?? []).entries()) {
    lines.push(`🏁 P${index + 1}: ${procedure.title}`)
    if (procedure.description) lines.push(procedure.description)
    for (const [step, value] of procedure.steps.entries()) lines.push(`${step + 1}. ${value}`)
  }
  for (const [index, question] of (prompts.questions ?? []).entries()) {
    lines.push(`❓ Q${index + 1}: ${question.title}`)
    if (question.body) lines.push(question.body)
    if (question.recommendation) lines.push(`➡️ ${question.recommendation}`)
    const answer = answers[String(index)]
    if (answer) lines.push(`Answer: ${answer}`)
  }
  return lines
}

/** The record as titled blocks, empty groups dropped. */
export function blocksOf(report: Report): Block[] {
  const blocks: Block[] = []
  const sections = report.sections ?? {}
  const push = (title: string, lines: string[]) => {
    if (lines.length) blocks.push({ title, lines })
  }
  push("Completed", sections.completed ?? [])
  push("Deviations", sections.deviations ?? [])
  push(
    "Hiccups",
    (sections.hiccups ?? []).map(
      (row) => [row.problem, row.cause && `cause: ${row.cause}`, row.fix && `fix: ${row.fix}`].filter(Boolean).join(" | "),
    ),
  )
  push("Failed / skipped", sections.failed ?? [])
  push("Next", sections.next ?? [])
  const answers = report.answers ?? {}
  if (report.kind === "prompt-user") {
    push("Procedures", promptBlocks({ procedures: report.prompts?.procedures }))
    push("Questions", promptBlocks({ questions: report.prompts?.questions }, answers))
  } else {
    push("Needs your decision", promptBlocks(report.prompts, answers))
  }
  return blocks
}

const BLOCK_EMOJI: Record<string, string> = {
  "Completed": "✅",
  "Deviations": "🔀",
  "Hiccups": "🐛",
  "Failed / skipped": "❌",
  "Next": "⏩",
  "Needs your decision": "❓",
  "Procedures": "🏁",
  "Questions": "❓",
}

/** The short label a slot shows: the required description, else the old title. */
export function descriptionOf(report: Report): string {
  return report.description?.trim() || titleOf(report)
}

/** Questions and procedures as prose and lists, not bullets of bullets. */
export function promptMarkdown(prompts: Prompts | undefined, answers: Record<string, string> = {}): string {
  if (!prompts) return ""
  const parts: string[] = []
  const procedures = prompts.procedures ?? []
  if (procedures.length) {
    parts.push("### 🏁 Procedures")
    for (const [index, procedure] of procedures.entries()) {
      parts.push(`**P${index + 1}: ${procedure.title}**`)
      if (procedure.description) parts.push(procedure.description)
      if (procedure.steps.length) parts.push(procedure.steps.map((step, at) => `${at + 1}. ${step}`).join("\n"))
      parts.push("")
    }
  }
  const questions = prompts.questions ?? []
  if (questions.length) {
    parts.push("### ❓ Questions")
    for (const [index, question] of questions.entries()) {
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

/** The record's blocks as Markdown, without the kind heading. */
export function markdownBodyOf(report: Report): string {
  const parts: string[] = []
  const sections = report.sections ?? {}
  const push = (title: string, lines: string[]) => {
    if (!lines.length) return
    parts.push(`### ${BLOCK_EMOJI[title] ?? "•"} ${title}\n\n${lines.map((line) => `- ${line}`).join("\n")}`)
  }
  push("Completed", sections.completed ?? [])
  push("Deviations", sections.deviations ?? [])
  push(
    "Hiccups",
    (sections.hiccups ?? []).map(
      (row) => [row.problem, row.cause && `cause: ${row.cause}`, row.fix && `fix: ${row.fix}`].filter(Boolean).join(" | "),
    ),
  )
  push("Failed / skipped", sections.failed ?? [])
  push("Next", sections.next ?? [])
  if (report.kind === "prompt-user") {
    const prompts = promptMarkdown(report.prompts, report.answers ?? {})
    if (prompts) parts.push(prompts)
  } else if (report.prompts) {
    const prompts = promptMarkdown(report.prompts, report.answers ?? {})
    if (prompts) parts.push(`### ❓ Needs your decision\n\n${prompts.replace(/^### .*\n+/, "")}`)
  }
  return parts.join("\n\n").trim()
}

/** The record as Markdown, for a view's Markdown renderer. */
export function markdownOf(report: Report): string {
  const heading = report.kind === "post-task" ? "## Post Task" : "## Prompts"
  return [heading, "", markdownBodyOf(report)].join("\n").trim()
}

/** A report slot has only two states: unread or read. */
export function reportDotState(report: Report | undefined): "unread" | "read" {
  return report && !report.readAt ? "unread" : "read"
}

/** What a prompt slot says: answer needed, unread, or handled. */
export type DotState = "answer" | "unread" | "read"

export function dotState(report: Report | undefined): DotState {
  if (!report) return "read"
  if (needsAnswer(report)) return "answer"
  return report.readAt ? "read" : "unread"
}

/** The record has questions and no answer or dismissal yet, whichever kind it is. */
export function needsAnswer(report: Report): boolean {
  return (report.prompts?.questions?.length ?? 0) > 0 && !report.answeredAt && !report.dismissedAt
}

/** One report group per session, oldest report first. */
export interface ReportGroup {
  sessionID: string
  reports: Report[]
}

/** The records a section still wants seen: unread reports, unanswered prompts. */
export function attentionOf(reports: readonly Report[], kind: Report["kind"]): Report[] {
  return reports.filter((report) => (kind === "post-task" ? !report.readAt : needsAnswer(report)))
}

/** attentionOf for the TUI's section names, "report" and "prompt". */
export function attentionForSection(
  reports: readonly Report[],
  section: "report" | "prompt",
): Report[] {
  return attentionOf(reports, section === "report" ? "post-task" : "prompt-user")
}

/**
 * The next session group in a list, wrapping at the ends. With `attention`
 * set, a group with nothing needing it is skipped. Used by the history's
 * Ctrl+Up/Down, over the list the history was opened from.
 */
export function nextSessionOf(
  sessions: readonly ReportGroup[],
  currentID: string,
  delta: 1 | -1,
  attention: boolean,
  section: "report" | "prompt",
): ReportGroup | undefined {
  if (sessions.length < 2) return undefined
  const from = sessions.findIndex((group) => group.sessionID === currentID)
  if (from < 0) return undefined
  for (let step = 1; step <= sessions.length; step++) {
    const at = (((from + delta * step) % sessions.length) + sessions.length) % sessions.length
    const group = sessions[at]
    if (!group || group.sessionID === currentID) continue
    if (attention && attentionForSection(group.reports, section).length === 0) continue
    return group
  }
  return undefined
}

/** One kind's reports, grouped per session. The sidebar shows the kinds in separate sections. */
export function groupsOfKind(reports: readonly Report[], kind: Report["kind"]): ReportGroup[] {
  return groupBySession(reports.filter((report) => report.kind === kind))
}

export function groupBySession(reports: readonly Report[]): ReportGroup[] {
  const map = new Map<string, Report[]>()
  for (const report of reports) {
    const list = map.get(report.sessionID)
    if (list) list.push(report)
    else map.set(report.sessionID, [report])
  }
  return [...map.entries()].map(([sessionID, list]) => ({
    sessionID,
    reports: list.slice().sort((a, b) => a.at - b.at),
  }))
}

/** What the reporting session reads after the user answers the prompts. */
export function answerText(report: Report, answers: Record<string, string>): string {
  const lines = [`Answers to "${report.title}":`]
  for (const [index, question] of (report.prompts?.questions ?? []).entries()) {
    const answer = answers[String(index)]?.trim()
    if (answer) lines.push(`${index + 1}. ${question.title}: ${answer}`)
  }
  return lines.join("\n")
}

/** Our form ids carry the report id behind this prefix; other forms do not. */
const FORM_PREFIX = "frm_report_"

/** The native form id for one prompt record. */
export function formIDOf(reportID: string): string {
  return `${FORM_PREFIX}${reportID}`
}

/** The report a native form belongs to, or nothing when the form is not ours. */
export function reportIDOfForm(formID: string): string | undefined {
  const id = String(formID ?? "")
  if (!id.startsWith(FORM_PREFIX)) return undefined
  const reportID = id.slice(FORM_PREFIX.length)
  return reportID || undefined
}

/**
 * The inline form fields for a prompt record: one string field per question,
 * with the recommendation as the first option and free text still allowed.
 */
export function formFieldsOf(report: Report): FormField[] {
  return (report.prompts?.questions ?? []).map((question, index) => {
    const recommendation = question.recommendation?.trim()
    return {
      key: `q${index}`,
      title: question.title || `Question ${index + 1}`,
      ...(question.body ? { description: question.body } : {}),
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
    const text = Array.isArray(value)
      ? value.map((item) => String(item)).filter(Boolean).join(", ")
      : value === undefined || value === null
        ? ""
        : String(value).trim()
    if (text) out[index] = text
  }
  return out
}

/** The first item the list can show, else the first prompt, else a default. */
export function titleOf(report: Report): string {
  const sections = report.sections ?? {}
  const first =
    sections.completed?.[0] ??
    sections.deviations?.[0] ??
    sections.failed?.[0] ??
    sections.next?.[0] ??
    sections.hiccups?.[0]?.problem
  if (first) return first
  const prompt = report.prompts?.questions?.[0]?.title ?? report.prompts?.procedures?.[0]?.title
  if (prompt) return prompt
  return report.kind === "post-task" ? "Post task" : "Prompts"
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

/** The record's age, and its update age when it was revised. */
export function stampOf(report: Report, now = Date.now()): string {
  const created = ago(report.at, now)
  return report.updatedAt && report.updatedAt !== report.at
    ? `${created} · upd ${ago(report.updatedAt, now)}`
    : created
}

/** A stable id for one record: time plus a short random suffix. */
export function reportID(now = Date.now()): string {
  return `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}
