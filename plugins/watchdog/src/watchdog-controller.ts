/**
 * Controller for the Watchdog page (#18). Mirrors the Jev view controller's
 * discipline: one generation counter, one busy key, every mutation reloads,
 * errors reach the dialogs and never a payload.
 *
 * The page's identity is its own: it never touches Jev's provider status,
 * log rows, or approval lists. It drives the same public recovery contract
 * headless clients use — abortOperations, releaseOperation — plus the
 * watchdog settings methods, so the rendered page and a headless operator
 * cannot disagree about what a release did.
 */

/** One pending human review: display fields and an age, never the call's input. */
export interface WatchdogPendingReview {
  sessionID: string
  id: string
  tool: string
  action: string
  stage: string
  ageMs: number | null
  /** True when a restart reported it: its call did not survive, so no card can answer it. */
  interrupted: boolean
}

export interface WatchdogPending {
  inFlight: number
  waiting: number
  durable: number
  durableUnreadable: boolean
  reviews: WatchdogPendingReview[]
}

export interface WatchdogStatusInfo {
  ok: boolean
  on: boolean
  chain: { status: string; reason: string; wired: boolean } | null
  pending: WatchdogPending
  effective: {
    activeOperations: number
    sessionsCovered: number
    overlapping: Array<{ sessionID: string; operations: number }>
    incompleteOperations: number
  }
  recordsReadable: boolean
  reason?: string
}

export interface WatchdogSettingsInfo {
  on: boolean
  persisted: {
    nodes: string
    timing: "blocking" | "nonblocking"
    sessionCap: number
    jevBatchMax: number
    jevBatchMs: number
    supervisorBatchMax: number
    supervisorBatchMs: number
    chain: boolean
    askMode: "judged" | "immediate"
  }
  effective: {
    timing: "blocking" | "nonblocking"
    sessionCap: number
    jevBatchMax: number
    jevBatchMs: number
    supervisorBatchMax: number
    supervisorBatchMs: number
    nodes: { jev: boolean; parent: boolean; supervisor: boolean; human: boolean }
    chain: boolean
    askMode: "judged" | "immediate"
  }
  envOverrides: string[]
  receiptsWebhookPresent: boolean
  supervisorEndpointPresent: boolean
  migration: { present: boolean; stored: number; defaulted: number; invalid: number }
}

export interface WatchdogOperationInfo {
  id: string
  sessionID: string
  scope: string[]
  source: string
  cause: string
  at: number
  released?: number
  continuedAt?: number
  incomplete: Array<{ step: string; status: string; detail: string }>
  delivery?: { receipt: string; attempts: number; notice: string }
}

export interface ReleaseResult {
  ok: boolean
  durable: boolean
  receipt: boolean
  already: boolean
  operationID: string
  ban: { cleared: number; kept: number; failed: number }
  covered: string[]
  continued: "sent" | "prevented" | "not-requested" | "unsupported" | "already"
  incomplete: Array<{ step: string; status: string; detail: string }>
  reason?: string
}

export interface WatchdogRPC {
  watchdogStatus(input: Record<string, never>): Promise<WatchdogStatusInfo>
  getWatchdogSettings(input: Record<string, never>): Promise<WatchdogSettingsInfo>
  setWatchdogSetting(input: { key: string; value: boolean | string | number }): Promise<{ ok: boolean; error?: string }>
  setWatchdogSecret(input: { key: "receiptsWebhook" | "supervisorEndpoint"; value: string }): Promise<{ ok: boolean; error?: string }>
  abortOperations(input: Record<string, never>): Promise<{ ok: boolean; reason?: string; operations: WatchdogOperationInfo[]; deliveryReadable: boolean }>
  releaseOperation(input: { operationID: string; continue?: boolean }): Promise<ReleaseResult>
  reopenPendingReview(input: { itemID: string }): Promise<{ ok: boolean; reopened: boolean; reason?: string }>
  subscribe(listener: (event: { reason: string }) => void): () => void
}

export interface WatchdogViewState {
  loading: boolean
  error?: string
  status?: WatchdogStatusInfo
  settings?: WatchdogSettingsInfo
  operations: WatchdogOperationInfo[]
  operationsReadable: boolean
  deliveryReadable: boolean
  busy?: string
}

export interface WatchdogDialogs {
  update(state: WatchdogViewState): void
  error(description: string): void
  warning(description: string): void
}

/** Same error unwrapping as the Jev view: a description, never a payload. */
import { errorText } from "./gui-controller.ts"
export { errorText }

