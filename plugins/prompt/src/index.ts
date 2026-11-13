// fazuh.prompt — the prompt-user prompts as records, not as plain text at the
// end of a reply.
//
// The tool replaces the skill block: the agent calls `prompt_user`, the user
// answers in the Prompts view, and the reply keeps only the answer. One name,
// one owner: the server owns the tool and the file store; the TUI (./tui)
// half only reads and answers through the RPC.
import { Contract } from "./rpc.ts"
import { answerText, isEmpty, promptsOf, promptID, type Prompt, type Prompts } from "./shared.ts"
import { appendPrompt, claimPrompt, readMany, readPrompts, updatePrompt } from "./store.ts"

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

type BlockOutcome =
  | { type: "answered"; answers: Record<string, string> }
  | { type: "dismissed" }
  | { type: "deferred" }
  | { type: "aborted" }

/**
 * Host state that must outlive one plugin setup. The server loads the plugin
 * per location, so a `prompt_user` call can run in one instance while its
 * answer RPC lands on another; the waiter would then never resolve and the
 * session would stay blocked. The same registry also lets whichever instance
 * registered last emit the `changed` event.
 */
interface PromptRuntime {
  blocked: Map<string, (outcome: BlockOutcome) => void>
  emit?: (event: { sessionID: string; prompt: Prompt }) => Promise<void>
}

const runtimeKey = Symbol.for("fazuh.prompt.runtime")
const runtime: PromptRuntime = ((globalThis as any)[runtimeKey] ??= { blocked: new Map() })

