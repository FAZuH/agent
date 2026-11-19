import { discoverToken, makeClient } from "./client.ts"
import { cursorKey, decodeCursorRecord, encodeCursorRecord, hydrateState } from "./persistence.ts"
import { DEFAULT_CONFIG, emptyState, planWake, readConfig, type WakeState } from "./shared.ts"

export { discoverToken, makeClient } from "./client.ts"
export { cursorKey, decodeCursorRecord, encodeCursorRecord, hydrateState } from "./persistence.ts"
export { DEFAULT_CONFIG, emptyState, formatWakePrompt, planWake, readConfig, wakeTarget } from "./shared.ts"
export type { BoardEvent, BridgeConfig, WakePlan, WakeState } from "./shared.ts"

const DEFAULT_URL = "http://127.0.0.1:4100/api/board"
const POLL_WAIT_SECONDS = 25
const RETRY_MS = 2000
// Hot reload can call setup several times; only one long-poll loop may run.
const LOOP_KEY = Symbol.for("fazuh.board-bridge.loop")

type Loop = { controller: AbortController; state: WakeState }

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve()
    const timer = setTimeout(resolve, ms)
    signal.addEventListener("abort", () => {
      clearTimeout(timer)
      resolve()
    }, { once: true })
  })
}

export default {
  id: "fazuh.board-bridge",

  setup: async (ctx: any) => {
    if (process.env.BOARD_BRIDGE_DISABLE === "1") return

    const config = readConfig(process.env)
    const url = (process.env.BOARD_URL ?? DEFAULT_URL).replace(/\/+$/, "")
    let token: string
    try {
      token = discoverToken(url, process.env)
    } catch (error) {
      console.warn(`[board-bridge] disabled: ${message(error)}`)
      return
    }

    const holder = globalThis as typeof globalThis & { [LOOP_KEY]?: Loop }
    holder[LOOP_KEY]?.controller.abort()

    const client = makeClient(url, token)
    const state = holder[LOOP_KEY]?.state ?? emptyState()
    const controller = new AbortController()
    holder[LOOP_KEY] = { controller, state }

    const storage = ctx.storage
    const key = cursorKey(url, config.channel)
    let cursor: string | undefined
    if (storage?.get) {
      try {
        const saved = decodeCursorRecord(await storage.get(key))
        if (saved) {
          cursor = saved.cursor
          hydrateState(state, saved)
        }
      } catch (error) {
        console.warn(`[board-bridge] cursor load failed: ${message(error)}`)
      }
    }

    const saveCursor = async () => {
      if (!cursor || !storage?.set || controller.signal.aborted) return
      try {
        await storage.set(key, encodeCursorRecord(cursor, state, Date.now()))
      } catch (error) {
        console.warn(`[board-bridge] cursor save failed: ${message(error)}`)
      }
    }

    const loop = async () => {
      while (!controller.signal.aborted) {
        try {
          const page = await client.poll({
            after: cursor,
            wait: POLL_WAIT_SECONDS,
            channel: config.channel,
            signal: controller.signal,
          })
          if (controller.signal.aborted) break
          cursor = page.cursor || cursor
          for (const event of page.events) {
            if (controller.signal.aborted) break
            const plan = planWake(event, config, state, Date.now())
            if (!plan.delivery) {
              if (plan.reason !== "no_target") {
                console.warn(`[board-bridge] suppressed ${plan.reason}: ${event.cursor ?? "unknown"}`)
              }
              continue
            }
            try {
              await ctx.session.prompt({
                sessionID: plan.delivery.sessionID,
                text: plan.delivery.prompt,
                delivery: "steer",
              })
            } catch (error) {
              console.warn(`[board-bridge] wake failed for ${plan.delivery.sessionID}: ${message(error)}`)
            }
          }
          await saveCursor()
        } catch (error) {
          if (controller.signal.aborted) break
          console.warn(`[board-bridge] poll failed: ${message(error)}`)
          await sleep(RETRY_MS, controller.signal)
        }
      }
    }

    void loop()
    return () => {
      controller.abort()
      if (holder[LOOP_KEY]?.controller === controller) delete holder[LOOP_KEY]
    }
  },
}
