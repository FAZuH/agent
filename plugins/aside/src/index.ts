// fazuh.aside — server half. Forks the current session at its latest state,
// asks the question there, and tells the session that asked what came back.
//
// The plugin ctx exposes no fork, so the fork goes through `opencode2 api`
// (same shell-out pattern as the viz plugin's session lookup). The fork is
// marked in its own session metadata; the TUI half (./tui.ts) reads that mark
// to move the view to the fork, or to say why the fork never started.
//
// One name, one owner: the server owns `/aside` and `/aside-silent`, so the
// command works on every host, including the ones with no TUI module.
import {
  ASIDE_KEY,
  applyEvent,
  askText,
  failedNotice,
  finished,
  finishedNotice,
  forkedNotice,
  newState,
  type AsideState,
} from "./aside.ts"

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

export default {
  id: "fazuh.aside",
  tui: true,
  setup: async (ctx: any) => {
    // One entry per live fork. A plugin reload drops them: the fork keeps
    // running, but nobody is left to report the answer back.
    const states = new Map<string, AsideState>()
    const controller = new AbortController()

    async function api(method: string, path: string, data?: unknown): Promise<any> {
      const args = ["opencode2", "api", method, path]
      if (data !== undefined) args.push("--data", JSON.stringify(data))
      const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" })
      const out = await new Response(proc.stdout).text()
      await proc.exited
      try {
        return JSON.parse(out)
      } catch {
        return undefined
      }
    }

    const info = (result: any) => result?.data ?? result

    async function metadataOf(sessionID: string): Promise<Record<string, unknown>> {
      try {
        const result = await ctx.session.get({ sessionID })
        return (info(result)?.metadata ?? {}) as Record<string, unknown>
      } catch {
        return {}
      }
    }

    /** Write the mark. A fork inherits the parent's metadata, so merge, never replace. */
    async function mark(sessionID: string, marker: Record<string, unknown>): Promise<void> {
      const metadata = { ...(await metadataOf(sessionID)), [ASIDE_KEY]: marker }
      await ctx.session.update({ sessionID, metadata })
    }

    async function forkSession(parentID: string): Promise<string> {
      const forked: any = await api("post", `/api/session/${parentID}/fork`, {
        boundary: { type: "through" },
      })
      const sid: string = forked?.data?.id ?? forked?.id
      if (!sid) throw new Error("fork returned no session id")
      return sid
    }

    async function notifyFinished(state: AsideState): Promise<void> {
      const answer = state.lastText.trim() || "The fork finished without a text answer."
      try {
        await ctx.session.synthetic({
          sessionID: state.parentID,
          text: finishedNotice(state.forkID, state.parentID, answer),
        })
      } catch (error) {
        console.error(`[aside] finish notice failed: ${message(error)}`)
      }
    }

    /**
     * Fork, ask, and (when the caller wants to hear back) watch the fork.
     * The state is registered before the question is asked: the fork's turn
     * can start the moment it is prompted.
     */
    async function startAside(question: string, parentID: string, notify: boolean): Promise<string> {
      let forkID: string
      try {
        forkID = await forkSession(parentID)
      } catch (error) {
        const reason = message(error)
        await mark(parentID, { status: "failed", parentID, error: reason })
        if (notify) {
          try {
            await ctx.session.synthetic({ sessionID: parentID, text: failedNotice(parentID, reason) })
          } catch (failure) {
            console.error(`[aside] failure notice failed: ${message(failure)}`)
          }
        }
        return ""
      }
      if (notify) states.set(forkID, newState(parentID, forkID))
      await mark(forkID, { status: "forked", parentID, sessionID: forkID, question })
      await ctx.session.prompt({ sessionID: forkID, text: askText(question, parentID) })
      if (notify) {
        await ctx.session.synthetic({
          sessionID: parentID,
          text: forkedNotice(forkID, parentID, question),
        })
      }
      return forkID
    }

    void (async () => {
      try {
        const stream = ctx.event?.subscribe?.({ signal: controller.signal })
        if (!stream) {
          console.error("[aside] ctx.event.subscribe is unavailable; the finish notice will not come")
          return
        }
        for await (const event of stream) {
          const type = String(event?.type ?? "")
          const data = (event?.data ?? {}) as Record<string, unknown>
          for (const [forkID, state] of states) {
            if (!applyEvent(state, { type, data })) continue
            if (!finished(state)) continue
            states.delete(forkID)
            await notifyFinished(state)
          }
        }
      } catch (error) {
        if (!controller.signal.aborted) console.error(`[aside] event stream failed: ${message(error)}`)
      }
    })()

    await ctx.command.transform((draft: any) => {
      draft.add({
        name: "aside",
        description:
          "Fork this session at its latest state, ask something in the fork, and tell this session what came back. Usage: /aside <question>",
        execute: async (input: any) => {
          const text = String(input?.prompt?.text ?? "").trim()
          if (!text) return { content: "Usage: /aside <question>" }
          const parentID: string | undefined = input?.sessionID
          if (!parentID) return { content: "aside failed: no parent session." }
          const forkID = await startAside(text, parentID, true)
          if (!forkID) return { content: "aside failed: could not fork this session." }
          return { content: `Forked to \`${forkID}\` — the answer comes back here.` }
        },
      })

      draft.add({
        name: "aside-silent",
        description:
          "Fork this session at its latest state and ask something in the fork, without telling this session. Usage: /aside-silent <question>",
        execute: async (input: any) => {
          const text = String(input?.prompt?.text ?? "").trim()
          if (!text) return { content: "Usage: /aside-silent <question>" }
          const parentID: string | undefined = input?.sessionID
          if (!parentID) return { content: "aside-silent failed: no parent session." }
          const forkID = await startAside(text, parentID, false)
          if (!forkID) return { content: "aside-silent failed: could not fork this session." }
          return { content: `Forked to \`${forkID}\` — continue there.` }
        },
      })
    })

    return () => {
      controller.abort()
      states.clear()
    }
  },
}
