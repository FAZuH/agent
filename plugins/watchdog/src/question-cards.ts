/**
 * Question-card route — inert unless questionCards is on.
 *
 * The decision lives in tool.execute.before (which runs before the tool body
 * and before permission.assert/evaluate). `allow` lets the tool run. `deny`
 * skips only that call. `abort` stops the whole session and notifies the user.
 * `propagate` opens one question card and holds only that call while the session and
 * its subagents keep running; the user picks allow, deny, or abort.
 */
import { cfgBool, logCall } from "../../../lib/jev/state.ts"
import { cancelCard, createCard } from "./form.ts"
import { toolBanForForm } from "../../../lib/jev/tool-ban.ts"

/** Set true only when the flag is on AND execute.before was registered. */
let cardRouteActive = false
export function markCardRouteActive(): void {
  cardRouteActive = true
}
export function cardRouteActiveNow(): boolean {
  return cardRouteActive
}
export function resetCardRoute(): void {
  cardRouteActive = false
}

export function questionCardsOn(): boolean {
  return cfgBool("hook_tool_risk", "questionCards")
}

export type GateEffect = "allow" | "deny" | "propagate" | "abort"

export interface GateDecision {
  effect: GateEffect
  message?: string
  resources: string[]
  /** Redacted review notice to surface on the card (no call text/secrets). */
  notice?: string
}

/** Decide a gated call. Provided by index.ts, which owns the scoring helpers. */
export type DecideFn = (ctx: any, tool: string, sessionID: string, input: unknown, callID: string) => Promise<GateDecision>

/** Host actions injected by index.ts so this module never imports the handles. */
export interface CardDeps {
  stopTree: (sessionID: string) => Promise<string[]>
  toolBan: (sessionID: string, subagents: string[], reason: string) => void
  staleCard: (sessionID: string) => string | undefined
  setCard: (sessionID: string, formID: string, tool: string) => void
  unbanTool: (sessionID: string) => number
  changed: (reason: string) => void
  /** V-ABORT notification (webhook/toast). Optional so callers need no TUI. */
  notifyAbort?: (sessionID: string, text: string) => Promise<void>
  /** How long a V-PROPAGATE card waits before failing closed to `deny`. */
  askTimeoutMs?: number
}

/** The three choices the user holds on a V-PROPAGATE card. */
export const ASK_OPTIONS = [
  { value: "allow", label: "Allow" },
  { value: "deny", label: "Deny" },
  { value: "abort", label: "Abort session" },
] as const

/** The V-PROPAGATE card: one held call, three explicit user options. */
export function buildAskCard(tool: string, nonce: string, notice?: string) {
  const id = `frm_jev_block_${nonce}`
  return {
    id,
    card: {
      id,
      title: `Jev needs your decision on a ${tool} call`,
      metadata: { kind: "question", jevTool: tool, ...(notice ? { reviewNotice: notice } : {}) },
      fields: [
        {
          key: "decision",
          title: "Allow this call?",
          description:
            notice ??
            `Only this ${tool} call is held. The session and its subagents keep running. Allow runs it, Deny skips only this call, Abort stops the session and notifies you.`,
          type: "string",
          custom: true,
          options: [...ASK_OPTIONS],
        },
      ],
    },
  }
}

function cardFor(tool: string, nonce: string, notice?: string) {
  return buildAskCard(tool, nonce, notice)
}

/** Create the card with one fresh-id retry. Awaits only the HTTP POST,
 *  never a card answer. Returns the id of the card that actually opened (or the
 *  last attempted id if both fail), so the tool ban record stores a reachable id. */
async function openCardRecord(sessionID: string, tool: string, stale: string | undefined, notice?: string): Promise<string> {
  const fresh = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
  const nonce = fresh()
  const formID = cardFor(tool, nonce, notice).id
  if (stale && stale !== formID) void cancelCard(sessionID, stale)
  const opened = await createCard(sessionID, cardFor(tool, nonce, notice).card).catch(() => undefined)
  if (opened?.created) return formID
  // First id was rejected (e.g. stale 409): open with a fresh id and return it.
  const retryNonce = fresh()
  await createCard(sessionID, cardFor(tool, retryNonce, notice).card).catch(() => undefined)
  return cardFor(tool, retryNonce, notice).id
}

