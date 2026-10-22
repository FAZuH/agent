/**
 * /tell in the TUI — the picker that fills the session id in.
 *
 * The server half owns the slash name and sends the message. This half only
 * writes text: a composer line that starts with `/tell ` opens a list of the
 * subagents of the session on screen, their titles on the left, and picking
 * one puts its session id where the id belongs. The user types the message
 * after it.
 *
 * The list is the caller's own tree, so a subagent of a subagent is in it
 * too, and nothing outside the tree is. The server walks the same tree
 * again when the command runs, so a session id typed by hand cannot reach
 * past the session that asked.
 *
 * Two keymap layers, because the two keys mean different things. The picker
 * layer is live only while the list is open: arrows move, enter fills the id
 * in, escape closes. The command layer is live while the command is being
 * written: ctrl+enter puts the `--queue` flag in the line and submits it,
 * which is the only way a plain enter and a queued send differ in the text
 * the server reads.
 */
import { BoxRenderable, ScrollBoxRenderable, TextRenderable, isEditBufferRenderable } from "@opentui/core"
import { createSignal, onCleanup, onMount } from "solid-js"
import { PREFIX, argsOf, descendants, filterRows, trigger, type Descendant, type SessionRow } from "./shared.ts"

function findEditor(node: any): any {
  if (isEditBufferRenderable(node)) return node
  for (const child of node.getChildren()) {
    const editor = findEditor(child)
    if (editor) return editor
  }
}

/** What a row says: the title the user knows the subagent by, and its agent. */
function label(row: Descendant): string {
  const title = row.title?.trim() || row.id
  return row.agent ? `${title} (${row.agent})` : title
}

