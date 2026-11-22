/** The shape `statusSnapshot` returns, kept here so the controller is testable. */
export interface JevStatus {
  enabled: boolean
  toast: boolean
  features: Array<{ key: string; label: string; what: string; on: boolean; stored: boolean }>
  supervisor: {
    model: string
    protocol: string
    endpoint: string
    timeoutMs: number
    maxRounds: number
    maxEvidence: number
    askWaitMs: number
  }
  key: { present: boolean; from: string }
  spend: { calls: number; tokens: number; usd: number }
  logMax: number
  statePath: string
}

export interface Approval {
  token: string
  sessionID: string
  action: string
  subject: string
  reason: string
  ts: string
}

/** The Settings snapshot. Credentials are presence flags, never values. */
export interface SettingsInfo {
  protocol: string
  think: boolean
  model: string
  keyEnv: string
  keyFile: string
  yoloAsk: string
  approveTtl: number
  sidebar: boolean
  sidebarCount: number
  sidebarSubject: boolean
  toast: boolean
  logMax: number
  secrets: { keyPresent: boolean; webhookPresent: boolean; endpointPresent: boolean; supervisorEndpointPresent: boolean }
  config: Record<string, Record<string, boolean | string | number>>
  features: Record<string, boolean>
}

export interface SetSettingInput {
  scope: "state" | "feature"
  key: string
  value: boolean | string | number
  feature?: string
}

export interface SetSecretInput {
  key: "apiKey" | "alertWebhook"
  value: string
}

export interface JevRPC {
  status(input: {}): Promise<JevStatus>
  log(input: { limit: number; sessionID?: string }): Promise<{ rows: Array<Record<string, unknown>> }>
  approvals(input: {}): Promise<{ approvals: Approval[] }>
  approve(input: { token: string; sessionID: string }): Promise<{ ok: boolean }>
  reject(input: { token: string }): Promise<{ ok: boolean }>
  approveAll(input: {}): Promise<{ ok: boolean; count: number }>
  rejectAll(input: {}): Promise<{ ok: boolean; count: number }>
  stopSession(input: { sessionID: string }): Promise<StopSessionResult>
  liftToolBan(input: { sessionID: string }): Promise<{ ok: boolean; count: number; error?: string }>
  liftToolBanAndResume(input: { sessionID: string }): Promise<{ ok: boolean; count: number; error?: string }>
  listToolBans(input: {}): Promise<{ toolBans: ToolBanInfo[] }>
  setEnabled(input: { on: boolean }): Promise<{ ok: boolean }>
  setFeature(input: { key: string; on: boolean }): Promise<{ ok: boolean }>
  // Optional so the panel still renders against a server without the abort methods.
  abortOperations?(input: {}): Promise<{ ok: boolean; reason?: string; operations: AbortOperationInfo[] }>
  abortOperation?(input: { sessionID: string }): Promise<AbortOperationResult>
  // Optional so the panel still renders against a server without the Settings methods.
  getSettings?(input: {}): Promise<SettingsInfo>
  setSetting?(input: SetSettingInput): Promise<{ ok: boolean; error?: string }>
  setSecret?(input: SetSecretInput): Promise<{ ok: boolean; error?: string }>
  subscribe(listener: (event: { reason: string }) => void): () => void
}

/** One abort operation's result, as both stop and abort report it. */
export interface AbortOperationResult {
  ok: boolean
  sealed: boolean
  durable: boolean
  receipt: boolean
  ban: { written: number; failed: number }
  operationID: string
  scope: string[]
  incomplete: ContainerStepInfo[]
  /**
   * What the answer can vouch for: `known` is the operation's own report,
   * `none` is a request that never ran, `unknown` is a throw after the abort
   * may have written identity or a ban. On `unknown` the flags and counts are
   * placeholders and the surface reports the failure, not a clean negative.
   */
  outcome: "known" | "none" | "unknown"
  /**
   * The admission surfaces that consult a ban right now (`chain`,
   * `session-ban`, `cards`, `tool-risk`), read after the operation resolved.
   * Empty means no hook enforces this ban in this process, and the surface says
   * so rather than implying it.
   */
  enforcedBy: string[]
  /** Present when `enforcedBy` is empty: this ban is not live-enforced. */
  warning?: string
  error?: string
}

