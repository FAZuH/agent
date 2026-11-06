/**
 * Core actions, with the host and the desktop injected so the rules can be
 * tested without a server or a screen.
 */
import { pathToFileURL } from "node:url"

import { answerFrom } from "./answer.ts"
import { armText, statusText, triggerText } from "./frame.ts"
import type { CaptureResult } from "./shot.ts"
import { clearTarget, readTarget, stateRoot, writeTarget, type Delivery, type Target } from "./state.ts"

export interface PromptReceipt {
  id?: string
  created?: number
}

export interface Host {
  root: string
  now: () => Date
  directory: string
  capture: (opts: { root: string; region?: string; window?: boolean }) => CaptureResult
  activeWindow: () => string | undefined
  /** The session title and directory, or undefined when the session is gone. */
  session: (sessionID: string) => Promise<{ title?: string; directory?: string } | undefined>
  prompt: (input: { sessionID: string; text: string; files: { uri: string }[]; delivery: Delivery }) => Promise<PromptReceipt | void>
  /** Busy state and the time the session last went idle. */
  status: (sessionID: string) => Promise<{ busy: boolean; idleAt?: number } | undefined>
  context: (sessionID: string) => Promise<unknown>
  copy: (text: string) => boolean
  copyPollMs?: number
  copyTimeoutMs?: number
  onCopy?: (result: CopyResult) => void
}

export interface ArmInput {
  sessionID: string
  instruction: string
  region?: string
  delivery?: string
}

export interface TriggerInput {
  source?: string
  region?: string
  window?: boolean
  delivery?: string
  ask?: string
  copy?: boolean
}

export type CopyResult =
  | { ok: true; text: string }
  | { ok: false; type: "gone" | "timeout" | "no_answer" | "copy_failed"; message: string }

export type Failure = { ok: false; type: string; message: string; data: { detail: string } }
export type Result<T> = { ok: true; value: T } | Failure

const fail = (type: string, message: string): Failure => ({ ok: false, type, message, data: { detail: message } })

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "")

const deliveryOf = (value: unknown, fallback: Delivery): Delivery =>
  value === "steer" || value === "queue" ? value : fallback

function titleOf(session: { title?: string } | undefined, fallback?: string): string | undefined {
  return text(session?.title) || fallback
}

function directoryOf(session: { directory?: string } | undefined, fallback: string): string {
  return text(session?.directory) || fallback
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Wait for the turn that started at `since` to finish, then put its answer on
 * the clipboard. The idle timestamp lags a queued message, so a turn still
 * waiting behind another one has no answer after `since` and the loop keeps
 * polling instead of copying the other turn's text.
 */
export async function copyAnswer(host: Host, sessionID: string, since: number): Promise<CopyResult> {
  const interval = host.copyPollMs ?? 500
  const deadline = Date.now() + (host.copyTimeoutMs ?? 180_000)

  while (Date.now() < deadline) {
    const status = await host.status(sessionID)
    if (!status) return { ok: false, type: "gone", message: `session ${sessionID} is gone` }

    if (!status.busy && (status.idleAt ?? 0) > since) {
      try {
        const answer = answerFrom(await host.context(sessionID), since)
        if (answer) {
          return host.copy(answer)
            ? { ok: true, text: answer }
            : { ok: false, type: "copy_failed", message: "no clipboard tool accepted the text" }
        }
      } catch (error) {
        return { ok: false, type: "no_answer", message: message(error) }
      }
    }

    await sleep(Math.min(interval, Math.max(0, deadline - Date.now())))
  }
  return { ok: false, type: "timeout", message: "no answer before the copy timeout" }
}

export function createHandlers(host: Host) {
  return {
    async arm(input: ArmInput): Promise<Result<{ sessionID: string; title?: string; instruction: string; triggers: number; text: string }>> {
      const instruction = text(input.instruction)
      if (!instruction) return fail("invalid_instruction", "instruction is empty")
      if (!text(input.sessionID)) return fail("no_session", "no session to arm")

      const session = await host.session(input.sessionID)
      if (!session) return fail("no_session", `session ${input.sessionID} does not exist`)

      const existing = readTarget(host.root)
      const keep = existing?.sessionID === input.sessionID ? existing.triggers : 0
      const target: Target = {
        sessionID: input.sessionID,
        directory: directoryOf(session, host.directory),
        title: titleOf(session),
        instruction,
        region: text(input.region) || undefined,
        delivery: deliveryOf(input.delivery, "queue"),
        armedAt: host.now().toISOString(),
        triggers: keep,
      }
      try {
        writeTarget(target, host.root)
      } catch (error) {
        return fail("state_failed", message(error))
      }
      return {
        ok: true,
        value: {
          sessionID: target.sessionID,
          title: target.title,
          instruction: target.instruction,
          triggers: target.triggers,
          text: armText(target),
        },
      }
    },

    status(): Result<{ text: string; target?: Target }> {
      const target = readTarget(host.root)
      if (!target) return { ok: true, value: { text: "desktop-ask: no target armed." } }
      return { ok: true, value: { text: statusText(target), target } }
    },

    disarm(): Result<{ cleared: boolean }> {
      return { ok: true, value: { cleared: clearTarget(host.root) } }
    },

    async trigger(input: TriggerInput): Promise<
      Result<{ sessionID: string; title?: string; path: string; trigger: number; delivery: Delivery; messageID?: string; created?: number }>
    > {
      const target = readTarget(host.root)
      if (!target) return fail("not_armed", "no target is armed; run /desktop-ask <instruction> in the session to ask")

      const session = await host.session(target.sessionID)
      if (!session) {
        clearTarget(host.root)
        return fail("no_session", `target session ${target.sessionID} is gone; arm again`)
      }

      const captured = host.capture({
        root: host.root,
        region: text(input.region) || target.region,
        window: input.window === true,
      })
      if (!captured.ok) return fail("capture_failed", captured.error)

      const delivery = deliveryOf(input.delivery, target.delivery)
      const n = (target.triggers ?? 0) + 1
      const instruction = text(input.ask) || target.instruction
      const body = triggerText({
        n,
        sessionID: target.sessionID,
        instruction,
        path: captured.path,
        source: text(input.source) || "keybind",
        activeWindow: host.activeWindow(),
        adhoc: Boolean(text(input.ask)),
      })

      let sent: PromptReceipt | void
      try {
        sent = await host.prompt({
          sessionID: target.sessionID,
          text: body,
          files: [{ uri: pathToFileURL(captured.path).href }],
          delivery,
        })
      } catch (error) {
        return fail("prompt_failed", message(error))
      }

      const next: Target = {
        ...target,
        title: titleOf(session, target.title),
        triggers: n,
        lastTriggerAt: host.now().toISOString(),
      }
      try {
        writeTarget(next, host.root)
      } catch (error) {
        return fail("state_failed", `screenshot sent, but the trigger count was not saved: ${message(error)}`)
      }

      if (input.copy !== false) {
        const since = sent?.created ?? host.now().getTime()
        void copyAnswer(host, next.sessionID, since).then((result) => host.onCopy?.(result))
      }

      return {
        ok: true,
        value: {
          sessionID: next.sessionID,
          title: next.title,
          path: captured.path,
          trigger: n,
          delivery,
          messageID: sent?.id,
          created: sent?.created,
        },
      }
    },
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export { stateRoot }
