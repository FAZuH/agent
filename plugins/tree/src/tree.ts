export type TreeSession = {
  id: string
  parentID?: string | null
  fork?: { sessionID?: string | null; boundary?: unknown } | null
  title?: string | null
  agent?: string | null
  model?: { id?: string | null; providerID?: string | null; variant?: string | null } | null
  cost?: number | null
  tokens?: { input?: number | null; output?: number | null; reasoning?: number | null } | null
  outcome?: string | null
  time?: { created?: number | null; updated?: number | null; busy?: number | null; idle?: number | null } | null
  location?: { directory?: string | null } | null
}

export type SessionKind = "root" | "subagent" | "fork"
export type SessionStatus = "busy" | "idle"
export type EdgeKind = "subagent" | "fork"

export type TreeNode = {
  id: string
  title: string
  label: string
  kind: SessionKind
  agent: string
  model: string
  cost: number
  tokens: { input: number; output: number; reasoning: number }
  outcome: string
  status: SessionStatus
  created: number
  updated: number
  directory: string
}

export type TreeEdge = { from: string; to: string; kind: EdgeKind }
export type TreeRoot = { id: string; title: string; updated: number }

export type TreeData = {
  generatedAt: number
  focus: string
  roots: TreeRoot[]
  nodes: TreeNode[]
  edges: TreeEdge[]
  stats: { nodes: number; subagents: number; forks: number }
}

export const LABEL_LIMIT = 36
export const ROOT_LIMIT = 200

const text = (value: unknown): string => (typeof value === "string" ? value : "")
const number = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0)

/** A fork carries its source in `fork`; a subagent carries it in `parentID`. */
export function sourceOf(session: TreeSession | undefined | null): string | undefined {
  const fork = text(session?.fork?.sessionID)
  if (fork) return fork
  const parent = text(session?.parentID)
  return parent || undefined
}

export function kindOf(session: TreeSession): SessionKind {
  if (session.fork?.sessionID) return "fork"
  if (session.parentID) return "subagent"
  return "root"
}

/** Busy while a turn runs: `busy` exists and no later idle mark has landed. */
export function statusOf(session: TreeSession): SessionStatus {
  const busy = session.time?.busy
  if (typeof busy !== "number") return "idle"
  const idle = session.time?.idle
  if (typeof idle !== "number" || idle === 0) return "busy"
  return busy > idle ? "busy" : "idle"
}

export function labelOf(title: unknown, limit = LABEL_LIMIT): string {
  const value = text(title).trim() || "(untitled)"
  const chars = Array.from(value)
  return chars.length <= limit ? value : chars.slice(0, limit - 1).join("") + "…"
}

function modelOf(session: TreeSession): string {
  const id = text(session.model?.id)
  const provider = text(session.model?.providerID)
  if (!id) return ""
  return provider ? `${provider}/${id}` : id
}

export function toNode(session: TreeSession): TreeNode {
  return {
    id: session.id,
    title: text(session.title) || "(untitled)",
    label: labelOf(session.title),
    kind: kindOf(session),
    agent: text(session.agent),
    model: modelOf(session),
    cost: number(session.cost),
    tokens: {
      input: number(session.tokens?.input),
      output: number(session.tokens?.output),
      reasoning: number(session.tokens?.reasoning),
    },
    outcome: text(session.outcome),
    status: statusOf(session),
    created: number(session.time?.created),
    updated: number(session.time?.updated),
    directory: text(session.location?.directory),
  }
}

type Graph = {
  byId: Map<string, TreeSession>
  children: Map<string, TreeSession[]>
}

function index(sessions: TreeSession[]): Graph {
  const byId = new Map<string, TreeSession>()
  for (const session of sessions) {
    if (!session || !text(session.id)) continue
    if (!byId.has(session.id)) byId.set(session.id, session)
  }
  const children = new Map<string, TreeSession[]>()
  for (const session of byId.values()) {
    const source = sourceOf(session)
    if (!source || source === session.id || !byId.has(source)) continue
    const list = children.get(source)
    if (list) list.push(session)
    else children.set(source, [session])
  }
  for (const list of children.values()) {
    list.sort((a, b) => {
      const created = number(a.time?.created) - number(b.time?.created)
      return created !== 0 ? created : a.id.localeCompare(b.id)
    })
  }
  return { byId, children }
}

/** Climb to the top of the source chain, stopping at a missing source or a cycle. */
export function rootOf(graph: Graph, id: string): string {
  const seen = new Set<string>()
  let current = id
  for (;;) {
    if (seen.has(current)) return ""
    seen.add(current)
    const source = sourceOf(graph.byId.get(current))
    if (!source || source === current || !graph.byId.has(source)) return current
    current = source
  }
}

