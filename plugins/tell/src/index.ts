// fazuh.tell — server half. `/tell <session id> <message>` sends the message
// to a subagent of the session that asked. The TUI half (./tui.ts) fills the
// session id in from a list of subagent titles; the message is sent here, so
// the command works in every host, including the ones that load no TUI module.
//
// One name, one owner: the server owns `/tell`, so the TUI half only fills
// text in and never registers a second copy of the name.
import { COMMAND, parseTarget } from "./shared.ts"

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** The session info, whichever shape the client wraps it in. */
function info(result: any): any {
  return result?.data ?? result
}

export default {
  id: "fazuh.tell",
  tui: true,
  setup: async (ctx: any) => {
    /**
     * A subagent is a descendant of the session that asks for it, so the walk
     * goes up from the target and has to meet the caller. An unrelated
     * session is refused: the command sends into the tree that asked, and
     * nowhere else.
     */
    async function isDescendant(callerID: string, targetID: string): Promise<boolean> {
      let id: string | undefined = targetID
      for (let hops = 0; hops < 32 && id; hops++) {
        if (id === callerID) return true
        let session: any
        try {
          session = info(await ctx.session.get({ sessionID: id }))
        } catch {
          return false
        }
        id = typeof session?.parentID === "string" ? session.parentID : undefined
      }
      return false
    }

    async function titleOf(sessionID: string): Promise<string> {
      try {
        const session = info(await ctx.session.get({ sessionID }))
        return typeof session?.title === "string" && session.title.trim() ? session.title.trim() : sessionID
      } catch {
        return sessionID
      }
    }

    await ctx.command.transform((draft: any) => {
      draft.add({
        name: COMMAND,
        description:
          "Send a message to a subagent of this session. Usage: /tell <session id> <message>",
        execute: async (input: any) => {
          const parsed = parseTarget(String(input?.prompt?.text ?? ""))
          if (parsed.error) return { content: parsed.error }
          const caller: string | undefined = input?.sessionID
          if (!caller) return { content: "tell failed: no session." }
          if (!(await isDescendant(caller, parsed.target))) {
            return { content: `tell failed: ${parsed.target} is not a subagent of this session.` }
          }
          // The text asks for the mode; the host asks for it too when the
          // command itself was submitted queued.
          const delivery = parsed.queue || input?.delivery === "queue" ? "queue" : "steer"
          try {
            await ctx.session.prompt({
              sessionID: parsed.target,
              text: parsed.message,
              delivery,
            })
          } catch (error) {
            return { content: `tell failed: ${message(error)}` }
          }
          const title = await titleOf(parsed.target)
          return { content: `Sent to ${title} (${parsed.target}) — ${delivery}.` }
        },
      })
    })
  },
}
