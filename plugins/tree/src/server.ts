import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

import { buildTree, familyOf, normalizeBase, normalizeHost, resolveLinkBase, webBaseURL, type ServiceConfig, type TreeSession } from "./tree.ts"
import { buildGraph, normalizeMessages, type SessionMessage } from "./layout.ts"
import { renderPage } from "./web.ts"

export type ResolvedOptions = {
  hostname: string
  port: number
  limit: number
  maxNodes: number
  /** An explicit base from the plugin option or env; empty when unset. */
  explicitBase: string
  /** The base derived from the configured service host and port. */
  configuredBase: string
}

export type SessionLister = (input: { limit: number; cursor?: string }) => Promise<unknown>

/** Raw session context lookup; the result is unwrapped by `normalizeMessages`. */
export type MessageFetcher = (sessionID: string) => Promise<unknown>

const DEFAULTS = {
  hostname: "127.0.0.1",
  port: 47821,
  limit: 500,
  maxNodes: 2000,
}
const MAX_LIMIT = 2000

const text = (value: unknown): string => (typeof value === "string" ? value : "")
const number = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0)
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {}

function optionOf(options: Record<string, unknown>, envName: string, short: string): unknown {
  const kebab = envName.toLowerCase().replace(/_/g, "-")
  const camel = kebab.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())
  for (const key of [envName, kebab, camel, short]) {
    const value = options[key]
    if (value !== undefined && value !== null && value !== "") return value
  }
  return undefined
}

function pick(
  env: Record<string, string | undefined>,
  options: Record<string, unknown>,
  envName: string,
  short: string,
): unknown {
  const fromEnv = text(env[envName]).trim()
  return fromEnv || optionOf(options, envName, short)
}

function portOf(value: unknown, fallback: number): number {
  const port = typeof value === "number" ? value : Number.parseInt(text(value).trim(), 10)
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : fallback
}

function limitOf(value: unknown): number {
  const limit = typeof value === "number" ? value : Number.parseInt(text(value).trim(), 10)
  if (!Number.isInteger(limit) || limit < 1) return DEFAULTS.limit
  return Math.min(limit, MAX_LIMIT)
}

function maxNodesOf(value: unknown): number {
  if (value === undefined || value === null || (typeof value === "string" && value.trim() === "")) return DEFAULTS.maxNodes
  const max = typeof value === "number" ? value : Number.parseInt(text(value).trim(), 10)
  if (!Number.isInteger(max) || max < 0) return DEFAULTS.maxNodes
  return max
}

export function resolveOptions(
  env: Record<string, string | undefined>,
  options?: Record<string, unknown>,
  service?: ServiceConfig,
): ResolvedOptions {
  const opts = record(options)
  const hostname = text(pick(env, opts, "OPENCODE_TREE_HOST", "host")).trim() || DEFAULTS.hostname
  const port = portOf(pick(env, opts, "OPENCODE_TREE_PORT", "port"), DEFAULTS.port)
  const limit = limitOf(pick(env, opts, "OPENCODE_TREE_LIMIT", "limit"))
  const maxNodes = maxNodesOf(pick(env, opts, "OPENCODE_TREE_MAX", "maxNodes") ?? opts.max)
  const option = text(pick(env, opts, "OPENCODE_TREE_WEB_BASE", "webBaseURL")).trim()
  return {
    hostname,
    port,
    limit,
    maxNodes,
    explicitBase: normalizeBase(option),
    configuredBase: webBaseURL({ service }),
  }
}

function configHome(env: Record<string, string | undefined>): string {
  const xdg = text(env.XDG_CONFIG_HOME).trim()
  return xdg ? join(xdg, "opencode", "service.json") : join(homedir(), ".config", "opencode", "service.json")
}

function stateHome(env: Record<string, string | undefined>): string {
  const xdg = text(env.XDG_STATE_HOME).trim()
  return join(xdg || join(homedir(), ".local", "state"), "opencode", "service.json")
}

/** The service config is optional; an unreadable file must not break the plugin. */
export function readServiceConfig(env: Record<string, string | undefined> = process.env): ServiceConfig {
  try {
    const parsed = JSON.parse(readFileSync(configHome(env), "utf8"))
    return parsed && typeof parsed === "object" ? (parsed as ServiceConfig) : null
  } catch {
    return null
  }
}

