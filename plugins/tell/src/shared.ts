/**
 * Shared rules for the tell plugin.
 *
 * The command is `/tell <session id> <message>`: the message goes to a
 * subagent of the session that asked, never to an unrelated session. The TUI
 * half (./tui.ts) fills the session id in from a list of subagent titles; the
 * server half (./index.ts) parses what was typed and sends it.
 *
 * The delivery mode rides in the text as a flag: `--queue` waits for the
 * target's current turn to finish, `--steer` (the default) interrupts it. The
 * TUI half writes the flag in before it submits, so the server stays the only
 * sender and hosts without a TUI can type the flag by hand.
 */

/** The slash name. One owner: the server plugin registers it. */
export const COMMAND = "tell"

/** What the composer holds right after the command name. */
export const PREFIX = `/${COMMAND} `

export type Delivery = "steer" | "queue"

export interface Parsed {
  /** The session the message goes to. */
  target: string
  /** The message text. */
  message: string
  /** The delivery the text asked for. */
  delivery: Delivery
  /** Set when the text is not a usable command. */
  error?: string
}

const FLAG = /^--(queue|steer)\s+/

/** Split the text after the slash name into a target, a message, and a mode. */
export function parseTarget(text: string): Parsed {
  let rest = String(text ?? "").trim()
  let delivery: Delivery = "steer"
  const flag = FLAG.exec(rest)
  if (flag) {
    delivery = flag[1] as Delivery
    rest = rest.slice(flag[0].length)
  }
  const cut = rest.search(/\s/)
  const target = cut === -1 ? rest : rest.slice(0, cut)
  const message = cut === -1 ? "" : rest.slice(cut + 1).trim()
  if (!target || !message) {
    return { target, message, delivery, error: `Usage: /${COMMAND} <session id> <message>` }
  }
  return { target, message, delivery }
}

export interface SessionRow {
  id: string
  parentID?: string
  title?: string
  agent?: string
}

export interface Descendant extends SessionRow {
  /** 1 for a direct child, 2 for a grandchild, and so on. */
  depth: number
}

/** Every session under `rootID`, children first, however deep the tree runs. */
export function descendants(rows: SessionRow[], rootID: string): Descendant[] {
  const children = new Map<string, SessionRow[]>()
  for (const row of rows ?? []) {
    if (!row?.id || !row.parentID) continue
    const list = children.get(row.parentID)
    if (list) list.push(row)
    else children.set(row.parentID, [row])
  }
  const out: Descendant[] = []
  const seen = new Set([rootID])
  let level = [rootID]
  for (let depth = 1; depth <= 8 && level.length; depth++) {
    const next: string[] = []
    for (const id of level) {
      for (const child of children.get(id) ?? []) {
        if (seen.has(child.id)) continue
        seen.add(child.id)
        out.push({ ...child, depth })
        next.push(child.id)
      }
    }
    level = next
  }
  return out
}

/** Fold accents so "planeta" matches a search for "planéta". */
function fold(text: string): string {
  return String(text ?? "")
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLocaleLowerCase()
}

/**
 * The rows the picker shows: the subagents that match the query. An empty
 * query shows every subagent.
 */
export function filterRows(rows: Descendant[], query: string): Descendant[] {
  const needle = fold(query).trim()
  const prefix = String(query ?? "").trim().toLocaleLowerCase()
  if (!needle && !prefix) return rows
  return rows.filter(
    (row) =>
      fold(row.title ?? "").includes(needle) ||
      (prefix.length > 0 && row.id.toLocaleLowerCase().startsWith(prefix)),
  )
}

export interface Trigger {
  /** The text typed after the command name. */
  query: string
}

/**
 * The composer text that opens the picker: the command and one token, nothing
 * else. The message the user types after the id has a space in it, so the
 * picker closes as soon as they start writing.
 */
export function trigger(text: string): Trigger | undefined {
  if (!text.startsWith(PREFIX)) return undefined
  const rest = text.slice(PREFIX.length)
  if (rest.includes(" ") || rest.includes("\n")) return undefined
  return { query: rest }
}

/** The line a queued message needs: the command, a target, and a message. */
export function messageLine(text: string): { target: string; message: string } | undefined {
  if (!text.startsWith(PREFIX)) return undefined
  const rest = text.slice(PREFIX.length).trim()
  const cut = rest.search(/\s/)
  if (cut === -1) return undefined
  const target = rest.slice(0, cut)
  const message = rest.slice(cut + 1).trim()
  if (!target || !message) return undefined
  return { target, message }
}
