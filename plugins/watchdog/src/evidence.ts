/**
 * Read-only evidence broker: allowlist, request/reference types, and guards
 * around a host-supplied I/O adapter. Guards read path metadata only
 * (lstat/realpath) to keep symlinks inside the configured root. This module
 * never reads file contents, the network or the shell; the adapter does, and
 * only after a guard has approved the request. Results are references plus
 * short redacted excerpts, never whole file bodies.
 *
 * `supervisor-host.ts` supplies the adapter and a configured root.
 */

import { lstatSync, realpathSync } from "node:fs"
import { dirname, join, sep } from "node:path"

export const MAX_EXCERPT_CHARS = 400
export const MAX_EXCERPTS = 8
export const MAX_QUERY_CHARS = 200

export type EvidenceKind = "file" | "search" | "git-show" | "git-log"

export interface EvidenceRef {
  kind: EvidenceKind
  /** Normalized path relative to the configured root. */
  path: string
  excerpt: string
  line?: number
  rev?: string
}

export interface EvidenceResult {
  refs: EvidenceRef[]
  redacted: boolean
  /** Present when a guard rejected the request; no adapter call was made. */
  error?: string
}

export interface EvidenceLimits {
  root: string
  maxExcerptChars?: number
  maxExcerpts?: number
}

export interface FileReadRequest {
  path: string
}

export interface SearchRequest {
  query: string
  path?: string
  glob?: string
}

export interface GitShowRequest {
  rev: string
  path: string
}

export interface GitLogRequest {
  path?: string
  maxCount?: number
}

export interface RawSearchHit {
  path: string
  line?: number
  text: string
}

export interface RawLogEntry {
  rev: string
  subject: string
}

/** The only seam that performs I/O. Implemented by `supervisor-host.ts`. */
export interface RawEvidenceAdapter {
  readFile(path: string): Promise<string>
  search(query: string, path?: string, glob?: string): Promise<RawSearchHit[]>
  gitShow(rev: string, path: string): Promise<string>
  gitLog(path?: string, maxCount?: number): Promise<RawLogEntry[]>
}

export interface EvidenceBroker {
  readFile(req: FileReadRequest): Promise<EvidenceResult>
  search(req: SearchRequest): Promise<EvidenceResult>
  gitShow(req: GitShowRequest): Promise<EvidenceResult>
  gitLog(req: GitLogRequest): Promise<EvidenceResult>
}

export type Guard<T> = { ok: true; value: T } | { ok: false; reason: string }

