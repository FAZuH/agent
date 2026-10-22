// fazuh.aside — server half. Forks the current session at its latest state,
// asks the question there, and lets the fork report back on its own.
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
  askText,
  failedNotice,
  forkedNotice,
} from "./aside.ts"

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

export default {
  id: "fazuh.aside",
  tui: true,
  setup: async (ctx: any) => {
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

    /**
     * Fork, ask, and tell the asking session that a fork exists. The answer
     * comes back on the fork's own initiative: the ask prompt tells it how to
     * report, so it curates what the asking session gets to read.
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
            await ctx.session.prompt({ sessionID: parentID, text: failedNotice(parentID, reason) })
          } catch (failure) {
            console.error(`[aside] failure notice failed: ${message(failure)}`)
          }
        }
        return ""
      }
      await mark(forkID, { status: "forked", parentID, sessionID: forkID, question })
      await ctx.session.prompt({ sessionID: forkID, text: askText(question, parentID, forkID) })
      if (notify) {
        await ctx.session.prompt({
          sessionID: parentID,
          text: forkedNotice(forkID, parentID, question),
        })
      }
      return forkID
    }

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
  },
}
