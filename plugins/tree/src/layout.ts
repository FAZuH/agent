import {
  familyOf,
  kindOf,
  labelOf,
  sourceOf,
  statusOf,
  toNode,
  type TreeSession,
} from "./tree.ts"

export type SessionMessage = {
  id: string
  role: "user" | "assistant"
  created: number
  text: string
}

export type GraphLane = {
  id: string
  kind: "root" | "subagent" | "fork"
  title: string
  agent: string
  status: "busy" | "idle"
  linked: string
  mergedAt: number | null
  merged: boolean
  live: boolean
  group?: { agent: string; count: number; liveCount: number; members: string[] }
}

export type GraphNode = {
  id: string
  lane: string
  role: "header" | "user" | "assistant" | "ellipsis"
  /** Lane column, 34px per lane. */
  x: number
  /** Row: a lane's header is row 0, its nodes follow in consecutive rows. */
  y: number
  label: string
  tooltipFields: Record<string, string>
}

export type GraphEdge = { from: string; to: string; kind: "flow" | "fork" | "spawn" | "merge" }

export type SessionGraph = {
  focus: string
  lanes: GraphLane[]
  nodes: GraphNode[]
  edges: GraphEdge[]
  stats: {
    lanes: number
    nodes: number
    messages: number
    flow: number
    fork: number
    spawn: number
    merge: number
    omittedMessages: number
    groups: number
    totalLanes: number
    budgeted: boolean
  }
}

export type GraphInput = {
  sessions: TreeSession[]
  focus?: string
  messages: Map<string, SessionMessage[]>
  webBase: string
  now?: number
  expand?: Iterable<string>
  maxNodes?: number
}

/** Pixels between adjacent lanes. */
export const LANE_W = 34
/** Pixels per row; the page multiplies the payload's row index by this. */
export const ROW_H = 26
/** Messages shown per lane without being asked for by a branch. */
export const CAPS = { root: 120, fork: 60, subagent: 30 } as const
/** Preview text kept per message; the tooltip shows the first 60 characters. */
export const PREVIEW_LIMIT = 240
/** A run of unselected messages this long becomes one ellipsis node. */
export const ELLIPSIS_MIN = 3
/** Families with more lanes than this collapse repetitive subagent lanes by agent. */
export const GROUP_THRESHOLD = 40
/** Default rendered-message budget; 0 disables it. */
export const DEFAULT_MAX_NODES = 2000

const text = (value: unknown): string => (typeof value === "string" ? value : "")
const number = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0)
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {}

function unwrap(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw
  const outer = record(raw)
  if (Array.isArray(outer.data)) return outer.data as unknown[]
  const inner = record(outer.data)
  if (Array.isArray(inner.data)) return inner.data as unknown[]
  return []
}

function previewOf(message: Record<string, unknown>): string {
  const type = text(message.type)
  if (type === "user") return text(message.text)
  if (type === "assistant") {
    let reasoning = ""
    let tool = ""
    for (const part of Array.isArray(message.content) ? message.content : []) {
      const p = record(part)
      if (text(p.type) === "text" && text(p.text)) return text(p.text)
      if (text(p.type) === "reasoning" && !reasoning) reasoning = text(p.text)
      if (text(p.type) === "tool" && !tool) tool = text(p.name)
    }
    return reasoning || (tool ? `tool ${tool}` : "")
  }
  return ""
}

/** The user/assistant records of a session context, in ascending time order. */
export function normalizeMessages(raw: unknown): SessionMessage[] {
  const out: SessionMessage[] = []
  for (const item of unwrap(raw)) {
    const message = record(item)
    const type = text(message.type)
    if (type !== "user" && type !== "assistant") continue
    const id = text(message.id)
    const created = number(record(message.time).created)
    if (!id || !created) continue
    out.push({ id, role: type, created, text: previewOf(message).slice(0, PREVIEW_LIMIT) })
  }
  out.sort((a, b) => a.created - b.created)
  return out
}

