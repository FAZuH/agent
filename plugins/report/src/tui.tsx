/** @jsxImportSource @opentui/solid */
/**
 * Reports in the TUI: two sidebar sections, one slot per agent in each.
 * "Reports" holds post-task records, "Prompts" holds prompt-user records.
 * A slot opens that agent's history; ←/→ move through it, Enter answers an
 * open prompt, and an unread slot blinks. The server owns the records.
 */
import { SyntaxStyle, TextAttributes } from "@opentui/core"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { For, Show, createEffect, createSignal } from "solid-js"
import { Contract } from "./rpc.ts"
import {
  ago,
  answersOfForm,
  attentionForSection,
  attentionOf,
  descriptionOf,
  formFieldsOf,
  formIDOf,
  groupsOfKind,
  markdownBodyOf,
  needsAnswer,
  nextSessionOf,
  reportIDOfForm,
  stampOf,
  titleOf,
  type Question,
  type Report,
  type ReportGroup,
} from "./shared.ts"

/** The routed session and its subagents: the reports one view shows. */
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

/** Newest first: slots follow the time of their latest record. */
function orderedGroups(ctx: any, groups: ReportGroup[]): ReportGroup[] {
  return groups.slice().sort((a, b) => {
    const latest = (group: ReportGroup) => group.reports[group.reports.length - 1]?.at ?? 0
    return latest(b) - latest(a) || sessionCreated(ctx, a.sessionID) - sessionCreated(ctx, b.sessionID)
  })
}

/** Reports: green while any report is unread. Prompts: yellow while any question is unanswered. */
function dotColor(ctx: any, group: ReportGroup, kind: "report" | "prompt"): string {
  const waiting = attentionForSection(group.reports, kind).length > 0
  if (kind === "report") {
    return waiting ? ctx.theme.text.feedback.success.base : ctx.theme.text.muted
  }
  return waiting ? ctx.theme.text.feedback.warning.base : ctx.theme.text.muted
}

let reportSyntax: any

/**
 * The host's own markdown rules, from its theme tokens: headings, bold,
 * italics, lists, quotes, code, and links keep the colors the timeline uses.
 */