function mount(ctx: any, prompt: any) {
  // A zero-size slot marker locates this prompt's editor without capturing a
  // dialog's input or another session's composer when focus changes.
  const marker = new BoxRenderable(ctx.renderer, { width: 0, height: 0, position: "absolute" })
  const popup = new BoxRenderable(ctx.renderer, {
    id: `tell-${marker.num}`,
    position: "absolute",
    visible: false,
    zIndex: 100,
    flexDirection: "column",
    border: ["left", "right"],
    borderColor: ctx.theme.border.base,
    customBorderChars: {
      topLeft: "", bottomLeft: "", topRight: "", bottomRight: "",
      horizontal: " ", vertical: "┃", bottomT: "", topT: "", cross: "", leftT: "", rightT: "",
    },
  })
  const list = new ScrollBoxRenderable(ctx.renderer, {
    width: "100%",
    scrollbarOptions: { visible: false },
    scrollX: false,
    focusable: false,
  })
  popup.add(list)

  let editor: any
  let anchor: any
  let disposed = false
  let editing = false
  /** The composer text the picker was last closed on. */
  let dismissed: string | undefined
  let matches: Descendant[] = []
  let selected = 0
  let lastQuery: string | undefined
  let rowSignature = ""
  let rowEls: { box: any; label: any }[] = []
  const [target, setTarget] = createSignal<any>()

  /**
   * The subagents of the session on screen. The store hands back the family
   * of the root, so the tree is walked down from the caller to get the
   * caller's own descendants. The rows are read every time, because a
   * subagent gets its title once it starts working.
   */
  function loadRows(): Descendant[] {
    const ids: string[] = ctx.data?.session?.family?.(prompt.sessionID) ?? []
    const sessions: SessionRow[] = []
    for (const id of ids) {
      const row: any = ctx.data?.session?.get?.(id)
      const data = row?.data ?? row
      if (data && typeof data.id === "string") sessions.push(data as SessionRow)
    }
    return descendants(sessions, prompt.sessionID)
  }

  /** The composer text before the cursor, when a tell command is being written. */
  function currentCommand(): { args: string; line: string } | undefined {
    if (disposed || editing || !editor || editor.isDestroyed) return undefined
    if (!prompt.sessionID || prompt.mode !== "normal") return undefined
    if (ctx.renderer.currentFocusedEditor !== editor || editor.hasSelection()) return undefined
    const route = ctx.ui.router.current()
    if (route.type !== "session" || route.sessionID !== prompt.sessionID) return undefined
    const line = editor.getTextRange(0, editor.cursorOffset)
    const args = argsOf(line)
    if (args === undefined) return undefined
    // Text after the cursor would be left behind by the rewrite.
    const after = editor.plainText.slice(line.length)
    if (after && !after.startsWith("\n")) return undefined
    return { args, line }
  }

  /** The composer text that keeps the picker open. */
  function currentTrigger(): { query: string } | undefined {
    const command = currentCommand()
    if (!command) return undefined
    // A dismissed picker stays closed while the line still grows out of the
    // text it was dismissed on.
    if (dismissed && command.line.startsWith(dismissed)) return undefined
    if (ctx.keymap.mode.current() !== "base") return undefined
    return trigger(command.line)
  }

  function position(): void {
    if (!popup.visible || !anchor) return
    const available = Math.max(0, anchor.y - ctx.renderer.root.y)
    const height = Math.min(8, Math.max(1, matches.length), available)
    if (height < 1) {
      popup.visible = false
      return
    }
    popup.width = Math.max(1, Math.min(anchor.width, ctx.renderer.width - anchor.x))
    popup.height = height
    popup.left = anchor.x - ctx.renderer.root.x
    popup.top = anchor.y - ctx.renderer.root.y - height
    list.height = height
    if (selected < list.scrollTop) list.scrollTo(selected)
    else if (selected >= list.scrollTop + height) list.scrollTo(selected - height + 1)
  }

  function paint(): void {
    if (!popup.visible) return
    popup.backgroundColor = ctx.theme.background.base
    popup.borderColor = ctx.theme.border.base
    list.backgroundColor = ctx.theme.background.base
    const signature = matches.map((row) => row.id).join(",")
    if (signature !== rowSignature || rowEls.length === 0) {
      rowSignature = signature
      for (const row of rowEls) {
        try {
          row.box.destroyRecursively()
        } catch {}
      }
      rowEls = (matches.length ? matches : [undefined]).map((match, index) => {
        const box = new BoxRenderable(ctx.renderer, {
          width: "100%", height: 1, flexShrink: 0, paddingLeft: 1, paddingRight: 1,
          onMouseMove: () => {
            if (matches.length) {
              selected = index
              paint()
            }
          },
          onMouseDown: (event: any) => {
            event.preventDefault()
            event.stopPropagation()
          },
          onMouseUp: (event: any) => {
            event.preventDefault()
            event.stopPropagation()
            if (event.button !== 0 || !matches.length) return
            selected = index
            complete()
          },
        })
        const text = new TextRenderable(ctx.renderer, {
          width: "100%", height: 1, wrapMode: "none", truncate: true, selectable: false,
          content: match ? label(match) : "No subagent matches",
        })
        box.add(text)
        list.add(box)
        return { box, label: text }
      })
    }
    for (const [index, row] of rowEls.entries()) {
      const focused = matches.length > 0 && index === selected
      row.box.backgroundColor = focused ? ctx.theme.background.action.primary.focused : ctx.theme.background.base
      row.label.fg = focused
        ? ctx.theme.text.action.primary.focused
        : matches.length
          ? ctx.theme.text.base
          : ctx.theme.text.muted
    }
    position()
  }

  function refresh(): void {
    if (disposed || editing) return
    const active = currentTrigger()
    if (!active) {
      popup.visible = false
      return
    }
    if (active.query !== lastQuery) {
      lastQuery = active.query
      selected = 0
    }
    matches = filterRows(loadRows(), active.query)
    selected = Math.min(selected, Math.max(0, matches.length - 1))
    popup.visible = true
    paint()
  }

  /**
   * Put the session id where the typed query was, with a space behind it so
   * the message can be typed right after. The prefix stays: it is the
   * command, and a line that starts with something else is not a tell.
   */
  function complete(): boolean {
    const active = currentTrigger()
    if (!active || !editor) return false
    refresh()
    const match = matches[selected]
    if (!match) return false
    const { row, col } = editor.logicalCursor
    editing = true
    try {
      editor.deleteRange(row, PREFIX.length, row, col)
      editor.insertText(`${match.id} `)
    } finally {
      editing = false
    }
    dismissed = PREFIX + match.id + " "
    popup.visible = false
    return true
  }

  function move(delta: number): boolean {
    if (!currentTrigger()) return false
    refresh()
    if (!matches.length) return false
    selected = (selected + delta + matches.length) % matches.length
    paint()
    return true
  }

  function dismiss(): boolean {
    const command = currentCommand()
    if (!command) return false
    dismissed = command.line
    popup.visible = false
    return true
  }

  /**
   * The queued send. The mode goes into the text as the `--queue` flag,
   * because that is what the server reads, and a host with no TUI half can
   * type the same flag by hand.
   */
  function queue(): boolean {
    const command = currentCommand()
    if (!command || !editor) return false
    const { row, col } = editor.logicalCursor
    editing = true
    try {
      editor.deleteRange(row, PREFIX.length, row, col)
      editor.insertText(`--queue ${command.args}`.trim())
    } finally {
      editing = false
    }
    dismissed = undefined
    popup.visible = false
    ctx.keymap.dispatch("input.submit")
    return true
  }

  ctx.keymap.layer(() => ({
    priority: 1000,
    target,
    enabled: () => !!currentTrigger(),
    commands: [
      { id: "tell.previous", title: "Previous subagent", bind: "up", run: () => move(-1) },
      { id: "tell.next", title: "Next subagent", bind: "down", run: () => move(1) },
      {
        id: "tell.insert",
        title: "Use subagent",
        bind: "return",
        run: (_input: any, event: any) => {
          if (!currentTrigger()) return false
          refresh()
          // With nothing to pick, the key belongs to the host: it submits.
          if (!matches.length) return false
          event?.preventDefault()
          event?.stopPropagation()
          return complete()
        },
      },
      { id: "tell.dismiss", title: "Dismiss subagents", bind: "escape", run: () => dismiss() },
    ],
  }))

  ctx.keymap.layer(() => ({
    priority: 1000,
    target,
    enabled: () => !!currentCommand(),
    commands: [
      {
        id: "tell.queue",
        title: "Send queued",
        bind: "ctrl+return",
        run: (_input: any, event: any) => {
          if (!currentCommand()) return false
          event?.preventDefault()
          event?.stopPropagation()
          return queue()
        },
      },
    ],
  }))

  function detach(): void {
    editor?.editBuffer.off("content-changed", refresh)
    editor?.editBuffer.off("cursor-changed", refresh)
    editor = undefined
    setTarget(undefined)
    anchor = undefined
    dismissed = undefined
  }

  function attach(): void {
    if (disposed) return
    if (!editor || editor.isDestroyed) {
      detach()
      // The nearest shared ancestor is the prompt box. Stop before the app root.
      for (let parent = marker.parent; parent && parent !== ctx.renderer.root; parent = parent.parent) {
        const candidate = findEditor(parent)
        if (!candidate) continue
        editor = candidate
        anchor = parent
        editor.editBuffer.on("content-changed", refresh)
        editor.editBuffer.on("cursor-changed", refresh)
        setTarget(editor)
        break
      }
    }
    refresh()
  }

  onMount(() => {
    ctx.renderer.root.add(popup)
    attach()
    ctx.renderer.on("focused_editor", attach)
    // Also follows layout changes and prompt remounts, like native autocomplete.
    const timer = setInterval(attach, 250)
    onCleanup(() => {
      disposed = true
      clearInterval(timer)
      ctx.renderer.off("focused_editor", attach)
      detach()
      popup.destroyRecursively()
    })
  })

  return marker
}

export default {
  id: "fazuh.tell-tui",

  setup: async (ctx: any) => {
    return ctx.ui.slot({ append: "prompt.footer", render: (prompt: any) => mount(ctx, prompt) })
  },
}