/** The stop route's answer: the same operation report, so nothing is swallowed. */
export type StopSessionResult = AbortOperationResult

/** One abort operation as the panel reads it: identity, scope and what is left. */
export interface AbortOperationInfo {
  id: string
  sessionID: string
  scope: string[]
  source: string
  cause: string
  at: number
  incomplete: ContainerStepInfo[]
}

export interface ContainerStepInfo {
  step: string
  status: string
  detail: string
}

export interface ToolBanInfo {
  sessionID: string
  subagents: string[]
  reason: string
  toolBannedAt: string
  formID?: string
  tool?: string
}

export interface JevViewState {
  status?: JevStatus
  settings?: SettingsInfo
  rows: Array<Record<string, unknown>>
  approvals: Approval[]
  toolBans: ToolBanInfo[]
  loading: boolean
  error?: string
  busy?: string
}

export interface JevDialogs {
  update(state: JevViewState): void
  error(message: string): void
  /** A stop that returned but did not fully do what the user asked. */
  warning(message: string): void
}

/** RPC errors cross the bridge as plain objects; read their message, not String(). */
export function errorText(error: unknown, depth = 0): string {
  if (error instanceof Error) return error.message || error.name
  if (typeof error === "string") return error
  if (error && typeof error === "object" && depth < 3) {
    const value = error as Record<string, unknown>
    for (const key of ["message", "error", "reason", "description"]) {
      const text = value[key]
      if (typeof text === "string" && text.trim()) return text
      if (text && typeof text === "object") {
        const nested = errorText(text, depth + 1)
        if (nested && nested !== "[object Object]") return nested
      }
    }
  }
  return String(error)
}

/**
 * What a stop's receipt leaves unsaid, or null when it said everything the user
 * needs: the record is durable, every containment step stopped as asked, and an
 * admission hook enforces the ban right now. A stop is the one action where the
 * difference between "asked" and "in force" matters, so a partial result is
 * reported, never reduced to `ok`.
 */
export function stopWarning(result: StopSessionResult): string | null {
  if (result.outcome !== "known") {
    const what = result.outcome === "none" ? "never ran" : "may have run before it failed"
    return `The stop ${what}. ${result.error ?? "Its effects cannot be verified; check the abort records before retrying."}`
  }
  if (!result.ok) return `The stop was not recorded. ${result.error ?? "The store refused the record."}`
  const parts: string[] = []
  if (!result.durable) parts.push("the abort record did not reach disk")
  if (!result.sealed) parts.push("the session is not sealed against a restart")
  for (const row of result.incomplete) parts.push(`${row.step} did not stop as asked (${row.status})`)
  if (!result.enforcedBy.length) {
    // The server owns this fact; the fallback covers a consumer that built the
    // result itself.
    parts.push(result.warning ?? "no admission hook is active, so this ban is not enforced in this process")
  }
  if (!parts.length) return null
  return `Stopped, with limits: ${parts.join("; ")}.`
}

