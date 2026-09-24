/**
 * md-link core — single source of truth for the Obsidian live-mirror pair.
 *
 * Consumers:
 *   plugins/md-link/index.ts (server: mirrors assistant replies)
 *   plugins/md-link/tui.ts   (TUI: ctrl+alt+n / /md-link toggle)
 *
 * This repo is cloned as a project's `.opencode` directory; plugins/md-link/
 * auto-loads server-side as a package dir, while tui.ts needs an explicit
 * entry in cli.json.
 *
 * State file contract (~/.config/fazuh-agent/data/md-link-state.json):
 *   {
 *     "defaultDir": "/abs/dir" | null,          // fallback output dir
 *     "keep": 25 | null,                        // prune mirrors to N newest replies
 *     "sessions": { "<sessionID>": "/abs/dir" } // "" dir = use defaultDir
 *     "titles": { "<sessionID>": "<sanitized>" }// title fixed at toggle-ON
 *     "files": { "<sessionID>": "<filename>" }  // resolved name (authoritative)
 *     "persist": true|false                     // true = mirrors survive TUI exit
 *     "openWith": "<argv template>"             // opener; {path} raw, {uri} encoded;
 *                                               // absent = xdg-open obsidian:// URI
 *     "openOnEnable": true|false                // true = open the mirror when toggled ON
 *   }
 *
 * Filenames are `link_<Title>.md` (title fixed at enable time so session
 * renames never orphan content), `link_<Title>_<suffix>.md` on collision,
 * `link_<sessionID>.md` when the title is missing. Sessions recorded before
 * titles existed have no entry and fall back to the legacy `<sessionID>_link.md`.
 *
 * With persist=true, TUI exit keeps this project's mirror files AND their
 * session entries, so the poller resumes mirroring into the same files on
 * the next launch. Explicit /md-link OFF always deletes regardless.
 *
 * Mirror file contract (<dir>/link_<Title>.md):
 *   Contains ONLY response blocks — no frontmatter, titles, or separators:
 *     <!-- msg:<assistantMessageID>#<ordinal> -->   (dedup marker, invisible
 *     **HH:MM**                                      in Obsidian preview)
 *
 *     <reply text>
 *
 * The server re-reads the state file on every event so TUI toggles apply
 * instantly; writers use read-modify-write to stay concurrency-safe.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync, appendFileSync } from "fs"
import { dirname, join } from "path"
import { homedir } from "os"

export const STATE_FILE = join(homedir(), ".config", "fazuh-agent", "data", "md-link-state.json")

export type MdLinkState = {
  defaultDir: string | null
  keep: number | null
  sessions: Record<string, string>
  /** Sanitized session title per session, fixed at toggle-ON. */
  titles?: Record<string, string>
  /** Resolved mirror filename per session (authoritative over re-deriving). */
  files?: Record<string, string>
  /** True = mirror files + session entries survive TUI exit (resume next launch). */
  persist?: boolean
  /** Opener argv template (`{path}` raw, `{uri}` percent-encoded); unset = Obsidian default. */
  openWith?: string
  /** Open the mirror when toggled ON (default true). */
  openOnEnable?: boolean
}

/** Used when the state file has no `openWith`: Obsidian resolves an absolute
 * path inside any registered vault, launched through the desktop handler. */
export const DEFAULT_OPENER = "xdg-open obsidian://open?path={uri}"

/** Expand an opener template into argv. Whitespace-split, one argument per
 * token — no shell, so paths with spaces cannot break quoting and nothing but
 * the configured program runs (no pipes/redirects). */
export function openArgs(template: string | undefined, file: string): string[] {
  const args = String(template?.trim() || DEFAULT_OPENER).split(/\s+/).filter(Boolean)
  const uri = encodeURIComponent(file)
  return args.map((a) => a.replaceAll("{path}", file).replaceAll("{uri}", uri))
}

const EMPTY_STATE: MdLinkState = { defaultDir: null, keep: null, sessions: {}, titles: {}, files: {}, persist: false }

/** Keep only string→string entries (state file is user-editable). */
function strMap(v: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (v && typeof v === "object" && !Array.isArray(v)) {
    for (const [k, val] of Object.entries(v)) {
      if (typeof k === "string" && k && typeof val === "string") out[k] = val
    }
  }
  return out
}

