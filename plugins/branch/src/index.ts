// fazuh.branch — server half. Forks the current session at its latest state,
// asks the question there, and lets the fork report back on its own.
//
// The plugin ctx exposes no fork, so the fork goes through `opencode2 api`.
// The fork is
// marked in its own session metadata; the TUI half (./tui.ts) reads that mark
// to move the view to the fork, or to say why the fork never started.
//
// Two tools carry the same feature to the agent itself: branch_ask forks and
// asks (the silent flag is /branch-silent), and branch_report is how a fork
// sends its answer back, tagged for the asking session. The report is a tool
// call, not a hand-built `opencode2 api` command.
//
// One name, one owner: the server owns `/branch`, `/branch-silent`, and both
// tools, so they work on every host, including the ones with no TUI module.
import {
  BRANCH_KEY,
  askText,
  failedNotice,
  forkedNotice,
  readMarker,
  reportTags,
} from "./branch.ts"
import { Contract } from "./rpc.ts"

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

export default {
  id: "fazuh.branch",
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
      const metadata = { ...(await metadataOf(sessionID)), [BRANCH_KEY]: marker }
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
     * Fork, ask, and (unless silent) tell the asking session that a fork
     * exists. In report mode the answer comes back through branch_report, so
     * the fork curates what the asking session gets to read.
     */
    async function startBranch(question: string, parentID: string, silent: boolean): Promise<string> {
      let forkID: string
      try {
        forkID = await forkSession(parentID)
      } catch (error) {
        const reason = message(error)
        await mark(parentID, { status: "failed", parentID, error: reason })
        if (!silent) {
          try {
            await ctx.session.prompt({ sessionID: parentID, text: failedNotice(parentID, reason) })
          } catch (failure) {
            console.error(`[branch] failure notice failed: ${message(failure)}`)
          }
        }
        return ""
      }
      await mark(forkID, { status: "forked", parentID, sessionID: forkID, question })
      await ctx.session.prompt({
        sessionID: forkID,
        text: askText(question, parentID, forkID, !silent),
      })
      if (!silent) {
        await ctx.session.prompt({
          sessionID: parentID,
          text: forkedNotice(forkID, parentID, question),
        })
      }
      return forkID
    }

    /** The fork's own report channel: mark → tags → prompt to the asking session. */
    async function reportToParent(sessionID: string, text: string): Promise<void> {
      const marker = readMarker(await metadataOf(sessionID))
      if (!marker || marker.status !== "forked") {
        throw new Error("this session was not forked by branch")
      }
      const tags = reportTags(marker.sessionID ?? sessionID, marker.parentID)
      await ctx.session.prompt({
        sessionID: marker.parentID,
        text: `${tags.open}\n${text}\n${tags.close}`,
      })
    }

    if (typeof ctx.rpc?.register !== "function") {
      console.error("[branch] ctx.rpc.register is unavailable; the GUI ask dialog cannot be called")
    } else {
      try {
        await ctx.rpc.register(Contract, {
          start: async (input: any) => {
            const question = String(input?.question ?? "").trim()
            if (!question) return { error: "question is empty." }
            const parentID = String(input?.parentID ?? "")
            if (!parentID) return { error: "no parent session." }
            const silent = input?.silent === true
            try {
              const forkID = await startBranch(question, parentID, silent)
              if (!forkID) return { error: "could not fork this session." }
              return { forkID }
            } catch (error) {
              return { error: message(error) }
            }
          },
        })
      } catch (error) {
        console.error(`[branch] RPC registration failed: ${message(error)}`)
      }
    }

    await ctx.tool.transform((tools: any) => {
      tools.add({
        name: "branch_ask",
        description:
          "Fork this session at its latest state and ask a question in the fork, so this session keeps working. The fork answers on its own and reports back with branch_report. Use for a side question that needs this session's context; set silent to fork with no notice and no report, like /branch-silent.",
        input: {
          type: "object",
          properties: {
            question: {
              type: "string",
              description: "The question the fork answers. It is the fork's only task.",
            },
            silent: {
              type: "boolean",
              description:
                "Fork without telling this session and without asking for a report (default false).",
            },
          },
          required: ["question"],
          additionalProperties: false,
        },
        execute: async (input: any, tctx: any) => {
          const question = String(input?.question ?? "").trim()
          if (!question) return { content: "branch_ask failed: question is empty." }
          const sessionID = typeof tctx?.sessionID === "string" ? tctx.sessionID : ""
          if (!sessionID) return { content: "branch_ask failed: no session." }
          const silent = input?.silent === true
          try {
            const forkID = await startBranch(question, sessionID, silent)
            if (!forkID) return { content: "branch_ask failed: could not fork this session." }
            return {
              content: `Forked to \`${forkID}\` — ${silent ? "continue there." : "the answer comes back here."}`,
            }
          } catch (error) {
            return { content: `branch_ask failed: ${message(error)}` }
          }
        },
      })

      tools.add({
        name: "branch_report",
        description:
          "Send the answer back to the session that forked this one with branch_ask, wrapped in the <branch> tags that identify it there. Use only inside an branch fork, once the question is answered.",
        input: {
          type: "object",
          properties: {
            text: { type: "string", description: "The answer, written for the asking session." },
          },
          required: ["text"],
          additionalProperties: false,
        },
        execute: async (input: any, tctx: any) => {
          const text = String(input?.text ?? "").trim()
          if (!text) return { content: "branch_report failed: text is empty." }
          const sessionID = typeof tctx?.sessionID === "string" ? tctx.sessionID : ""
          if (!sessionID) return { content: "branch_report failed: no session." }
          try {
            await reportToParent(sessionID, text)
            return { content: "Reported to the session that asked." }
          } catch (error) {
            return { content: `branch_report failed: ${message(error)}` }
          }
        },
      })
    })

    await ctx.command.transform((draft: any) => {
      draft.add({
        name: "branch",
        description:
          "Fork this session at its latest state, ask something in the fork, and tell this session what came back. Usage: /branch <question>",
        execute: async (input: any) => {
          const text = String(input?.prompt?.text ?? "").trim()
          if (!text) return { content: "Usage: /branch <question>" }
          const parentID: string | undefined = input?.sessionID
          if (!parentID) return { content: "branch failed: no parent session." }
          const forkID = await startBranch(text, parentID, false)
          if (!forkID) return { content: "branch failed: could not fork this session." }
          return { content: `Forked to \`${forkID}\` — the answer comes back here.` }
        },
      })

      draft.add({
        name: "branch-silent",
        description:
          "Fork this session at its latest state and ask something in the fork, without telling this session. Usage: /branch-silent <question>",
        execute: async (input: any) => {
          const text = String(input?.prompt?.text ?? "").trim()
          if (!text) return { content: "Usage: /branch-silent <question>" }
          const parentID: string | undefined = input?.sessionID
          if (!parentID) return { content: "branch-silent failed: no parent session." }
          const forkID = await startBranch(text, parentID, true)
          if (!forkID) return { content: "branch-silent failed: could not fork this session." }
          return { content: `Forked to \`${forkID}\` — continue there.` }
        },
      })
    })
  },
}
