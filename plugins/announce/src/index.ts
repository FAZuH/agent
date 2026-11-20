import { allSessions, deliverAll, formatAnnouncement, requireMessage, requireSession, runningIDs, targets, type Scope } from "./shared.ts"

export default {
  id: "fazuh.announce",
  setup: async (ctx: any) => {
    async function fetchActive(path: string): Promise<{ stdout: string; stderr: string; ok: boolean }> {
      const proc = Bun.spawn(["opencode2", "api", "get", path], { stdout: "pipe", stderr: "pipe" })
      const [stdout, stderr, exit] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ])
      return { stdout, stderr, ok: exit === 0 }
    }

    async function announce(scope: Scope, input: any): Promise<void> {
      const text = requireMessage(input?.prompt?.text)
      const caller = requireSession(input?.sessionID)
      const running = await runningIDs(fetchActive)
      const rows = scope === "session" ? await allSessions((query) => ctx.session.list(query)) : []
      const ids = targets(scope, caller, running, rows)
      const framed = formatAnnouncement(scope, caller, text)
      await deliverAll(framed, ids, (sessionID, text) => ctx.session.prompt({ sessionID, text, delivery: "steer" }))
    }

    await ctx.command.transform((draft: any) => {
      draft.add({
        name: "announce-global",
        description: "Send a message to every running session. Usage: /announce-global <message>",
        execute: async (input: any) => announce("global", input),
      })
      draft.add({
        name: "announce-session",
        description: "Send a message to this session and its running subagents. Usage: /announce-session <message>",
        execute: async (input: any) => announce("session", input),
      })
    })
  },
}