/** Read state, migrating legacy formats (plain array / {sessions:[...]}). */
export function loadState(): MdLinkState {
  try {
    if (!existsSync(STATE_FILE)) return { ...EMPTY_STATE, sessions: {} }
    const raw = JSON.parse(readFileSync(STATE_FILE, "utf-8"))

    if (Array.isArray(raw)) {
      const sessions: Record<string, string> = {}
      for (const x of raw) if (typeof x === "string") sessions[x] = ""
      return { ...EMPTY_STATE, sessions }
    }
    if (raw && typeof raw === "object") {
      const sessions: Record<string, string> = {}
      const s = (raw as any).sessions
      if (s && typeof s === "object" && !Array.isArray(s)) {
        for (const [k, v] of Object.entries(s)) {
          if (typeof k === "string" && k && typeof v === "string") sessions[k] = v
        }
      } else if (Array.isArray(s)) {
        for (const x of s) if (typeof x === "string") sessions[x] = ""
      }
      return {
        defaultDir: typeof raw.defaultDir === "string" ? raw.defaultDir : null,
        keep: typeof raw.keep === "number" && raw.keep >= 1 ? Math.floor(raw.keep) : null,
        sessions,
        titles: strMap((raw as any).titles),
        files: strMap((raw as any).files),
        persist: raw.persist === true,
        openWith: typeof raw.openWith === "string" ? raw.openWith : undefined,
        openOnEnable: raw.openOnEnable === false ? false : true,
      }
    }
  } catch {}
  return { ...EMPTY_STATE, sessions: {} }
}

/** Atomic-enough write for our scale (single writer per toggle, tiny file). */
export function saveState(st: MdLinkState): void {
  try {
    mkdirSync(dirname(STATE_FILE), { recursive: true })
    writeFileSync(STATE_FILE, JSON.stringify(st, null, 2), "utf-8")
  } catch {}
}

export function isEnabled(st: MdLinkState, sessionID: string): boolean {
  return sessionID in st.sessions
}

/** Add a session (read-modify-write). Preserves any dir already recorded. */
export function enableSession(st: MdLinkState, sessionID: string, dir = ""): void {
  if (!(sessionID in st.sessions)) st.sessions[sessionID] = dir
  saveState(st)
}

/** Remove a session (read-modify-write). Also drops its title/filename record. */
export function disableSession(st: MdLinkState, sessionID: string): void {
  delete st.sessions[sessionID]
  if (st.titles) delete st.titles[sessionID]
  if (st.files) delete st.files[sessionID]
  saveState(st)
}

/** Short collision suffix from a session ID (first 6 alphanumerics past `ses_`). */
export function shortSuffix(sessionID: string): string {
  const alnum = String(sessionID).replace(/^ses_/, "").replace(/[^A-Za-z0-9]/g, "")
  return alnum.slice(0, 6) || "x"
}

/** Make a session title filename-safe: no separators/controls, capped length. */
export function sanitizeTitle(raw: unknown): string {
  const s = String(raw ?? "")
    .replace(/[/\\]+/g, "-")
    .replace(/[\x00-\x1f\x7f]/g, "")
    .trim()
    .slice(0, 120)
    .trim()
    .replace(/[. ]+$/, "")
  return s
}

/** Resolve `link_<Title>.md`, or `link_<Title>_<suffix>.md` when taken.
 * Pure — callers seed `taken` with other sessions' recorded names in the
 * same dir (plus any on-disk collision) before calling. */
export function resolveMirrorName(title: string, sessionID: string, taken: Set<string>): string {
  const base = `link_${title}.md`
  if (!taken.has(base)) return base
  const suffix = shortSuffix(sessionID)
  const alt = `link_${title}_${suffix}.md`
  if (!taken.has(alt)) return alt
  let n = 2
  while (taken.has(`link_${title}_${suffix}-${n}.md`)) n++
  return `link_${title}_${suffix}-${n}.md`
}

/** Filename (not path) gate for recorded mirror names — the state file is
 * user-editable, so anything path-like falls back to the legacy name. */
export function isSafeName(n: string | undefined | null): n is string {
  return !!n && n !== "." && n !== ".." && !n.includes("/") && !n.includes("\\") && !n.includes("\x00")
}

/** Resolve where a session's mirror lives. Falls back through recorded dir → defaultDir → fallbackDir. */
export function mirrorFile(st: MdLinkState, sessionID: string, fallbackDir?: string): string | null {
  let dir = st.sessions[sessionID] ?? ""
  if (!dir && st.defaultDir) dir = st.defaultDir
  if (!dir && fallbackDir) dir = fallbackDir
  if (!dir) return null
  const rec = st.files?.[sessionID]
  return join(dir, isSafeName(rec) ? rec : `${sessionID}_link.md`)
}

/** Create an empty mirror file (responses only — zero boilerplate). No-op if it exists. */
export function touchMirror(file: string): void {
  if (existsSync(file)) return
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, "", "utf-8")
}

export type AppendResult = "written" | "updated" | "duplicate" | "failed"

/** Extract full reply text from a /message item (shapes vary: content[] parts or flat text). */
export function messageText(m: any): string {
  let text = ""
  if (Array.isArray(m?.content)) {
    text = m.content
      .filter((c: any) => c?.type === "text" && typeof c.text === "string")
      .map((c: any) => c.text)
      .join("\n")
  }
  if (!text && typeof m?.text === "string") text = m.text
  return text.trim()
}

