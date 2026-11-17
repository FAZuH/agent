import type { Prompt } from "./shared.ts"

export interface PromptRPC {
  list(input: { sessionIDs: string[] }): Promise<{ prompts: Prompt[] }>
  reopen(input: { sessionID: string; promptID?: string }): Promise<{ ok: boolean; reason?: string }>
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
      const result = await rpc.list({ sessionIDs })
      if (disposed || request !== generation) return
      update({ prompts: result.prompts, loading: false })
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
    dispose() {
      disposed = true
      unsubscribe()
    },
  }
}
