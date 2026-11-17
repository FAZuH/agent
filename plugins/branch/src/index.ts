// fazuh.branch — server half. `branch_ask` forks the calling primary session;
// `branch_subagent` forks a finished subagent in the caller's tree. Both keep
// the source's agent, model, and history, mark the fork, and let it report back
// on its own through `branch_report`.
//
// The plugin ctx exposes no fork, so the fork goes through `opencode2 api`.
// The fork is
// marked in its own session metadata; the TUI half (./tui.ts) reads that mark
// to move the view to the fork, or to say why the fork never started.
//
// One name, one owner: the server owns the commands, both fork tools, and the
// report tool, so they work on every host, including the ones with no TUI
// module.
import {
  BRANCH_KEY,
  askText,
  failedNotice,
  forkedNotice,
  readMarker,
  reportTags,
  type BranchKind,
  type BranchVia,
} from "./branch.ts"
import { createForkSlots } from "./forks.ts"
import { createReportBatcher } from "./queue.ts"
import { Contract } from "./rpc.ts"
import { isDescendant, isPrimarySession, subagentTargetError, type SessionFacts } from "./access.ts"
import {
  normalizeSettings,
  parseSettingsArgs,
  readSettings,
  settingsText,
  writeSettings,
} from "./settings.ts"

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

const PRIMARY_ONLY =
  "branch_ask forks this session, so it runs only in a primary session. Use branch_subagent to fork a subagent in your tree."

