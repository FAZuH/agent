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
  stopSession(input: { sessionID: string }): Promise<{ ok: boolean; subagents: string[] }>
  unblockSession(input: { sessionID: string }): Promise<{ ok: boolean; count: number }>
  listBans(input: {}): Promise<{ bans: SessionBanInfo[] }>
  setEnabled(input: { on: boolean }): Promise<{ ok: boolean }>
  setFeature(input: { key: string; on: boolean }): Promise<{ ok: boolean }>
  // Optional so the panel still renders against a server without the Settings methods.
  getSettings?(input: {}): Promise<SettingsInfo>
  setSetting?(input: SetSettingInput): Promise<{ ok: boolean; error?: string }>
  setSecret?(input: SetSecretInput): Promise<{ ok: boolean; error?: string }>
  subscribe(listener: (event: { reason: string }) => void): () => void
}

export interface SessionBanInfo {
  sessionID: string
  subagents: string[]
  reason: string
  bannedAt: string
  formID?: string
  tool?: string
}

export interface JevViewState {
  status?: JevStatus
  settings?: SettingsInfo
  rows: Array<Record<string, unknown>>
  approvals: Approval[]
  bans: SessionBanInfo[]
  loading: boolean
  error?: string
  busy?: string
}

export interface JevDialogs {
  update(state: JevViewState): void
  error(message: string): void
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

export function createJevView(rpc: JevRPC, dialogs: JevDialogs) {
  let disposed = false
  let generation = 0
  // undefined = all sessions; a value scopes recent calls to one session.
  let sessionID: string | undefined
  // How many recent rows to fetch; capped to the RPC log limit.
  let limit = 15
  let paused = false
  let state: JevViewState = { rows: [], approvals: [], bans: [], loading: false }
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
      const [status, log, pending, bans, settings] = await Promise.all([
        rpc.status({}),
        withLog ? rpc.log({ limit: Math.min(200, Math.max(1, limit)), ...(sessionID ? { sessionID } : {}) }) : Promise.resolve(null),
        rpc.approvals({}),
        rpc.listBans({}),
        rpc.getSettings ? rpc.getSettings({}) : Promise.resolve(undefined),
      ])
      if (disposed || request !== generation) return
      update({
        status,
        settings: settings ?? state.settings,
        rows: withLog && log ? log.rows : state.rows,
        approvals: pending.approvals,
        bans: bans.bans,
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

  async function mutate(key: string, run: () => Promise<{ ok: boolean }>) {
    if (disposed) return
    update({ ...state, busy: key })
    try {
      const result = await run()
      if (!result.ok) dialogs.error("That change was not applied.")
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
    stopSession: (sessionID: string) => mutate(`stop:${sessionID}`, () => rpc.stopSession({ sessionID })),
    unblockSession: (sessionID: string) => mutate(`unblock:${sessionID}`, () => rpc.unblockSession({ sessionID })),
    listBans: () => rpc.listBans({}),
    dispose() {
      disposed = true
      unsubscribe()
    },
  }
}
