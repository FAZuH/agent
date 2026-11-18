/** @jsxImportSource @opentui/solid */
/**
 * Prompts in the TUI: one sidebar section, one slot per agent. A slot opens
 * that agent's history; ←/→ move through it, Enter answers the open prompt,
 * and a slot with an unanswered question shows a warning dot. The server owns
 * the records.
 */
import { SyntaxStyle, TextAttributes } from "@opentui/core"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { For, Show, createEffect, createSignal } from "solid-js"
import { Contract } from "./rpc.ts"
import {
  ago,
  answersOfForm,
  attentionOf,
  descriptionOf,
  groupBySession,
  markdownOf,
  needsAnswer,
  nextSessionOf,
  promptIDOfForm,
  type Prompt,
  type PromptGroup,
  type Question,
} from "./shared.ts"

/** The routed session and its subagents: the prompts one view shows. */
function familyOf(ctx: any, sessionID: string): string[] {
  try {
    const family = ctx.data?.session?.family?.(sessionID)
    return Array.isArray(family) && family.length ? family : [sessionID]
  } catch {
    return [sessionID]
  }
}

function sessionTitle(ctx: any, sessionID: string, fallback = "this session"): string {
  const title = ctx.data?.session?.get?.(sessionID)?.title
  const trimmed = typeof title === "string" ? title.trim() : ""
  return trimmed || fallback
}

function sessionCreated(ctx: any, sessionID: string): number {
  const created = ctx.data?.session?.get?.(sessionID)?.time?.created
  return typeof created === "number" ? created : 0
}

/** Newest first: slots follow the time of their latest prompt. */
function orderedGroups(ctx: any, groups: PromptGroup[]): PromptGroup[] {
  return groups.slice().sort((a, b) => {
    const latest = (group: PromptGroup) => group.prompts[group.prompts.length - 1]?.at ?? 0
    return latest(b) - latest(a) || sessionCreated(ctx, a.sessionID) - sessionCreated(ctx, b.sessionID)
  })
}

/** Yellow while any question is unanswered, muted once answered or dismissed. */
function dotColor(ctx: any, group: PromptGroup): string {
  return attentionOf(group.prompts).length > 0 ? ctx.theme.text.feedback.warning.base : ctx.theme.text.muted
}

let promptSyntax: any

/**
 * The host's own markdown rules, from its theme tokens: headings, bold,
 * italics, lists, quotes, code, and links keep the colors the timeline uses.
 */
function syntaxFor(ctx: any): any {
  if (promptSyntax) return promptSyntax
  const owner = (ctx.renderer as any)?.nativeScene ?? ctx.renderer
  const theme = ctx.theme
  const markdown = theme.markdown
  const rule = (scope: string[], foreground: any, style: Record<string, any> = {}) => ({
    scope,
    style: { foreground, ...style },
  })
  try {
    promptSyntax = SyntaxStyle.fromTheme(
      [
        rule(["default"], theme.text.base),
        rule(
          [
            "markup.heading",
            "markup.heading.2",
            "markup.heading.3",
            "markup.heading.4",
            "markup.heading.5",
            "markup.heading.6",
          ],
          markdown.heading,
          { bold: true },
        ),
        rule(["markup.heading.1"], markdown.heading, { bold: true, underline: true }),
        rule(["markup.bold", "markup.strong"], markdown.strong, { bold: true }),
        rule(["markup.italic"], markdown.emphasis, { italic: true }),
        rule(["markup.list"], markdown.listItem),
        rule(["markup.quote"], markdown.blockQuote, { italic: true }),
        rule(["markup.raw", "markup.raw.block"], markdown.code),
        rule(["markup.raw.inline"], markdown.code, { background: theme.background.base }),
        rule(["markup.link", "markup.link.url"], markdown.link, { underline: true }),
        rule(["markup.link.label"], markdown.linkText, { underline: true }),
        rule(["markup.strikethrough", "markup.list.unchecked"], theme.text.muted),
        rule(["markup.list.checked"], theme.text.feedback.success.base),
      ],
      owner,
    )
  } catch {
    promptSyntax = undefined
  }
  return promptSyntax
}

/** A full-width separator between a dialog's parts. */
function Rule(props: { ctx: any }) {
  return <box height={1} width="100%" border={["bottom"]} borderColor={props.ctx.theme.border.base} />
}

