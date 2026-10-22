/**
 * The rules of the tell plugin, with no host and no network in sight.
 *
 * The command is `/tell <session id> <message>`: the message goes to a
 * subagent of the session that asked, never to an unrelated session. The TUI
 * half (./tui.ts) fills the session id in from a list of subagent titles; the
 * server half (./index.ts) parses what was typed and sends it.
 *
 * The delivery mode comes from the text: a `--queue` or `--steer` flag says
 * it outright, and the flag the TUI half writes in before it submits is the
 * same flag a host with no TUI half can type by hand. The mode the host
 * hands over is only the fallback for a line with no flag.
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
  /** The delivery the text asked for, when it said. */
  delivery?: Delivery
  /** Set when the text is not a usable command. */
  error?: string
}

const FLAG = /^--(queue|steer)\b\s*/

/** Split the text after the slash name into a target, a message, and a mode. */
export function parseTarget(text: string): Parsed {
  let rest = String(text ?? "").trim()
  let delivery: Delivery | undefined
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

/** Every session under `rootID`, depth first, however deep the tree runs. */
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
  const walk = (id: string, depth: number) => {
    for (const child of children.get(id) ?? []) {
      if (seen.has(child.id)) continue
      seen.add(child.id)
      out.push({ ...child, depth })
      walk(child.id, depth + 1)
    }
  }
  walk(rootID, 1)
  return out
}

/** The parent of a session id, or nothing when the session is gone. */
export type ParentOf = (id: string) => string | undefined | Promise<string | undefined>

/** The walk up the tree stops here, so a cycle cannot loop forever. */
const MAX_HOPS = 32

/**
 * True when the target sits under the ancestor: a child, a grandchild, or
 * deeper. The lookup gives the parent of a session id, and a missing parent
 * ends the walk.
 */
export async function isDescendant(parentOf: ParentOf, ancestorID: string, targetID: string): Promise<boolean> {
  let id: string | undefined = targetID
  for (let hops = 0; hops < MAX_HOPS && id; hops++) {
    if (id === ancestorID) return true
    id = await parentOf(id)
  }
  return false
}

/** Fold accents so "planeta" matches a search for "planéta". */
function fold(text: string): string {
  return String(text ?? "")
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLocaleLowerCase()
}

/**
 * The rows the picker shows: the subagents that match the query. Every word
 * of the query has to appear in the title, the agent, or the session id.
 */
export function filterRows(rows: Descendant[], query: string): Descendant[] {
  const words = fold(query).split(/\s+/).filter(Boolean)
  if (!words.length) return rows
  return rows.filter((row) => {
    const haystack = fold(`${row.title ?? ""} ${row.agent ?? ""} ${row.id}`)
    return words.every((word) => haystack.includes(word))
  })
}

/**
 * The text after the command name, when the text starts with the command.
 * The picker and the queue keybind both start here.
 */
export function argsOf(text: string): string | undefined {
  if (!String(text ?? "").startsWith(PREFIX)) return undefined
  return text.slice(PREFIX.length)
}

/**
 * The composer text that opens the picker: the command and one word, nothing
 * else. A space starts the message, and the picker closes then, so the two
 * never fight over the same words.
 */
export function trigger(text: string): { query: string } | undefined {
  const args = argsOf(text)
  if (args === undefined) return undefined
  if (/[\s]/.test(args)) return undefined
  return { query: args }
}
