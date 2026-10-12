// fazuh.aside — server half. Forks the current session at its latest state,
// asks the question there, and returns the fork id. The TUI owns the `aside`
// slash name (only it can switch the view to the fork); this text route is
// `aside-fork` for hosts with no TUI module (desktop, API, mini).
//
// The plugin ctx exposes no fork, so fork goes through `opencode2 api`
// (same shell-out pattern as the viz plugin's session lookup).
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

    await ctx.command.transform((draft: any) => {
      draft.add({
        name: "aside-fork",
        description: "Fork this session at its latest state and ask something in the fork (no view switch). Usage: /aside-fork <question>",
        execute: async (input: any) => {
          try {
            const text = String(input?.prompt?.text ?? "").trim()
            if (!text) return { content: "Usage: /aside-fork <question>" }
            const parentID: string | undefined = input?.sessionID
            if (!parentID) return { content: "aside failed: no parent session." }
            const forked: any = await api("post", `/api/session/${parentID}/fork`, {
              boundary: { type: "through" },
            })
            const sid: string = forked?.data?.id ?? forked?.id
            if (!sid) return { content: "aside failed: fork returned no id." }
            const ask = `This session was forked via /aside from ${parentID} by the user. Do not resume previous task. Prior history is context only. The user only wants you to answer this question, nothing else:\n\n${text}`
            await ctx.session.prompt({ sessionID: sid, text: ask })
            return { content: `Forked to \`${sid}\` — continue there.\nAsked: ${text.slice(0, 200)}` }
          } catch (error) {
            return { content: `aside failed: ${error instanceof Error ? error.message : String(error)}` }
          }
        },
      })
    })
  },
}