function PromptBody(props: { ctx: any; prompt: Prompt }) {
  const theme = props.ctx.theme
  return (
    <markdown
      syntaxStyle={syntaxFor(props.ctx)}
      content={markdownOf(props.prompt)}
      fg={theme.text.base}
      conceal
      internalBlockMode="top-level"
      tableOptions={{ style: "grid", cellPaddingX: 1 }}
    />
  )
}

function AnswerDialog(props: {
  ctx: any
  question: Question
  initial: string
  onDone: (value: string, mode: "steer" | "queue") => void
  onCancel: () => void
}) {
  const theme = props.ctx.theme
  const dimensions = useTerminalDimensions()
  let textarea: any
  let bodyScroll: any
  const [scrollable, setScrollable] = createSignal(false)
  // The body can be long. Bound it so the textarea and the key hints stay on
  // screen; PgUp/PgDn scroll the body, the full record is one Enter away in
  // the history dialog.
  const bodyRows = () => Math.max(5, Math.floor(dimensions().height * 0.28))
  const measure = () => {
    const check = () => {
      if (!bodyScroll) return
      setScrollable(bodyScroll.scrollHeight > bodyScroll.height)
    }
    for (const delay of [50, 250, 750]) setTimeout(check, delay)
  }
  createEffect(() => {
    props.question.body
    dimensions().height
    measure()
  })

  const submit = (mode: "steer" | "queue") => {
    const typed = typeof textarea?.plainText === "string" ? textarea.plainText : props.initial
    const answer = typed.trim() || props.question.recommendation?.trim() || ""
    if (!answer) return
    props.onDone(answer, mode)
  }

  // The textarea consumes Enter itself, so the dialog owns the keys through a
  // modal keymap layer, the way the host's own prompt dialog does.
  props.ctx.keymap.layer(() => ({
    mode: "modal",
    priority: 2,
    enabled: true,
    target: () => textarea,
    commands: [
      { id: "prompt.answer.steer", title: "Steer the answer", bind: "enter", run: () => submit("steer") },
      { id: "prompt.answer.queue", title: "Queue the answer", bind: "ctrl+enter", run: () => submit("queue") },
      { id: "prompt.answer.cancel", title: "Cancel answer", bind: "escape", run: () => props.onCancel() },
      {
        id: "prompt.answer.scroll.up",
        title: "Scroll the question up",
        bind: "pageup",
        run: (_input: any, event: any) => {
          event?.preventDefault()
          event?.stopPropagation()
          bodyScroll?.scrollBy(-10)
          return true
        },
      },
      {
        id: "prompt.answer.scroll.down",
        title: "Scroll the question down",
        bind: "pagedown",
        run: (_input: any, event: any) => {
          event?.preventDefault()
          event?.stopPropagation()
          bodyScroll?.scrollBy(10)
          return true
        },
      },
    ],
  }))

  return (
    <box flexDirection="column" gap={1} paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1}>
      <markdown
        syntaxStyle={syntaxFor(props.ctx)}
        content={`**${props.question.title}**`}
        fg={theme.text.base}
        conceal
        internalBlockMode="top-level"
      />
      <Show when={props.question.body}>
        <scrollbox
          ref={(element: any) => (bodyScroll = element)}
          maxHeight={bodyRows()}
          contentOptions={{ minHeight: 0 }}
          scrollbarOptions={{ visible: false }}
        >
          <markdown
            syntaxStyle={syntaxFor(props.ctx)}
            content={props.question.body}
            fg={theme.text.base}
            conceal
            internalBlockMode="top-level"
          />
        </scrollbox>
      </Show>
      <textarea
        initialValue={props.initial}
        minHeight={1}
        maxHeight={6}
        wrapMode="word"
        placeholder={props.question.recommendation ?? "Your answer"}
        focusedBackgroundColor={theme.background.formfield.focused}
        focusedTextColor={theme.text.formfield.focused}
        placeholderColor={theme.text.muted}
        ref={(element: any) => {
          textarea = element
          setTimeout(() => {
            try {
              element.focus()
            } catch {}
          }, 1)
        }}
      />
      <text fg={theme.text.muted}>
        <span style={{ fg: theme.text.base }}>steer</span> <span style={{ fg: theme.text.muted }}>enter</span>   {" "}
        <span style={{ fg: theme.text.base }}>queue</span> <span style={{ fg: theme.text.muted }}>ctrl+enter</span>   {" "}
        <span style={{ fg: theme.text.base }}>cancel</span> <span style={{ fg: theme.text.muted }}>esc</span>
        <Show when={scrollable()}>
          {"   "}
          <span style={{ fg: theme.text.base }}>scroll</span>{" "}
          <span style={{ fg: theme.text.muted }}>pgup/pgdn</span>
        </Show>
      </text>
    </box>
  )
}

