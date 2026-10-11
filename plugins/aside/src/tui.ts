/**
 * /aside in the TUI — fork the current session at its latest state, ask the
 * question there, and switch the view to the fork (like /fork does).
 *
 * The server owns fork+prompt; only the TUI can navigate, so the TUI owns
 * the `aside` slash name here and the server exposes the same logic as
 * `aside-fork` for hosts with no TUI module (desktop, API, mini).
 */
export default {
  id: "fazuh.aside-tui",

  setup: async (ctx: any) => {
    const toast = (message: string, variant = "info") => {
      try {
        ctx.ui?.toast?.show?.({ title: "aside", message, variant })
      } catch {}
    }

    async function runAside(question: string): Promise<void> {
      const text = String(question ?? "").trim()
      if (!text) {
        toast("Usage: /aside <question>", "error")
        return
      }
      const route = ctx.ui?.router?.current?.()
      const parentID = route?.type === "session" ? route.sessionID : undefined
      if (!parentID) {
        toast("Open a session first — aside forks the current one.", "error")
        return
      }
      try {
        const forked: any = await ctx.client.session.fork({
          sessionID: parentID,
          boundary: { type: "through" },
        })
        const sid: string = forked?.id ?? forked?.data?.id
        if (!sid) {
          toast("Fork returned no session id.", "error")
          return
        }
        await ctx.client.session.prompt({ sessionID: sid, text })
        ctx.ui.router.navigate({ type: "session", sessionID: sid })
      } catch (error: any) {
        toast(`aside failed: ${error?.message ?? error}`, "error")
      }
    }

    ctx.ui?.slot?.({
      append: "app",
      render: () => {
        ctx.keymap.layer(() => ({
          mode: "global",
          priority: 1,
          enabled: true,
          commands: [
            {
              id: "aside.fork",
              title: "Fork session and ask (aside)",
              group: "aside",
              palette: true,
              slash: { name: "aside", arguments: true },
              run: (input?: string) => void runAside(input ?? ""),
            },
          ],
        }))
        return null
      },
    })

    return undefined
  },
}
