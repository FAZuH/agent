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
import { abortNotice, durabilitySentence, releaseWhenClear, type AbortOutcome } from "./abort.ts"

/** Set true only when the flag is on AND execute.before was registered. */
let cardRouteActive = false
export function markCardRouteActive(): void {
  cardRouteActive = true
}
export function cardRouteActiveNow(): boolean {
  return cardRouteActive
}
/**
 * Clear the flag. Called at the start of every `setup`, because the flag names
 * the registration this load makes, and by suites between cases.
 */
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
  /**
   * Publish this decision's own settlement: the winning proposal's row and cache
   * entry when the call is answered with it, refusals when it is not. Called
   * exactly once, at the route's settlement — never while the decision is still
   * being made, because a proposal this route then refuses must not be recorded as
   * applied or reused by a later call.
   */
  settle?: (applied: boolean, reason: string) => void
}

/** Decide a gated call. Provided by index.ts, which owns the scoring helpers. */
export type DecideFn = (ctx: any, tool: string, sessionID: string, input: unknown, callID: string) => Promise<GateDecision>

/** Host actions injected by index.ts so this module never imports the handles. */
export interface CardDeps {
  /**
   * Run the unified abort operation for this session and its owned descendants.
   * The cause is the actual trigger, so the record and the notice agree.
   */
  stopTree: (sessionID: string, cause: string) => Promise<AbortOutcome>
  toolBan: (sessionID: string, subagents: string[], reason: string) => void
  staleCard: (sessionID: string) => string | undefined
  setCard: (sessionID: string, formID: string, tool: string) => void
  unbanTool: (sessionID: string) => number
  changed: (reason: string) => void
  /** V-ABORT notification (webhook/toast). Carries the receipt-derived notice. */
  notifyAbort?: (sessionID: string, text: string) => Promise<void>
  /**
   * True when an admission hook consults a ban in this process right now. The
   * notice may only call a stop durable while something enforces it: a sealed
   * record with every hook off blocks nothing.
   */
  enforced?: () => boolean
  /** How long a V-PROPAGATE card waits before failing closed to `deny`. */
  askTimeoutMs?: number
  /**
   * The refusal sentence when startup recovery could not establish an abort's
   * enforcement for this session, or null. This route admits calls on its own
   * (it is active when the chain and the session-ban provider are off), so it
   * has to consult the same block they do.
   */
  blocked?: (sessionID: string) => string | null
  /**
   * Still the setup that registered this route. A re-setup replaces the
   * `execute.before` callback, but the host may keep the old wrapper live for a
   * call already in flight, and it is not obliged to replay that call to the
   * replacement.
   */
  live?: () => boolean
  /**
   * The live generation's handler for this event, or null when no card route
   * exists to take it. A retired callback must return a decision either way: the
   * call it was handed would otherwise run unjudged.
   */
  handToLive?: () => ((event: any) => Promise<void>) | null
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

/**
 * Create the card with one fresh-id retry. Awaits only the HTTP POST, never a
 * card answer.
 *
 * `beforePost` sees each id before its card is posted: the host can hold a card
 * and emit its reply before this process reads the POST's response, so a waiter
 * registered afterwards would miss an answer that already arrived.
 *
 * `created` is the only id an answer can belong to. A rejected attempt opens no
 * relation: the host refused to create that id, and a collision means the id may
 * name a different existing card, so whatever replied to it is not this call's
 * answer. The retry gets a genuinely new id, and when it also fails nothing was
 * created and the caller must settle the hold refused.
 */
async function openCardRecord(
  sessionID: string,
  tool: string,
  stale: string | undefined,
  notice: string | undefined,
  beforePost: (formID: string) => void,
): Promise<{ formID: string; created: boolean }> {
  const fresh = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
  const nonce = fresh()
  const formID = cardFor(tool, nonce, notice).id
  if (stale && stale !== formID) void cancelCard(sessionID, stale)
  beforePost(formID)
  const opened = await createCard(sessionID, cardFor(tool, nonce, notice).card).catch(() => undefined)
  if (opened?.created) return { formID, created: true }
  // Rejected, or the transport said nothing: either way this id is not a card
  // this hold can be answered through. One retry, with an id the host has never
  // seen.
  const retryNonce = fresh()
  const retryID = cardFor(tool, retryNonce, notice).id
  beforePost(retryID)
  const retried = await createCard(sessionID, cardFor(tool, retryNonce, notice).card).catch(() => undefined)
  return { formID: retryID, created: retried?.created === true }
}

/** One held question card: its session and the two ways it can settle. */
interface HeldCard {
  sessionID: string
  /**
   * A user answer for this id. The answer authorizes the hold only when the host
   * confirmed creating this exact card; before that it is buffered, so a reply
   * that lands before the POST returns is applied once the create succeeds, and
   * dropped for good when the host rejects the id.
   */
  deliver: (answer: "allow" | "deny" | "abort") => void
  /** Settle without an answer: the card is gone, so the call is refused. */
  refuse: () => void
}

/** One V-PROPAGATE answer per open card. Claim-once: a second reply is harmless. */
const propagateWaiters = new Map<string, HeldCard>()

/** Held card ids this process can still answer, each with its own session. */
export function heldQuestionCards(): Array<{ formID: string; sessionID: string }> {
  return [...propagateWaiters.entries()].map(([formID, held]) => ({ formID, sessionID: held.sessionID }))
}

/**
 * Settle one held card without a user answer, as a refusal: a card the host
 * cancelled or an abort removed is not an allow. True when a hold was waiting on
 * that id.
 */
export function releaseHeldCard(formID: string): boolean {
  const held = propagateWaiters.get(formID)
  if (!held) return false
  propagateWaiters.delete(formID)
  held.refuse()
  return true
}

export function handleCardReply(formID: string, answer: unknown): boolean {
  const decision = String((answer as any)?.decision ?? "").trim().toLowerCase()
  const held = propagateWaiters.get(formID)
  if (held && (decision === "allow" || decision === "deny" || decision === "abort")) {
    held.deliver(decision)
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

/**
 * Subscribe to native form events. A reply resolves a V-PROPAGATE waiter or lifts
 * a tool ban.
 *
 * Returns the stop function. A setup can replace this route, and the host may
 * keep the old subscription until its signal aborts: a retired feed that stayed
 * live could answer a card the new generation opened.
 */
export function attachCardEvents(ctx: any): () => void {
  const controller = typeof AbortController === "function" ? new AbortController() : null
  const stream = ctx?.event?.subscribe?.({
    types: ["form.replied", "form.cancelled"],
    ...(controller ? { signal: controller.signal } : {}),
  })
  if (!stream) return () => {}
  let stopped = false
  void (async () => {
    try {
      for await (const event of stream) {
        if (stopped) return
        const id = String(event?.data?.id ?? "")
        // A card the host dropped is not an answer, and the hold must not wait
        // out its timeout: it settles as a refusal. The record keeps the id for
        // `/jev-latest`, which cancels and reopens its own card.
        if (event?.type === "form.cancelled") {
          if (releaseHeldCard(id)) {
            logCall({ hook: "hook_tool_risk", detail: "the host cancelled a held card; the call was refused" })
          }
          continue
        }
        if (event?.type !== "form.replied") continue
        handleCardReply(id, event?.data?.answer)
      }
    } catch {}
  })()
  return () => {
    stopped = true
    controller?.abort()
  }
}

/**
 * V-ABORT: the unified stop, then one notice built from its own receipt. The
 * outcome goes back whole: the caller's own message is written from it, so the
 * thrown text and the notice can never disagree about what was recorded.
 */
async function abortTree(sessionID: string, cause: string, deps: CardDeps): Promise<AbortOutcome> {
  const outcome = await deps.stopTree(sessionID, cause)
  // The posture is read here, after the operation: a stop the record calls
  // durable still guards nothing while no admission hook runs.
  if (deps.notifyAbort) await deps.notifyAbort(sessionID, abortNotice(outcome, cause, deps.enforced?.() ?? false))
  deps.changed("abort")
  logCall({ hook: "hook_tool_risk", sessionID, detail: "aborted the session through the unified operation" })
  return outcome
}

/**
 * What the agent is told after an abort operation returned. Written from the
 * outcome and the live posture, never from the pre-run verdict: a failed identity
 * write must not read as a recorded operation, and a record nothing enforces must
 * not read as a durable stop — the notice and this message share one vocabulary.
 */
function abortResultMessage(outcome: AbortOutcome, enforced: boolean): string {
  const uncovered = outcome.incomplete.map((row) => `${row.step} ${row.status}`)
  const lead = outcome.durable
    ? `jev: the session was aborted, and abort operation ${outcome.operation.id} was recorded. This call did not run.`
    : "jev: the session was aborted. This call did not run."
  return [
    lead,
    uncovered.length ? ` Containment incomplete: ${uncovered.join(", ")}.` : " No containment step stopped short.",
    ` ${durabilitySentence(outcome, enforced)}`,
  ].join("")
}

/** What one V-PROPAGATE hold settled on. `refused` is no answer this route can act on. */
type CardAnswer = "allow" | "deny" | "abort" | "refused"

/**
 * Open a V-PROPAGATE card and await the user's single decision. Times out to
 * `deny`. An answer only ever settles the id the host confirmed creating: a reply
 * for a rejected attempt is buffered at most, and dropped with that attempt.
 */
async function propagateUserCard(sessionID: string, tool: string, decision: GateDecision, deps: CardDeps): Promise<CardAnswer> {
  const timeoutMs = deps.askTimeoutMs ?? 60_000
  let timer: ReturnType<typeof setTimeout> | undefined
  let settled = false
  let resolveAnswer: (answer: CardAnswer) => void = () => {}
  const answer = new Promise<CardAnswer>((resolve) => {
    resolveAnswer = resolve
  })
  const finish = (value: CardAnswer): void => {
    if (settled) return
    settled = true
    if (timer) clearTimeout(timer)
    resolveAnswer(value)
  }
  /** The id whose POST is in flight, and the id the host confirmed creating. */
  let armed = ""
  let confirmed = ""
  /** An answer that arrived before its own POST returned. */
  let buffered: "allow" | "deny" | "abort" | null = null
  // One waiter per attempted id, armed before that card is posted. A reply is
  // buffered while the id is unproven and re-keyed away when the retry replaces
  // it, so an answer and a created card can never mismatch.
  const arm = (formID: string): void => {
    if (settled) return
    if (armed && armed !== formID) propagateWaiters.delete(armed)
    armed = formID
    buffered = null
    propagateWaiters.set(formID, {
      sessionID,
      deliver: (value) => {
        if (settled) return
        if (formID === confirmed) {
          propagateWaiters.delete(formID)
          finish(value)
          return
        }
        // Not this hold's answer yet: the host has not said it created this id,
        // and it may never.
        buffered = value
      },
      refuse: () => finish("refused"),
    })
  }
  const opened = await openCardRecord(sessionID, tool, deps.staleCard(sessionID), decision.notice, arm)
  if (!opened.created) {
    propagateWaiters.delete(armed)
    buffered = null
    deps.changed("propagate")
    logCall({ hook: "hook_tool_risk", sessionID, tool, detail: "the host rejected the question card, so the call was refused" })
    finish("refused")
    return await answer
  }
  confirmed = opened.formID
  deps.setCard(sessionID, opened.formID, tool)
  ;(globalThis as any).__jevCardLiftToolBan = deps.unbanTool
  deps.changed("propagate")
  if (buffered) {
    // The answer arrived before the create was confirmed; the confirmation is
    // what makes it this call's answer.
    const value = buffered
    buffered = null
    propagateWaiters.delete(opened.formID)
    finish(value)
    return await answer
  }
  if (!settled) {
    timer = setTimeout(() => {
      if (propagateWaiters.delete(opened.formID)) finish("deny")
    }, timeoutMs)
  }
  return await answer
}

/** One judgement of one call, resolved rather than thrown so a sibling can replay it. */
type CardJudgement = { error: Error | null }

/**
 * Judgements in flight, by call. A host may hand one call to both a retired
 * callback and its replacement; with a shared entry the second caller replays the
 * first answer instead of scoring the call twice and opening a second card.
 */
const cardCalls = new Map<string, Promise<CardJudgement>>()

/**
 * One host identity component, or "" when the host did not send one. Only a
 * non-empty string identifies a call: a number, an object or an empty value
 * would collapse into a key that aliases another call.
 */
const identityPart = (value: unknown): string => (typeof value === "string" && value ? value : "")

/**
 * The claim key for one call. The parts are encoded as one JSON array, never
 * concatenated: a separator inside a part cannot then make two tuples share a
 * key.
 */
const callKeyOf = (event: any): string => {
  const sessionID = identityPart(event?.sessionID)
  const id = identityPart(event?.id)
  return sessionID && id ? JSON.stringify([sessionID, id]) : ""
}

const replayJudgement = (judgement: CardJudgement): void => {
  if (judgement.error) throw judgement.error
}

/**
 * What the route refuses a call whose host identity it cannot claim. A card can
 * hold, deny or abort, so one call must be claimable by id to keep a duplicate
 * dispatch from opening a second card; the host's identity contract is
 * unverified (#19), so an unidentifiable call is refused rather than judged
 * undeduplicated.
 */
const CARD_UNIDENTIFIED = "jev: the call could not be identified, so it was refused"

/**
 * What a retired generation answers when no live route can take the call. Fixed
 * sentence: the call is refused, and the refusal names why rather than leaving
 * the host's default to release it.
 */
const CARD_HANDOVER_REFUSAL = "jev: the question-card route was being replaced while this call was dispatched, so it was refused"

/**
 * A retired generation hands the call to the one that replaced it and replays its
 * answer. The host is not guaranteed to replay an already-dispatched event to the
 * new registration, so returning nothing here would release the call unjudged.
 */
async function handOff(event: any, deps: CardDeps, key: string): Promise<void> {
  const live = deps.handToLive?.()
  if (live) {
    // Our claim would make the live generation replay us instead of judging: the
    // call has to be handed over before it is asked for a decision.
    if (key) cardCalls.delete(key)
    await live(event)
    return
  }
  // No live route to take the call, so it is refused. Nothing else is guaranteed
  // to have seen this event: the host need not replay it to a replacement
  // registration, and the new setup may have every gate off. Returning here
  // would leave the host's default to release a call nothing judged.
  throw new Error(CARD_HANDOVER_REFUSAL)
}

/** Gate one tool call. See the module header for the effect mapping. */
export async function onBeforeExecute(ctx: any, event: any, decide: DecideFn, deps: CardDeps): Promise<void> {
  const key = callKeyOf(event)
  const shared = key ? cardCalls.get(key) : undefined
  if (shared) return replayJudgement(await shared)
  const judgement = judgeCall(ctx, event, decide, deps, key)
  if (!key) return replayJudgement(await judgement)
  cardCalls.set(key, judgement)
  try {
    replayJudgement(await judgement)
  } finally {
    // Only the claim is shared, and only while the judgement runs: a sibling
    // callback dispatched in the same window replays this answer, and a later
    // dispatch is a new judgement rather than a cached one.
    if (cardCalls.get(key) === judgement) cardCalls.delete(key)
  }
}

async function judgeCall(ctx: any, event: any, decide: DecideFn, deps: CardDeps, key: string): Promise<CardJudgement> {
  try {
    await judgeCard(ctx, event, decide, deps, key)
    return { error: null }
  } catch (error) {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }
}

async function judgeCard(ctx: any, event: any, decide: DecideFn, deps: CardDeps, key: string): Promise<void> {
  const retired = () => Boolean(deps.live && !deps.live())
  // A call dispatched to a retired callback still needs an answer.
  if (retired()) return handOff(event, deps, key)
  // The route is off: nothing here decides anything, so the call passes through
  // exactly as before this route existed.
  if (!cardRouteActiveNow()) return
  // An active route decides on its own, so the identity gate comes before every
  // other return: a call it cannot claim must be refused, never released with
  // its host effect standing. The host's identity contract is unverified (#19);
  // this gate is the plugin-side guarantee.
  if (!key) throw new Error(CARD_UNIDENTIFIED)
  const sessionID = String(event?.sessionID ?? "")
  const tool = String(event?.tool ?? "")
  const callID = String(event?.id ?? "")
  // A call with no tool name cannot be scored, banned or carded, so it is the
  // one pass-through left: no decision exists to leave undone.
  if (!tool) return

  // This route decides on its own, and with the chain and the session-ban
  // provider off it is the only gate, so nothing about an abort can be left to
  // them. The gate is asked at entry AND again after every await below: an abort
  // can land while the decision runs (scoring, a model call) or while the card is
  // open, and a covered session must never receive an allow.
  //
  // It also waits on the discovery hold. An abort marks only its selected
  // session before the scan, so a descendant is neither marked nor banned until
  // the listing returns; a release that ran inside that window would admit a call
  // the abort is about to cover. The wait ends with the scan, and the gate is
  // then asked again, which refuses the descendant.
  const blockedNow = (): string | null => deps.blocked?.(sessionID) ?? null
  const refuseCall = (blocked: string): never => {
    logCall({ hook: "hook_tool_risk", sessionID, tool, blocked })
    throw new Error(blocked)
  }
  // Entry: nothing is decided yet, so a refusal here owns no proposal to publish.
  // The primitive re-reads the hold after the yield that ends its wait, and runs
  // this callback in the same block as the read.
  const entry = await releaseWhenClear(blockedNow, (blocked) => blocked)
  if (entry) refuseCall(entry)

  const decision = await decide(ctx, tool, sessionID, event?.input, callID)
  // One settlement per call: every exit below publishes exactly what the route
  // answered with, and nothing else.
  let settled = false
  const publish = (applied: boolean, reason: string): void => {
    if (settled) return
    settled = true
    decision.settle?.(applied, reason)
  }
  /**
   * Release this call. The gate read and `action` run in one synchronous block,
   * so an abort that starts after the read cannot find the call already released
   * on a stale answer. A refusal publishes against the decision and is thrown,
   * never carried out as an allow.
   */
  const release = async (action: () => void): Promise<void> => {
    const blocked = await releaseWhenClear(blockedNow, (refusal) => {
      if (refusal) return refusal
      action()
      return null
    })
    if (!blocked) return
    publish(false, blocked)
    refuseCall(blocked)
  }
  // A re-setup can land inside the await above. The choice points below open
  // a card, deny the call, or start an abort, so a retired generation hands the
  // call over here instead of acting on a route it no longer owns.
  if (retired()) {
    publish(false, CARD_HANDOVER_REFUSAL)
    return handOff(event, deps, key)
  }
  if (decision.effect === "allow") {
    await release(() => publish(true, ""))
    return
  }

  if (decision.effect === "deny") {
    await release(() => {
      publish(true, "")
      logCall({ hook: "hook_tool_risk", sessionID, tool, skipped: "denied this call only", detail: callID })
      deps.changed("deny")
    })
    throw new Error(decision.message ?? "jev: the call was denied")
  }

  if (decision.effect === "abort") {
    await release(() => publish(true, ""))
    const cause = "the Jev verdict aborted the session"
    const outcome = await abortTree(sessionID, cause, deps)
    throw new Error(abortResultMessage(outcome, deps.enforced?.() ?? false))
  }

  // V-PROPAGATE: hold only this call. The session and subagents keep running.
  // The card's answer is this call's decision, so a retirement inside the wait
  // does not reopen it: the reply route is process-wide and the live feed
  // answers a card either generation opened.
  const answer = await propagateUserCard(sessionID, tool, decision, deps)
  // The card wait is the longest window of all: an abort that landed inside it
  // outranks the answer, so the user's allow cannot release a banned call.
  if (answer === "allow") {
    await release(() => publish(true, ""))
    return
  }
  if (answer === "deny") {
    await release(() => {
      publish(true, "")
      deps.changed("deny")
    })
    throw new Error("jev: denied by the user; this call did not run")
  }
  if (answer === "refused") {
    // No card carried an answer: the host rejected the id, or dropped the card
    // it had. Nothing authorized this call.
    await release(() => {
      publish(true, "")
      deps.changed("deny")
    })
    throw new Error("jev: the question card could not be answered, so this call did not run")
  }
  await release(() => publish(true, ""))
  const outcome = await abortTree(sessionID, "the user aborted the session from a held card", deps)
  throw new Error(abortResultMessage(outcome, deps.enforced?.() ?? false))
}
