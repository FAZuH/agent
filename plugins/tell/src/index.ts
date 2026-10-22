// fazuh.tell — server half. `/tell <session id> <message>` sends the message
// to a subagent of the session that asked. The TUI half (./tui.ts) fills the
// session id in from a list of subagent titles; the message is sent here, so
// the command works in every host, including the ones that load no TUI module.
//
// One name, one owner: the server owns `/tell`, so the TUI half only fills
// text in and never registers a second copy of the name.
import { COMMAND, isDescendant, parseTarget } from "./shared.ts"

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** The session info, whichever shape the client wraps it in. */
function info(result: any): any {
  return result?.data ?? result
}

export default {
  id: "fazuh.tell",
  tui: true,
  setup: async (ctx: any) => {
    /** The parent of a session, or nothing when the session is gone. */
    async function parentOf(sessionID: string): Promise<string | undefined> {
      try {
        const session = info(await ctx.session.get({ sessionID }))
        return typeof session?.parentID === "string" ? session.parentID : undefined
      } catch {
        return undefined
      }
    }

    await ctx.command.transform((draft: any) => {
      draft.add({
        name: COMMAND,
        description: "Send a message to a subagent of this session. Usage: /tell <session id> <message>",
        execute: async (input: any) => {
          // The host throws a command error into the transcript, but drops the
          // content a command returns, so a failure has to be a throw.
          const parsed = parseTarget(String(input?.prompt?.text ?? ""))
          if (parsed.error) throw new Error(parsed.error)
          const caller: string | undefined = input?.sessionID
          if (!caller) throw new Error("tell failed: no session.")
          if (parsed.target === caller) throw new Error("tell failed: the target is this session.")
          if (!(await isDescendant(parentOf, caller, parsed.target))) {
            throw new Error(`tell failed: ${parsed.target} is not a subagent of this session.`)
          }
          // The flag in the text decides the mode; the mode the host handed
          // over is the fallback for a line that carries no flag.
          const delivery = parsed.delivery ?? (input?.delivery === "queue" ? "queue" : "steer")
          try {
            await ctx.session.prompt({
              sessionID: parsed.target,
              text: parsed.message,
              delivery,
            })
          } catch (error) {
            throw new Error(`tell failed: ${message(error)}`)
          }
        },
      })
    })
  },
}
