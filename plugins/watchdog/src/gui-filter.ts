/** Pure helpers for the Jev call log, kept separate from the JSX view so they are testable. */

/**
 * One outcome vocabulary for the badge column. A row's hook is its source,
 * not an outcome, so it never appears here; it moves to the expanded detail.
 */
export function rowBadge(row: Record<string, unknown>): string {
  const verdict = row.verdict
  if (typeof verdict === "string" && verdict.trim()) return verdict.toUpperCase()
  if (row.skipped != null && String(row.skipped).trim()) return "SKIPPED"
  const event = row.event
  if (typeof event === "string" && event.trim()) {
    return event.replace(/^supervisor[_-]/i, "").replace(/[_-]/g, " ").toUpperCase()
  }
  return "—"
}

/** A short, always-present label so a log row can never render blank. */
export function rowSummary(row: Record<string, unknown>): string {
  const value = row.detail ?? row.subject ?? row.reason ?? row.error ?? row.skipped ?? row.tool ?? row.hook
  const text = value == null ? "" : String(value)
  return text || "jev event"
}

/** Filter recent rows by hook, badge and case-insensitive text. Never touches payload fields. */
export function filterRows(
  rows: Array<Record<string, unknown>>,
  opts: { hook: string; badge: string; query: string },
): Array<Record<string, unknown>> {
  const q = opts.query.trim().toLowerCase()
  return rows.filter((row) => {
    if (opts.hook !== "all" && String(row.hook ?? "") !== opts.hook) return false
    if (opts.badge !== "all" && rowBadge(row) !== opts.badge) return false
    if (!q) return true
    const haystack = [rowSummary(row), row.detail, row.reason, row.ts, row.sessionID, row.tool, row.hook]
      .map((value) => (value == null ? "" : String(value).toLowerCase()))
      .join("\n")
    return haystack.includes(q)
  })
}


/** Distinct hook names present in the rows, sorted. */
export function distinctHooks(rows: Array<Record<string, unknown>>): string[] {
  return [...new Set(rows.map((row) => String(row.hook ?? "")).filter(Boolean))].sort()
}

/** Distinct badges present in the rows, sorted. */
export function distinctBadges(rows: Array<Record<string, unknown>>): string[] {
  return [...new Set(rows.map((row) => rowBadge(row)))].sort()
}