function boundaryOf(session: TreeSession): string {
  return text(record(session.fork?.boundary).messageID)
}

function truncate(value: string, limit: number): string {
  const chars = Array.from(value)
  return chars.length <= limit ? value : chars.slice(0, limit - 1).join("") + "…"
}

function tokensText(tokens: { input: number; output: number; reasoning: number }): string {
  return `in ${tokens.input.toLocaleString()} · out ${tokens.output.toLocaleString()} · reasoning ${tokens.reasoning.toLocaleString()}`
}

export function relTime(milliseconds: number, now: number): string {
  if (!milliseconds) return "never"
  const delta = now - milliseconds
  if (delta < 0) return "now"
  const seconds = Math.floor(delta / 1000)
  if (seconds < 45) return "just now"
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

type Unit =
  | { kind: "header" }
  | { kind: "message"; index: number }
  | { kind: "ellipsis"; first: number; count: number }

type LaneInfo = {
  session: TreeSession
  messages: SessionMessage[]
  units: Unit[]
  /** Message index to its rank in units. */
  ranks: Map<number, number>
  selected: Set<number>
  protectedIndices: Set<number>
  headerId?: string
  lastMessageTime: number
  /**
   * Message index in the PARENT's list that this lane branches from: the fork
   * boundary or the subagent spawn point; -1 means the parent's header.
   */
  branch: number
  /** Message index in the parent's list where a stopped subagent merges, or -1. */
  merge: number
}

type Relation = {
  parent: string
  kind: "subagent" | "fork"
  boundaryMessageID: string
}

function nodeIdFor(info: LaneInfo, rank: number): string {
  const lane = info.session.id
  const unit = info.units[rank]
  if (!unit) return info.headerId ?? `${lane}#h`
  if (unit.kind === "header") return info.headerId ?? `${lane}#h`
  if (unit.kind === "ellipsis") return `${lane}#e${unit.first}`
  return `${lane}#m${info.messages[unit.index].id}`
}

function selectionFor(messages: SessionMessage[], cap: number, extra: number[]): Set<number> {
  const selected = new Set<number>()
  for (let i = Math.max(0, messages.length - cap); i < messages.length; i++) selected.add(i)
  for (const index of extra) if (index >= 0 && index < messages.length) selected.add(index)
  return selected
}

function buildUnits(messages: SessionMessage[], selected: Set<number>): Unit[] {
  const units: Unit[] = [{ kind: "header" }]
  let previous = -1
  for (const index of [...selected].sort((a, b) => a - b)) {
    const gap = index - previous - 1
    if (gap >= ELLIPSIS_MIN) units.push({ kind: "ellipsis", first: previous + 1, count: gap })
    units.push({ kind: "message", index })
    previous = index
  }
  return units
}

/** The last message index at or before a time, or -1. */
function lastAtOrBefore(messages: SessionMessage[], time: number): number {
  let found = -1
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].created > time) break
    found = i
  }
  return found
}

/** The first message index at or after a time, or -1. */
function firstAtOrAfter(messages: SessionMessage[], time: number): number {
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].created >= time) return i
  }
  return -1
}

/** The parent node a child branches from, and its rank, for a branch kind. */
function branchNode(
  parent: LaneInfo,
  kind: "subagent" | "fork",
  messageIndex: number,
): { id: string; rank: number } {
  if (messageIndex >= 0) {
    const rank = parent.ranks.get(messageIndex)
    if (rank !== undefined) return { id: nodeIdFor(parent, rank), rank }
  }
  const rank = kind === "fork" ? parent.units.length - 1 : 0
  return { id: nodeIdFor(parent, rank), rank }
}