/** One V-PROPAGATE answer per open card. Claim-once: a second reply is harmless. */
const propagateWaiters = new Map<string, (answer: "allow" | "deny" | "abort") => void>()

export function handleCardReply(formID: string, answer: unknown): boolean {
  const decision = String((answer as any)?.decision ?? "").trim().toLowerCase()
  const waiter = propagateWaiters.get(formID)
  if (waiter && (decision === "allow" || decision === "deny" || decision === "abort")) {
    propagateWaiters.delete(formID)
    waiter(decision)
    return true
  }
  // A tool ban card answers `lift-tool-ban` to lift the tool ban.
  const record = toolBanForForm(formID)
  if (!record) return false
  if (decision === "lift-tool-ban") {
    const g = globalThis as any
    const key = "__jevCardLiftToolBan"
    const unbanTool: ((id: string) => number) | undefined = g[key]
    if (unbanTool) unbanTool(record.sessionID)
    else {
      void import("../../../lib/jev/tool-ban.ts").then((m) => m.unbanTool(record.sessionID))
    }
    return true
  }
  return false
}

/** Subscribe to native form events. A reply resolves a V-PROPAGATE waiter or lifts a tool ban. */
export function attachCardEvents(ctx: any): void {
  const stream = ctx?.event?.subscribe?.({ types: ["form.replied", "form.cancelled"] })
  if (!stream) return
  void (async () => {
    try {
      for await (const event of stream) {
        if (event?.type !== "form.replied") continue
        handleCardReply(String(event?.data?.id ?? ""), event?.data?.answer)
      }
    } catch {}
  })()
}

/** V-ABORT: stop the whole session tree and notify the user. No resume API. */
async function abortTree(sessionID: string, text: string, deps: CardDeps): Promise<void> {
  await deps.stopTree(sessionID)
  if (deps.notifyAbort) await deps.notifyAbort(sessionID, text)
  deps.changed("abort")
  logCall({ hook: "hook_tool_risk", sessionID, detail: "aborted session and notified user" })
}

/** Open a V-PROPAGATE card and await the user's single decision. Times out to `deny`. */
async function propagateUserCard(sessionID: string, tool: string, decision: GateDecision, deps: CardDeps): Promise<"allow" | "deny" | "abort"> {
  const formID = await openCardRecord(sessionID, tool, deps.staleCard(sessionID), decision.notice)
  deps.setCard(sessionID, formID, tool)
  ;(globalThis as any).__jevCardLiftToolBan = deps.unbanTool
  deps.changed("propagate")
  const timeoutMs = deps.askTimeoutMs ?? 60_000
  return await new Promise<"allow" | "deny" | "abort">((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (answer: "allow" | "deny" | "abort") => {
      if (timer) clearTimeout(timer)
      resolve(answer)
    }
    propagateWaiters.set(formID, finish)
    timer = setTimeout(() => {
      if (propagateWaiters.delete(formID)) finish("deny")
    }, timeoutMs)
  })
}

/** Gate one tool call. See the module header for the effect mapping. */
export async function onBeforeExecute(ctx: any, event: any, decide: DecideFn, deps: CardDeps): Promise<void> {
  if (!cardRouteActiveNow()) return
  const sessionID = String(event?.sessionID ?? "")
  const tool = String(event?.tool ?? "")
  const callID = String(event?.id ?? "")
  if (!sessionID || !tool) return

  const decision = await decide(ctx, tool, sessionID, event?.input, callID)
  if (decision.effect === "allow") return

  if (decision.effect === "deny") {
    logCall({ hook: "hook_tool_risk", sessionID, tool, skipped: "denied this call only", detail: callID })
    deps.changed("deny")
    throw new Error(decision.message ?? "jev: the call was denied")
  }

  if (decision.effect === "abort") {
    await abortTree(sessionID, decision.message ?? "jev: the session was aborted", deps)
    throw new Error(decision.message ?? "jev: the session was aborted")
  }

  // V-PROPAGATE: hold only this call. The session and subagents keep running.
  const answer = await propagateUserCard(sessionID, tool, decision, deps)
  if (answer === "allow") return
  if (answer === "deny") {
    deps.changed("deny")
    throw new Error("jev: denied by the user; this call did not run")
  }
  await abortTree(sessionID, "jev: the user aborted the session from a held call", deps)
  throw new Error("jev: the session was aborted by the user")
}
