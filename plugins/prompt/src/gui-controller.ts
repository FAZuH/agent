import type { Prompt } from "./shared.ts"

const MAX_SESSION_IDS = 200

export type PromptTab = "awaiting" | "answered" | "dismissed"

export function tabOf(prompt: Prompt): PromptTab {
  if (prompt.answeredAt != null) return "answered"
  if (prompt.dismissedAt != null) return "dismissed"
  return "awaiting"
}

export interface PromptRPC {
  list(input: { sessionIDs: string[] }): Promise<{ prompts: Prompt[] }>
  reopen(input: { sessionID: string; promptID?: string }): Promise<{ ok: boolean; reason?: string }>
  dismiss(input: { sessionID: string; promptID: string }): Promise<{ ok: boolean }>
  dismissAll(input: { sessionIDs: string[] }): Promise<{ ok: boolean; count: number }>
  subscribe(listener: (event: { sessionID: string; prompt: Prompt }) => void): () => void
}

export interface PromptViewState {
  prompts: Prompt[]
  loading: boolean
  error?: string
}

export interface PromptDialogs {
  update(state: PromptViewState): void
  error(message: string): void
}

/**
 * RPC failures reach the GUI as plain objects, not Error instances. String()
 * on those gives "[object Object]", so read the message they carry instead.
 */
export function errorText(error: unknown, depth = 0): string {
  if (error instanceof Error) return error.message || error.name
  if (typeof error === "string") return error
  if (error && typeof error === "object" && depth < 3) {
    const value = error as Record<string, unknown>
    for (const key of ["message", "error", "reason", "description"]) {
      const text = value[key]
      if (typeof text === "string" && text.trim()) return text
      if (text && typeof text === "object") {
        const nested = errorText(text, depth + 1)
        if (nested && nested !== "[object Object]") return nested
      }
    }
  }
  return String(error)
}

export function createPromptView(rpc: PromptRPC, dialogs: PromptDialogs) {
  let family: string[] = []
  let generation = 0
  let disposed = false
  let state: PromptViewState = { prompts: [], loading: false }
  const update = (next: PromptViewState) => {
    state = next
    dialogs.update(state)
  }

  async function load(sessionIDs: string[]) {
    if (disposed) return
    const request = ++generation
    const same = family.join("\0") === sessionIDs.join("\0")
    family = sessionIDs.slice()
    update({ prompts: same ? state.prompts : [], loading: true })
    try {
      // The list contract accepts at most 200 session ids per call. A large
      // session family would otherwise fail validation and blank the panel.
      const ids = [...new Set(sessionIDs)]
      const batches: string[][] = []
      for (let at = 0; at < ids.length; at += MAX_SESSION_IDS) {
        batches.push(ids.slice(at, at + MAX_SESSION_IDS))
      }
      const results = await Promise.all(batches.map((batch) => rpc.list({ sessionIDs: batch })))
      if (disposed || request !== generation) return
      update({ prompts: results.flatMap((result) => result.prompts), loading: false })
    } catch (error) {
      if (disposed || request !== generation) return
      update({ prompts: state.prompts, loading: false, error: errorText(error) })
    }
  }

  const unsubscribe = rpc.subscribe((event) => {
    if (!disposed && family.includes(event.sessionID)) void load(family)
  })

  return {
    load,
    /** Reopen one prompt or the latest in the family as a native question card. */
    async reopen(sessionID: string, promptID?: string) {
      try {
        const result = await rpc.reopen({ sessionID, promptID })
        if (!result.ok) {
          dialogs.error(result.reason || "Could not reopen the question card")
          return
        }
        if (family.length) await load(family)
      } catch (error) {
        dialogs.error(errorText(error))
      }
    },
    /** Dismiss one prompt and refresh the family. */
    async dismiss(sessionID: string, promptID: string) {
      try {
        const result = await rpc.dismiss({ sessionID, promptID })
        if (!result.ok) {
          dialogs.error("Could not dismiss the prompt")
          return
        }
        if (family.length) await load(family)
      } catch (error) {
        dialogs.error(errorText(error))
      }
    },
    /** Dismiss every awaiting prompt in the family and refresh once. */
    async dismissAll(sessionIDs: string[]): Promise<number> {
      try {
        const ids = [...new Set(sessionIDs)]
        let count = 0
        for (let at = 0; at < ids.length; at += MAX_SESSION_IDS) {
          const result = await rpc.dismissAll({ sessionIDs: ids.slice(at, at + MAX_SESSION_IDS) })
          count += result.count
        }
        if (family.length) await load(family)
        return count
      } catch (error) {
        dialogs.error(errorText(error))
        return 0
      }
    },
    dispose() {
      disposed = true
      unsubscribe()
    },
  }
}
