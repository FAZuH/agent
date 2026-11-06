/**
 * The rules of desktop control, with no host and no commands in sight.
 *
 * Two decisions live here because they are the ones that go wrong quietly:
 * which window a target string means, and how a key chord is split into
 * modifiers and a base key. The rest of the plugin is command plumbing.
 */

export interface DeskWindow {
  /** Hyprland address, also the X11 window id when the client is XWayland. */
  address: string
  class: string
  title: string
  x: number
  y: number
  width: number
  height: number
  workspace: string
  focused: boolean
  /** True when the client is XWayland, so XTest pointer input reaches it. */
  xwayland: boolean
}

export interface Windows {
  found: boolean
  error?: string
  list: DeskWindow[]
}

/**
 * Which window a target means.
 *
 * `0x…` is an exact address. `class:` and `title:` force one field. A bare
 * string tries exact class, then class substring, then title substring, so
 * "kitty" beats a title that merely mentions it.
 */
export function matchWindow(list: DeskWindow[], target: string): DeskWindow | undefined {
  const wanted = target.trim()
  if (!wanted) return undefined
  const lower = wanted.toLowerCase()

  if (lower.startsWith("0x")) {
    return list.find((w) => w.address.toLowerCase() === lower)
  }
  if (lower.startsWith("class:")) {
    const name = lower.slice("class:".length)
    return list.find((w) => w.class.toLowerCase() === name) ?? list.find((w) => w.class.toLowerCase().includes(name))
  }
  if (lower.startsWith("title:")) {
    const name = lower.slice("title:".length)
    return list.find((w) => w.title.toLowerCase().includes(name))
  }

  return (
    list.find((w) => w.class.toLowerCase() === lower) ??
    list.find((w) => w.class.toLowerCase().includes(lower)) ??
    list.find((w) => w.title.toLowerCase().includes(lower))
  )
}

const MODIFIER_ALIASES: Record<string, string> = {
  ctrl: "ctrl",
  control: "ctrl",
  shift: "shift",
  alt: "alt",
  super: "logo",
  win: "logo",
  meta: "logo",
  logo: "logo",
}

export interface Chord {
  /** Modifiers in press order, already normalised for wtype (-M names). */
  mods: string[]
  /** Base key, a keysym name or a single character. */
  key: string
}

/**
 * Split "ctrl+shift+t" into modifiers and a base key.
 *
 * The last token is always the base key: "ctrl++" means ctrl plus the plus
 * key, and "ctrl" alone is the ctrl key itself rather than a modifier with
 * nothing to modify.
 */
export function parseChord(spec: string): Chord {
  const raw = spec.trim()
  if (!raw) throw new Error("key is empty")

  const parts = raw.split("+")
  // A trailing "+" is the plus key itself, not an empty segment.
  if (parts.length > 1 && parts[parts.length - 1] === "") {
    parts.pop()
    parts[parts.length - 1] = "+"
  }

  const key = parts.pop() as string
  const mods: string[] = []
  for (const part of parts) {
    const mod = MODIFIER_ALIASES[part.trim().toLowerCase()]
    if (!mod) throw new Error(`unknown modifier: ${part}`)
    if (!mods.includes(mod)) mods.push(mod)
  }
  return { mods, key: key === "enter" ? "Return" : key }
}

/** One line per window: what to click on, and whether XTest reaches it. */
export function formatWindows(list: DeskWindow[]): string {
  if (!list.length) return "no windows"
  return list
    .map((w) => {
      const state = [w.focused ? "focused" : "", w.xwayland ? "xwayland" : "wayland"].filter(Boolean).join(", ")
      return `${w.address}  ${w.class}  "${w.title}"  ${w.width}x${w.height} at ${w.x},${w.y}  ws ${w.workspace}  [${state}]`
    })
    .join("\n")
}
