import {
  acquire,
  readServiceConfig,
  release,
  resolveOptions,
  viewerURL,
  type MessageFetcher,
  type SessionLister,
} from "./server.ts"

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

function sessionLister(ctx: any): SessionLister {
  return async ({ limit, cursor }) => {
    const list = ctx?.session?.list
    if (typeof list !== "function") throw new Error("ctx.session.list is not available")
    return cursor ? list.call(ctx.session, { limit, cursor }) : list.call(ctx.session, { limit })
  }
}

/** The session's message records, in ascending time order. */
function sessionContext(ctx: any): MessageFetcher {
  return async (sessionID: string) => {
    const context = ctx?.session?.context
    if (typeof context === "function") return context.call(ctx.session, { sessionID })
    const proc = Bun.spawn(["opencode2", "api", "get", `/api/session/${sessionID}/context`], {
      stdout: "pipe",
      stderr: "pipe",
    })
    const out = await new Response(proc.stdout).text()
    await proc.exited
    try {
      return JSON.parse(out)
    } catch {
      throw new Error("opencode2 api returned no message list")
    }
  }
}

export default {
  id: "fazuh.tree",
  setup: async (ctx: any) => {
    const options = resolveOptions(process.env, ctx?.options, readServiceConfig(process.env))
    let viewer: { port: number; hostname: string } | null = null
    try {
      viewer = await acquire(sessionLister(ctx), sessionContext(ctx), options)
    } catch (error) {
      console.error(`[tree] viewer failed to start: ${message(error)}`)
    }

    await ctx.command.transform((draft: any) => {
      draft.add({
        name: "tree",
        description: "Open the session tree viewer",
        execute: async (input: any) => {
          if (!viewer) {
            return { content: "Session tree viewer is not running. Check the OpenCode log for [tree] viewer failed to start." }
          }
          const url = viewerURL(
            viewer.port,
            typeof input?.sessionID === "string" ? input.sessionID : undefined,
            viewer.hostname,
          )
          if (process.env.DISPLAY || process.env.WAYLAND_DISPLAY) {
            try {
              Bun.spawn(["xdg-open", url], { stdout: "ignore", stderr: "ignore" })
            } catch (error) {
              console.error(`[tree] xdg-open failed: ${message(error)}`)
            }
          }
          return { content: url }
        },
      })
    })

    return async () => {
      if (viewer) release()
    }
  },
}
