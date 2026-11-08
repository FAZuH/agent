// fazuh.report — the post-task report and the prompt-user prompts as records,
// not as plain text at the end of a reply.
//
// The tools replace the two skill blocks: the agent calls one, the user reads
// the Reports view, and the reply keeps only the answer. `report_update`
// patches one record in place so an agent can revise a section without
// repeating the whole report. One name, one owner: the server owns the tools
// and the file store; the TUI (./tui) and GUI (./gui-experimental) halves only
// read and answer through the RPC.
import { Contract } from "./rpc.ts"
import {
  answerText,
  isEmpty,
  promptsOf,
  reportID,
  sectionsOf,
  titleOf,
  type Prompts,
  type Report,
} from "./shared.ts"
import { appendReport, readMany, readReports, updateReport } from "./store.ts"

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

const stringList = { type: "array", items: { type: "string" } } as const
const descriptionSchema = { type: "string", minLength: 1, maxLength: 35 } as const

/** The required short label: trimmed, non-empty, at most 35 characters. */
function shortDescription(value: unknown): string | undefined {
  const text = typeof value === "string" ? value.trim() : ""
  return text && text.length <= 35 ? text : undefined
}

const promptInput = {
  type: "object",
  properties: {
    procedures: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          description: { type: "string" },
          steps: { type: "array", items: { type: "string" } },
        },
        required: ["title", "steps"],
        additionalProperties: false,
      },
    },
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          body: { type: "string" },
          recommendation: { type: "string" },
        },
        required: ["title"],
        additionalProperties: false,
      },
    },
  },
  additionalProperties: false,
} as const

const postTaskInput = {
  type: "object",
  properties: {
    description: descriptionSchema,
    completed: stringList,
    deviations: stringList,
    hiccups: {
      type: "array",
      items: {
        type: "object",
        properties: {
          problem: { type: "string" },
          cause: { type: "string" },
          fix: { type: "string" },
        },
        required: ["problem"],
        additionalProperties: false,
      },
    },
    failed: stringList,
    next: stringList,
  },
  required: ["description"],
  additionalProperties: false,
} as const

const promptUserInput = {
  type: "object",
  properties: {
    description: descriptionSchema,
    ...promptInput.properties,
  },
  required: ["description"],
  additionalProperties: false,
} as const

const updateInput = {
  type: "object",
  properties: {
    id: { type: "string" },
    ...postTaskInput.properties,
  },
  additionalProperties: false,
} as const