const promptInput = {
  type: "object",
  properties: {
    description: { type: "string", minLength: 1, maxLength: 35 },
    block: {
      type: "boolean",
      description:
        "Wait for the user to answer before returning. Requires at least one question. The tool result carries the answers, or says the user dismissed or deferred the prompt.",
    },
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
  required: ["description"],
  additionalProperties: false,
} as const

/** The required short label: trimmed, non-empty, at most 35 characters. */
function shortDescription(value: unknown): string | undefined {
  const text = typeof value === "string" ? value.trim() : ""
  return text && text.length <= 35 ? text : undefined
}

export default {
  id: "fazuh.prompt",
  setup: async (ctx: any) => {
    if (typeof ctx.rpc?.register !== "function") {
      console.error("[prompt] ctx.rpc.register is unavailable; the view cannot list prompts")
    } else {
      try {
        const registration = await ctx.rpc.register(Contract, {
          list: async (input: any) => {
            const ids = Array.isArray(input?.sessionIDs)
              ? input.sessionIDs.filter((id: unknown): id is string => typeof id === "string" && id.length > 0)
              : []
            return { prompts: readMany(ids.slice(0, 200)) }
          },
          answer: async (input: any) => {
            const sessionID = String(input?.sessionID ?? "")
            const promptID = String(input?.promptID ?? "")
            const mode = input?.mode === "queue" ? "queue" : "steer"
            const raw = input?.answers && typeof input.answers === "object" ? input.answers : {}
            const answers: Record<string, string> = {}
            for (const [key, value] of Object.entries(raw)) {
              if (typeof value === "string" && value.trim()) answers[key] = value.trim()
            }
            const prompt = readPrompts(sessionID).find((item) => item.id === promptID)
            if (!prompt) return { ok: false, delivered: false, error: "prompt not found" }
            // One answer per record. A second call comes from a repeated
            // keybind or a leaked handler, and each prompt call posts its own
            // message, so without this claim the same text lands in the chat
            // twice. A blocking prompt_user resolves through the waiter below
            // and never posts the text at all.
            const claimed = claimPrompt(
              sessionID,
              promptID,
              (current) => Boolean(current.answeredAt),
              (current) => ({
                ...current,
                answers: { ...(current.answers ?? {}), ...answers },
                answeredAt: Date.now(),
              }),
            )
            if (!claimed) return { ok: true, delivered: false, duplicate: true }
            if (runtime.emit) {
              void runtime.emit({ sessionID, prompt: claimed }).catch((cause) =>
                console.error(`[prompt] emit failed: ${message(cause)}`),
              )
            }
            const waiter = runtime.blocked.get(promptID)
            if (waiter) {
              runtime.blocked.delete(promptID)
              waiter({ type: "answered", answers })
              return { ok: true, delivered: true }
            }
            let delivered = false
            let error: string | undefined
            try {
              await ctx.session.prompt({
                sessionID,
                text: answerText(claimed, answers),
                delivery: mode,
              })
              delivered = true
            } catch (cause) {
              error = message(cause)
              // Nothing reached the agent, so release the claim and let the
              // next answer try again.
              const released = updatePrompt(sessionID, promptID, (current) => ({
                ...current,
                answeredAt: undefined,
              }))
              if (released && runtime.emit) {
                void runtime.emit({ sessionID, prompt: released }).catch((cause) =>
                  console.error(`[prompt] emit failed: ${message(cause)}`),
                )
              }
            }
            return { ok: true, delivered, ...(error ? { error } : {}) }
          },
          dismiss: async (input: any) => {
            const sessionID = String(input?.sessionID ?? "")
            const promptID = String(input?.promptID ?? "")
            const waiter = runtime.blocked.get(promptID)
            runtime.blocked.delete(promptID)
            try {
              const updated = updatePrompt(sessionID, promptID, (current) => ({
                ...current,
                dismissedAt: Date.now(),
              }))
              if (updated && runtime.emit) {
                void runtime.emit({ sessionID, prompt: updated }).catch((cause) =>
                  console.error(`[prompt] emit failed: ${message(cause)}`),
                )
              }
              return { ok: Boolean(updated) }
            } finally {
              waiter?.({ type: "dismissed" })
            }
          },
          defer: async (input: any) => {
            const promptID = String(input?.promptID ?? "")
            const waiter = runtime.blocked.get(promptID)
            runtime.blocked.delete(promptID)
            waiter?.({ type: "deferred" })
            return { ok: true }
          },
        })
        runtime.emit = (event) => registration.events.emit("changed", event)
      } catch (error) {
        console.error(`[prompt] RPC registration failed: ${message(error)}`)
      }
    }

    function save(sessionID: string, description: string, prompts: Prompts): Prompt {
      const at = Date.now()
      const prompt: Prompt = {
        id: promptID(),
        sessionID,
        at,
        title: "",
        description,
        prompts,
      }
      prompt.title = prompts.questions?.[0]?.title ?? prompts.procedures?.[0]?.title ?? "Prompts"
      appendPrompt(prompt)
      if (runtime.emit)
        void runtime.emit({ sessionID, prompt }).catch((error) =>
          console.error(`[prompt] emit failed: ${message(error)}`),
        )
      return prompt
    }

    await ctx.tool.transform((tools: any) => {
      tools.add({
        name: "prompt_user",
        description:
          "Call this instead of printing the prompt-user block in your reply. It stores the procedures and questions in the session's Prompts view (TUI sidebar), where the user can answer them. `description` is required: the short slot label, at most 35 characters. Do not repeat them in the reply. Set `block: true` to wait for an answer in this turn; the tool result carries it. Blocking needs at least one question. Use when the user must decide something or run steps, per the @prompt-user skill.",
        input: promptInput,
        execute: async (input: any, tctx: any) => {
          const sessionID = typeof tctx?.sessionID === "string" ? tctx.sessionID : ""
          if (!sessionID) return { content: "prompt_user failed: no session." }
          const description = shortDescription(input?.description)
          if (!description) {
            return { content: "prompt_user failed: description is required and must be at most 35 characters." }
          }
          const prompts = promptsOf(input)
          if (isEmpty(prompts)) return { content: "prompt_user failed: no procedures or questions." }
          const block = input?.block === true
          if (block && !(prompts.questions?.length ?? 0)) {
            return { content: "prompt_user failed: block requires at least one question." }
          }
          try {
            const prompt = save(sessionID, description, prompts)
            if (!block) {
              return { content: `Saved as prompt ${prompt.id}; it is in the Prompts view. Do not repeat it here.` }
            }
            const outcome = await new Promise<BlockOutcome>((resolve) => {
              runtime.blocked.set(prompt.id, resolve)
              // The turn can be interrupted while the prompt waits. Drop the
              // waiter so a later answer falls back to a normal user message
              // instead of resolving a tool call that no longer exists.
              const signal = tctx?.abort
              if (!signal || typeof signal.addEventListener !== "function") return
              const onAbort = () => {
                if (runtime.blocked.get(prompt.id) !== resolve) return
                runtime.blocked.delete(prompt.id)
                resolve({ type: "aborted" })
              }
              if (signal.aborted) onAbort()
              else signal.addEventListener("abort", onAbort, { once: true })
            })
            if (outcome.type === "answered") {
              const latest = readPrompts(sessionID).find((item) => item.id === prompt.id) ?? prompt
              return { content: answerText(latest, outcome.answers) }
            }
            if (outcome.type === "dismissed") {
              return { content: "The user dismissed the prompt without answering it." }
            }
            if (outcome.type === "aborted") {
              return {
                content: "The prompt was interrupted; the answer will arrive as a new message.",
              }
            }
            return {
              content: "The user deferred the prompt; the answer will arrive as a new message.",
            }
          } catch (error) {
            return { content: `prompt_user failed: ${message(error)}` }
          }
        },
      })
    })
  },
}
