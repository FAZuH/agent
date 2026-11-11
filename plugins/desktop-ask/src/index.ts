/**
 * fazuh.desktop-ask — the keybind sends a screenshot to one armed session and
 * asks the instruction that session stored. The target is a file, not session
 * metadata, so every plugin instance and the CLI read the same answer.
 */
import { copyToClipboard } from "./clipboard.ts"
import { createHandlers } from "./handlers.ts"
import { Contract } from "./rpc.ts"
import { activeWindow, capture } from "./shot.ts"
import { stateRoot, writeLastCopy } from "./state.ts"

const info = (result: any) => result?.data ?? result

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** RPC output validation rejects an optional key that is present but undefined. */
const compact = (value: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined))

export default {
  id: "fazuh.desktop-ask",
  setup: async (ctx: any) => {
    const root = stateRoot()
    const handlers = createHandlers({
      root,
      now: () => new Date(),
      directory: ctx.location?.directory ?? process.cwd(),
      capture: (opts) => capture(opts),
      activeWindow: () => activeWindow().label,
      session: async (sessionID) => {
        try {
          const session = info(await ctx.session.get({ sessionID }))
          if (!session || (typeof session.id !== "string" && typeof session.sessionID !== "string")) return undefined
          return {
            title: typeof session.title === "string" ? session.title : undefined,
            directory: typeof session.location?.directory === "string" ? session.location.directory : undefined,
          }
        } catch {
          return undefined
        }
      },
      prompt: async (input) => {
        const receipt = info(
          await ctx.session.prompt({
            sessionID: input.sessionID,
            text: input.text,
            files: input.files,
            delivery: input.delivery,
          }),
        )
        return {
          id: typeof receipt?.id === "string" ? receipt.id : undefined,
          created: Number.isFinite(receipt?.time?.created) ? Number(receipt.time.created) : undefined,
        }
      },
      status: async (sessionID) => {
        try {
          const session = info(await ctx.session.get({ sessionID }))
          if (!session) return undefined
          const busy = Number(session.time?.busy ?? 0)
          const idle = Number(session.time?.idle ?? 0)
          return { busy: busy > idle, idleAt: idle || undefined }
        } catch {
          return undefined
        }
      },
      context: async (sessionID) => info(await ctx.session.context({ sessionID })),
      copy: (value) => copyToClipboard(value),
      onCopy: (result) => {
        try {
          writeLastCopy(
            result.ok
              ? { at: new Date().toISOString(), ok: true, chars: result.text.length, preview: result.text.slice(0, 120) }
              : { at: new Date().toISOString(), ok: false, error: result.message },
            root,
          )
        } catch {}
      },
    })

    if (typeof ctx.rpc?.register !== "function") {
      console.error("[desktop-ask] ctx.rpc.register is unavailable; the keybind trigger cannot be called")
    } else {
      try {
        await ctx.rpc.register(Contract, {
          trigger: async (input: any, call: any) => {
            const result = await handlers.trigger(input ?? {})
            if (!result.ok) return call.error(result.type, result.message, result.data)
            return compact({
              sessionID: result.value.sessionID,
              title: result.value.title,
              path: result.value.path,
              trigger: result.value.trigger,
              delivery: result.value.delivery,
              messageID: result.value.messageID,
              created: result.value.created,
            })
          },
          arm: async (input: any, call: any) => {
            const result = await handlers.arm(input ?? {})
            if (!result.ok) return call.error(result.type, result.message, result.data)
            return compact({
              sessionID: result.value.sessionID,
              title: result.value.title,
              instruction: result.value.instruction,
              triggers: result.value.triggers,
            })
          },
          status: async (_input: any, call: any) => {
            const result = handlers.status()
            if (!result.ok) return call.error(result.type, result.message, result.data)
            if (!result.value.target) return { armed: false }
            return compact({ armed: true, ...result.value.target })
          },
          disarm: async (_input: any, call: any) => {
            const result = handlers.disarm()
            if (!result.ok) return call.error(result.type, result.message, result.data)
            return result.value
          },
        })
      } catch (error) {
        console.error(`[desktop-ask] RPC registration failed: ${message(error)}`)
      }
    }

    await ctx.tool.transform((tools: any) => {
      tools.add({
        name: "desktop_ask_arm",
        description:
          "Make this the one target session for the screenshot keybind. Call it when the user says what to expect from incoming screenshots, for example 'watch the game and tell me which enemy is selected'. The keybind then sends a screenshot here and you answer the stored instruction. Replaces any previous target.",
        input: {
          type: "object",
          properties: {
            instruction: {
              type: "string",
              description: "What to look for or answer when a screenshot arrives. The questions go here.",
            },
            region: {
              type: "string",
              description: "Capture region in image pixels, 'WxH' or 'X,Y WxH'. Omit for the full screen.",
            },
            delivery: {
              type: "string",
              enum: ["steer", "queue"],
              description: "steer interrupts a turn in progress; queue waits (default).",
            },
          },
          required: ["instruction"],
          additionalProperties: false,
        },
        execute: async (input: any, tool: any) => {
          const sessionID = typeof tool?.sessionID === "string" ? tool.sessionID : ""
          if (!sessionID) return { content: "desktop_ask_arm failed: no session." }
          const result = await handlers.arm({
            sessionID,
            instruction: String(input?.instruction ?? ""),
            region: input?.region,
            delivery: input?.delivery,
          })
          if (!result.ok) return { content: `desktop_ask_arm failed: ${result.message}` }
          return { content: result.value.text }
        },
      })

      tools.add({
        name: "desktop_ask_disarm",
        description: "Stop sending screenshots to the armed target session.",
        input: { type: "object", properties: {}, additionalProperties: false },
        execute: async () => {
          const result = handlers.disarm()
          if (!result.ok) return { content: `desktop_ask_disarm failed: ${result.message}` }
          return { content: result.value.cleared ? "desktop-ask disarmed." : "desktop-ask: nothing was armed." }
        },
      })
    })

    await ctx.command.transform((draft: any) => {
      draft.add({
        name: "desktop-ask",
        description:
          "Arm this session for the screenshot keybind, or control the target. Usage: /desktop-ask <instruction> | status | off",
        execute: async (input: any) => {
          const sessionID: string | undefined = input?.sessionID
          const line = String(input?.prompt?.text ?? "").trim()
          const word = line.split(/\s+/)[0]?.toLowerCase() ?? ""

          if (!line || word === "status") {
            const result = handlers.status()
            if (!result.ok) return { content: `desktop-ask failed: ${result.message}` }
            return { content: result.value.text }
          }

          if (word === "off" || word === "disarm") {
            const result = handlers.disarm()
            if (!result.ok) throw new Error(`desktop-ask failed: ${result.message}`)
            return { content: result.value.cleared ? "desktop-ask disarmed." : "desktop-ask: nothing was armed." }
          }

          if (!sessionID) throw new Error("desktop-ask failed: no session.")
          const result = await handlers.arm({ sessionID, instruction: line })
          if (!result.ok) throw new Error(`desktop-ask failed: ${result.message}`)
          return { content: result.value.text }
        },
      })
    })
  },
}