function askAnswer(
  ctx: any,
  question: Question,
  initial: string,
): Promise<{ value: string; mode: "steer" | "queue" } | undefined> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (result?: { value: string; mode: "steer" | "queue" }) => {
      if (settled) return
      settled = true
      try {
        ctx.ui.dialog.clear()
      } catch {}
      resolve(result)
    }
    ctx.ui.dialog.show(() => (
      <AnswerDialog
        ctx={ctx}
        question={question}
        initial={initial}
        onDone={(value, mode) => finish({ value, mode })}
        onCancel={() => finish(undefined)}
      />
    ))
    try {
      ctx.ui.dialog.set({ size: "xlarge", centered: true })
    } catch {}
  })
}

function History(props: {
  ctx: any
  group: PromptGroup
  sessions: PromptGroup[]
  onAnswer: (prompt: Prompt) => void
  onDismiss: (prompt: Prompt) => void
  onDefer: (prompt: Prompt) => void
}) {
  const theme = props.ctx.theme
  const dimensions = useTerminalDimensions()
  let scroll: any
  const [groupID, setGroupID] = createSignal(props.group.sessionID)
  const group = () =>
    props.sessions.find((item) => item.sessionID === groupID()) ?? props.group
  const [history, setHistory] = createSignal<Prompt[]>(props.group.prompts)
  const [index, setIndex] = createSignal(props.group.prompts.length - 1)
  // Ctrl+A freezes the entries that needed attention when it was pressed, so
  // dismissing one does not move the entry out from under the cursor.
  const [filterIDs, setFilterIDs] = createSignal<string[] | undefined>(undefined)
  const filtered = () => {
    const ids = filterIDs()
    return ids ? history().filter((item) => ids.includes(item.id)) : history()
  }
  const prompt = () => filtered()[Math.min(index(), filtered().length - 1)]!
  const toggleFilter = () => {
    const current = prompt()
    if (filterIDs()) {
      setFilterIDs(undefined)
      const at = history().findIndex((item) => item.id === current.id)
      setIndex(at >= 0 ? at : history().length - 1)
      return
    }
    const matched = attentionOf(history())
    if (!matched.length) {
      props.ctx.ui.toast.show({
        message: "No unanswered prompts in this session.",
        variant: "info",
      })
      return
    }
    const at = matched.findIndex((item) => item.id === current.id)
    setFilterIDs(matched.map((item) => item.id))
    setIndex(at >= 0 ? at : matched.length - 1)
  }
  // Ctrl+Up/Down walks the sessions the dialog was opened from, wrapping at
  // the ends. With the attention filter on, sessions with nothing to show are
  // skipped: the filter keeps its meaning while changing sessions.
  const switchSession = (delta: 1 | -1) => {
    const target = nextSessionOf(props.sessions, groupID(), delta, filterIDs() !== undefined)
    if (!target) {
      if (props.sessions.length > 1 && filterIDs()) {
        props.ctx.ui.toast.show({
          message: "No other session has unanswered prompts.",
          variant: "info",
        })
      }
      return
    }
    setGroupID(target.sessionID)
    setHistory(target.prompts)
    if (filterIDs()) {
      const matched = attentionOf(target.prompts)
      setFilterIDs(matched.map((item) => item.id))
      setIndex(matched.length - 1)
    } else {
      setIndex(target.prompts.length - 1)
    }
    scroll?.scrollTo(0)
  }
  const maxRows = () => Math.max(12, Math.floor(dimensions().height * 0.55))
  const [scrollable, setScrollable] = createSignal(false)
  const measure = () => {
    const check = () => {
      if (!scroll) return
      setScrollable(scroll.scrollHeight > scroll.height)
    }
    for (const delay of [50, 250, 750]) setTimeout(check, delay)
  }
  createEffect(() => {
    prompt()
    dimensions().height
    measure()
  })
  const answerable = () => needsAnswer(prompt())

  // A dialog is modal, so bind the filter and session keys in a layer of its
  // own: the composer's ctrl+a and the input's "move to line start" stay out.
  props.ctx.keymap.layer(() => ({
    mode: "modal",
    priority: 2,
    enabled: true,
    commands: [
      {
        id: "prompt.history.filter",
        title: "Only unanswered prompts",
        group: "Dialog",
        bind: "ctrl+a",
        run: () => toggleFilter(),
      },
      {
        id: "prompt.history.session.prev",
        title: "Previous session",
        group: "Dialog",
        bind: "ctrl+up",
        run: () => switchSession(-1),
      },
      {
        id: "prompt.history.session.next",
        title: "Next session",
        group: "Dialog",
        bind: "ctrl+down",
        run: () => switchSession(1),
      },
    ],
  }))

  useKeyboard((event: any) => {
    if (event.name === "escape") {
      // Closing an unanswered prompt releases a blocked prompt_user call;
      // the record stays in the list for a later answer.
      if (answerable()) props.onDefer(prompt())
      return
    }
    if (event.name === "up" && event.ctrl !== true) {
      event.preventDefault()
      event.stopPropagation()
      scroll?.scrollBy(-1)
      return
    }
    if (event.name === "down" && event.ctrl !== true) {
      event.preventDefault()
      event.stopPropagation()
      scroll?.scrollBy(1)
      return
    }
    if (event.name === "pageup") {
      event.preventDefault()
      event.stopPropagation()
      scroll?.scrollBy(-20)
      return
    }
    if (event.name === "pagedown") {
      event.preventDefault()
      event.stopPropagation()
      scroll?.scrollBy(20)
      return
    }
    if (event.name === "home") {
      event.preventDefault()
      event.stopPropagation()
      scroll?.scrollTo(0)
      return
    }
    if (event.name === "end") {
      event.preventDefault()
      event.stopPropagation()
      if (scroll) scroll.scrollTo(scroll.scrollHeight)
      return
    }
    if (event.name === "left" || event.name === "h") {
      event.preventDefault()
      event.stopPropagation()
      setIndex((current) => Math.max(0, current - 1))
      return
    }
    if (event.name === "right" || event.name === "l") {
      event.preventDefault()
      event.stopPropagation()
      setIndex((current) => Math.min(filtered().length - 1, current + 1))
      return
    }
    if (event.name === "c") {
      event.preventDefault()
      event.stopPropagation()
      try {
        const copied = props.ctx.renderer?.copyToClipboardOSC52?.(group().sessionID)
        props.ctx.ui.toast.show({
          message: copied ? "Session id copied" : "Could not copy the session id",
          variant: copied ? "success" : "error",
        })
      } catch {
        props.ctx.ui.toast.show({ message: "Could not copy the session id", variant: "error" })
      }
      return
    }
    if (event.name === "return" && answerable()) {
      event.preventDefault()
      event.stopPropagation()
      props.ctx.ui.dialog.clear()
      props.onAnswer(prompt())
      return
    }
    if (event.name === "d" && answerable()) {
      event.preventDefault()
      event.stopPropagation()
      const current = prompt()
      const dismissedAt = Date.now()
      // The dialog stays open, so it shows the dismissal right away instead of
      // waiting for the sidebar to reopen it from the reloaded records.
      setHistory((items) =>
        items.map((item) => (item.id === current.id ? { ...item, dismissedAt } : item)),
      )
      props.onDismiss(current)
      return
    }
  })

  return (
    <box flexDirection="column" gap={1} paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1}>
      <text fg={theme.text.muted}>
        {sessionTitle(props.ctx, group().sessionID)} · {index() + 1}/{filtered().length}
        {filterIDs() ? " · showing unanswered" : ""}
        {" · "}
        {ago(prompt().at)}
        {prompt().answeredAt ? " · answered" : ""}
        {prompt().dismissedAt ? " · dismissed" : ""}
      </text>
      <Rule ctx={props.ctx} />
      <Show when={prompt().description}>
        <text fg={theme.text.base}>
          <b>{prompt().description}</b>
        </text>
      </Show>
      <scrollbox
        ref={(element: any) => (scroll = element)}
        maxHeight={maxRows()}
        contentOptions={{ minHeight: 0 }}
        scrollbarOptions={{ visible: false }}
      >
        <PromptBody ctx={props.ctx} prompt={prompt()} />
      </scrollbox>
      <Rule ctx={props.ctx} />
      <text fg={theme.text.muted}>
        <Show when={filtered().length > 1}>
          <span style={{ fg: theme.text.base }}>history</span>{" "}
          <span style={{ fg: theme.text.muted }}>←/→</span>   {" "}
        </Show>
        <Show when={props.sessions.length > 1}>
          <span style={{ fg: theme.text.base }}>sessions</span>{" "}
          <span style={{ fg: theme.text.muted }}>ctrl+↑/↓</span>   {" "}
        </Show>
        <Show when={answerable()}>
          <span style={{ fg: theme.text.base }}>answer</span> <span style={{ fg: theme.text.muted }}>enter</span>   {" "}
          <span style={{ fg: theme.text.base }}>dismiss</span> <span style={{ fg: theme.text.muted }}>d</span>   {" "}
        </Show>
        <span style={{ fg: theme.text.base }}>
          {filterIDs() ? "all" : "only unanswered"}
        </span>{" "}
        <span style={{ fg: theme.text.muted }}>ctrl+a</span>   {" "}
        <span style={{ fg: theme.text.base }}>copy session id</span> <span style={{ fg: theme.text.muted }}>c</span>   {" "}
        <span style={{ fg: theme.text.base }}>close</span> <span style={{ fg: theme.text.muted }}>esc</span>
        <Show when={scrollable()}>
          {"   "}
          <span style={{ fg: theme.text.base }}>scroll</span> <span style={{ fg: theme.text.muted }}>↑/↓</span>
        </Show>
      </text>
    </box>
  )
}