export function buildGraph(input: GraphInput): SessionGraph {
  const now = input.now !== undefined && Number.isFinite(input.now) ? input.now : Date.now()
  const family = familyOf(input.sessions, input.focus)
  const byId = new Map(family.map((session) => [session.id, session]))

  const relations = new Map<string, Relation>()
  for (const session of family) {
    const source = sourceOf(session)
    if (!source || source === session.id || !byId.has(source)) continue
    relations.set(session.id, {
      parent: source,
      kind: session.fork?.sessionID ? "fork" : "subagent",
      boundaryMessageID: boundaryOf(session),
    })
  }

  const childrenOf = new Map<string, TreeSession[]>()
  for (const session of family) {
    const relation = relations.get(session.id)
    if (!relation) continue
    const list = childrenOf.get(relation.parent)
    if (list) list.push(session)
    else childrenOf.set(relation.parent, [session])
  }

  const infos = new Map<string, LaneInfo>()
  for (const session of family) {
    const messages = input.messages.get(session.id) ?? []
    const kind = kindOf(session)

    const extra: number[] = []
    for (const child of childrenOf.get(session.id) ?? []) {
      const relation = relations.get(child.id)!
      if (relation.kind === "fork") {
        const index = messages.findIndex((message) => message.id === relation.boundaryMessageID)
        if (index >= 0) extra.push(index)
      } else {
        extra.push(lastAtOrBefore(messages, number(child.time?.created)))
        const childMessages = input.messages.get(child.id) ?? []
        if (childMessages.length) {
          extra.push(firstAtOrAfter(messages, childMessages[childMessages.length - 1].created))
        }
      }
    }

    const selected = selectionFor(messages, CAPS[kind], extra)
    infos.set(session.id, {
      session,
      messages,
      units: [],
      ranks: new Map(),
      selected,
      protectedIndices: new Set(extra.filter((index) => index >= 0 && index < messages.length)),
      lastMessageTime: messages.length ? messages[messages.length - 1].created : 0,
      branch: -1,
      merge: -1,
    })
  }

  // Branch and merge points reference the parent's message list, so measure
  // them once every lane's selection is known.
  for (const session of family) {
    const relation = relations.get(session.id)
    if (!relation) continue
    const parent = infos.get(relation.parent)!
    const info = infos.get(session.id)!
    if (relation.kind === "fork") {
      info.branch = parent.messages.findIndex((message) => message.id === relation.boundaryMessageID)
    } else {
      info.branch = lastAtOrBefore(parent.messages, number(session.time?.created))
      info.merge = info.lastMessageTime > 0 ? firstAtOrAfter(parent.messages, info.lastMessageTime) : -1
    }
  }

  const offsets = new Map<string, number>()
  const computing = new Set<string>()
  function offsetFor(id: string): number {
    if (offsets.has(id)) return offsets.get(id)!
    if (computing.has(id)) return 0
    computing.add(id)
    let value = 0
    const relation = relations.get(id)
    if (relation) {
      const info = infos.get(id)!
      const { rank } = branchNode(infos.get(relation.parent)!, relation.kind, info.branch)
      value = offsetFor(relation.parent) + rank + 1
    }
    computing.delete(id)
    offsets.set(id, value)
    return value
  }

  // Lanes run left to right in session creation order.
  const ordered = [...family].sort(
    (a, b) => number(a.time?.created) - number(b.time?.created) || a.id.localeCompare(b.id),
  )

  const expandedSet = new Set(
    [...(input.expand ?? [])].map((value) => String(value).trim()).filter(Boolean),
  )
  type Group = { agent: string; id: string; members: TreeSession[]; liveCount: number; expanded: boolean }
  const groupsByAgent = new Map<string, TreeSession[]>()
  if (family.length > GROUP_THRESHOLD) {
    for (const session of ordered) {
      if (kindOf(session) !== "subagent") continue
      const agent = text(session.agent)
      if (!agent) continue
      const list = groupsByAgent.get(agent)
      if (list) list.push(session)
      else groupsByAgent.set(agent, [session])
    }
  }
  const groups = new Map<string, Group>()
  for (const [agent, members] of groupsByAgent) {
    if (members.length < 2) continue
    groups.set(agent, {
      agent,
      id: `group:${agent}`,
      members,
      liveCount: members.filter((member) => statusOf(member) === "busy").length,
      expanded: expandedSet.has(agent),
    })
  }
  const groupOf = new Map<string, Group>()
  for (const group of groups.values()) {
    for (const member of group.members) groupOf.set(member.id, group)
  }
  for (const group of groups.values()) {
    if (group.expanded) continue
    for (const member of group.members) {
      const info = infos.get(member.id)!
      info.selected = new Set()
      info.headerId = `${group.id}#h`
    }
  }

  const rawMax = input.maxNodes
  const budget =
    rawMax === undefined
      ? DEFAULT_MAX_NODES
      : rawMax === 0
        ? Infinity
        : Number.isFinite(rawMax) && rawMax > 0
          ? rawMax
          : DEFAULT_MAX_NODES
  let totalSelected = 0
  for (const session of ordered) {
    const group = groupOf.get(session.id)
    if (group && !group.expanded) continue
    totalSelected += infos.get(session.id)!.selected.size
  }
  let budgeted = false
  if (totalSelected > budget) {
    budgeted = true
    const visible = ordered.filter((session) => {
      const group = groupOf.get(session.id)
      return !group || group.expanded
    })
    while (totalSelected > budget) {
      let dropped = false
      for (const session of visible) {
        if (totalSelected <= budget) break
        const info = infos.get(session.id)!
        const oldest = [...info.selected]
          .filter((index) => !info.protectedIndices.has(index))
          .sort((a, b) => a - b)[0]
        if (oldest === undefined) continue
        info.selected.delete(oldest)
        totalSelected--
        dropped = true
      }
      if (!dropped) break
    }
  }

  for (const info of infos.values()) {
    info.units = buildUnits(info.messages, info.selected)
    info.ranks = new Map()
    info.units.forEach((unit, rank) => {
      if (unit.kind === "message") info.ranks.set(unit.index, rank)
    })
  }

  const lanes: GraphLane[] = []
  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []

  const emitSession = (session: TreeSession) => {
    const node = toNode(session)
    const info = infos.get(session.id)!
    const relation = relations.get(session.id)
    const status = statusOf(session)
    const subagent = node.kind === "subagent"
    const merged = subagent && status === "idle" && node.outcome === "succeeded"
    const mergedAt = merged && info.lastMessageTime > 0 ? info.lastMessageTime : null
    const live = status === "busy"
    const x = lanes.length * LANE_W
    const yOffset = offsetFor(session.id)

    lanes.push({
      id: session.id,
      kind: node.kind,
      title: node.label,
      agent: node.agent,
      status,
      linked: `${input.webBase}/session/${encodeURIComponent(session.id)}`,
      mergedAt,
      merged,
      live,
    })

    const fields: Record<string, string> = {
      agent: node.agent || "—",
      model: node.model || "—",
      outcome: node.outcome || "—",
      status: node.status,
    }
    if (live) fields.live = "live"
    fields.messages = String(info.messages.length)
    fields.cost = `$${node.cost.toFixed(4)}`
    fields.tokens = tokensText(node.tokens)
    fields.directory = node.directory || "—"
    if (mergedAt) fields.merged = relTime(mergedAt, now)
    fields.updated = relTime(node.updated, now)

    const headerLabel =
      subagent && groupOf.get(session.id)?.expanded
        ? `${node.agent || "—"} · ${info.messages.length} msg · $${node.cost.toFixed(4)}`
        : node.label

    const ids: string[] = []
    info.units.forEach((unit, rank) => {
      const y = yOffset + rank
      if (unit.kind === "header") {
        const id = nodeIdFor(info, rank)
        nodes.push({ id, lane: session.id, role: "header", x, y, label: headerLabel, tooltipFields: fields })
        ids.push(id)
      } else if (unit.kind === "ellipsis") {
        const id = nodeIdFor(info, rank)
        nodes.push({
          id,
          lane: session.id,
          role: "ellipsis",
          x,
          y,
          label: `… ${unit.count}`,
          tooltipFields: { role: "ellipsis", omitted: `${unit.count} messages` },
        })
        ids.push(id)
      } else {
        const message = info.messages[unit.index]
        const id = nodeIdFor(info, rank)
        const preview = message.text || "—"
        nodes.push({
          id,
          lane: session.id,
          role: message.role,
          x,
          y,
          label: truncate(preview, 80),
          tooltipFields: {
            role: message.role,
            message: `msg ${unit.index + 1} of ${info.messages.length}`,
            preview: truncate(preview, 60),
            time: relTime(message.created, now),
          },
        })
        ids.push(id)
      }
    })

    for (let i = 1; i < ids.length; i++) {
      edges.push({ from: ids[i - 1], to: ids[i], kind: "flow" })
    }

    if (relation) {
      const parent = infos.get(relation.parent)!
      const branch = branchNode(parent, relation.kind, info.branch)
      edges.push({ from: branch.id, to: ids[0], kind: relation.kind === "fork" ? "fork" : "spawn" })
      if (merged) {
        const mergeRank = info.merge >= 0 ? parent.ranks.get(info.merge) : undefined
        const merge = nodeIdFor(parent, mergeRank !== undefined ? mergeRank : parent.units.length - 1)
        edges.push({ from: ids[ids.length - 1], to: merge, kind: "merge" })
      }
    }
  }

  const emitGroup = (group: Group) => {
    const x = lanes.length * LANE_W
    const label = group.liveCount
      ? `${group.agent} × ${group.members.length} · live ×${group.liveCount}`
      : `${group.agent} × ${group.members.length}`
    lanes.push({
      id: group.id,
      kind: "subagent",
      title: label,
      agent: group.agent,
      status: group.liveCount ? "busy" : "idle",
      linked: "",
      mergedAt: null,
      merged: false,
      live: group.liveCount > 0,
      group: {
        agent: group.agent,
        count: group.members.length,
        liveCount: group.liveCount,
        members: group.members.map((member) => member.id),
      },
    })
    nodes.push({
      id: `${group.id}#h`,
      lane: group.id,
      role: "header",
      x,
      y: offsetFor(group.members[0].id),
      label,
      tooltipFields: {
        agent: group.agent,
        count: String(group.members.length),
        liveCount: String(group.liveCount),
        live: group.liveCount ? `live ×${group.liveCount}` : "—",
        state: group.expanded ? "expanded" : "collapsed",
      },
    })
  }

  const emittedGroups = new Set<string>()
  for (const session of ordered) {
    const group = groupOf.get(session.id)
    if (group) {
      if (emittedGroups.has(group.id)) continue
      emittedGroups.add(group.id)
      emitGroup(group)
      if (group.expanded) {
        for (const member of group.members) emitSession(member)
      }
      continue
    }
    emitSession(session)
  }

  const count = (kind: GraphEdge["kind"]) => edges.filter((edge) => edge.kind === kind).length
  const rendered = nodes.filter((node) => node.role === "user" || node.role === "assistant").length
  const totalMessages = family.reduce((sum, session) => sum + (infos.get(session.id)?.messages.length ?? 0), 0)

  return {
    focus: family[0]?.id ?? "",
    lanes,
    nodes,
    edges,
    stats: {
      lanes: lanes.length,
      nodes: nodes.length,
      messages: rendered,
      flow: count("flow"),
      fork: count("fork"),
      spawn: count("spawn"),
      merge: count("merge"),
      omittedMessages: Math.max(0, totalMessages - rendered),
      groups: groups.size,
      totalLanes: family.length,
      budgeted,
    },
  }
}
