/**
 * The approve flow: a blocked call becomes a record, the user's approval
 * becomes a grant, and the next matching call spends the grant.
 *
 * The token is the identity of the call — same session, same action, same
 * resources — so a retry of the same command is recognized and a modified
 * command is a different call. Six hex characters: short enough to type, and
 * the toast and the deny message both carry it.
 *
 * Two files, one writer each. The server writes the pending blocks, the TUI
 * writes the grants, so neither can clobber the other's state.
 */

import { createHash } from "node:crypto"
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { APPROVALS_FILE, GRANTS_FILE } from "./state.ts"

/** One blocked call waiting for a human. */
export interface Approval {
  token: string
  sessionID: string
  action: string
  resources: string[]
  subject: string
  reason: string
  ts: string
}

/** The identity of a call. The same call is the same token. */
export function callToken(sessionID: string, action: string, resources: string[]): string {
  const identity = [sessionID, action, ...[...resources].sort()].join("\0")
  return createHash("sha256").update(identity, "utf8").digest("hex").slice(0, 6)
}

function readJSON(path: string): any {
  try {
    return JSON.parse(readFileSync(path, "utf8"))
  } catch {
    return {}
  }
}

/** Write through a temp file so a reader never sees half a file. */
function writeJSON(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  const temp = `${path}.tmp`
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  chmodSync(temp, 0o600)
  renameSync(temp, path)
  chmodSync(path, 0o600)
}

function expired(ts: string, ttlSeconds: number): boolean {
  if (ttlSeconds <= 0) return false
  const at = Date.parse(ts)
  if (!Number.isFinite(at)) return true
  return Date.now() - at > ttlSeconds * 1000
}

/**
 * The blocked calls still waiting for a human, oldest first. A record past
 * its TTL is dropped: an approval nobody gives in time is not an approval.
 */
export function readApprovals(ttlSeconds: number): Approval[] {
  const stored = readJSON(APPROVALS_FILE)
  const out: Approval[] = []
  for (const [token, value] of Object.entries(stored ?? {})) {
    if (!value || typeof value !== "object") continue
    const approval = value as Partial<Approval>
    if (typeof approval.sessionID !== "string" || typeof approval.action !== "string") continue
    if (expired(String(approval.ts ?? ""), ttlSeconds)) continue
    out.push({
      token,
      sessionID: approval.sessionID,
      action: approval.action,
      resources: Array.isArray(approval.resources) ? approval.resources.map(String) : [],
      subject: String(approval.subject ?? ""),
      reason: String(approval.reason ?? ""),
      ts: String(approval.ts ?? ""),
    })
  }
  return out.sort((a, b) => a.ts.localeCompare(b.ts))
}

/** Record a blocked call. The same call keeps its token and gets a new time. */
export function recordApproval(approval: Approval, ttlSeconds: number): void {
  const stored = readJSON(APPROVALS_FILE)
  for (const [token, value] of Object.entries(stored)) {
    const ts = String((value as any)?.ts ?? "")
    if (expired(ts, ttlSeconds)) delete stored[token]
  }
  stored[approval.token] = approval
  writeJSON(APPROVALS_FILE, stored)
}

/** The approved tokens. */
export function readGrants(): Record<string, { sessionID: string; ts: string }> {
  const stored = readJSON(GRANTS_FILE)
  const out: Record<string, { sessionID: string; ts: string }> = {}
  for (const [token, value] of Object.entries(stored ?? {})) {
    if (!value || typeof value !== "object") continue
    out[token] = { sessionID: String((value as any).sessionID ?? ""), ts: String((value as any).ts ?? "") }
  }
  return out
}

/** Approve one blocked call. The next matching call spends the grant. */
export function grant(token: string, sessionID: string): void {
  const stored = readGrants()
  stored[token] = { sessionID, ts: new Date().toISOString() }
  writeJSON(GRANTS_FILE, stored)
}

/**
 * Spend a grant. Returns true when the token was granted, in which case the
 * grant is gone: it allows one call, not a policy.
 */
export function consumeGrant(token: string): boolean {
  const stored = readGrants()
  if (!(token in stored)) return false
  delete stored[token]
  writeJSON(GRANTS_FILE, stored)
  return true
}