function syntaxFor(ctx: any): any {
  if (reportSyntax) return reportSyntax
  const owner = (ctx.renderer as any)?.nativeScene ?? ctx.renderer
  const theme = ctx.theme
  const markdown = theme.markdown
  const rule = (scope: string[], foreground: any, style: Record<string, any> = {}) => ({
    scope,
    style: { foreground, ...style },
  })
  try {
    reportSyntax = SyntaxStyle.fromTheme(
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
    reportSyntax = undefined
  }
  return reportSyntax
}

/** A full-width separator between a dialog's parts. */
function Rule(props: { ctx: any }) {
  return <box height={1} width="100%" border={["bottom"]} borderColor={props.ctx.theme.border.base} />
}

function ReportBody(props: { ctx: any; report: Report }) {
  const theme = props.ctx.theme
  return (
    <markdown
      syntaxStyle={syntaxFor(props.ctx)}
      content={markdownBodyOf(props.report)}
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
  // The body can be a whole report. Bound it so the textarea and the key hints
  // stay on screen; PgUp/PgDn scroll the body, the full record is one Enter
  // away in the history dialog.
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
      { id: "report.answer.steer", title: "Steer the answer", bind: "enter", run: () => submit("steer") },
      { id: "report.answer.queue", title: "Queue the answer", bind: "ctrl+enter", run: () => submit("queue") },
      { id: "report.answer.cancel", title: "Cancel answer", bind: "escape", run: () => props.onCancel() },
      {
        id: "report.answer.scroll.up",
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
        id: "report.answer.scroll.down",
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
): Promise<{ value: string; mode: "now" | "next" } | undefined> {
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
  group: ReportGroup
  sessions: ReportGroup[]
  kind: "report" | "prompt"
  onAnswer: (report: Report) => void
  onRead: (report: Report) => void
  onDismiss: (report: Report) => void
  onDefer: (report: Report) => void
}) {
  const theme = props.ctx.theme
  const dimensions = useTerminalDimensions()
  let scroll: any
  const [groupID, setGroupID] = createSignal(props.group.sessionID)
  const group = () =>
    props.sessions.find((item) => item.sessionID === groupID()) ?? props.group
  // Reads done in this dialog, so switching sessions and back keeps them.
  const marks = new Map<string, number>()
  const withMarks = (reports: readonly Report[]): Report[] =>
    reports.map((item) =>
      !item.readAt && marks.has(item.id) ? { ...item, readAt: marks.get(item.id)! } : item,
    )
  const [history, setHistory] = createSignal<Report[]>(withMarks(props.group.reports))
  const [index, setIndex] = createSignal(props.group.reports.length - 1)
  // Ctrl+A freezes the entries that needed attention when it was pressed, so
  // reading one (which marks it read) or dismissing one does not move the
  // entry out from under the cursor.
  const [filterIDs, setFilterIDs] = createSignal<string[] | undefined>(undefined)
  const filtered = () => {
    const ids = filterIDs()
    return ids ? history().filter((item) => ids.includes(item.id)) : history()
  }
  const report = () => filtered()[Math.min(index(), filtered().length - 1)]!
  const toggleFilter = () => {
    const current = report()
    if (filterIDs()) {
      setFilterIDs(undefined)
      const at = history().findIndex((item) => item.id === current.id)
      setIndex(at >= 0 ? at : history().length - 1)
      return
    }
    // The section kind ("report"/"prompt") and the record kind
    // ("post-task"/"prompt-user") are different vocabularies; this maps them.
    const matched = attentionForSection(history(), props.kind)
    if (!matched.length) {
      props.ctx.ui.toast.show({
        message:
          props.kind === "report"
            ? "No unread reports in this session."
            : "No unanswered prompts in this session.",
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
    const sessions = props.sessions.map((item) => ({ ...item, reports: withMarks(item.reports) }))
    const target = nextSessionOf(
      sessions,
      groupID(),
      delta,
      filterIDs() !== undefined,
      props.kind,
    )
    if (!target) {
      if (props.sessions.length > 1 && filterIDs()) {
        props.ctx.ui.toast.show({
          message:
            props.kind === "report"
              ? "No other session has unread reports."
              : "No other session has unanswered prompts.",
          variant: "info",
        })
      }
      return
    }
    setGroupID(target.sessionID)
    setHistory(target.reports)
    if (filterIDs()) {
      const matched = attentionForSection(target.reports, props.kind)
      setFilterIDs(matched.map((item) => item.id))
      setIndex(matched.length - 1)
    } else {
      setIndex(target.reports.length - 1)
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
    report()
    dimensions().height
    measure()
  })
  // Only a prompt record can be answered. Reports keep their old "Needs your
  // decision" block readable, but the action belongs to the Prompts section.
  const answerable = () => props.kind === "prompt" && needsAnswer(report())

  createEffect(() => {
    const current = report()
    if (current.readAt) return
    // Patch the dialog's own copy too. The store is the source of truth, but
    // the changed event only reloads the sidebar; without this the header and
    // a later ctrl+a snapshot would still call this record unread.
    const readAt = Date.now()
    marks.set(current.id, readAt)
    setHistory((items) =>
      items.map((item) => (item.id === current.id ? { ...item, readAt } : item)),
    )
    props.onRead(current)
  })

  // A dialog is modal, so bind the filter and session keys in a layer of its
  // own: the composer's ctrl+a and the input's "move to line start" stay out.
  props.ctx.keymap.layer(() => ({
    mode: "modal",
    priority: 2,
    enabled: true,
    commands: [
      {
        id: "report.history.filter",
        title: props.kind === "report" ? "Only unread reports" : "Only unanswered prompts",
        group: "Dialog",
        bind: "ctrl+a",
        run: () => toggleFilter(),
      },
      {
        id: "report.history.session.prev",
        title: "Previous session",
        group: "Dialog",
        bind: "ctrl+up",
        run: () => switchSession(-1),
      },
      {
        id: "report.history.session.next",
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
      if (answerable()) props.onDefer(report())
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
      props.onAnswer(report())
      return
    }
    if (event.name === "d" && answerable()) {
      event.preventDefault()
      event.stopPropagation()
      const current = report()
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
        {filterIDs()
          ? props.kind === "report"
            ? " · showing unread"
            : " · showing unanswered"
          : ""}
        {" · "}
        {stampOf(report())}
        {report().rev && report().rev! > 1 ? ` · rev ${report().rev}` : ""}
        {report().readAt ? " · read" : ""}
        {report().answeredAt ? " · answered" : ""}
        {report().dismissedAt ? " · dismissed" : ""}
      </text>
      <Rule ctx={props.ctx} />
      <Show when={report().description}>
        <text fg={theme.text.base}>
          <b>{report().description}</b>
        </text>
      </Show>
      <scrollbox
        ref={(element: any) => (scroll = element)}
        maxHeight={maxRows()}
        contentOptions={{ minHeight: 0 }}
        scrollbarOptions={{ visible: false }}
      >
        <ReportBody ctx={props.ctx} report={report()} />
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
          {filterIDs() ? "all" : props.kind === "report" ? "only unread" : "only unanswered"}
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
  group: ReportGroup,
  sessions: ReportGroup[],
  kind: "report" | "prompt",
  onAnswer: (report: Report) => void,
  onRead: (report: Report) => void,
  onDismiss: (report: Report) => void,
) {
  const onDefer = (report: Report) => {
    try {
      void ctx.client
        .rpc(Contract)
        .defer({ sessionID: report.sessionID, reportID: report.id })
        .catch(() => {})
    } catch {}
  }
  ctx.ui.dialog.show(() => (
    <History
      ctx={ctx}
      group={group}
      sessions={sessions}
      kind={kind}
      onAnswer={onAnswer}
      onRead={onRead}
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
  group: ReportGroup
  kind: "report" | "prompt"
  onOpen: (group: ReportGroup) => void
  onAnswer: (report: Report) => void
  onRead: (report: Report) => void
  onDismiss: (report: Report) => void
}) {
  const theme = props.ctx.theme
  const latest = () => props.group.reports[props.group.reports.length - 1]!
  const unread = () =>
    props.kind === "report" && props.group.reports.some((report) => !report.readAt)
  return (
    <box
      flexDirection="column"
      minWidth={0}
      onMouseUp={() => props.onOpen(props.group)}
    >
      <box flexDirection="row" gap={1} minWidth={0}>
        <text flexShrink={0} style={{ fg: dotColor(props.ctx, props.group, props.kind) }}>
          {"\u2022"}
        </text>
        <text
          fg={theme.text.base}
          attributes={unread() ? TextAttributes.BOLD | TextAttributes.BLINK : TextAttributes.BOLD}
          wrapMode="none"
          truncate
          flexGrow={1}
          flexShrink={1}
          minWidth={0}
        >
          {sessionTitle(props.ctx, props.group.sessionID)}
        </text>
        <text fg={theme.text.muted} flexShrink={0}>
          {props.group.reports.length} · {ago(latest().at)}
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
  title: string
  kind: "report" | "prompt"
  marginTop?: number
  note?: string
  attention: number
  groups: ReportGroup[]
  open: boolean
  toggle: () => void
  onOpen: (group: ReportGroup) => void
  onAnswer: (report: Report) => void
  onRead: (report: Report) => void
  onDismiss: (report: Report) => void
}) {
  const theme = props.ctx.theme
  return (
    <Show when={props.groups.length > 0}>
      <box marginTop={props.marginTop ?? 0}>
        <box flexDirection="row" gap={1} onMouseDown={props.toggle}>
          <text fg={theme.text.base}>{props.open ? "\u25BC" : "\u25B6"}</text>
          <text fg={theme.text.base}>
            <b>{props.title}</b>
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
            {(group) => (
              <Slot
                ctx={props.ctx}
                group={group}
                kind={props.kind}
                onOpen={props.onOpen}
                onAnswer={props.onAnswer}
                onRead={props.onRead}
                onDismiss={props.onDismiss}
              />
            )}
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
  list: () => Report[]
  reload: (sessionID: string) => void
  onAnswer: (report: Report) => void
  onRead: (report: Report) => void
  onDismiss: (report: Report) => void
}) {
  createEffect(() => {
    const sessionID = props.sessionID
    if (!sessionID) return
    props.reload(sessionID)
  })
  const latestOf = (group: ReportGroup) => group.reports[group.reports.length - 1]!
  const needs = (group: ReportGroup, kind: "report" | "prompt") =>
    attentionForSection(group.reports, kind).length > 0
  const reportGroups = () => orderedGroups(props.ctx, groupsOfKind(props.list(), "post-task"))
  const promptGroups = () => orderedGroups(props.ctx, groupsOfKind(props.list(), "prompt-user"))
  // At most five slots: attention first, then newest. The picker still lists
  // all, and the history's ctrl+up/down walks this same order uncapped.
  const sorted = (groups: ReportGroup[], kind: "report" | "prompt") =>
    groups
      .slice()
      .sort(
        (a, b) =>
          Number(needs(b, kind)) - Number(needs(a, kind)) || latestOf(b).at - latestOf(a).at,
      )
  const reportSessions = () => {
    const groups = reportGroups()
    return sorted(
      props.view?.unread === true ? groups.filter((group) => needs(group, "report")) : groups,
      "report",
    )
  }
  const promptSessions = () => {
    const groups = promptGroups()
    return sorted(
      props.view?.unanswered === true ? groups.filter((group) => needs(group, "prompt")) : groups,
      "prompt",
    )
  }
  const reports = () => reportSessions().slice(0, 5)
  const prompts = () => promptSessions().slice(0, 5)
  const reportAttention = () => reportGroups().filter((group) => needs(group, "report")).length
  const promptAttention = () => promptGroups().filter((group) => needs(group, "prompt")).length
  const reportsOpen = () => props.view?.open !== false
  const promptsOpen = () => props.view?.prompts !== false
  const toggleReports = () => {
    void props.setView((draft: any) => {
      draft.open = draft.open === false
    })
  }
  const togglePrompts = () => {
    void props.setView((draft: any) => {
      draft.prompts = draft.prompts === false
    })
  }
  const sidebarShown = () => props.view?.sidebar !== false
  const reportsShown = () => props.view?.showReports !== false
  const promptsShown = () => props.view?.showPrompts !== false
  const hasContent = () =>
    (reportsShown() && reports().length > 0) || (promptsShown() && prompts().length > 0)
  return (
    <Show when={sidebarShown() && hasContent()}>
      <box>
        <Show when={reportsShown()}>
          <Section
            ctx={props.ctx}
            title="Reports"
            kind="report"
            note={props.view?.unread === true ? "unread" : undefined}
            attention={reportAttention()}
            groups={reports()}
            open={reportsOpen()}
            toggle={toggleReports}
            onOpen={(group) =>
              openHistory(
                props.ctx,
                group,
                reportSessions(),
                "report",
                props.onAnswer,
                props.onRead,
                props.onDismiss,
              )
            }
            onAnswer={props.onAnswer}
            onRead={props.onRead}
            onDismiss={props.onDismiss}
          />
        </Show>
        <Show when={promptsShown()}>
          <Section
            ctx={props.ctx}
            title="Prompts"
            kind="prompt"
            marginTop={reportsShown() && reports().length > 0 ? 1 : 0}
            note={props.view?.unanswered === true ? "unanswered" : undefined}
            attention={promptAttention()}
            groups={prompts()}
            open={promptsOpen()}
            toggle={togglePrompts}
            onOpen={(group) =>
              openHistory(
                props.ctx,
                group,
                promptSessions(),
                "prompt",
                props.onAnswer,
                props.onRead,
                props.onDismiss,
              )
            }
            onAnswer={props.onAnswer}
            onRead={props.onRead}
            onDismiss={props.onDismiss}
          />
        </Show>
      </box>
    </Show>
  )
}

export default {
  id: "fazuh.report-tui",

  setup: async (ctx: any) => {
    if (typeof ctx.client?.rpc !== "function") return
    const rpc = ctx.client.rpc(Contract)
    const [reports, setReports] = createSignal<Record<string, Report[]>>({})

    const routedID = (): string | undefined => {
      const route = ctx.ui.router.current()
      return route?.type === "session" ? route.sessionID : undefined
    }

    const reload = (sessionID: string) => {
      void rpc
        .list({ sessionIDs: familyOf(ctx, sessionID) })
        .then((result: any) => {
          setReports((previous) => ({ ...previous, [sessionID]: result?.reports ?? [] }))
        })
        .catch(() => {})
    }

    // A report or answer written anywhere in the family refetches the view,
    // and a fresh prompt record opens as the host's inline form.
    const off = rpc.events.on("changed", (event: any) => {
      const sessionID = routedID()
      if (sessionID) reload(sessionID)
      const report = event?.data?.report
      if (report?.kind === "prompt-user") void showForm(report)
    })

    /** Prompt records already offered as an inline form, by report id. */
    const shownForms = new Set<string>()
    let warnedNoForm = false

    /**
     * Offer a prompt record as the inline form the question tool uses. The
     * record is already saved, so the card is only an offer: it can be filled
     * now, or dismissed with esc to defer it to the Prompts list. A blocking
     * prompt_user waits for the answer; a normal call keeps the agent working.
     */
    async function showForm(report: Report) {
      if (report.kind !== "prompt-user") return
      if (!report.prompts?.questions?.length) return
      if (report.answeredAt || report.dismissedAt) return
      if (shownForms.has(report.id)) return
      // A read or answer on an old record also emits changed; do not pop a
      // form for a prompt that was written long before this event.
      if (Date.now() - report.at > 15_000) return
      const create = ctx.client?.session?.form?.create
      if (typeof create !== "function") {
        if (!warnedNoForm) {
          warnedNoForm = true
          console.error("[report] the host has no session.form.create; prompts stay in the sidebar")
        }
        return
      }
      shownForms.add(report.id)
      try {
        await create.call(ctx.client.session.form, {
          sessionID: report.sessionID,
          id: formIDOf(report.id),
          title: descriptionOf(report),
          metadata: { kind: "report.prompt", reportID: report.id },
          fields: formFieldsOf(report),
        })
      } catch (error: any) {
        shownForms.delete(report.id)
        console.error(`[report] could not show the prompt form: ${error?.message ?? error}`)
      }
    }

    // The form is a second way into the same answer path. Dismissing it with
    // esc is the defer action: the record stays unanswered in the list.
    const offReplied = ctx.data?.on?.("form.replied", (event: any) => {
      const reportID = reportIDOfForm(String(event?.data?.id ?? ""))
      if (!reportID) return
      const sessionID = String(event?.data?.sessionID ?? "")
      const answers = answersOfForm(event?.data?.answer)
      if (!sessionID || !Object.keys(answers).length) return
      void deliver(sessionID, reportID, answers, "steer")
    })
    const offCancelled = ctx.data?.on?.("form.cancelled", (event: any) => {
      const reportID = reportIDOfForm(String(event?.data?.id ?? ""))
      if (!reportID) return
      const sessionID = String(event?.data?.sessionID ?? "")
      if (sessionID) void rpc.defer({ sessionID, reportID }).catch(() => {})
      ctx.ui.toast.show({ message: "Prompt deferred to the Prompts list.", variant: "info" })
    })

    async function read(report: Report) {
      try {
        await rpc.read({ sessionID: report.sessionID, reportID: report.id })
      } catch {}
    }

    async function deferPrompt(report: Report) {
      try {
        await rpc.defer({ sessionID: report.sessionID, reportID: report.id })
      } catch {}
    }

    async function dismiss(report: Report) {
      try {
        await rpc.dismiss({ sessionID: report.sessionID, reportID: report.id })
        ctx.ui.toast.show({ message: `Dismissed: ${descriptionOf(report)}`, variant: "info" })
      } catch (error: any) {
        ctx.ui.toast.show({ message: `Could not dismiss: ${error?.message ?? error}`, variant: "error" })
      }
      const sessionID = routedID()
      if (sessionID) reload(sessionID)
    }

    async function deliver(
      sessionID: string,
      reportID: string,
      answers: Record<string, string>,
      mode: "steer" | "queue",
    ) {
      try {
        const result: any = await rpc.answer({ sessionID, reportID, answers, mode })
        if (result?.error && !result?.delivered) {
          ctx.ui.toast.show({ message: `Answers saved, but ${result.error}`, variant: "warning" })
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

    async function answer(report: Report) {
      const questions = report.prompts?.questions ?? []
      if (!questions.length) return
      const answers: Record<string, string> = {}
      let mode: "steer" | "queue" = "steer"
      for (const [index, question] of questions.entries()) {
        const result = await askAnswer(
          ctx,
          question,
          answers[String(index)] ?? report.answers?.[String(index)] ?? "",
        )
        if (!result) {
          void deferPrompt(report)
          return
        }
        answers[String(index)] = result.value
        if (result.mode === "queue") mode = "queue"
      }
      if (!Object.keys(answers).length) return
      await deliver(report.sessionID, report.id, answers, mode)
    }

    /**
     * Clear one section's attention for the routed session's family: every
     * unread post-task record, or every prompt record still awaiting an
     * answer. Answered and already-dismissed prompts need no second pass.
     */
    async function markAll(kind: Report["kind"]) {
      const sessionID = routedID()
      if (!sessionID) {
        ctx.ui.toast.show({ message: "Open a session first.", variant: "info" })
        return
      }
      let records: Report[] = []
      try {
        const result: any = await rpc.list({ sessionIDs: familyOf(ctx, sessionID) })
        records = Array.isArray(result?.reports) ? result.reports : []
      } catch (error: any) {
        ctx.ui.toast.show({
          message: `Could not load ${kind === "post-task" ? "reports" : "prompts"}: ${error?.message ?? error}`,
          variant: "error",
        })
        return
      }
      const targets =
        kind === "post-task"
          ? records.filter((item) => item.kind === "post-task" && !item.readAt)
          : records.filter((item) => item.kind === "prompt-user" && needsAnswer(item))
      if (!targets.length) {
        ctx.ui.toast.show({
          message: kind === "post-task" ? "No unread reports." : "No prompts to dismiss.",
          variant: "info",
        })
        return
      }
      let done = 0
      for (const report of targets) {
        try {
          if (kind === "post-task") {
            await rpc.read({ sessionID: report.sessionID, reportID: report.id })
          } else {
            await rpc.dismiss({ sessionID: report.sessionID, reportID: report.id })
          }
          done++
        } catch {}
      }
      ctx.ui.toast.show({
        message:
          kind === "post-task"
            ? `Marked ${done} report${done === 1 ? "" : "s"} read.`
            : `Dismissed ${done} prompt${done === 1 ? "" : "s"}.`,
        variant: done === targets.length ? "success" : "warning",
      })
      reload(sessionID)
    }

    async function openList(kind: Report["kind"]) {
      const sessionID = routedID()
      if (!sessionID) {
        ctx.ui.toast.show({ message: "Open a session first.", variant: "info" })
        return
      }
      if (!reports()[sessionID]) reload(sessionID)
      const groups = orderedGroups(ctx, groupsOfKind(reports()[sessionID] ?? [], kind))
      const filtered = kind === "post-task" ? view.unread === true : view.unanswered === true
      const visible = filtered
        ? groups.filter((group) => attentionOf(group.reports, kind).length > 0)
        : groups
      if (!visible.length && !filtered) {
        ctx.ui.toast.show({
          message: kind === "post-task" ? "No reports in this session." : "No prompts in this session.",
          variant: "info",
        })
        return
      }
      const label = kind === "post-task" ? "unread" : "unanswered"
      const bindings = [
        {
          bind: "ctrl+a",
          title: filtered ? "Show all" : `Only ${label}`,
          group: "Dialog",
          run: () => {
            void setView((draft: any) => {
              if (kind === "post-task") draft.unread = draft.unread === false
              else draft.unanswered = draft.unanswered === false
            }).then(() => {
              try {
                ctx.ui.dialog.clear()
              } catch {}
              void openList(kind)
            })
          },
        },
      ]
      const picked = await ctx.ui.dialog.select({
        title: kind === "post-task" ? "Reports" : "Prompts",
        footerHints: [{ title: filtered ? "show all" : `only ${label}`, label: "ctrl+a" }],
        options: visible.map((group) => {
          const latest = group.reports[group.reports.length - 1]!
          return {
            title: sessionTitle(ctx, group.sessionID),
            description: `${group.reports.length} - ${descriptionOf(latest)} - ${ago(latest.at)}`,
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
          kind === "post-task" ? "report" : "prompt",
          (report) => void answer(report),
          (report) => void read(report),
          (report) => void dismiss(report),
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
        { key: "showReports", title: "Reports", note: "section" },
        { key: "showPrompts", title: "Prompts", note: "section" },
      ] as const
      for (;;) {
        const picked = await ctx.ui.dialog
          .select({
            title: "Report settings",
            footerHints: [{ title: "toggle", label: "enter" }],
            options: rows.map((row) => ({
              title: row.title,
              description: `${row.note} · ${view[row.key] !== false ? "shown" : "hidden"}`,
              value: row.key,
            })),
          })
          .catch(() => undefined)
        if (!picked) return
        await setView((draft: any) => {
          draft[picked] = draft[picked] === false
        })
      }
    }

    const [view, setView] = ctx.storage.store("report-view-v2", {
      initial: {
        open: true,
        prompts: true,
        unanswered: false,
        unread: false,
        sidebar: true,
        showReports: true,
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
          list={() => reports()[input.sessionID] ?? []}
          reload={reload}
          onAnswer={(report) => void answer(report)}
          onRead={(report) => void read(report)}
          onDismiss={(report) => void dismiss(report)}
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
              id: "report.open",
              title: "Reports",
              group: "report",
              palette: true,
              slash: { name: "reports" },
              run: () => void openList("post-task"),
            },
            {
              id: "report.prompts",
              title: "Prompts",
              group: "report",
              palette: true,
              slash: { name: "prompts" },
              run: () => void openList("prompt-user"),
            },
            {
              id: "report.settings",
              title: "Report settings",
              group: "report",
              palette: true,
              slash: { name: "report-settings" },
              run: () => void openSettings(),
            },
            {
              id: "report.attention",
              title: "Only unanswered prompts and unread reports",
              group: "report",
              palette: true,
              run: () => {
                const only = !(view.unread === true && view.unanswered === true)
                void setView((draft: any) => {
                  draft.unread = only
                  draft.unanswered = only
                })
              },
            },
            {
              id: "report.read.all",
              title: "Mark all reports read",
              group: "report",
              palette: true,
              slash: { name: "read-reports" },
              run: () => void markAll("post-task"),
            },
            {
              id: "report.dismiss.all",
              title: "Dismiss all prompts",
              group: "report",
              palette: true,
              slash: { name: "dismiss-prompts" },
              run: () => void markAll("prompt-user"),
            },
          ],
        }))
        return null
      },
    })

    return () => {
      for (const stop of [off, offReplied, offCancelled, offContext]) {
        try {
          stop?.()
        } catch {}
      }
    }
  },
}
