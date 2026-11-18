/**
 * Whether the host is auto-approving permissions, read from the client's own
 * config rather than guessed.
 *
 * Auto mode is client-side. The server raises `permission.asked` exactly as it
 * does in prompt mode; the TUI answers it itself with `once`, so no event,
 * session field, or API response records that it happened (measured: the
 * permission.asked data has no auto flag, Session.Info has no mode, the event
 * table keeps no permission rows, and `kv` has no flag). The only durable
 * evidence is the setting the palette toggle writes:
 * `~/.config/opencode/cli.json` → `session.permissions`.
 *
 * The one gap: `opencode --auto` sets the mode from a CLI flag with no file
 * behind it, so that launch reads as prompt mode and the risk check still runs.
 * Failing toward "run the check" is the safe direction for that blind spot.
 */

import { readFileSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

/** The host's own override, honoured so a launched host and this read agree. */
export const CONTENT_ENV = "OPENCODE_CLI_CONFIG_CONTENT"

/** Overrides the path for tests; unset in a real install. */
export const CONFIG_PATH_ENV = "JEV_CLI_CONFIG"

/**
 * The host parses cli.json as JSONC, so a trailing comma is legal there and
 * illegal to `JSON.parse`. Removing them needs string awareness: a comma inside
 * a quoted value, directly before a bracket, must survive.
 */
export function stripTrailingCommas(text: string): string {
  let out = ""
  let inString = false
  let escaped = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      out += ch
      if (escaped) escaped = false
      else if (ch === "\\") escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      out += ch
      continue
    }
    if (ch === "," && /^\s*[}\]]/.test(text.slice(i + 1))) continue
    out += ch
  }
  return out
}

export function parseConfig(text: string): any | null {
  for (const candidate of [text, stripTrailingCommas(text)]) {
    try {
      const parsed = JSON.parse(candidate)
      if (parsed && typeof parsed === "object") return parsed
    } catch {}
  }
  return null
}

export function configPath(): string {
  return process.env[CONFIG_PATH_ENV] ?? join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "opencode", "cli.json")
}

let cached: { mtimeMs: number; auto: boolean } | null = null

/**
 * True when the client auto-accepts. Re-read only when the file's mtime moves,
 * so this is cheap enough for every tool call. Anything unreadable, unparsable,
 * or absent is false: a parse failure must never silently disable a safety check.
 */
export function autoAccept(): boolean {
  const content = process.env[CONTENT_ENV]
  if (content) return parseConfig(content)?.session?.permissions === "autoaccept"
  try {
    const file = configPath()
    const mtimeMs = statSync(file).mtimeMs
    if (cached && cached.mtimeMs === mtimeMs) return cached.auto
    const auto = parseConfig(readFileSync(file, "utf8"))?.session?.permissions === "autoaccept"
    cached = { mtimeMs, auto }
    return auto
  } catch {
    return false
  }
}

/** Test seam: forget the mtime cache so a test's file is read again. */
export function resetAutoAcceptCache(): void {
  cached = null
}