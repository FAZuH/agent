/** The rules of the announce plugin, with no host and no network in sight. */

export type Scope = "global" | "session"

export interface SessionRow {
  id: string
  parentID?: string
}

export interface Descendant extends SessionRow {
  depth: number
}

export interface ActiveResult {
  stdout: string
  stderr: string
  ok: boolean
}

export type ActiveFetch = (path: string) => Promise<ActiveResult>
export type SendOne = (sessionID: string, text: string) => Promise<unknown>

/** The message after the command name, or a usage error when there is none. */
export function requireMessage(text: unknown): string {
  const message = String(text ?? "").trim()
  if (!message) throw new Error("Usage: /announce-global <message> or /announce-session <message>")
  return message
}

/** The caller session id, or a usage error when the host supplied none. */
export function requireSession(sessionID: unknown): string {
  const id = String(sessionID ?? "")
  if (!id) throw new Error("announce failed: no session.")
  return id
}

/** The running ids from the active-session response. */
export function activeSet(stdout: string, stderr: string, ok: boolean): Set<string> {
  if (!ok) {
    const reason = String(stderr ?? "").trim() || "unknown error"
    throw new Error(`announce failed: active sessions lookup failed: ${reason}`)
  }
  let raw: unknown
  try {
    raw = JSON.parse(stdout)
  } catch {
    throw new Error("announce failed: active sessions returned invalid JSON")
  }
  const root = (raw as any)?.data ?? raw
  const out = new Set<string>()
  if (root && typeof root === "object") {
    for (const [id, value] of Object.entries(root)) {
      if ((value as any)?.type === "running") out.add(id)
    }
  }
  return out
}

/** The running sessions, through an injected fetch so no process is spawned here. */
export async function runningIDs(fetchActive: ActiveFetch): Promise<Set<string>> {
  const { stdout, stderr, ok } = await fetchActive("/api/session/active")
  return activeSet(stdout, stderr, ok)
}

/** Every session under `rootID`, however deep, never revisiting an id. */
export function descendants(rows: SessionRow[], rootID: string): Descendant[] {
  const children = new Map<string, SessionRow[]>()
  for (const row of rows ?? []) {
    if (!row?.id || !row.parentID) continue
    const list = children.get(row.parentID)
    if (list) list.push(row)
    else children.set(row.parentID, [row])
  }
  const out: Descendant[] = []
  const seen = new Set<string>([rootID])
  const queue: Array<{ id: string; depth: number }> = [{ id: rootID, depth: 1 }]
  while (queue.length) {
    const current = queue.shift()!
    for (const child of children.get(current.id) ?? []) {
      if (!child.id || seen.has(child.id)) continue
      seen.add(child.id)
      out.push({ ...child, depth: current.depth })
      queue.push({ id: child.id, depth: current.depth + 1 })
    }
  }
  return out
}

/** Session ids that receive a given scope of announcement. */
export function targets(scope: Scope, caller: string, running: Set<string>, rows: SessionRow[]): string[] {
  const ids = scope === "global" ? [...running] : [caller, ...descendants(rows, caller).filter((r) => running.has(r.id)).map((r) => r.id)]
  return [...new Set(ids)].filter((id) => Boolean(id && id.trim()))
}

/** The provenance prefix and the message, unchanged, on the next line. */
export function formatAnnouncement(scope: Scope, from: string, text: string): string {
  return `[announce ${scope} from ${from}]\n${text}`
}

export type SessionLister = (input: { limit: number; cursor?: string }) => Promise<unknown>

function sessionPage(result: unknown): { data: SessionRow[]; next?: string } {
  const outer = (result ?? {}) as any
  const root = Array.isArray(outer.data) ? outer : (outer.data ?? outer)
  const data = Array.isArray(root?.data) ? (root.data as SessionRow[]) : Array.isArray(result) ? (result as SessionRow[]) : []
  const next = typeof root?.cursor?.next === "string" ? root.cursor.next : undefined
  return { data, next: next || undefined }
}

/** Every session, through an injected lister so no host call is made here. */
export async function allSessions(list: SessionLister): Promise<SessionRow[]> {
  const out: SessionRow[] = []
  const seen = new Set<string>()
  let cursor: string | undefined
  for (let guard = 0; guard < 128 && out.length < 2000; guard++) {
    const current = sessionPage(await list({ limit: Math.min(1000, 2000 - out.length), cursor }))
    for (const row of current.data) {
      if (!row?.id || seen.has(row.id)) continue
      seen.add(row.id)
      out.push(row)
    }
    if (!current.next || current.next === cursor) break
    cursor = current.next
  }
  return out
}

/** Send to all targets in parallel; one failure must not block the rest. */
export async function deliverAll(text: string, ids: string[], sendOne: SendOne): Promise<void> {
  const settled = await Promise.allSettled(ids.map((id) => sendOne(id, text)))
  const failed = settled.flatMap((result, i) => (result.status === "rejected" ? [ids[i]] : []))
  if (failed.length) throw new Error(`announce failed: delivery to ${failed.join(", ")} failed`)
}
