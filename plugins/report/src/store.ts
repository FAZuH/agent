/**
 * The report file store, server side only.
 *
 * One JSON file per session under the plugin's state home. The file is the
 * channel between the tool that writes a report and the views that show it:
 * the server owns writes, the TUI and the GUI read through the RPC, and a
 * half-written file must never be observable. Write a sibling temp file,
 * then rename it over the old one.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

import type { Report } from "./shared.ts"

const OLD_HOME = join(process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"), "fazuh-agent")
const STATE_HOME =
  process.env.OPENCODE_REPORT_STATE_HOME ??
  process.env.REPORT_STATE_HOME ??
  join(process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"), "opencode", "report")
export const REPORTS_DIR = join(STATE_HOME, "reports")

// One-shot move from the old shared root, like the other plugins. The old
// directory stays as the rollback path. Skipped when an override is set, so a
// test can never pull the live reports into its scratch home.
if (
  !process.env.OPENCODE_REPORT_STATE_HOME &&
  !process.env.REPORT_STATE_HOME &&
  !existsSync(REPORTS_DIR) &&
  existsSync(join(OLD_HOME, "reports"))
) {
  try {
    cpSync(join(OLD_HOME, "reports"), REPORTS_DIR, { recursive: true })
  } catch {}
}

/** How many reports one session keeps. The views list the newest first. */
export const REPORTS_LIMIT = 50

const SAFE_ID = /^[A-Za-z0-9._-]+$/

function fileOf(sessionID: string): string {
  if (!SAFE_ID.test(sessionID)) throw new Error(`unsafe session id: ${sessionID}`)
  return join(REPORTS_DIR, `${sessionID}.json`)
}

function valid(value: unknown): value is Report {
  if (!value || typeof value !== "object") return false
  const item = value as Record<string, unknown>
  return (
    typeof item.id === "string" &&
    (item.kind === "post-task" || item.kind === "prompt-user") &&
    typeof item.sessionID === "string" &&
    typeof item.at === "number" &&
    typeof item.title === "string"
  )
}

/** The session's reports, oldest first. A missing or broken file is empty. */
export function readReports(sessionID: string): Report[] {
  try {
    const parsed = JSON.parse(readFileSync(fileOf(sessionID), "utf8"))
    return Array.isArray(parsed) ? parsed.filter(valid) : []
  } catch {
    return []
  }
}

/** Every session's reports merged, oldest first, and capped for one view. */
export function readMany(sessionIDs: readonly string[], limit = 100): Report[] {
  const merged = sessionIDs.flatMap((sessionID) => readReports(sessionID))
  merged.sort((a, b) => a.at - b.at)
  return merged.length > limit ? merged.slice(merged.length - limit) : merged
}

/** Write a session's whole list atomically. */
export function writeReports(sessionID: string, list: Report[]): void {
  const file = fileOf(sessionID)
  mkdirSync(REPORTS_DIR, { recursive: true })
  const temp = `${file}.${process.pid}.tmp`
  writeFileSync(temp, `${JSON.stringify(list, null, 2)}\n`, "utf8")
  renameSync(temp, file)
}

/** Replace one report, by id, with the result of `patch`. Undefined when it is gone. */
export function updateReport(
  sessionID: string,
  reportID: string,
  patch: (report: Report) => Report,
): Report | undefined {
  const list = readReports(sessionID)
  const index = list.findIndex((report) => report.id === reportID)
  if (index === -1) return undefined
  const next = patch(list[index]!)
  list[index] = next
  writeReports(sessionID, list)
  return next
}

/** Append one report and return the stored list, capped at the limit. */
export function appendReport(report: Report, limit = REPORTS_LIMIT): Report[] {
  const list = readReports(report.sessionID)
  const next = [...list, report]
  const kept = next.length > limit ? next.slice(next.length - limit) : next
  writeReports(report.sessionID, kept)
  return kept
}
