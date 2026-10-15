/**
 * fazuh.ralph — the Ralph Wiggum loop, in the session that started it.
 *
 * Same idea as the upstream plugin: one prompt, fed back to the model until it
 * is done. The prompt never changes; what changes is the repository, so each
 * iteration reads the previous one's work and improves it. Upstream blocks the
 * Stop hook; OpenCode v2 has no such hook, so the loop rides session events:
 * `session.text.ended` remembers what the model last said, and `session.idle`
 * decides whether to finish, stop, or prompt again.
 *
 * One loop per session, held in memory. A plugin reload therefore stops any
 * running loop rather than resurrecting one that can no longer be watched —
 * `/ralph-status` says when that happened. Every decision is appended to
 * ralph-loops.jsonl, which the TUI tail turns into toasts.
 */

import { appendFileSync, mkdirSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

import { DEFAULT_COMPLETION_PROMISE, decide, iterationPrompt, parseArgs, status, USAGE, type LoopState } from "./loop.ts"

export const LOG_FILE =
  process.env.RALPH_LOG ?? join(process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"), "fazuh-agent", "ralph-loops.jsonl")

const loops = new Map<string, LoopState>()
const lastText = new Map<string, string>()

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

function log(event: string, data: Record<string, unknown> = {}): void {
  try {
    mkdirSync(dirname(LOG_FILE), { recursive: true })
    appendFileSync(LOG_FILE, `${JSON.stringify({ ts: new Date().toISOString(), event, ...data })}\n`)
  } catch (error) {
    // A log that cannot be written must not stop the loop, but say so once.
    console.error(`[ralph] log write failed: ${message(error)}`)
  }
}

/** End a loop and say why in the log. Returns the iteration it stopped at. */
function stopLoop(sessionID: string, event: string): number | undefined {
  const state = loops.get(sessionID)
  if (!state) return undefined
  loops.delete(sessionID)
  lastText.delete(sessionID)
  log(event, { sessionID, iteration: state.iteration })
  return state.iteration
}

/**
 * A turn ended. Finish, stop, or feed the same prompt back. A failed re-prompt
 * ends the loop: without a turn there is no next event, and a loop that cannot
 * prompt is not a loop.
 */
async function onTurnEnd(ctx: any, sessionID: string): Promise<void> {
  const state = loops.get(sessionID)
  if (!state) return
  const decision = decide(state, lastText.get(sessionID) ?? "")

  if (decision.kind === "continue") {
    loops.set(sessionID, decision.next)
    log("iterate", { sessionID, iteration: decision.next.iteration, maxIterations: decision.next.maxIterations })
    try {
      await ctx.session.prompt({ sessionID, text: iterationPrompt(decision.next) })
    } catch (error) {
      stopLoop(sessionID, "error")
      log("error", { sessionID, iteration: decision.next.iteration, error: message(error) })
    }
    return
  }

  stopLoop(sessionID, decision.kind)
}

export default {
  id: "fazuh.ralph",
  tui: true,

  setup: async (ctx: any) => {
    const controller = new AbortController()
    void (async () => {
      try {
        const stream = ctx.event?.subscribe?.({ signal: controller.signal })
        if (!stream) {
          log("error", { error: "ctx.event.subscribe is unavailable on this host; the loop cannot run" })
          return
        }
        for await (const event of stream) {
          const type = String(event?.type ?? "")
          const data = event?.data ?? {}
          const sessionID = String(data.sessionID ?? "")
          if (!sessionID) continue
          if (type === "session.text.ended") lastText.set(sessionID, String(data.text ?? ""))
          // v2.0.28 has no Stop hook and no `session.idle` on the wire. The turn
          // ending is `session.execution.succeeded` (or `failed`); measured, not
          // documented. An interrupt ends the loop: a human pressing esc outranks
          // an unattended iteration.
          else if (type === "session.execution.succeeded") await onTurnEnd(ctx, sessionID)
          else if (type === "session.execution.failed") await onTurnEnd(ctx, sessionID)
          else if (type === "session.execution.interrupted") stopLoop(sessionID, "interrupted")
        }
      } catch (error) {
        if (!controller.signal.aborted) log("error", { error: message(error) })
      }
    })()

    await ctx.command.transform((draft: any) => {
      draft.add({
        name: "ralph-loop",
        description: `Start a self-referential iteration loop in this session. Usage: /ralph-loop <task> [--max-iterations N] [--completion-promise TEXT] [--abort-promise TEXT]`,
        execute: async (input: any) => {
          const parsed = parseArgs(String(input?.prompt?.text ?? ""))
          if (!parsed.ok) return { content: parsed.error }
          const sessionID: string | undefined = input?.sessionID
          if (!sessionID) return { content: `ralph-loop failed: no session. ${USAGE}` }
          const state: LoopState = {
            sessionID,
            ...parsed.options,
            iteration: 1,
            emptyStreak: 0,
            startedAt: Date.now(),
          }
          loops.set(sessionID, state)
          lastText.set(sessionID, "")
          log("start", { sessionID, iteration: 1, maxIterations: state.maxIterations, completionPromise: state.completionPromise })
          if (state.maxIterations === 0) log("warn", { sessionID, note: "unlimited iterations; stop with /cancel-ralph" })
          // The command's own return value is shown to the human, not to the
          // model: a plugin command that wants the agent to work has to prompt
          // the session itself. So iteration 1 starts here.
          try {
            await ctx.session.prompt({ sessionID, text: iterationPrompt(state) })
          } catch (error) {
            loops.delete(sessionID)
            log("error", { sessionID, iteration: 1, error: message(error) })
            return { content: `ralph-loop failed to start: ${message(error)}` }
          }
          return { content: `Ralph loop started: iteration 1${state.maxIterations ? ` of ${state.maxIterations}` : ", unlimited"}. /ralph-status shows progress, /cancel-ralph stops it.` }
        },
      })

      draft.add({
        name: "cancel-ralph",
        description: "Stop the loop running in this session.",
        execute: async (input: any) => {
          const sessionID: string | undefined = input?.sessionID
          if (!sessionID) return { content: `cancel-ralph failed: no session.` }
          const state = loops.get(sessionID)
          if (!state) return { content: `No active Ralph loop in this session. Log: ${LOG_FILE}` }
          loops.delete(sessionID)
          log("cancel", { sessionID, iteration: state.iteration })
          return { content: `Cancelled the Ralph loop at iteration ${state.iteration}.` }
        },
      })

      draft.add({
        name: "ralph-status",
        description: "Report the Ralph loops running on this host.",
        execute: async () => {
          if (loops.size === 0) return { content: `No active Ralph loops. Log: ${LOG_FILE}` }
          const blocks = [...loops.values()].map((state) => status(state))
          return { content: [`${loops.size} active Ralph loop(s):`, ...blocks, `log      ${LOG_FILE}`].join("\n\n") }
        },
      })
    })

    return () => {
      controller.abort()
      // Loops are deliberately dropped here: a reloaded plugin should not
      // resume prompting on its own.
      for (const state of loops.values()) log("reload", { sessionID: state.sessionID, iteration: state.iteration })
      loops.clear()
      lastText.clear()
    }
  },
}

export { DEFAULT_COMPLETION_PROMISE }