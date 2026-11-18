/**
 * Pure search filtering for the Jev Settings tab. The view renders rows from
 * the metadata here, so a query matches only the friendly text the user sees.
 */
import { groupLabel, settingMeta } from "../../../lib/lib-jev/setting-meta.ts"

interface RowText {
  key: string
  title: string
  description: string
  alias?: string
}

export interface FieldMatch {
  key: string
  label: string
  description: string
}

export interface GroupMatch {
  feature: string
  title: string
  fields: FieldMatch[]
}

export interface SettingsFilterResult {
  connection: string[]
  secrets: string[]
  groups: GroupMatch[]
  empty: boolean
}

const CONNECTION_ROWS: readonly RowText[] = [
  { key: "protocol", title: "Protocol", description: "How Jev is asked for a decision." },
  { key: "think", title: "Thinking", description: "Whether the model reasons before it answers." },
  { key: "model", title: "Model", description: "The provider's wire model id." },
  { key: "keyEnv", title: "Key env vars", description: "Comma-separated env var names, checked in order before the key file." },
  { key: "keyFile", title: "Key file", description: "Key file, read when no env var matched." },
  { key: "yoloAsk", title: "YOLO propagate", description: "What a propagate verdict does while the client auto-accepts." },
  { key: "approveTtl", title: "Approval TTL", description: "Seconds a blocked call stays approvable." },
  { key: "sidebar", title: "Sidebar", description: "Whether the sidebar shows recent hook calls." },
  { key: "sidebarCount", title: "Sidebar calls", description: "How many recent calls the sidebar shows." },
  { key: "sidebarSubject", title: "Sidebar subjects", description: "Whether each sidebar line carries a clipped subject." },
  { key: "toast", title: "Toast calls", description: "Master switch for toasts; off means no call is announced." },
  { key: "logMax", title: "Log cap", description: "Call-log cap; older lines are pruned to keep this many." },
]

const SECRET_ROWS: readonly RowText[] = [
  { key: "apiKey", title: "API key", description: "Provider key. Write-only: it is never read back." },
  { key: "alertWebhook", title: "Alert webhook", description: "Discord webhook for alerts; empty turns it off." },
  { key: "endpoint", title: "Endpoint", description: "Full URL of the decisions or chat endpoint." },
  { key: "supervisorEndpoint", title: "Supervisor endpoint", description: "Endpoint for the supervisor's review call.", alias: "endpoint" },
]

function matches(row: RowText, query: string): boolean {
  if (!query) return true
  return `${row.title}\n${row.description}\n${row.alias ?? row.key}`.toLowerCase().includes(query)
}

function matchesField(label: string, description: string, key: string, query: string): boolean {
  if (!query) return true
  return `${label}\n${description}\n${key}`.toLowerCase().includes(query)
}

function isSecretFeatureField(feature: string, key: string): boolean {
  return key === "alertWebhook" || (feature === "hook_supervisor" && key === "endpoint")
}

export function filterSettings(
  query: string,
  config: Record<string, Record<string, unknown>>,
): SettingsFilterResult {
  const q = query.trim().toLowerCase()
  const connection = CONNECTION_ROWS.filter((row) => matches(row, q)).map((row) => row.key)
  const secrets = SECRET_ROWS.filter((row) => matches(row, q)).map((row) => row.key)
  const groups: GroupMatch[] = []
  for (const [feature, fields] of Object.entries(config)) {
    const matched: FieldMatch[] = []
    for (const key of Object.keys(fields)) {
      if (isSecretFeatureField(feature, key)) continue
      const meta = settingMeta(feature, key)
      if (matchesField(meta.label, meta.description, key, q)) {
        matched.push({ key, label: meta.label, description: meta.description })
      }
    }
    if (matched.length > 0) groups.push({ feature, title: groupLabel(feature), fields: matched })
  }
  return {
    connection,
    secrets,
    groups,
    empty: connection.length === 0 && secrets.length === 0 && groups.length === 0,
  }
}