export function createJevView(rpc: JevRPC, dialogs: JevDialogs) {
  let disposed = false
  let generation = 0
  // undefined = all sessions; a value scopes recent calls to one session.
  let sessionID: string | undefined
  // How many recent rows to fetch; capped to the RPC log limit.
  let limit = 15
  let paused = false
  let state: JevViewState = { rows: [], approvals: [], toolBans: [], loading: false }
  const update = (next: JevViewState) => {
    state = next
    dialogs.update(state)
  }

  async function load(opts: { log?: boolean } = {}) {
    if (disposed) return
    const request = ++generation
    update({ ...state, loading: true, error: undefined })
    try {
      const withLog = opts.log !== false
      const [status, log, pending, toolBans, settings] = await Promise.all([
        rpc.status({}),
        withLog ? rpc.log({ limit: Math.min(200, Math.max(1, limit)), ...(sessionID ? { sessionID } : {}) }) : Promise.resolve(null),
        rpc.approvals({}),
        rpc.listToolBans({}),
        rpc.getSettings ? rpc.getSettings({}) : Promise.resolve(undefined),
      ])
      if (disposed || request !== generation) return
      update({
        status,
        settings: settings ?? state.settings,
        rows: withLog && log ? log.rows : state.rows,
        approvals: pending.approvals,
        toolBans: toolBans.toolBans,
        loading: false,
      })
    } catch (error) {
      if (disposed || request !== generation) return
      update({ ...state, loading: false, error: errorText(error) })
    }
  }

  const unsubscribe = rpc.subscribe(() => {
    if (!disposed) void load({ log: !paused })
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

  async function bulk(key: string, run: () => Promise<{ ok: boolean; count: number }>): Promise<number> {
    if (disposed) return 0
    update({ ...state, busy: key })
    try {
      const result = await run()
      if (!result.ok) dialogs.error("That change was not applied.")
      await load()
      return result.ok ? result.count : 0
    } catch (error) {
      dialogs.error(errorText(error))
      await load()
      return 0
    } finally {
      if (!disposed) update({ ...state, busy: undefined })
    }
  }

  return {
    load,
    /** Scope recent calls to one session (id) or every session (undefined). */
    setSessionFilter(id: string | undefined) {
      if (disposed || id === sessionID) return
      sessionID = id
      void load()
    },
    /** Fetch at most n recent rows (capped at the RPC limit). */
    setLimit(n: number) {
      if (disposed || n === limit) return
      limit = n
      void load()
    },
    /** Pause the calls log; status and approvals keep updating. Explicit user
     *  actions (refresh, limit/scope changes, mutations) still load the log. */
    setPaused(value: boolean) {
      if (disposed) return
      paused = value
      if (!value) void load()
    },
    /** One forced full load, even while paused. */
    refresh() {
      if (!disposed) void load()
    },
    setEnabled: (on: boolean) => mutate("enabled", () => rpc.setEnabled({ on })),
    setFeature: (key: string, on: boolean) => mutate(key, () => rpc.setFeature({ key, on })),
    setSetting: (input: SetSettingInput) =>
      mutate(`setting:${input.key}`, () => (rpc.setSetting ? rpc.setSetting(input) : Promise.resolve({ ok: false }))),
    setSecret: (input: SetSecretInput) =>
      mutate(`secret:${input.key}`, () => (rpc.setSecret ? rpc.setSecret(input) : Promise.resolve({ ok: false }))),
    approve: (token: string, sessionID: string) =>
      mutate(`approve:${token}`, () => rpc.approve({ token, sessionID })),
    reject: (token: string) => mutate(`reject:${token}`, () => rpc.reject({ token })),
    approveAll: () => bulk("approveAll", () => rpc.approveAll({})),
    rejectAll: () => bulk("rejectAll", () => rpc.rejectAll({})),
    /**
     * The unified stop. Not `mutate`: its result carries what the receipt shows,
     * and a stop that was not sealed, stopped short, or has no hook enforcing it
     * must say so instead of passing as a plain success.
     */
    stopSession: async (sessionID: string) => {
      if (disposed) return
      const key = `stop:${sessionID}`
      update({ ...state, busy: key })
      try {
        const result = await rpc.stopSession({ sessionID })
        const warning = stopWarning(result)
        if (warning) dialogs.warning(warning)
        await load()
      } catch (error) {
        // The request crossed the bridge, so the operation may have run: saying
        // it failed would be as wrong as saying it stopped.
        dialogs.error(`The stop could not be confirmed: ${errorText(error)} Check the abort records before retrying.`)
        await load()
      } finally {
        if (!disposed) update({ ...state, busy: undefined })
      }
    },
    liftToolBan: (sessionID: string) => mutate(`liftToolBan:${sessionID}`, () => rpc.liftToolBan({ sessionID })),
    liftToolBanAndResume: (sessionID: string) =>
      mutate(`liftToolBanAndResume:${sessionID}`, () => rpc.liftToolBanAndResume({ sessionID })),
    listToolBans: () => rpc.listToolBans({}),
    dispose() {
      disposed = true
      unsubscribe()
    },
  }
}