function openHistory(
  ctx: any,
  group: PromptGroup,
  sessions: PromptGroup[],
  onAnswer: (prompt: Prompt) => void,
  onDismiss: (prompt: Prompt) => void,
) {
  const onDefer = (prompt: Prompt) => {
    try {
      void ctx.client
        .rpc(Contract)
        .defer({ sessionID: prompt.sessionID, promptID: prompt.id })
        .catch(() => {})
    } catch {}
  }
  ctx.ui.dialog.show(() => (
    <History
      ctx={ctx}
      group={group}
      sessions={sessions}
      onAnswer={onAnswer}
      onDismiss={onDismiss}
      onDefer={onDefer}
    />
  ))
  try {
    ctx.ui.dialog.set({ size: "xlarge", centered: true })
  } catch {}
}

function Slot(props: {
  ctx: any
  group: PromptGroup
  onOpen: (group: PromptGroup) => void
}) {
  const theme = props.ctx.theme
  const latest = () => props.group.prompts[props.group.prompts.length - 1]!
  return (
    <box
      flexDirection="column"
      minWidth={0}
      onMouseUp={() => props.onOpen(props.group)}
    >
      <box flexDirection="row" gap={1} minWidth={0}>
        <text flexShrink={0} style={{ fg: dotColor(props.ctx, props.group) }}>
          {"\u2022"}
        </text>
        <text
          fg={theme.text.base}
          attributes={TextAttributes.BOLD}
          wrapMode="none"
          truncate
          flexGrow={1}
          flexShrink={1}
          minWidth={0}
        >
          {sessionTitle(props.ctx, props.group.sessionID)}
        </text>
        <text fg={theme.text.muted} flexShrink={0}>
          {props.group.prompts.length} · {ago(latest().at)}
        </text>
      </box>
      <text fg={theme.text.muted} wrapMode="none" truncate>
        {"  "}
        {descriptionOf(latest())}
      </text>
    </box>
  )
}