export default {
  id: "fazuh.report",
  setup: async (ctx: any) => {
    let emit: ((event: { sessionID: string; report: Report }) => Promise<void>) | undefined

    if (typeof ctx.rpc?.register !== "function") {
      console.error("[report] ctx.rpc.register is unavailable; the views cannot list reports")
    } else {
      try {
        const registration = await ctx.rpc.register(Contract, {
          list: async (input: any) => {
            const ids = Array.isArray(input?.sessionIDs)
              ? input.sessionIDs.filter((id: unknown): id is string => typeof id === "string" && id.length > 0)
              : []
            return { reports: readMany(ids.slice(0, 200)) }
          },
          read: async (input: any) => {
            const sessionID = String(input?.sessionID ?? "")
            const reportID = String(input?.reportID ?? "")
            const report = readReports(sessionID).find((item) => item.id === reportID)
            if (!report) return { ok: false }
            if (report.readAt) return { ok: true }
            const updated = updateReport(sessionID, reportID, (current) => ({
              ...current,
              readAt: Date.now(),
            }))
            if (updated && emit) {
              void emit({ sessionID, report: updated }).catch((cause) =>
                console.error(`[report] emit failed: ${message(cause)}`),
              )
            }
            return { ok: Boolean(updated) }
          },
          answer: async (input: any) => {
            const sessionID = String(input?.sessionID ?? "")
            const reportID = String(input?.reportID ?? "")
            const mode = input?.mode === "queue" ? "queue" : "steer"
            const raw = input?.answers && typeof input.answers === "object" ? input.answers : {}
            const answers: Record<string, string> = {}
            for (const [key, value] of Object.entries(raw)) {
              if (typeof value === "string" && value.trim()) answers[key] = value.trim()
            }
            const report = readReports(sessionID).find((item) => item.id === reportID)
            if (!report) return { ok: false, delivered: false, error: "report not found" }
            let delivered = false
            let error: string | undefined
            try {
              await ctx.session.prompt({
                sessionID,
                text: answerText(report, answers),
                delivery: mode,
              })
              delivered = true
            } catch (cause) {
              error = message(cause)
            }
            const updated = updateReport(sessionID, reportID, (current) => ({
              ...current,
              answers: { ...(current.answers ?? {}), ...answers },
              answeredAt: Date.now(),
            }))
            if (updated && emit) {
              void emit({ sessionID, report: updated }).catch((cause) =>
                console.error(`[report] emit failed: ${message(cause)}`),
              )
            }
            return { ok: true, delivered, ...(error ? { error } : {}) }
          },
          dismiss: async (input: any) => {
            const sessionID = String(input?.sessionID ?? "")
            const reportID = String(input?.reportID ?? "")
            const updated = updateReport(sessionID, reportID, (current) => ({
              ...current,
              dismissedAt: Date.now(),
            }))
            if (updated && emit) {
              void emit({ sessionID, report: updated }).catch((cause) =>
                console.error(`[report] emit failed: ${message(cause)}`),
              )
            }
            return { ok: Boolean(updated) }
          },
        })
        emit = (event) => registration.events.emit("changed", event)
      } catch (error) {
        console.error(`[report] RPC registration failed: ${message(error)}`)
      }
    }

    function save(
      sessionID: string,
      kind: Report["kind"],
      description: string,
      sections: any,
      prompts: Prompts,
    ): Report {
      const at = Date.now()
      const report: Report = {
        id: reportID(),
        kind,
        sessionID,
        at,
        title: "",
        description,
        rev: 1,
        updatedAt: at,
        ...(Object.keys(sections).length ? { sections } : {}),
        ...(prompts.procedures?.length || prompts.questions?.length ? { prompts } : {}),
      }
      report.title = titleOf(report)
      appendReport(report)
      if (emit) void emit({ sessionID, report }).catch((error) => console.error(`[report] emit failed: ${message(error)}`))
      return report
    }

    await ctx.tool.transform((tools: any) => {
      tools.add({
        name: "post_task",
        description:
          "Call this instead of printing the post-task report in your reply. It stores the report in the session's Reports view (TUI sidebar slot, desktop side panel). `description` is required: the short slot label, at most 35 characters. Answer the user in a sentence or two, then call this; do not repeat any section in the reply. Use at the end of a finished task, per the @post-task skill. Anything the user must decide or run goes in a separate prompt_user call.",
        input: postTaskInput,
        execute: async (input: any, tctx: any) => {
          const sessionID = typeof tctx?.sessionID === "string" ? tctx.sessionID : ""
          if (!sessionID) return { content: "post_task failed: no session." }
          const description = shortDescription(input?.description)
          if (!description) {
            return { content: "post_task failed: description is required and must be at most 35 characters." }
          }
          const sections = sectionsOf(input)
          if (isEmpty(sections, {})) return { content: "post_task failed: the report has no sections." }
          try {
            const report = save(sessionID, "post-task", description, sections, {})
            return { content: `Saved as post-task ${report.id}; it is in the Reports view. Do not repeat it here.` }
          } catch (error) {
            return { content: `post_task failed: ${message(error)}` }
          }
        },
      })

      tools.add({
        name: "prompt_user",
        description:
          "Call this instead of printing the prompt-user block in your reply. It stores the procedures and questions in the session's Reports view, where the user can answer them. `description` is required: the short slot label, at most 35 characters. Do not repeat them in the reply. Use when the user must decide something or run steps, per the @prompt-user skill.",
        input: promptUserInput,
        execute: async (input: any, tctx: any) => {
          const sessionID = typeof tctx?.sessionID === "string" ? tctx.sessionID : ""
          if (!sessionID) return { content: "prompt_user failed: no session." }
          const description = shortDescription(input?.description)
          if (!description) {
            return { content: "prompt_user failed: description is required and must be at most 35 characters." }
          }
          const prompts = promptsOf(input)
          if (isEmpty({}, prompts)) return { content: "prompt_user failed: no procedures or questions." }
          try {
            const report = save(sessionID, "prompt-user", description, {}, prompts)
            return { content: `Saved as prompts ${report.id}; they are in the Reports view. Do not repeat them here.` }
          } catch (error) {
            return { content: `prompt_user failed: ${message(error)}` }
          }
        },
      })

      tools.add({
        name: "report_update",
        description:
          "Update one report in the session's Reports view in place, instead of writing a new report that repeats unchanged sections. Pass only the fields that changed; omitted sections keep their values. `id` defaults to this session's latest report; the tool result names the id. Bumps the report's revision.",
        input: updateInput,
        execute: async (input: any, tctx: any) => {
          const sessionID = typeof tctx?.sessionID === "string" ? tctx.sessionID : ""
          if (!sessionID) return { content: "report_update failed: no session." }
          const wanted = String(input?.id ?? "").trim()
          const list = readReports(sessionID)
          const target = wanted ? list.find((report) => report.id === wanted) : list.at(-1)
          if (!target) {
            return {
              content: wanted
                ? `report_update failed: no report ${wanted} in this session.`
                : "report_update failed: this session has no report to update.",
            }
          }
          const sections = sectionsOf(input)
          const description =
            input?.description === undefined ? undefined : shortDescription(input?.description)
          if (input?.description !== undefined && !description) {
            return { content: "report_update failed: description must be 1 to 35 characters." }
          }
          if (!Object.keys(sections).length && description === undefined) {
            return { content: "report_update failed: nothing to update." }
          }
          try {
            const updated = updateReport(sessionID, target.id, (report) => {
              const next: Report = {
                ...report,
                ...(description ? { description } : {}),
                sections: { ...(report.sections ?? {}), ...sections },
                rev: (report.rev ?? 1) + 1,
                updatedAt: Date.now(),
              }
              next.title = titleOf(next)
              return next
            })
            if (!updated) return { content: "report_update failed: the report disappeared." }
            if (emit) {
              void emit({ sessionID, report: updated }).catch((error) =>
                console.error(`[report] emit failed: ${message(error)}`),
              )
            }
            return { content: `Updated report ${updated.id} (rev ${updated.rev}); the view shows it now.` }
          } catch (error) {
            return { content: `report_update failed: ${message(error)}` }
          }
        },
      })
    })

  },
}
