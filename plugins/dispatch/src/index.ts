// fazuh.dispatch — /dispatch <task> spawns a general subagent bound to this
// session (parentID) and returns immediately. The child runs in the
// background, same as ctrl+b: same agent, same model as the parent.
export default {
  id: "fazuh.dispatch",
  setup: async (ctx: any) => {
    await ctx.command.transform((draft: any) => {
      draft.add({
        name: "dispatch",
        description: "Spawn a task in a background general subagent bound to this session. Usage: /dispatch <task>",
        execute: async (input: any) => {
          try {
            const text = String(input?.prompt?.text ?? "").trim()
            if (!text) return { content: "Usage: /dispatch <task>" }
            const parentID: string | undefined = input?.sessionID
            if (!parentID) return { content: "dispatch failed: no parent session." }
            let model: any
            try {
              const parent: any = await ctx.session.get({ sessionID: parentID })
              model = parent?.data?.model ?? parent?.model
            } catch {}
            const created: any = await ctx.session.create({
              parentID,
              agent: "general",
              title: `dispatch: ${text.slice(0, 60)}`,
              ...(model?.providerID && model?.id ? { model } : {}),
            })
            const sid: string = created?.id ?? created?.data?.id ?? created?.sessionID
            if (!sid) return { content: "dispatch failed: session create returned no id." }
            await ctx.session.prompt({ sessionID: sid, text })
            return { content: `Dispatched to background subagent \`${sid}\`.\nTask: ${text.slice(0, 200)}` }
          } catch (error) {
            return { content: `dispatch failed: ${error instanceof Error ? error.message : String(error)}` }
          }
        },
      })
    })
  },
}