export function rootsOf(graph: Graph): TreeRoot[] {
  const roots: TreeRoot[] = []
  for (const session of graph.byId.values()) {
    const root = rootOf(graph, session.id)
    if (root !== session.id) continue
    roots.push({
      id: session.id,
      title: text(session.title) || "(untitled)",
      updated: number(session.time?.updated),
    })
  }
  roots.sort((a, b) => b.updated - a.updated || a.id.localeCompare(b.id))
  return roots.slice(0, ROOT_LIMIT)
}

const EMPTY: TreeData = {
  generatedAt: 0,
  focus: "",
  roots: [],
  nodes: [],
  edges: [],
  stats: { nodes: 0, subagents: 0, forks: 0 },
}

/** The session the family descends from: the requested session's root, else the newest root. */
export function focusRoot(graph: Graph, focus?: string): string {
  const roots = rootsOf(graph)
  const requested = text(focus)
  const requestedRoot = requested && graph.byId.has(requested) ? rootOf(graph, requested) : ""
  return requestedRoot || roots[0]?.id || ""
}

/** The focused root's family, root first, children ordered by created then id. */
export function familyOf(sessions: TreeSession[], focus?: string, graph?: Graph): TreeSession[] {
  const g = graph ?? index(sessions ?? [])
  if (g.byId.size === 0) return []
  const out: TreeSession[] = []
  const visited = new Set<string>()
  const walk = (id: string) => {
    if (visited.has(id)) return
    const session = g.byId.get(id)
    if (!session) return
    visited.add(id)
    out.push(session)
    for (const child of g.children.get(id) ?? []) walk(child.id)
  }
  const id = focusRoot(g, focus)
  if (id) walk(id)
  return out
}

export function buildTree(sessions: TreeSession[], focus?: string): TreeData {
  const graph = index(sessions ?? [])
  if (graph.byId.size === 0) return { ...EMPTY, generatedAt: Date.now(), focus: text(focus) }

  const roots = rootsOf(graph)
  const focusId = focusRoot(graph, focus)

  const family = familyOf(sessions, focus, graph)
  const nodes = family.map(toNode)

  const inFamily = new Set(family.map((session) => session.id))
  const edges: TreeEdge[] = []
  for (const session of family) {
    const source = sourceOf(session)
    if (source && source !== session.id && inFamily.has(source)) {
      edges.push({ from: source, to: session.id, kind: session.fork?.sessionID ? "fork" : "subagent" })
    }
  }

  let subagents = 0
  let forks = 0
  for (const node of nodes) {
    if (node.kind === "subagent") subagents++
    else if (node.kind === "fork") forks++
  }

  return {
    generatedAt: Date.now(),
    focus: focusId,
    roots,
    nodes,
    edges,
    stats: { nodes: nodes.length, subagents, forks },
  }
}

export type ServiceConfig = { hostname?: unknown; port?: unknown } | null | undefined

export const DEFAULT_LINK_BASE = "http://127.0.0.1:4096"

/** Wildcard listeners are not addressable from a browser; links go to loopback. */
export function normalizeHost(hostname: string): string {
  const value = hostname.trim().replace(/^\[/, "").replace(/\]$/, "")
  if (value === "0.0.0.0" || value === "::" || value === "*") return "127.0.0.1"
  return value
}

function authority(host: string, port: number | string): string {
  const name = host.includes(":") ? `[${host}]` : host
  return port === "" || port === undefined ? name : `${name}:${port}`
}

/** Returns "" for anything that cannot be a link base: only http(s) survives. */
export function normalizeBase(value: unknown): string {
  const raw = text(value).trim()
  if (!raw) return ""
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return ""
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return ""
  const host = normalizeHost(url.hostname)
  if (!host) return ""
  const path = url.pathname.replace(/\/+$/, "")
  return `${url.protocol}//${authority(host, url.port)}${path}`
}

export type LinkBaseInput = {
  /** Option, env, or `?base=`; wins whenever it parses. */
  explicit?: unknown
  /** The configured service host and port. */
  configured?: unknown
  /** The live service URL from the state file. */
  live?: unknown
  /** Whether `configured` answered a probe. */
  reachable?: boolean
}

export function resolveLinkBase(input: LinkBaseInput = {}): string {
  const explicit = normalizeBase(input.explicit)
  if (explicit) return explicit
  const configured = normalizeBase(input.configured)
  if (configured && input.reachable === true) return configured
  return normalizeBase(input.live) || DEFAULT_LINK_BASE
}

export function webBaseURL(input: { option?: string; service?: ServiceConfig } = {}): string {
  const option = normalizeBase(input.option)
  if (option) return option

  const service = input.service
  const host = text(service?.hostname) ? normalizeHost(text(service?.hostname)) : ""
  if (host) {
    const raw = Number(service?.port)
    const port = Number.isInteger(raw) && raw > 0 && raw < 65536 ? raw : 4096
    return `http://${authority(host, port)}`
  }

  return DEFAULT_LINK_BASE
}