function Section(props: {
  ctx: any
  note?: string
  attention: number
  groups: PromptGroup[]
  open: boolean
  toggle: () => void
  onOpen: (group: PromptGroup) => void
}) {
  const theme = props.ctx.theme
  return (
    <Show when={props.groups.length > 0}>
      <box>
        <box flexDirection="row" gap={1} onMouseDown={props.toggle}>
          <text fg={theme.text.base}>{props.open ? "\u25BC" : "\u25B6"}</text>
          <text fg={theme.text.base}>
            <b>Prompts</b>
          </text>
          <Show when={props.note}>
            <text fg={theme.text.muted}> · {props.note}</text>
          </Show>
          <Show when={props.attention > 0}>
            <text fg={theme.text.muted}> ({props.attention})</text>
          </Show>
        </box>
        <Show when={props.open}>
          <For each={props.groups}>
            {(group) => <Slot ctx={props.ctx} group={group} onOpen={props.onOpen} />}
          </For>
        </Show>
      </box>
    </Show>
  )
}

function Sidebar(props: {
  ctx: any
  sessionID: string
  view: any
  setView: any
  list: () => Prompt[]
  reload: (sessionID: string) => void
  onAnswer: (prompt: Prompt) => void
  onDismiss: (prompt: Prompt) => void
}) {
  createEffect(() => {
    const sessionID = props.sessionID
    if (!sessionID) return
    props.reload(sessionID)
  })
  const latestOf = (group: PromptGroup) => group.prompts[group.prompts.length - 1]!
  // At most five slots: unanswered first, then newest. The picker still lists
  // all, and the history's ctrl+up/down walks this same order uncapped.
  const sorted = (groups: PromptGroup[]) =>
    groups
      .slice()
      .sort(
        (a, b) =>
          Number(attentionOf(b.prompts).length > 0) - Number(attentionOf(a.prompts).length > 0) ||
          latestOf(b).at - latestOf(a).at,
      )
  const groups = () => orderedGroups(props.ctx, groupBySession(props.list()))
  const sessions = () => {
    const all = groups()
    return sorted(props.view?.unanswered === true ? all.filter((group) => attentionOf(group.prompts).length > 0) : all)
  }
  const slots = () => sessions().slice(0, 5)
  const attention = () => groups().filter((group) => attentionOf(group.prompts).length > 0).length
  const open = () => props.view?.open !== false
  const toggle = () => {
    void props.setView((draft: any) => {
      draft.open = draft.open === false
    })
  }
  const sidebarShown = () => props.view?.sidebar !== false
  const promptShown = () => props.view?.showPrompts !== false
  return (
    <Show when={sidebarShown() && promptShown() && slots().length > 0}>
      <Section
        ctx={props.ctx}
        note={props.view?.unanswered === true ? "unanswered" : undefined}
        attention={attention()}
        groups={slots()}
        open={open()}
        toggle={toggle}
        onOpen={(group) => openHistory(props.ctx, group, sessions(), props.onAnswer, props.onDismiss)}
      />
    </Show>
  )
}

