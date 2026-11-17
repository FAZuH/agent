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
    trial: boolean
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

export interface JevRPC {
  status(input: {}): Promise<JevStatus>
  log(input: { limit: number }): Promise<{ rows: Array<Record<string, unknown>> }>
  approvals(input: {}): Promise<{ approvals: Approval[] }>
  approve(input: { token: string; sessionID: string }): Promise<{ ok: boolean }>
  reject(input: { token: string }): Promise<{ ok: boolean }>
  setEnabled(input: { on: boolean }): Promise<{ ok: boolean }>
  setFeature(input: { key: string; on: boolean }): Promise<{ ok: boolean }>
  subscribe(listener: (event: { reason: string }) => void): () => void
}

export interface JevViewState {
  status?: JevStatus
  rows: Array<Record<string, unknown>>
  approvals: Approval[]
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
  let state: JevViewState = { rows: [], approvals: [], loading: false }
  const update = (next: JevViewState) => {
    state = next
    dialogs.update(state)
  }

  async function load() {
    if (disposed) return
    const request = ++generation
    update({ ...state, loading: true, error: undefined })
    try {
      const [status, log, pending] = await Promise.all([
        rpc.status({}),
        rpc.log({ limit: 30 }),
        rpc.approvals({}),
      ])
      if (disposed || request !== generation) return
      update({ status, rows: log.rows, approvals: pending.approvals, loading: false })
    } catch (error) {
      if (disposed || request !== generation) return
      update({ ...state, loading: false, error: errorText(error) })
    }
  }

  const unsubscribe = rpc.subscribe(() => {
    if (!disposed) void load()
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

  return {
    load,
    setEnabled: (on: boolean) => mutate("enabled", () => rpc.setEnabled({ on })),
    setFeature: (key: string, on: boolean) => mutate(key, () => rpc.setFeature({ key, on })),
    approve: (token: string, sessionID: string) =>
      mutate(`approve:${token}`, () => rpc.approve({ token, sessionID })),
    reject: (token: string) => mutate(`reject:${token}`, () => rpc.reject({ token })),
    dispose() {
      disposed = true
      unsubscribe()
    },
  }
}
