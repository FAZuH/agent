/**
 * Per-session tool-call ban. A block bans the blocked session and
 * its subagents; only an explicit unblock lifts it. Stored in the Jev state home
 * with no secrets. Bans are auditable through the call log at the write site.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

export interface SessionBan {
  sessionID: string
  subagents: string[]
  reason: string
  bannedAt: string
  /** Card/record fields for /jev-latest reopen. No secrets. */
  cardID?: string
  tool?: string
  formID?: string
}

function stateHome(): string {
  return (
    process.env.OPENCODE_JEV_STATE_HOME ??
    process.env.JEV_STATE_HOME ??
    process.env.JEV_DATA_HOME ??
    join(process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"), "opencode", "jev")
  )
}

export function banPath(): string {
  return join(stateHome(), "jev-bans.json")
}

function readAll(): SessionBan[] {
  try {
    const rows = JSON.parse(readFileSync(banPath(), "utf8"))
    return Array.isArray(rows) ? (rows as SessionBan[]) : []
  } catch {
    return []
  }
}

function writeAll(rows: SessionBan[]): void {
  try {
    mkdirSync(stateHome(), { recursive: true })
    writeFileSync(banPath(), JSON.stringify(rows.slice(-200)), "utf8")
  } catch {}
}

/** Ban a session and its subagents. Idempotent: re-banning refreshes the record. */
export function banSession(sessionID: string, subagents: string[], reason: string): SessionBan {
  const record: SessionBan = {
    sessionID,
    subagents: [...new Set(subagents)],
    reason,
    bannedAt: new Date().toISOString(),
  }
  writeAll([...readAll().filter((row) => row.sessionID !== sessionID && !subagents.includes(row.sessionID)), record])
  return record
}

/** Attach the opened card id + tool to a ban record for later reopen. */
export function setBanCard(sessionID: string, formID: string, tool: string): void {
  writeAll(readAll().map((row) => (row.sessionID === sessionID ? { ...row, formID, cardID: row.cardID ?? formID, tool } : row)))
}

/** Find the ban record a native form id belongs to (for the reply subscriber). */
export function banForForm(formID: string): SessionBan | undefined {
  const id = String(formID ?? "")
  if (!id) return undefined
  return readAll().find((row) => row.formID === id)
}

/** Newest ban record with a card, for /jev-latest. */
export function latestBannedCard(): SessionBan | undefined {
  return readAll()
    .filter((row) => row.formID)
    .sort((a, b) => Date.parse(b.bannedAt) - Date.parse(a.bannedAt))[0]
}

/** Lift the ban on a session and any subagent records it owns. */
export function unbanSession(sessionID: string): number {
  const before = readAll()
  const after = before.filter((row) => row.sessionID !== sessionID && !row.subagents.includes(sessionID))
  writeAll(after)
  return before.length - after.length
}

export function isBanned(sessionID: string): boolean {
  return readAll().some((row) => row.sessionID === sessionID || row.subagents.includes(sessionID))
}

export function readBans(): SessionBan[] {
  return readAll()
}