type ForkRequest = {
  sourceID: string
  callerID: string
  prompt: string
  silent: boolean
  background?: boolean
  agent?: string
  kind: BranchKind
  via: BranchVia
}

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

    const settings = () => readSettings()
    const batcher = createReportBatcher(
      (parentID, text) => ctx.session.prompt({ sessionID: parentID, text }),
      () => settings().reportBatchMs,
    )
    const slots = createForkSlots()

    async function sessionFacts(sessionID: string): Promise<SessionFacts | undefined> {
      try {
        const result = await ctx.session.get({ sessionID })
        const data: any = info(result)
        if (!data || typeof data !== "object") return undefined
        return {
          parentID: typeof data.parentID === "string" ? data.parentID : null,
          agent: typeof data.agent === "string" ? data.agent : undefined,
          outcome: typeof data.outcome === "string" ? data.outcome : null,
        }
      } catch {
        return undefined
      }
    }

    async function agentMode(agentID?: string): Promise<string | undefined> {
      if (!agentID) return undefined
      try {
        const get = ctx.agent?.get
        if (typeof get === "function") {
          const raw = await get.call(ctx.agent, agentID)
          const data: any = info(raw)
          if (typeof data?.mode === "string") return data.mode
        }
      } catch {}
      try {
        const list = ctx.agent?.list
        if (typeof list === "function") {
          const raw = await list.call(ctx.agent)
          const rows: any[] = Array.isArray(raw) ? raw : (info(raw) ?? [])
          const row = rows.find((entry) => entry?.id === agentID)
          if (typeof row?.mode === "string") return row.mode
        }
      } catch {}
      try {
        const raw: any = await api("get", `/api/agent/${encodeURIComponent(agentID)}`)
        const data: any = info(raw)
        return typeof data?.mode === "string" ? data.mode : undefined
      } catch {
        return undefined
      }
    }

    /** The reason this session may not use branch_ask, or undefined when it may. */
    async function primaryRefusal(sessionID: string): Promise<string | undefined> {
      const facts = await sessionFacts(sessionID)
      if (!facts) return `session ${sessionID} was not found.`
      const mode = await agentMode(facts.agent)
      return isPrimarySession(facts, mode) ? undefined : PRIMARY_ONLY
    }

    async function metadataOf(sessionID: string): Promise<Record<string, unknown>> {
      try {
        const result = await ctx.session.get({ sessionID })
        return (info(result)?.metadata ?? {}) as Record<string, unknown>
      } catch {
        return {}
      }
    }

    /** Write the mark. A fork inherits the source's metadata, so merge, never replace. */
    async function mark(sessionID: string, marker: Record<string, unknown>): Promise<void> {
      const metadata = { ...(await metadataOf(sessionID)), [BRANCH_KEY]: marker }
      await ctx.session.update({ sessionID, metadata })
    }

    async function forkSession(sourceID: string): Promise<any> {
      const forked: any = await api("post", `/api/session/${sourceID}/fork`, {
        boundary: { type: "through" },
      })
      const data: any = info(forked)
      if (!data?.id) throw new Error("fork returned no session id")
      return data
    }

    async function switchAgent(sessionID: string, agent: string): Promise<void> {
      await api("post", `/api/session/${sessionID}/agent`, { agent })
    }

    async function discard(sessionID: string): Promise<void> {
      try {
        await api("delete", `/api/session/${sessionID}`)
      } catch {}
    }

    async function failed(req: ForkRequest, reason: string): Promise<{ error: string }> {
      await mark(req.callerID, {
        status: "failed",
        kind: req.kind,
        parentID: req.callerID,
        sourceID: req.sourceID,
        prompt: req.prompt,
        error: reason,
      })
      if (!req.silent) {
        try {
          await ctx.session.prompt({ sessionID: req.callerID, text: failedNotice(req.callerID, reason) })
        } catch (failure) {
          console.error(`[branch] failure notice failed: ${message(failure)}`)
        }
      }
      return { error: reason }
    }

    /**
     * Fork the source, optionally switch its agent, mark it, and prompt it.
     * In report mode the answer comes back through branch_report, so the fork
     * curates what the asking session gets to read.
     */
    async function startFork(req: ForkRequest): Promise<{ forkID: string; agent?: string } | { error: string }> {
      let token = ""
      if (!req.silent) {
        const reserved = slots.reserve(req.callerID, settings().maxForks)
        if ("error" in reserved) return reserved
        token = reserved.token
      }

      let forked: any
      try {
        forked = await forkSession(req.sourceID)
      } catch (error) {
        if (token) slots.release(req.callerID, token)
        const reason = `could not fork ${req.sourceID}: ${message(error)}`
        return failed(req, reason)
      }

      const forkID: string = forked.id
      let agent: string | undefined = forked.agent
      if (req.agent && req.agent !== forked.agent) {
        try {
          await switchAgent(forkID, req.agent)
          agent = req.agent
        } catch (error) {
          if (token) slots.release(req.callerID, token)
          await discard(forkID)
          return failed(req, `could not switch the fork to ${req.agent}: ${message(error)}`)
        }
      }

      if (token) slots.confirm(req.callerID, token, forkID)
      await mark(forkID, {
        status: "forked",
        kind: req.kind,
        parentID: req.callerID,
        sessionID: forkID,
        sourceID: req.sourceID,
        prompt: req.prompt,
        background: req.background === true,
      })

      try {
        await ctx.session.prompt({
          sessionID: forkID,
          text: askText(req.prompt, req.callerID, forkID, !req.silent, {
            via: req.via,
            sourceID: req.sourceID,
          }),
        })
      } catch (error) {
        if (token) slots.release(req.callerID, token)
        slots.release(req.callerID, forkID)
        await discard(forkID)
        return failed(req, `could not prompt the fork: ${message(error)}`)
      }

      if (!req.silent) {
        try {
          await ctx.session.prompt({
            sessionID: req.callerID,
            text: forkedNotice(forkID, req.callerID, req.prompt, {
              via: req.via,
              sourceID: req.sourceID,
            }),
          })
        } catch (failure) {
          console.error(`[branch] fork notice failed: ${message(failure)}`)
        }
      }
      return { forkID, agent }
    }

    /** The fork's own report channel: mark → tags → prompt to the asking session. */
    async function reportToParent(sessionID: string, text: string): Promise<void> {
      const marker = readMarker(await metadataOf(sessionID))
      if (!marker || marker.status !== "forked") {
        throw new Error("this session was not forked by branch_ask or branch_subagent")
      }
      if (marker.reportedAt) throw new Error("this fork already reported")
      const forkID = marker.sessionID ?? sessionID
      slots.release(marker.parentID, forkID)
      const tags = reportTags(forkID, marker.parentID)
      batcher.push(marker.parentID, `${tags.open}\n${text}\n${tags.close}`)
      try {
        await mark(sessionID, { ...marker, reportedAt: Date.now() })
      } catch (error) {
        console.error(`[branch] could not mark the report: ${message(error)}`)
      }
    }

    if (typeof ctx.rpc?.register !== "function") {
      console.error("[branch] ctx.rpc.register is unavailable; the GUI ask dialog cannot be called")
    } else {
      try {
        await ctx.rpc.register(Contract, {
          start: async (input: any) => {
            const prompt = String(input?.prompt ?? input?.question ?? "").trim()
            if (!prompt) return { error: "prompt is empty." }
            const parentID = String(input?.parentID ?? "")
            if (!parentID) return { error: "no parent session." }
            const refused = await primaryRefusal(parentID)
            if (refused) return { error: refused }
            const agent = typeof input?.agent === "string" && input.agent.trim() ? input.agent.trim() : undefined
            try {
              const started = await startFork({
                sourceID: parentID,
                callerID: parentID,
                prompt,
                silent: input?.silent === true,
                background: input?.background === true,
                agent,
                kind: "ask",
                via: "branch_ask",
              })
              return "error" in started ? { error: started.error } : { forkID: started.forkID }
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
          "Primary sessions only. Fork this session at its latest state and send a prompt to the fork, so this session keeps working. The fork keeps this session's agent and history, works on the prompt on its own, and reports back with branch_report. Use for a side task that needs this session's context; set silent to fork with no notice and no report, like /branch-silent; set background to keep the UI view on this session; set agent to switch the fork's role first. In a subagent, use branch_subagent instead.",
        input: {
          type: "object",
          properties: {
            prompt: {
              type: "string",
              description: "The task for the fork. It is the fork's only task.",
            },
            question: {
              type: "string",
              description: "Deprecated alias for prompt.",
            },
            silent: {
              type: "boolean",
              description:
                "Fork without telling this session and without asking for a report (default false).",
            },
            background: {
              type: "boolean",
              description:
                "Create the fork without moving the UI view to it; the view stays on this session (default false).",
            },
            agent: {
              type: "string",
              description:
                "Switch the fork's agent before it starts. The switch rewrites the system prompt, so the shared prefix is no longer cached. Default: this session's agent.",
            },
          },
          required: [],
          additionalProperties: false,
        },
        execute: async (input: any, tctx: any) => {
          const prompt = String(input?.prompt ?? input?.question ?? "").trim()
          if (!prompt) return { content: "branch_ask failed: prompt is empty." }
          const sessionID = typeof tctx?.sessionID === "string" ? tctx.sessionID : ""
          if (!sessionID) return { content: "branch_ask failed: no session." }
          const refused = await primaryRefusal(sessionID)
          if (refused) return { content: `branch_ask failed: ${refused}` }
          const agent = typeof input?.agent === "string" && input.agent.trim() ? input.agent.trim() : undefined
          try {
            const started = await startFork({
              sourceID: sessionID,
              callerID: sessionID,
              prompt,
              silent: input?.silent === true,
              background: input?.background === true,
              agent,
              kind: "ask",
              via: "branch_ask",
            })
            if ("error" in started) return { content: `branch_ask failed: ${started.error}` }
            const role = started.agent ? ` as \`${started.agent}\`` : ""
            const mode = input?.silent === true ? "continue there." : "the answer comes back here."
            return {
              content: `Forked to \`${started.forkID}\`${role} — ${mode}${input?.background === true ? " The view stays on this session." : ""}`,
            }
          } catch (error) {
            return { content: `branch_ask failed: ${message(error)}` }
          }
        },
      })

      tools.add({
        name: "branch_subagent",
        description:
          "Fork a finished subagent in this session's tree at its latest state and send it a prompt. The fork keeps the subagent's agent, model, and history, so it needs no brief. Use for follow-on work that should start from that subagent's context; the fork reports back with branch_report. Set silent for no notice and no report, set background to keep the UI view on this session, and set agent to switch the fork's role first.",
        input: {
          type: "object",
          properties: {
            sessionID: {
              type: "string",
              description: "The subagent to fork. It must sit below this session in the session tree.",
            },
            prompt: {
              type: "string",
              description: "The task for the fork. It is the fork's only task.",
            },
            silent: {
              type: "boolean",
              description:
                "Fork without telling this session and without asking for a report (default false).",
            },
            background: {
              type: "boolean",
              description:
                "Create the fork without moving the UI view to it; the view stays on this session (default false).",
            },
            agent: {
              type: "string",
              description:
                "Switch the fork's agent before it starts. Default: the subagent's agent.",
            },
          },
          required: ["sessionID", "prompt"],
          additionalProperties: false,
        },
        execute: async (input: any, tctx: any) => {
          const targetID = String(input?.sessionID ?? "").trim()
          const prompt = String(input?.prompt ?? "").trim()
          if (!targetID) return { content: "branch_subagent failed: sessionID is empty." }
          if (!prompt) return { content: "branch_subagent failed: prompt is empty." }
          const callerID = typeof tctx?.sessionID === "string" ? tctx.sessionID : ""
          if (!callerID) return { content: "branch_subagent failed: no session." }
          if (targetID === callerID) {
            return {
              content:
                "branch_subagent failed: it forks a subagent, not the caller. Use branch_ask to fork this session.",
            }
          }
          const facts = await sessionFacts(targetID)
          const invalid = subagentTargetError(facts, callerID, targetID)
          if (invalid) return { content: `branch_subagent failed: ${invalid}` }
          if (!(await isDescendant(sessionFacts, callerID, targetID))) {
            return {
              content: `branch_subagent failed: target session ${targetID} is outside this session's tree.`,
            }
          }
          const agent = typeof input?.agent === "string" && input.agent.trim() ? input.agent.trim() : undefined
          try {
            const started = await startFork({
              sourceID: targetID,
              callerID,
              prompt,
              silent: input?.silent === true,
              background: input?.background === true,
              agent,
              kind: "subagent",
              via: "branch_subagent",
            })
            if ("error" in started) return { content: `branch_subagent failed: ${started.error}` }
            const role = started.agent ? ` as \`${started.agent}\`` : ""
            const mode = input?.silent === true ? "continue there." : "the answer comes back here."
            return {
              content: `Forked \`${targetID}\` to \`${started.forkID}\`${role} — ${mode}${input?.background === true ? " The view stays on this session." : ""}`,
            }
          } catch (error) {
            return { content: `branch_subagent failed: ${message(error)}` }
          }
        },
      })

      tools.add({
        name: "branch_report",
        description:
          "Send your report back to the session that forked this one with branch_ask or branch_subagent, wrapped in the <branch> tags that identify it there. Use only inside such a fork, once the prompt is addressed.",
        input: {
          type: "object",
          properties: {
            text: { type: "string", description: "The report, written for the asking session." },
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
          "Fork this primary session at its latest state, send a prompt to the fork, and tell this session what came back. Usage: /branch <prompt>",
        execute: async (input: any) => {
          const text = String(input?.prompt?.text ?? "").trim()
          if (!text) return { content: "Usage: /branch <prompt>" }
          const parentID: string | undefined = input?.sessionID
          if (!parentID) return { content: "branch failed: no parent session." }
          const refused = await primaryRefusal(parentID)
          if (refused) return { content: `branch failed: ${refused}` }
          const started = await startFork({
            sourceID: parentID,
            callerID: parentID,
            prompt: text,
            silent: false,
            kind: "ask",
            via: "branch_ask",
          })
          if ("error" in started) return { content: `branch failed: ${started.error}` }
          return { content: `Forked to \`${started.forkID}\` — the answer comes back here.` }
        },
      })

      draft.add({
        name: "branch-silent",
        description:
          "Fork this primary session at its latest state and send a prompt to the fork, without telling this session. Usage: /branch-silent <prompt>",
        execute: async (input: any) => {
          const text = String(input?.prompt?.text ?? "").trim()
          if (!text) return { content: "Usage: /branch-silent <prompt>" }
          const parentID: string | undefined = input?.sessionID
          if (!parentID) return { content: "branch-silent failed: no parent session." }
          const refused = await primaryRefusal(parentID)
          if (refused) return { content: `branch-silent failed: ${refused}` }
          const started = await startFork({
            sourceID: parentID,
            callerID: parentID,
            prompt: text,
            silent: true,
            kind: "ask",
            via: "branch-silent",
          })
          if ("error" in started) return { content: `branch-silent failed: ${started.error}` }
          return { content: `Forked to \`${started.forkID}\` — continue there.` }
        },
      })

      draft.add({
        name: "branch-settings",
        description:
          "Show or set branch limits. maxForks caps reporting forks in flight per caller (0 = unlimited); reportBatchMs batches reports to one prompt (0 = off). Usage: /branch-settings [maxForks=N] [reportBatchMs=MS]",
        execute: async (input: any) => {
          const text = String(input?.prompt?.text ?? "").trim()
          if (!text) return { content: settingsText(settings()) }
          const parsed = parseSettingsArgs(text)
          if (parsed.error) return { content: `branch-settings: ${parsed.error}` }
          const next = normalizeSettings({ ...settings(), ...parsed.settings })
          try {
            writeSettings(next)
          } catch (error) {
            return { content: `branch-settings: could not save: ${message(error)}` }
          }
          return { content: settingsText(next) }
        },
      })
    })
  },
}