export default {
  id: "fazuh.prompt-tui",

  setup: async (ctx: any) => {
    if (typeof ctx.client?.rpc !== "function") return
    const rpc = ctx.client.rpc(Contract)
    const [prompts, setPrompts] = createSignal<Record<string, Prompt[]>>({})
    /** Disposers, collected as each subscription is made. A name that no
     * longer exists cannot throw before the try and strand every listener. */
    const stops: Array<(() => void) | undefined> = []

    const routedID = (): string | undefined => {
      const route = ctx.ui.router.current()
      return route?.type === "session" ? route.sessionID : undefined
    }

    const reload = (sessionID: string) => {
      void rpc
        .list({ sessionIDs: familyOf(ctx, sessionID) })
        .then((result: any) => {
          setPrompts((previous) => ({ ...previous, [sessionID]: result?.prompts ?? [] }))
        })
        .catch(() => {})
    }

    // A prompt or answer written anywhere in the family refetches the view.
    // The server opens the native question card on every client.
    stops.push(
      rpc.events.on("changed", (event: any) => {
        if (event?.data?.topic === "settings") {
          void rpc
            .getSettings()
            .then((settings: any) => {
              void setView((draft: any) => {
                draft.sidebar = settings?.sidebar !== false
                draft.showPrompts = settings?.showPrompts !== false
              })
            })
            .catch(() => {})
          return
        }
        const sessionID = routedID()
        if (sessionID) reload(sessionID)
      }),
    )

    // The native card is a second way into the same answer path. Dismissing it with
    // esc is the defer action: the record stays unanswered in the list.
    stops.push(
      ctx.data?.on?.("form.replied", (event: any) => {
        const promptID = promptIDOfForm(String(event?.data?.id ?? ""))
        if (!promptID) return
        const sessionID = String(event?.data?.sessionID ?? "")
        const answers = answersOfForm(event?.data?.answer)
        if (!sessionID || !Object.keys(answers).length) return
        void deliver(sessionID, promptID, answers, "steer")
      }),
    )
    stops.push(
      ctx.data?.on?.("form.cancelled", (event: any) => {
        const promptID = promptIDOfForm(String(event?.data?.id ?? ""))
        if (!promptID) return
        const sessionID = String(event?.data?.sessionID ?? "")
        if (sessionID) void rpc.defer({ sessionID, promptID }).catch(() => {})
        ctx.ui.toast.show({ message: "Prompt deferred to the Prompts list.", variant: "info" })
      }),
    )

    async function deferPrompt(prompt: Prompt) {
      try {
        await rpc.defer({ sessionID: prompt.sessionID, promptID: prompt.id })
      } catch {}
    }

    async function dismiss(prompt: Prompt) {
      try {
        await rpc.dismiss({ sessionID: prompt.sessionID, promptID: prompt.id })
        ctx.ui.toast.show({ message: `Dismissed: ${descriptionOf(prompt)}`, variant: "info" })
      } catch (error: any) {
        ctx.ui.toast.show({ message: `Could not dismiss: ${error?.message ?? error}`, variant: "error" })
      }
      const sessionID = routedID()
      if (sessionID) reload(sessionID)
    }

    async function deliver(
      sessionID: string,
      promptID: string,
      answers: Record<string, string>,
      mode: "steer" | "queue",
    ) {
      try {
        const result: any = await rpc.answer({ sessionID, promptID, answers, mode })
        if (result?.error && !result?.delivered) {
          ctx.ui.toast.show({ message: `Answers saved, but ${result.error}`, variant: "warning" })
        } else if (result?.duplicate) {
          ctx.ui.toast.show({ message: "Already answered; the agent has it.", variant: "info" })
        } else {
          ctx.ui.toast.show({
            message: `Answers ${mode === "queue" ? "queued for" : "steered to"} ${sessionTitle(ctx, sessionID)}.`,
            variant: "success",
          })
        }
      } catch (error: any) {
        ctx.ui.toast.show({ message: `Could not save answers: ${error?.message ?? error}`, variant: "error" })
      }
      const routed = routedID()
      if (routed) reload(routed)
    }

    async function answer(prompt: Prompt) {
      const questions = prompt.prompts?.questions ?? []
      if (!questions.length) return
      const answers: Record<string, string> = {}
      let mode: "steer" | "queue" = "steer"
      for (const [index, question] of questions.entries()) {
        const result = await askAnswer(
          ctx,
          question,
          answers[String(index)] ?? prompt.answers?.[String(index)] ?? "",
        )
        if (!result) {
          void deferPrompt(prompt)
          return
        }
        answers[String(index)] = result.value
        if (result.mode === "queue") mode = "queue"
      }
      if (!Object.keys(answers).length) return
      await deliver(prompt.sessionID, prompt.id, answers, mode)
    }

    /** Dismiss every prompt still awaiting an answer in the routed family. */
    async function dismissAll() {
      const sessionID = routedID()
      if (!sessionID) {
        ctx.ui.toast.show({ message: "Open a session first.", variant: "info" })
        return
      }
      let records: Prompt[] = []
      try {
        const result: any = await rpc.list({ sessionIDs: familyOf(ctx, sessionID) })
        records = Array.isArray(result?.prompts) ? result.prompts : []
      } catch (error: any) {
        ctx.ui.toast.show({
          message: `Could not load prompts: ${error?.message ?? error}`,
          variant: "error",
        })
        return
      }
      const targets = records.filter(needsAnswer)
      if (!targets.length) {
        ctx.ui.toast.show({ message: "No prompts to dismiss.", variant: "info" })
        return
      }
      let done = 0
      for (const prompt of targets) {
        try {
          await rpc.dismiss({ sessionID: prompt.sessionID, promptID: prompt.id })
          done++
        } catch {}
      }
      ctx.ui.toast.show({
        message: `Dismissed ${done} prompt${done === 1 ? "" : "s"}.`,
        variant: done === targets.length ? "success" : "warning",
      })
      reload(sessionID)
    }

    async function openList() {
      const sessionID = routedID()
      if (!sessionID) {
        ctx.ui.toast.show({ message: "Open a session first.", variant: "info" })
        return
      }
      if (!prompts()[sessionID]) reload(sessionID)
      const groups = orderedGroups(ctx, groupBySession(prompts()[sessionID] ?? []))
      const filtered = view.unanswered === true
      const visible = filtered
        ? groups.filter((group) => attentionOf(group.prompts).length > 0)
        : groups
      if (!visible.length && !filtered) {
        ctx.ui.toast.show({ message: "No prompts in this session.", variant: "info" })
        return
      }
      const bindings = [
        {
          bind: "ctrl+a",
          title: filtered ? "Show all" : "Only unanswered",
          group: "Dialog",
          run: () => {
            void setView((draft: any) => {
              draft.unanswered = draft.unanswered === false
            }).then(() => {
              try {
                ctx.ui.dialog.clear()
              } catch {}
              void openList()
            })
          },
        },
      ]
      const picked = await ctx.ui.dialog.select({
        title: "Prompts",
        footerHints: [{ title: filtered ? "show all" : "only unanswered", label: "ctrl+a" }],
        options: visible.map((group) => {
          const latest = group.prompts[group.prompts.length - 1]!
          return {
            title: sessionTitle(ctx, group.sessionID),
            description: `${group.prompts.length} - ${descriptionOf(latest)} - ${ago(latest.at)}`,
            value: group.sessionID,
          }
        }),
        bindings,
      })
      const group = picked ? groups.find((item) => item.sessionID === picked) : undefined
      if (group) {
        openHistory(
          ctx,
          group,
          visible,
          (prompt) => void answer(prompt),
          (prompt) => void dismiss(prompt),
        )
      }
    }

    /**
     * The visibility settings. Each row toggles and reopens the list because
     * the host's select closes on pick; esc ends the loop.
     */
    async function openSettings() {
      const rows = [
        { key: "sidebar", title: "Sidebar", note: "master" },
        { key: "showPrompts", title: "Prompts", note: "section" },
      ] as const
      for (;;) {
        let settings: any = {
          sidebar: view.sidebar !== false,
          showPrompts: view.showPrompts !== false,
        }
        try {
          settings = await rpc.getSettings()
        } catch {}
        const picked = await ctx.ui.dialog
          .select({
            title: "Prompt settings",
            footerHints: [{ title: "toggle", label: "enter" }],
            options: rows.map((row) => ({
              title: row.title,
              description: `${row.note} · ${settings?.[row.key] !== false ? "shown" : "hidden"}`,
              value: row.key,
            })),
          })
          .catch(() => undefined)
        if (!picked) return
        const value = settings?.[picked] === false
        try {
          const result: any = await rpc.setSetting({ key: picked, value })
          if (result && result.ok === false) {
            ctx.ui.toast.show({ message: result.error || "Could not save the setting.", variant: "error" })
            continue
          }
        } catch (error: any) {
          ctx.ui.toast.show({
            message: `Could not save the setting: ${error?.message ?? error}`,
            variant: "error",
          })
          continue
        }
        // The sidebar renders from this store, so mirror the shared setting
        // into it after the server has accepted the change.
        await setView((draft: any) => {
          draft[picked] = value
        })
      }
    }

    const [view, setView] = ctx.storage.store("prompt-view-v2", {
      initial: {
        open: true,
        unanswered: false,
        sidebar: true,
        showPrompts: true,
      },
    })

    ctx.ui.slot({
      append: "sidebar.content",
      render: (input: any) => (
        <Sidebar
          ctx={ctx}
          sessionID={input.sessionID}
          view={view}
          setView={setView}
          list={() => prompts()[input.sessionID] ?? []}
          reload={reload}
          onAnswer={(prompt) => void answer(prompt)}
          onDismiss={(prompt) => void dismiss(prompt)}
        />
      ),
    })

    // The keymap layer is owned by a component, like the host's own plugins.
    ctx.ui.slot({
      append: "app",
      render: () => {
        ctx.keymap.layer(() => ({
          mode: "global",
          priority: 1,
          enabled: true,
          commands: [
            {
              id: "prompt.open",
              title: "Prompts",
              group: "prompt",
              palette: true,
              slash: { name: "prompts" },
              run: () => void openList(),
            },
            {
              id: "prompt.settings",
              title: "Prompt settings",
              group: "prompt",
              palette: true,
              slash: { name: "prompt-settings" },
              run: () => void openSettings(),
            },
            {
              id: "prompt.attention",
              title: "Only unanswered prompts",
              group: "prompt",
              palette: true,
              run: () => {
                const only = view.unanswered !== true
                void setView((draft: any) => {
                  draft.unanswered = only
                })
              },
            },
            {
              id: "prompt.dismiss.all",
              title: "Dismiss all prompts",
              group: "prompt",
              palette: true,
              slash: { name: "dismiss-prompts" },
              run: () => void dismissAll(),
            },
          ],
        }))
        return null
      },
    })

    return () => {
      for (const stop of stops) {
        try {
          stop?.()
        } catch {}
      }
    }
  },
}