/** True if the file contains a block whose marker starts with `<!-- msg:<key>` */
export function hasBlock(file: string, key: string): boolean {
  try {
    return readFileSync(file, "utf-8").includes(`<!-- msg:${key}`)
  } catch {
    return false
  }
}

/**
 * Append one reply block, deduped/upserted by markerKey, then prune to `keep`.
 * With replace=true, an existing block for the same key is rewritten when its
 * text differs (used by the poller while replies are still streaming).
 * Block format (see module doc): marker comment, local HH:MM, blank line, text.
 */
export function appendMessage(
  file: string,
  opts: { text: string; markerKey?: string | null; replace?: boolean },
  keep: number | null,
): AppendResult {
  const key = opts.markerKey ?? null
  try {
    if (key && hasBlock(file, key)) {
      if (!opts.replace) return "duplicate"
      return replaceBlock(file, key, opts.text) ? "updated" : "duplicate"
    }
    if (key === null && hasBlockLoose(file, opts.text)) return "duplicate"
    const time = clock()
    const marker = key ? `<!-- msg:${key} -->\n` : ""
    appendFileSync(file, `${marker}**${time}**\n\n${opts.text.trim()}\n\n`, "utf-8")
    pruneMirror(file, keep)
    return "written"
  } catch {
    return "failed"
  }
}

function hasBlockLoose(file: string, text: string): boolean {
  try {
    return readFileSync(file, "utf-8").includes(text.trim().slice(0, 80))
  } catch {
    return false
  }
}

function clock(): string {
  return new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
}

/** Split a mirror into its preamble + `<!-- msg: -->` blocks (chronological).
 * Null when the file holds no blocks yet. Shared by replace/remove/prune. */
function splitBlocks(c: string): { head: string; blocks: string[] } | null {
  const first = c.search(/<!-- msg:/)
  if (first === -1) return null
  return {
    head: c.slice(0, first),
    blocks: c.slice(first).split(/(?=<!-- msg:)/g).filter((b) => b.trim().length > 0),
  }
}

/** Rewrite an existing block's text in place. Returns false if unchanged/not found. */
function replaceBlock(file: string, key: string, text: string): boolean {
  const s = splitBlocks(readFileSync(file, "utf-8"))
  if (!s) return false
  const idx = s.blocks.findIndex((b) => b.startsWith(`<!-- msg:${key}`))
  if (idx === -1) return false
  const fresh = `<!-- msg:${key} -->\n**${clock()}**\n\n${text.trim()}\n\n`
  const norm = (x: string) => x.replace(/\s+/g, " ").trim()
  if (norm(s.blocks[idx]) === norm(fresh)) return false
  s.blocks[idx] = fresh
  writeFileSync(file, s.head + s.blocks.join(""), "utf-8")
  return true
}

/** Delete the block marked `<!-- msg:<key>`. Returns true if the file changed. */
export function removeBlock(file: string, key: string): boolean {
  try {
    const s = splitBlocks(readFileSync(file, "utf-8"))
    if (!s) return false
    const kept = s.blocks.filter((b) => !b.startsWith(`<!-- msg:${key}`))
    if (kept.length === s.blocks.length) return false
    writeFileSync(file, s.head + kept.join(""), "utf-8")
    return true
  } catch {
    return false
  }
}

/** Write/refresh `text` as the file's LAST block under `markerKey`. In place when
 * already last (no-op when unchanged — keeps Obsidian from re-rendering every
 * poll), repositioned otherwise, because tool-hook blocks can append while the
 * writer is still live. */
export function upsertTailBlock(
  file: string,
  opts: { text: string; markerKey: string },
  keep: number | null,
): AppendResult {
  try {
    const s = splitBlocks(readFileSync(file, "utf-8"))
    if (s) {
      const idx = s.blocks.findIndex((b) => b.startsWith(`<!-- msg:${opts.markerKey}`))
      if (idx === s.blocks.length - 1) {
        return replaceBlock(file, opts.markerKey, opts.text) ? "updated" : "duplicate"
      }
    }
  } catch {}
  removeBlock(file, opts.markerKey)
  return appendMessage(file, { text: opts.text, markerKey: opts.markerKey, replace: true }, keep)
}

/** Keep only the newest `keep` reply blocks. keep <= 0/null = unlimited. */
export function pruneMirror(file: string, keep: number | null): void {
  try {
    if (!keep || keep < 1) return
    const s = splitBlocks(readFileSync(file, "utf-8"))
    if (!s || s.blocks.length <= keep) return
    writeFileSync(file, s.head + s.blocks.slice(-keep).join(""), "utf-8")
  } catch {}
}