/** The live service URL written by the running service, "" when unavailable. */
export function readLiveBase(env: Record<string, string | undefined> = process.env): string {
  try {
    const parsed = JSON.parse(readFileSync(stateHome(env), "utf8"))
    return normalizeBase(record(parsed).url)
  } catch {
    return ""
  }
}

const PROBE_TTL = 10_000
const PROBE_TIMEOUT = 500

let probe: { base: string; at: number; reachable: boolean } | null = null

/** A 2xx on `/` means the configured base can serve session links. */
export async function probeBase(base: string, now = Date.now()): Promise<boolean> {
  if (!base) return false
  if (probe && probe.base === base && now - probe.at < PROBE_TTL) return probe.reachable
  let reachable = false
  try {
    const response = await fetch(`${base}/`, { signal: AbortSignal.timeout(PROBE_TIMEOUT) })
    reachable = response.ok
    if (response.body) await response.body.cancel().catch(() => {})
  } catch {
    reachable = false
  }
  probe = { base, at: now, reachable }
  return reachable
}

export function resetProbe(): void {
  probe = null
}

type Entry = {
  server: any
  port: number
  refs: number
  options: ResolvedOptions
}

let active: Entry | null = null
let pending: Promise<Entry> | null = null
let lister: SessionLister | null = null
let fetcher: MessageFetcher | null = null

type MessageCacheEntry = { updated: number; at: number; messages: SessionMessage[] }
const messageCache = new Map<string, MessageCacheEntry>()
const MESSAGE_TTL = 60_000

/** A session's messages, cached by id and its own `time.updated`. */
export async function messagesFor(
  session: TreeSession,
  now = Date.now(),
): Promise<SessionMessage[]> {
  const key = session.id
  const updated = number(session.time?.updated)
  const cached = messageCache.get(key)
  if (cached && cached.updated === updated && now - cached.at < MESSAGE_TTL) return cached.messages
  if (!fetcher) return cached?.messages ?? []
  try {
    const messages = normalizeMessages(await fetcher(key))
    messageCache.set(key, { updated, at: now, messages })
    return messages
  } catch {
    return cached?.messages ?? []
  }
}

export function resetMessageCache(): void {
  messageCache.clear()
}

function isAddrInUse(error: unknown): boolean {
  const code = (error as any)?.code
  const message = error instanceof Error ? error.message : String(error)
  return code === "EADDRINUSE" || /EADDRINUSE|address already in use/i.test(message)
}

function page(result: unknown): { data: TreeSession[]; next?: string } {
  const outer = record(result)
  const root = Array.isArray(outer.data) ? outer : record(outer.data)
  const data = Array.isArray(root.data)
    ? (root.data as TreeSession[])
    : Array.isArray(result)
      ? (result as TreeSession[])
      : []
  const next = text((root as any)?.cursor?.next)
  return { data, next: next || undefined }
}

async function collect(limit: number): Promise<TreeSession[]> {
  if (!lister) throw new Error("no session source")
  const out: TreeSession[] = []
  const seen = new Set<string>()
  let cursor: string | undefined
  for (let guard = 0; guard < 128 && out.length < limit; guard++) {
    const result = await lister({ limit: Math.min(1000, limit - out.length), cursor })
    const current = page(result)
    for (const session of current.data) {
      if (!session || !text(session.id) || seen.has(session.id)) continue
      seen.add(session.id)
      out.push(session)
    }
    if (!current.next || current.next === cursor) break
    cursor = current.next
  }
  return out.slice(0, limit)
}

async function graphOf(
  sessions: TreeSession[],
  focus: string,
  webBase: string,
  extra: { maxNodes?: number; expand?: string[] } = {},
) {
  const family = familyOf(sessions, focus)
  const messages = new Map<string, SessionMessage[]>()
  await Promise.all(
    family.map(async (session) => {
      messages.set(session.id, await messagesFor(session))
    }),
  )
  return buildGraph({ sessions, focus, messages, webBase, maxNodes: extra.maxNodes, expand: extra.expand })
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  })
}

function html(body: string): Response {
  return new Response(body, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  })
}

async function asset(): Promise<Response> {
  const file = Bun.file(new URL("../web/cytoscape.min.js", import.meta.url))
  if (!(await file.exists())) return new Response("Not found", { status: 404 })
  return new Response(file, {
    headers: {
      "content-type": "text/javascript; charset=utf-8",
      "cache-control": "public, max-age=1",
    },
  })
}

