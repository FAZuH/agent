import { needsAnswer, type Prompt, type Question } from "./shared.ts"

type Target = { sessionID: string; promptID: string }
type Delivery = "steer" | "queue"

export interface PromptRPC {
  list(input: { sessionIDs: string[] }): Promise<{ prompts: Prompt[] }>
  answer(input: Target & { answers: Record<string, string>; mode: Delivery }): Promise<{
    ok: boolean
    delivered: boolean
    duplicate?: boolean
    error?: string
  }>
  dismiss(input: Target): Promise<{ ok: boolean }>
  defer(input: Target): Promise<{ ok: boolean }>
  subscribe(listener: (event: { sessionID: string; prompt: Prompt }) => void): () => void
}

export interface PromptViewState {
  prompts: Prompt[]
  loading: boolean
  error?: string
}

export interface PromptDialogs {
  update(state: PromptViewState): void
  question(question: Question, value: string): Promise<string | undefined>
  delivery(): Promise<Delivery | undefined>
  error(message: string): void
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

  const message = (error: unknown) => (error instanceof Error ? error.message : String(error))
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
      update({ prompts: state.prompts, loading: false, error: message(error) })
    }
  }
  const unsubscribe = rpc.subscribe((event) => {
    if (!disposed && family.includes(event.sessionID)) void load(family)
  })
  return {
    load,
    async answer(prompt: Prompt) {
      if (!needsAnswer(prompt)) return
      try {
        const target = { sessionID: prompt.sessionID, promptID: prompt.id }
        const answers: Record<string, string> = {}
        for (const [index, question] of (prompt.prompts?.questions ?? []).entries()) {
          const value = await dialogs.question(question, prompt.answers?.[String(index)] ?? "")
          if (value === undefined) {
            await rpc.defer(target)
            return
          }
          answers[String(index)] = value.trim() || question.recommendation?.trim() || ""
        }
        const mode = await dialogs.delivery()
        if (!mode) {
          await rpc.defer(target)
          return
        }
        const result = await rpc.answer({ ...target, answers, mode })
        if (!result.ok || (!result.delivered && !result.duplicate)) {
          throw new Error(result.error || "Could not deliver answers")
        }
        if (family.length) await load(family)
      } catch (error) {
        dialogs.error(message(error))
      }
    },
    async dismiss(prompt: Prompt) {
      try {
        const result = await rpc.dismiss({ sessionID: prompt.sessionID, promptID: prompt.id })
        if (!result.ok) throw new Error("Could not dismiss prompt")
        if (family.length) await load(family)
      } catch (error) {
        dialogs.error(message(error))
      }
    },
    dispose() {
      disposed = true
      unsubscribe()
    },
  }
}