/**
 * What one release answer can vouch for. The page reports the receipt, never
 * a plain success: a release that kept bans, left the session covered, or
 * could not send its continuation says so.
 */
export function releaseWarning(result: ReleaseResult): string | null {
  if (!result.ok) {
    return `The release could not be verified: ${result.reason ?? "its record and restriction state cannot be checked"}. Nothing was assumed cleared.`
  }
  if (result.ban.failed > 0) return `${result.ban.failed} ban${result.ban.failed === 1 ? "" : "s"} could not be cleared; ${result.ban.kept} kept by another covering operation.`
  if (result.covered.length > 0) return `Released, but ${result.covered.length} session${result.covered.length === 1 ? " is" : "s are"} still covered by another active operation: releasing this one kept every other covering ban in force.`
  if (result.continued === "prevented") return "No continuation was sent: the session was still effectively blocked at the send boundary."
  if (result.continued === "unsupported") return "No continuation was sent: no hook in this process can deliver one."
  return null
}

export function createWatchdogView(rpc: WatchdogRPC, dialogs: WatchdogDialogs) {
  let disposed = false
  let generation = 0
  let state: WatchdogViewState = { loading: false, operations: [], operationsReadable: true, deliveryReadable: true }

  const update = (next: WatchdogViewState) => {
    state = next
    dialogs.update(next)
  }

  async function load() {
    if (disposed) return
    const request = ++generation
    update({ ...state, loading: true, error: undefined })
    try {
      const [status, settings, operations] = await Promise.all([
        rpc.watchdogStatus({}),
        rpc.getWatchdogSettings({}),
        rpc.abortOperations({}),
      ])
      if (disposed || request !== generation) return
      update({
        status,
        settings,
        operations: operations.ok ? operations.operations : [],
        operationsReadable: operations.ok,
        // Never folded into the rows: an unreadable store is this state, and
        // absent receipts mean "never queued" only when it is readable.
        deliveryReadable: operations.deliveryReadable,
        loading: false,
      })
    } catch (error) {
      if (disposed || request !== generation) return
      update({ ...state, loading: false, error: errorText(error) })
    }
  }

  const unsubscribe = rpc.subscribe(() => {
    if (!disposed) void load()
  })

  async function mutate(key: string, run: () => Promise<{ ok: boolean; error?: string }>) {
    if (disposed) return
    update({ ...state, busy: key })
    try {
      const result = await run()
      if (!result.ok) dialogs.error(result.error ?? "That change was not applied.")
      await load()
    } catch (error) {
      dialogs.error(errorText(error))
      await load()
    } finally {
      if (!disposed) update({ ...state, busy: undefined })
    }
  }

  return {
    load,
    setSetting: (key: string, value: boolean | string | number) =>
      mutate(`watchdog:${key}`, () => rpc.setWatchdogSetting({ key, value })),
    setSecret: (key: "receiptsWebhook" | "supervisorEndpoint", value: string) =>
      mutate(`watchdog-secret:${key}`, () => rpc.setWatchdogSecret({ key, value })),
    /**
     * One release through the public contract, selected session only. The
     * result's own fields say what it did; the warning, when there is one,
     * is the receipt's honesty, not a restatement of success.
     */
    release: async (operationID: string, wantContinue: boolean) => {
      if (disposed) return
      const key = `release:${operationID}`
      update({ ...state, busy: key })
      try {
        const result = await rpc.releaseOperation({ operationID, ...(wantContinue ? { continue: true } : {}) })
        const warning = releaseWarning(result)
        if (warning) dialogs.warning(warning)
        await load()
      } catch (error) {
        dialogs.error(`The release could not be confirmed: ${errorText(error)} Check the abort records before retrying.`)
        await load()
      } finally {
        if (!disposed) update({ ...state, busy: undefined })
      }
    },
    /**
     * Re-open one pending review's card. It authorizes nothing: the item still
     * resolves through the human answer alone, and a refused reopen says why.
     */
    reopen: async (itemID: string) => {
      if (disposed) return
      const key = `reopen:${itemID}`
      update({ ...state, busy: key })
      try {
        const result = await rpc.reopenPendingReview({ itemID })
        if (!result.ok) dialogs.error(result.reason ?? "That review could not be reopened.")
        await load()
      } catch (error) {
        dialogs.error(errorText(error))
        await load()
      } finally {
        if (!disposed) update({ ...state, busy: undefined })
      }
    },
    dispose() {
      disposed = true
      unsubscribe()
    },
  }
}