const SHELL_META = /[\0-\x1f\x7f;|&$`><(){}[\]!\\]/
const SECRET_FILE = /(^|[._-])(env|pem|p12|pfx|key|rsa|secret|token|credentials|passwd|password)(\.[a-z0-9]+)?$/i
const NETWORK = /^(?:[a-z][a-z0-9+.-]*:\/\/|[a-z0-9._-]+@|\/\/)/i
const GLOB_OK = /^[A-Za-z0-9._/*?+\-[\]]+$/

/** Resolve a path lexically under root and apply the secret/git denylist. */
export function validatePath(raw: string, root: string): Guard<string> {
  if (typeof raw !== "string" || !raw.trim()) return { ok: false, reason: "invalid path" }
  if (NETWORK.test(raw)) return { ok: false, reason: "network URL not allowed" }
  if (SHELL_META.test(raw)) return { ok: false, reason: "shell metacharacters not allowed" }

  const base = root.replace(/\/+$/, "")
  let candidate = raw
  if (candidate.startsWith("/")) {
    if (candidate !== base && !candidate.startsWith(base + "/")) {
      return { ok: false, reason: "path outside root" }
    }
    candidate = candidate.slice(base.length).replace(/^\//, "")
  }

  const parts = candidate.split("/")
  const stack: string[] = []
  for (const part of parts) {
    if (!part || part === ".") continue
    if (part === "..") {
      if (stack.length === 0) return { ok: false, reason: "path outside root" }
      stack.pop()
      continue
    }
    stack.push(part)
  }

  for (const part of stack) {
    if (part === ".git") return { ok: false, reason: "git internals not allowed" }
    if (SECRET_FILE.test(part)) return { ok: false, reason: "secret filename not allowed" }
  }

  const relative = stack.join("/")
  if (!relative) return { ok: false, reason: "invalid path" }
  return { ok: true, value: relative }
}

/**
 * Lexical allowlist plus filesystem confinement. Any symlink on the path is
 * refused, and an existing target must resolve under the root's real path.
 * A missing target passes only the lexical guard; the adapter reports the miss.
 */
export function validateResolvedPath(raw: string, root: string): Guard<string> {
  const lexical = validatePath(raw, root)
  if (!lexical.ok) return lexical

  let realRoot: string
  try {
    realRoot = realpathSync(root)
  } catch {
    // No directory to escape from; the lexical guard is the only check possible.
    return lexical
  }

  const target = join(realRoot, lexical.value)
  let cursor = target
  for (;;) {
    try {
      if (lstatSync(cursor).isSymbolicLink()) return { ok: false, reason: "symlink not allowed" }
    } catch {
      break
    }
    if (cursor === realRoot) break
    const parent = dirname(cursor)
    if (parent === cursor) break
    cursor = parent
  }

  try {
    const realTarget = realpathSync(target)
    if (realTarget !== realRoot && !realTarget.startsWith(realRoot + sep)) {
      return { ok: false, reason: "path outside root" }
    }
  } catch {
    // Missing target: the lexical guard already bounded it.
  }

  return lexical
}

/** Git revisions are identifiers, not shell fragments or paths. */
export function validateRev(raw: string): Guard<string> {
  if (typeof raw !== "string" || !raw.trim()) return { ok: false, reason: "invalid revision" }
  const rev = raw.trim()
  if (SHELL_META.test(rev) || rev.includes(":")) return { ok: false, reason: "shell metacharacters not allowed" }
  if (rev.includes("..")) return { ok: false, reason: "path traversal not allowed" }
  if (!/^[A-Za-z0-9._~/+-]+$/.test(rev)) return { ok: false, reason: "invalid revision" }
  return { ok: true, value: rev }
}

export function validateQuery(raw: string): Guard<string> {
  if (typeof raw !== "string" || !raw.trim()) return { ok: false, reason: "invalid query" }
  const query = raw.trim()
  if (query.length > MAX_QUERY_CHARS) return { ok: false, reason: "query too long" }
  if (SHELL_META.test(query)) return { ok: false, reason: "shell metacharacters not allowed" }
  return { ok: true, value: query }
}

export function validateGlob(raw: string | undefined): Guard<string | undefined> {
  if (raw === undefined) return { ok: true, value: undefined }
  if (typeof raw !== "string" || !raw.trim()) return { ok: false, reason: "invalid glob" }
  if (raw.length > MAX_QUERY_CHARS) return { ok: false, reason: "glob too long" }
  if (!GLOB_OK.test(raw)) return { ok: false, reason: "glob has disallowed characters" }
  return { ok: true, value: raw }
}

export function boundExcerpt(text: string, maxChars: number = MAX_EXCERPT_CHARS): string {
  return text.length <= maxChars ? text : text.slice(0, Math.max(0, maxChars))
}

const REDACTIONS: Array<[RegExp, string]> = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/g, "[REDACTED KEY]"],
  [/(Authorization\s*:\s*Bearer\s+)[A-Za-z0-9._~+/-]+/gi, "$1[REDACTED]"],
  [/\bBearer\s+[A-Za-z0-9._~+/-]{6,}\b/g, "Bearer [REDACTED]"],
  [
    /\b(API[_-]?KEY|TOKEN|PASSWORD|PASSWD|SECRET|CLIENT[_-]?SECRET|PRIVATE[_-]?KEY)\b(\s*[:=]\s*)(["']?)([^\s"',;&]+)/gi,
    "$1$2$3[REDACTED]",
  ],
  [/\b(AKIA|ASIA)[0-9A-Z]{16}\b/g, "[REDACTED]"],
]

export function redactExcerpt(text: string): { text: string; redacted: boolean } {
  let out = text
  for (const [pattern, replacement] of REDACTIONS) out = out.replace(pattern, replacement)
  return { text: out, redacted: out !== text }
}

/**
 * Wrap a host adapter with the allowlist. Every request is validated before
 * the adapter runs, and every returned row is path-validated, bounded and
 * redacted before it can reach the audit record.
 */
export function createEvidenceBroker(adapter: RawEvidenceAdapter, limits: EvidenceLimits): EvidenceBroker {
  const maxChars = limits.maxExcerptChars ?? MAX_EXCERPT_CHARS
  const maxRefs = limits.maxExcerpts ?? MAX_EXCERPTS

  const denied = (reason: string): EvidenceResult => ({ refs: [], redacted: false, error: `denied: ${reason}` })

  const makeRef = (
    kind: EvidenceKind,
    path: string,
    rawText: string,
    extra: Partial<EvidenceRef> = {},
  ): { ref: EvidenceRef; redacted: boolean } => {
    const clean = redactExcerpt(rawText)
    return {
      ref: { kind, path, excerpt: boundExcerpt(clean.text, maxChars), ...extra },
      redacted: clean.redacted,
    }
  }

  const fromHits = (hits: RawSearchHit[]): EvidenceResult => {
    const refs: EvidenceRef[] = []
    let redacted = false
    for (const hit of hits) {
      if (refs.length >= maxRefs) break
      const path = validateResolvedPath(hit.path, limits.root)
      if (!path.ok) continue
      const made = makeRef("search", path.value, hit.text, hit.line === undefined ? {} : { line: hit.line })
      refs.push(made.ref)
      redacted = redacted || made.redacted
    }
    return { refs, redacted }
  }

  return {
    async readFile(req: FileReadRequest): Promise<EvidenceResult> {
      const path = validateResolvedPath(req.path, limits.root)
      if (!path.ok) return denied(path.reason)
      const body = await adapter.readFile(path.value)
      const made = makeRef("file", path.value, body)
      return { refs: [made.ref], redacted: made.redacted }
    },

    async search(req: SearchRequest): Promise<EvidenceResult> {
      const query = validateQuery(req.query)
      if (!query.ok) return denied(query.reason)
      const path = req.path === undefined ? undefined : validateResolvedPath(req.path, limits.root)
      if (path && !path.ok) return denied(path.reason)
      const glob = req.glob === undefined ? undefined : validateGlob(req.glob)
      if (glob && !glob.ok) return denied(glob.reason)
      const hits = await adapter.search(query.value, path?.value, glob?.value)
      return fromHits(hits)
    },

    async gitShow(req: GitShowRequest): Promise<EvidenceResult> {
      const rev = validateRev(req.rev)
      if (!rev.ok) return denied(rev.reason)
      const path = validateResolvedPath(req.path, limits.root)
      if (!path.ok) return denied(path.reason)
      const body = await adapter.gitShow(rev.value, path.value)
      const made = makeRef("git-show", path.value, body, { rev: rev.value })
      return { refs: [made.ref], redacted: made.redacted }
    },

    async gitLog(req: GitLogRequest): Promise<EvidenceResult> {
      const path = req.path === undefined ? undefined : validateResolvedPath(req.path, limits.root)
      if (path && !path.ok) return denied(path.reason)
      if (req.maxCount !== undefined && (!Number.isInteger(req.maxCount) || req.maxCount < 1 || req.maxCount > 100)) {
        return denied("invalid maxCount")
      }
      const entries = await adapter.gitLog(path?.value, req.maxCount)
      const refs: EvidenceRef[] = []
      let redacted = false
      for (const entry of entries) {
        if (refs.length >= maxRefs) break
        const rev = validateRev(entry.rev)
        if (!rev.ok) continue
        const made = makeRef("git-log", "git log", entry.subject, { rev: rev.value })
        refs.push(made.ref)
        redacted = redacted || made.redacted
      }
      return { refs, redacted }
    },
  }
}
