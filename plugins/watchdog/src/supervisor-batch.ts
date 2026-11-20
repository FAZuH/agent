import type { SupervisorCall } from "./supervisor-call.ts"

export type { SupervisorCall }

export type SupervisorMode = "default" | "standalone" | "nonBlocking"

/** `active` is the supervisor feature switch plus a configured model. */
export function resolveSupervisorMode(config: { standalone: boolean; nonBlocking: boolean; active: boolean }): SupervisorMode {
  if (!config.active) return "default"
  if (config.nonBlocking) return "nonBlocking"
  return config.standalone ? "standalone" : "default"
}

export interface SupervisorBatch {
  sessionID: string
  calls: SupervisorCall[]
}

export interface BatchQueue {
  /** Returns a full batch at the cap, else null. Clears what it hands out. */
  record(call: SupervisorCall): SupervisorBatch | null
  drain(sessionID: string): SupervisorBatch | null
  sessions(): string[]
  size(sessionID: string): number
}

export function createBatchQueue(batchMax: number): BatchQueue {
  const bySession = new Map<string, SupervisorCall[]>()
  const cap = Math.max(1, batchMax)
  return {
    record(call) {
      const list = bySession.get(call.sessionID) ?? []
      list.push(call)
      if (list.length < cap) {
        bySession.set(call.sessionID, list)
        return null
      }
      bySession.delete(call.sessionID)
      return { sessionID: call.sessionID, calls: list }
    },
    drain(sessionID) {
      const list = bySession.get(sessionID)
      if (!list?.length) return null
      bySession.delete(sessionID)
      return { sessionID, calls: list }
    },
    sessions() {
      return [...bySession.keys()]
    },
    size(sessionID) {
      return bySession.get(sessionID)?.length ?? 0
    },
  }
}

/** The abort target; a mixed batch names no session, so the caller must drop it. */
export function batchTargetSession(calls: SupervisorCall[]): string | null {
  const sessionID = calls[0]?.sessionID
  if (!sessionID || calls.some((call) => call.sessionID !== sessionID)) return null
  return sessionID
}

export type BatchVerdict = "allow" | "abort"

/** Fail closed: propagate, deny, wrong case and malformed answers all abort. */
export function normalizeBatchVerdict(raw: unknown): BatchVerdict {
  return raw === "allow" ? "allow" : "abort"
}

export interface BatchRunnerDeps {
  batchMs: number
  batchMax: number
  onFlush: (batch: SupervisorBatch) => void
  /** Injected so a test can fire a window without a clock. Returns a cancel. */
  schedule?: (sessionID: string, ms: number, fire: () => void) => () => void
}

export interface BatchRunner {
  record(call: SupervisorCall): void
  endSession(sessionID: string): void
  close(): void
}

export function createBatchRunner(deps: BatchRunnerDeps): BatchRunner {
  const queue = createBatchQueue(deps.batchMax)
  const timers = new Map<string, () => void>()
  let closed = false
  const schedule =
    deps.schedule ??
    ((sessionID: string, ms: number, fire: () => void) => {
      const timer = setTimeout(fire, ms)
      return () => clearTimeout(timer)
    })

  const cancelTimer = (sessionID: string) => {
    const cancel = timers.get(sessionID)
    if (cancel) cancel()
    timers.delete(sessionID)
  }
  const flush = (batch: SupervisorBatch | null) => {
    if (!batch || closed) return
    cancelTimer(batch.sessionID)
    deps.onFlush(batch)
  }

  return {
    record(call) {
      if (closed) return
      // One window per session, opened by its first call and never restarted.
      if (queue.size(call.sessionID) === 0) {
        timers.set(
          call.sessionID,
          schedule(call.sessionID, deps.batchMs, () => {
            timers.delete(call.sessionID)
            flush(queue.drain(call.sessionID))
          }),
        )
      }
      flush(queue.record(call))
    },
    endSession(sessionID) {
      cancelTimer(sessionID)
      flush(queue.drain(sessionID))
    },
    close() {
      closed = true
      for (const cancel of timers.values()) cancel()
      timers.clear()
      for (const sessionID of queue.sessions()) {
        const batch = queue.drain(sessionID)
        if (batch) deps.onFlush(batch)
      }
    },
  }
}
