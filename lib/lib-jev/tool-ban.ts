/**
 * Per-session tool-call tool ban. A block tool bans the blocked session and
 * its subagents; only an explicit liftTool ban lifts it. Stored in the Jev state home
 * with no secrets. Tool bans are auditable through the call log at the write site.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

export interface ToolBan {
  sessionID: string
  subagents: string[]
  reason: string
  toolBannedAt: string
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

export function toolBanPath(): string {
  return join(stateHome(), "jev-tool-bans.json")
}

function legacyToolBanPath(): string {
  return join(stateHome(), "jev-bans.json")
}

function readAll(): ToolBan[] {
  for (const path of [toolBanPath(), legacyToolBanPath()]) {
    try {
      const rows = JSON.parse(readFileSync(path, "utf8"))
      return Array.isArray(rows) ? (rows as ToolBan[]) : []
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue
      return []
    }
  }
  return []
}

function writeAll(rows: ToolBan[]): void {
  try {
    mkdirSync(stateHome(), { recursive: true })
    writeFileSync(toolBanPath(), JSON.stringify(rows.slice(-200)), "utf8")
  } catch {}
}

/** Tool ban a session and its subagents. Idempotent: banning the tool refreshes the record. */
export function banTool(sessionID: string, subagents: string[], reason: string): ToolBan {
  const record: ToolBan = {
    sessionID,
    subagents: [...new Set(subagents)],
    reason,
    toolBannedAt: new Date().toISOString(),
  }
  writeAll([...readAll().filter((row) => row.sessionID !== sessionID && !subagents.includes(row.sessionID)), record])
  return record
}

/** Attach the opened card id + tool to a tool ban record for later reopen. */
export function setToolBanCard(sessionID: string, formID: string, tool: string): void {
  writeAll(readAll().map((row) => (row.sessionID === sessionID ? { ...row, formID, cardID: row.cardID ?? formID, tool } : row)))
}

/** Find the tool ban record a native form id belongs to (for the reply subscriber). */
export function toolBanForForm(formID: string): ToolBan | undefined {
  const id = String(formID ?? "")
  if (!id) return undefined
  return readAll().find((row) => row.formID === id)
}

/** Newest tool ban record with a card, for /jev-latest. */
export function latestToolBanCard(): ToolBan | undefined {
  return readAll()
    .filter((row) => row.formID)
    .sort((a, b) => Date.parse(b.toolBannedAt) - Date.parse(a.toolBannedAt))[0]
}

/** Lift the tool ban on a session and any subagent records it owns. */
export function unbanTool(sessionID: string): number {
  const before = readAll()
  const after = before.filter((row) => row.sessionID !== sessionID && !row.subagents.includes(sessionID))
  writeAll(after)
  return before.length - after.length
}

export function isToolBanned(sessionID: string): boolean {
  return readAll().some((row) => row.sessionID === sessionID || row.subagents.includes(sessionID))
}

export function readToolBans(): ToolBan[] {
  return readAll()
}
