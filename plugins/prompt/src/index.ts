// fazuh.prompt — the prompt-user prompts as records, not as plain text at the
// end of a reply. The server owns the tool, the record store, and the native
// question card; the TUI and Desktop halves only read and answer through RPC.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

import { cancelNativeForm, openNativeForm } from "./form.ts"
import {
  Contract,
  DEFAULT_SETTINGS,
  SETTING_KEYS,
  type SettingKey,
  type SettingsInfo,
} from "./rpc.ts"
import {
  answerText,
  answersOfForm,
  isEmpty,
  promptsOf,
  promptID,
  promptIDOfForm,
  type Prompt,
  type Prompts,
} from "./shared.ts"
import { appendPrompt, claimPrompt, PROMPTS_DIR, readMany, readPrompts, updatePrompt } from "./store.ts"

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** The visibility toggles live beside the prompt records, in one state home. */
const SETTINGS_FILE = join(dirname(PROMPTS_DIR), "settings.json")

/** Missing, partial, or broken settings fall back to the shipped defaults. */
export function readSettings(): SettingsInfo {
  try {
    const row = JSON.parse(readFileSync(SETTINGS_FILE, "utf8")) as Record<string, unknown> | null
    return {
      sidebar: row?.sidebar !== false,
      showPrompts: row?.showPrompts !== false,
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

/** Validate one toggle and persist it atomically. No fields beyond the two keys. */
export function writeSetting(key: unknown, value: unknown): { ok: boolean; error?: string } {
  if (!SETTING_KEYS.includes(key as SettingKey)) return { ok: false, error: "invalid setting key" }
  if (typeof value !== "boolean") return { ok: false, error: "value must be a boolean" }
  const next = { ...readSettings(), [key as SettingKey]: value }
  mkdirSync(dirname(SETTINGS_FILE), { recursive: true })
  const temp = `${SETTINGS_FILE}.${process.pid}.tmp`
  writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", mode: 0o600 })
  renameSync(temp, SETTINGS_FILE)
  return { ok: true }
}

type BlockOutcome =
  | { type: "answered"; answers: Record<string, string> }
  | { type: "dismissed" }
  | { type: "deferred" }
  | { type: "aborted" }

type ChangedEvent = { topic: "prompt"; sessionID: string; prompt: Prompt } | { topic: "settings" }

/**
 * Host state that must outlive one plugin setup. The server loads the plugin
 * per location, so a `prompt_user` call can run in one instance while its
 * answer RPC or form event lands on another. The waiter would then never
 * resolve and the session would stay blocked.
 */
interface PromptRuntime {
  blocked: Map<string, (outcome: BlockOutcome) => void>
  forms: Map<string, string>
  emit?: (event: ChangedEvent) => Promise<void>
}

const runtimeKey = Symbol.for("fazuh.prompt.runtime")
// A hot reload keeps the old global object on globalThis. Fill missing fields
// instead of replacing it, so pending waiters from the previous code survive.
const previous: Partial<PromptRuntime> = (globalThis as any)[runtimeKey] ?? {}
const runtime: PromptRuntime = ((globalThis as any)[runtimeKey] = {
  blocked: previous.blocked ?? new Map(),
  forms: previous.forms ?? new Map(),
  emit: previous.emit,
})

const promptInput = {
  type: "object",
  properties: {
    description: { type: "string", minLength: 1, maxLength: 35 },
    block: {
      type: "boolean",
      default: false,
      description:
        "Wait for the answer in this turn. Off by default: omit it so the call returns immediately and the answer arrives as a new message. Set it only when the user explicitly asks to wait. Requires at least one question; the tool result then carries the answer, dismissal, or deferral.",
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
    function emitChanged(prompt: Prompt): void {
      if (!runtime.emit) return
      void runtime.emit({ topic: "prompt", sessionID: prompt.sessionID, prompt }).catch((cause) =>
        console.error(`[prompt] emit failed: ${message(cause)}`),
      )
    }

    function dropForm(sessionID: string, promptID: string): void {
      const formID = runtime.forms.get(promptID)
      if (formID) void cancelNativeForm(sessionID, formID)
      runtime.forms.delete(promptID)
    }

    /**
     * The host shows one question card at a time and queues the rest. Reopening
     * a card means replacing the one on screen, so close every card this plugin
     * opened in the session before showing the new one. A prompt's record stays
     * unanswered; only its card goes away.
     */
    async function closeSessionForms(sessionID: string): Promise<void> {
      const owned = new Set(readPrompts(sessionID).map((prompt) => prompt.id))
      const pending: Promise<void>[] = []
      for (const [promptID, formID] of runtime.forms) {
        if (!owned.has(promptID)) continue
        pending.push(cancelNativeForm(sessionID, formID))
        runtime.forms.delete(promptID)
      }
      await Promise.all(pending)
    }

    /** One answer per record, then either the waiter or the reporting session. */
    async function settleAnswer(
      sessionID: string,
      promptID: string,
      answers: Record<string, string>,
      mode: "steer" | "queue",
    ) {
      const prompt = readPrompts(sessionID).find((item) => item.id === promptID)
      if (!prompt) return { ok: false, delivered: false, error: "prompt not found" }
      // One answer per record. A second call comes from a repeated keybind, a
      // leaked handler, or the native card and the panel being answered both.
      const claimed = claimPrompt(
        sessionID,
        promptID,
        (current) => Boolean(current.answeredAt),
        (current) => ({
          ...current,
          answers: { ...(current.answers ?? {}), ...answers },
          answeredAt: Date.now(),
          revision: (current.revision ?? 0) + 1,
        }),
      )
      if (!claimed) return { ok: true, delivered: false, duplicate: true }
      runtime.forms.delete(promptID)
      emitChanged(claimed)
      const waiter = runtime.blocked.get(promptID)
      if (waiter) {
        runtime.blocked.delete(promptID)
        waiter({ type: "answered", answers })
        return { ok: true, delivered: true }
      }
      let delivered = false
      let error: string | undefined
      try {
        await ctx.session.prompt({ sessionID, text: answerText(claimed, answers), delivery: mode })
        delivered = true
      } catch (cause) {
        error = message(cause)
        // Nothing reached the agent, so release the claim and let the next
        // answer try again.
        const released = updatePrompt(sessionID, promptID, (current) => ({
          ...current,
          answeredAt: undefined,
          revision: (current.revision ?? 0) + 1,
        }))
        if (released) emitChanged(released)
      }
      return { ok: true, delivered, ...(error ? { error } : {}) }
    }

    function settleDismiss(sessionID: string, promptID: string) {
      const waiter = runtime.blocked.get(promptID)
      runtime.blocked.delete(promptID)
      dropForm(sessionID, promptID)
      const updated = updatePrompt(sessionID, promptID, (current) => ({
        ...current,
        dismissedAt: Date.now(),
        revision: (current.revision ?? 0) + 1,
      }))
      if (updated) emitChanged(updated)
      waiter?.({ type: "dismissed" })
      return { ok: Boolean(updated) }
    }

    function settleDefer(sessionID: string, promptID: string) {
      const waiter = runtime.blocked.get(promptID)
      runtime.blocked.delete(promptID)
      dropForm(sessionID, promptID)
      const updated = updatePrompt(sessionID, promptID, (current) => ({
        ...current,
        deferredAt: Date.now(),
        revision: (current.revision ?? 0) + 1,
      }))
      if (updated) emitChanged(updated)
      waiter?.({ type: "deferred" })
      return { ok: true }
    }

    /** Reopen one prompt, or the newest unanswered one, as a fresh card. */
    async function reopenLatest(sessionID: string, promptID?: string): Promise<{ ok: boolean; reason?: string }> {
      if (!sessionID) return { ok: false, reason: "no session" }
      const prompts = readPrompts(sessionID)
      const target = promptID
        ? prompts.find((item) => item.id === promptID)
        : prompts
            .slice()
            .reverse()
            .find(
              (prompt) =>
                !prompt.answeredAt &&
                !prompt.dismissedAt &&
                (prompt.prompts?.questions?.length ?? 0) > 0,
            )
      if (!target) {
        return {
          ok: false,
          reason: promptID ? "That prompt is no longer available." : "No unanswered prompts in this session.",
        }
      }
      if (!(target.prompts?.questions?.length ?? 0)) {
        return { ok: false, reason: "That prompt has no questions to show as a card." }
      }
      await closeSessionForms(sessionID)
      const opened = await openNativeForm(target, true)
      if (!opened?.created) return { ok: false, reason: "Could not reopen the prompt as a question card." }
      runtime.forms.set(target.id, opened.id)
      if (target.deferredAt) {
        const updated = claimPrompt(
          sessionID,
          target.id,
          (current) => JSON.stringify(current) !== JSON.stringify(target),
          (current) => ({
            ...current,
            deferredAt: undefined,
            revision: (current.revision ?? 0) + 1,
          }),
        )
        if (updated) emitChanged(updated)
      }
      return { ok: true }
    }

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
            return settleAnswer(sessionID, promptID, answers, mode)
          },
          dismiss: async (input: any) =>
            settleDismiss(String(input?.sessionID ?? ""), String(input?.promptID ?? "")),
          defer: async (input: any) => settleDefer(String(input?.sessionID ?? ""), String(input?.promptID ?? "")),
          reopen: async (input: any) =>
            reopenLatest(
              String(input?.sessionID ?? ""),
              typeof input?.promptID === "string" ? input.promptID : undefined,
            ),
          dismissAll: async (input: any) => {
            const ids = Array.isArray(input?.sessionIDs)
              ? input.sessionIDs.filter((id: unknown): id is string => typeof id === "string" && id.length > 0)
              : []
            let count = 0
            for (const sessionID of ids.slice(0, 200)) {
              // Read first: settleDismiss emits a changed event and closes any
              // open card, so the snapshot keeps this pass to its own prompts.
              for (const prompt of readPrompts(sessionID)) {
                if (!prompt.answeredAt && !prompt.dismissedAt && settleDismiss(sessionID, prompt.id).ok) count++
              }
            }
            return { ok: true, count }
          },
          getSettings: async () => readSettings(),
          setSetting: async (input: any) => {
            const result = writeSetting(input?.key, input?.value)
            if (result.ok) {
              void registration.events.emit("changed", { topic: "settings" }).catch((cause: unknown) =>
                console.error(`[prompt] settings emit failed: ${message(cause)}`),
              )
            }
            return result
          },
        })
        runtime.emit = (event) => registration.events.emit("changed", event)
      } catch (error) {
        console.error(`[prompt] RPC registration failed: ${message(error)}`)
      }
    }

    // The native card is answered on any client, including ones with no
    // plugin UI half. Settle the same record the RPC handlers settle.
    try {
      if (typeof ctx?.event?.subscribe === "function") {
        const stream = ctx.event.subscribe({ types: ["form.replied", "form.cancelled"] })
        if (stream) {
          void (async () => {
            for await (const event of stream) {
              const promptID = promptIDOfForm(String(event?.data?.id ?? ""))
              if (!promptID) continue
              const sessionID = String(event?.data?.sessionID ?? "")
              if (!sessionID) continue
              if (event.type === "form.replied") {
                await settleAnswer(sessionID, promptID, answersOfForm(event?.data?.answer), "steer")
              } else if (event.type === "form.cancelled") {
                settleDefer(sessionID, promptID)
              }
            }
          })()
        }
      }
    } catch (error) {
      console.error(`[prompt] form event subscription failed: ${message(error)}`)
    }

    function save(sessionID: string, description: string, prompts: Prompts): Prompt {
      const prompt: Prompt = {
        id: promptID(),
        sessionID,
        at: Date.now(),
        title: "",
        description,
        prompts,
      }
      prompt.title = prompts.questions?.[0]?.title ?? prompts.procedures?.[0]?.title ?? "Prompts"
      appendPrompt(prompt)
      return prompt
    }

    async function openCard(prompt: Prompt, reopen = false): Promise<void> {
      const opened = await openNativeForm(prompt, reopen)
      if (opened) runtime.forms.set(prompt.id, opened.id)
    }

    await ctx.tool.transform((tools: any) => {
      tools.add({
        name: "prompt_list",
        description:
          "Read stored questions, procedures, status and answers from the caller session only. Read-only: does not reopen, answer or dismiss prompts. Use for recovery before asking again. Pending, deferred, dismissed or missing answers never imply approval.",
        input: {
          type: "object",
          properties: {
            promptID: { type: "string" },
            status: { type: "string", enum: ["pending", "answered", "dismissed", "deferred"] },
            limit: { type: "integer", minimum: 1, maximum: 50, default: 10 },
            offset: { type: "integer", minimum: 0, default: 0 },
          },
          additionalProperties: false,
        },
        execute: async (input: any, tctx: any) => {
          const sessionID = typeof tctx?.sessionID === "string" ? tctx.sessionID : ""
          if (!sessionID) return { content: "prompt_list failed: no session." }
          if (
            !input ||
            typeof input !== "object" ||
            Array.isArray(input) ||
            Object.keys(input).some((key) => !["promptID", "status", "limit", "offset"].includes(key)) ||
            (input.promptID !== undefined && typeof input.promptID !== "string") ||
            (input.limit !== undefined &&
              (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 50)) ||
            (input.offset !== undefined && (!Number.isSafeInteger(input.offset) || input.offset < 0))
          ) {
            return { content: JSON.stringify({ error: "invalid prompt_list filters" }) }
          }
          if (
            input?.status !== undefined &&
            !["pending", "answered", "dismissed", "deferred"].includes(input.status)
          ) {
            return { content: JSON.stringify({ error: "invalid status" }) }
          }
          const matching = readPrompts(sessionID)
            .filter((prompt) => prompt.sessionID === sessionID)
            .reverse()
            .map((prompt) => ({
              ...prompt,
              status: prompt.answeredAt
                ? "answered"
                : prompt.dismissedAt
                  ? "dismissed"
                  : prompt.deferredAt
                    ? "deferred"
                    : "pending",
            }))
            .filter((prompt) => input?.promptID === undefined || prompt.id === input.promptID)
            .filter((prompt) => input?.status === undefined || prompt.status === input.status)
          const offset = input.offset ?? 0
          const limit = input.limit ?? 10
          const prompts: unknown[] = []
          let cursor = offset
          for (const prompt of matching.slice(offset, offset + limit)) {
            const record =
              Buffer.byteLength(JSON.stringify(prompt)) > 60_000
                ? { id: prompt.id.slice(0, 200), status: prompt.status, contentOmitted: true }
                : prompt
            const candidate = JSON.stringify({
              prompts: [...prompts, record],
              nextOffset: cursor + 1 < matching.length ? cursor + 1 : null,
            })
            if (Buffer.byteLength(candidate) > 64_000) break
            prompts.push(record)
            cursor++
          }
          return {
            content: JSON.stringify({
              prompts,
              nextOffset: cursor < matching.length ? cursor : null,
            }),
          }
        },
      })
      tools.add({
        name: "prompt_user",
        description:
          "Call this instead of printing the prompt-user block in your reply. It stores the procedures and questions, opens them as a native question card on every client, and lists them in the Prompts view. `description` is required: the short slot label, at most 35 characters. Do not repeat them in the reply. Calls are non-blocking by default: the tool returns immediately and the answer arrives as a new message. Set `block: true` only when the user explicitly asks to wait for the answer in this turn; blocking needs at least one question. Use when the user must decide something or run steps, per the @prompt-user skill.",
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
            // Register the waiter before any await: an answer can land the
            // moment the record reaches the store.
            const waiting = block
              ? new Promise<BlockOutcome>((resolve) => {
                  runtime.blocked.set(prompt.id, resolve)
                  // The turn can be interrupted while the prompt waits. Drop
                  // the waiter and the card so a late answer falls back to a
                  // message.
                  const signal = tctx?.abort
                  if (!signal || typeof signal.addEventListener !== "function") return
                  const onAbort = () => {
                    if (runtime.blocked.get(prompt.id) !== resolve) return
                    runtime.blocked.delete(prompt.id)
                    dropForm(sessionID, prompt.id)
                    resolve({ type: "aborted" })
                  }
                  if (signal.aborted) onAbort()
                  else signal.addEventListener("abort", onAbort, { once: true })
                })
              : undefined
            await openCard(prompt)
            emitChanged(prompt)
            if (!waiting) {
              return {
                content: `Saved as prompt ${prompt.id}; it is in the Prompts view and open as a question card. Do not repeat it here.`,
              }
            }
            const outcome = await waiting
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

    await ctx.command.transform((draft: any) => {
      draft.add({
        name: "prompt-latest",
        description: "Reopen the latest unanswered prompt as a question card.",
        execute: async (input: any) => {
          const sessionID = String(input?.sessionID ?? "")
          const result = await reopenLatest(sessionID)
          if (!result.ok && result.reason && sessionID) {
            await ctx.session.synthetic({ sessionID, text: result.reason, resume: false })
          }
        },
      })
    })
  },
}