async function linkBase(options: ResolvedOptions, override?: unknown): Promise<string> {
  const explicit = normalizeBase(override) || options.explicitBase
  if (explicit) return explicit
  try {
    const reachable = await probeBase(options.configuredBase)
    return resolveLinkBase({
      configured: options.configuredBase,
      live: readLiveBase(),
      reachable,
    })
  } catch {
    return resolveLinkBase({ live: readLiveBase() })
  }
}

function handler(options: ResolvedOptions) {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url)
    if (url.pathname === "/") {
      const base = await linkBase(options, url.searchParams.get("base"))
      return html(renderPage(base, options.limit, options.configuredBase))
    }
    if (url.pathname === "/vendor/cytoscape.min.js") return asset()
    if (url.pathname === "/api/health") {
      return json({ ok: true, pid: process.pid, uptime: process.uptime() })
    }
    if (url.pathname === "/api/tree") {
      const requested = Number.parseInt(url.searchParams.get("limit") ?? "", 10)
      const limit = Number.isInteger(requested) ? Math.min(Math.max(requested, 1), MAX_LIMIT) : options.limit
      const session = text(url.searchParams.get("session"))
      try {
        const sessions = await collect(limit)
        const tree = buildTree(sessions, session)
        const webBase = await linkBase(options, url.searchParams.get("base"))
        if (url.searchParams.get("graph") === "1") {
          const maxParam = url.searchParams.get("max")
          const parsedMax = maxParam === null ? NaN : Number.parseInt(maxParam, 10)
          const maxNodes = Number.isInteger(parsedMax) && parsedMax >= 0 ? parsedMax : options.maxNodes
          const expand = url.searchParams
            .getAll("expand")
            .flatMap((value) => value.split(","))
            .map((value) => value.trim())
            .filter(Boolean)
          return json({
            ...tree,
            graph: await graphOf(sessions, tree.focus, webBase, { maxNodes, expand }),
            webBase,
            configuredBase: options.configuredBase,
          })
        }
        return json({ ...tree, webBase, configuredBase: options.configuredBase })
      } catch (error) {
        return json({
          error: error instanceof Error ? error.message : String(error),
          webBase: await linkBase(options, url.searchParams.get("base")),
          configuredBase: options.configuredBase,
        }, 500)
      }
    }
    return new Response("Not found", { status: 404 })
  }
}

function bind(options: ResolvedOptions): { server: any; port: number } {
  let lastError: unknown
  for (let offset = 0; offset <= 10; offset++) {
    const port = options.port + offset
    if (port > 65535) break
    try {
      const server = Bun.serve({ hostname: options.hostname, port, fetch: handler(options) })
      return { server, port: server.port ?? port }
    } catch (error) {
      lastError = error
      if (!isAddrInUse(error)) throw error
    }
  }
  throw lastError ?? new Error("no port available")
}

function start(options: ResolvedOptions): Entry {
  const { server, port } = bind(options)
  console.log(`[tree] viewer ${viewerURL(port, undefined, options.hostname)}`)
  return { server, port, refs: 0, options }
}

export type Viewer = { port: number; hostname: string; webBaseURL: string }

export function viewerURL(port: number, sessionID?: string, hostname = "127.0.0.1"): string {
  const host = normalizeHost(hostname) || "127.0.0.1"
  const authority = host.includes(":") ? `[${host}]` : host
  const query = new URLSearchParams()
  if (sessionID) query.set("session", sessionID)
  const search = query.toString()
  return `http://${authority}:${port}/${search ? `?${search}` : ""}`
}

export async function acquire(
  list: SessionLister,
  context: MessageFetcher,
  options: ResolvedOptions,
): Promise<Viewer> {
  lister = list
  fetcher = context
  if (active) {
    active.refs++
    return { port: active.port, hostname: active.options.hostname, webBaseURL: active.options.explicitBase }
  }
  let starting = pending
  if (!starting) {
    starting = Promise.resolve().then(() => start(options))
    pending = starting
  }
  let entry: Entry
  try {
    entry = await starting
  } catch (error) {
    if (pending === starting) pending = null
    throw error
  }
  entry.refs++
  if (pending === starting) {
    pending = null
    active = entry
  }
  return { port: entry.port, hostname: entry.options.hostname, webBaseURL: entry.options.explicitBase }
}

export function release(): void {
  if (!active) return
  active.refs--
  if (active.refs > 0) return
  const entry = active
  active = null
  try {
    entry.server.stop(true)
  } catch (error) {
    console.error(`[tree] stop failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}
