import { For, Show, createEffect, createSignal, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { MenuItem, Panel, Plugin, Style, createKeyed } from "@opencode/plugin/gui"
import { Contract } from "./rpc.ts"
import {
  ago,
  groupBySession,
  markdownOf,
  needsAnswer,
  stampOf,
  type Report,
  type ReportGroup,
} from "./shared.ts"

/**
 * Reports in the desktop app: two side-panel sections, one slot per agent in
 * each. "Reports" holds post-task records, "Prompts" holds prompt-user
 * records. Unread slots blink; the arrows walk an agent's history and an
 * open prompt can be answered from the panel.
 */
const TAB = { id: "reports", title: "Reports", closable: "compact" as const }
const SUCCESS = "#3fb950"
const WARNING = "#d29922"
const MUTED = "#8b949e"
const BLINK = `
@keyframes fazuh-report-blink { 50% { opacity: 0.3 } }
.fazuh-report-unread { animation: fazuh-report-blink 1.2s step-end infinite; }
`

type Kind = "report" | "prompt"

function ReportsView(props: {
  ctx: any
  session: () => { id: string }
  reports: () => Report[]
  seed: (sessionID: string) => void
  answer: (report: Report) => void
  read: (report: Report) => void
  dismiss: (report: Report) => void
}) {
  const ui = props.ctx.ui
  const [active, setActive] = createSignal<{ kind: Kind; sessionID: string }>()
  const [index, setIndex] = createSignal(0)
  const data = () => props.ctx.servers.get("sidecar")?.data

  const order = (groups: ReportGroup[]) => {
    const routed = props.session().id
    return groups.slice().sort((a, b) => {
      if (a.sessionID === routed) return -1
      if (b.sessionID === routed) return 1
      const created = (id: string) => data()?.session.get(id)?.time?.created ?? 0
      return created(a.sessionID) - created(b.sessionID)
    })
  }
  const reportGroups = () => order(groupBySession(props.reports().filter((report) => report.kind === "post-task")))
  const promptGroups = () => order(groupBySession(props.reports().filter((report) => report.kind === "prompt-user")))
  const groupsFor = (kind: Kind) => (kind === "report" ? reportGroups() : promptGroups())
  const selected = () => {
    const current = active()
    if (current) {
      const found = groupsFor(current.kind).find((item) => item.sessionID === current.sessionID)
      if (found) return { kind: current.kind, group: found }
    }
    const report = reportGroups()[0]
    if (report) return { kind: "report" as const, group: report }
    const prompt = promptGroups()[0]
    if (prompt) return { kind: "prompt" as const, group: prompt }
    return undefined
  }
  const current = () => {
    const found = selected()
    if (!found) return undefined
    return found.group.reports[Math.max(0, Math.min(index(), found.group.reports.length - 1))]
  }
  const title = (sessionID: string) => {
    const value = data()?.session.get(sessionID)?.title
    return typeof value === "string" && value.trim() ? value.trim() : sessionID.slice(0, 10)
  }
  const dot = (item: ReportGroup, kind: Kind) => {
    if (kind === "report") {
      return item.reports.some((report) => !report.readAt) ? SUCCESS : MUTED
    }
    return item.reports.some((report) => needsAnswer(report)) ? WARNING : MUTED
  }
  const unread = (item: ReportGroup, kind: Kind) =>
    kind === "report" && item.reports.some((report) => !report.readAt)
  const isActive = (kind: Kind, item: ReportGroup) =>
    selected()?.kind === kind && selected()?.group.sessionID === item.sessionID
  const select = (kind: Kind, item: ReportGroup) => {
    setActive({ kind, sessionID: item.sessionID })
    setIndex(item.reports.length - 1)
  }

  createEffect(() => {
    const sessionID = props.session().id
    if (sessionID) props.seed(sessionID)
  })

  createEffect(() => {
    const value = current()
    if (value && !value.readAt) props.read(value)
  })

  const row = (kind: Kind, item: ReportGroup) => {
    const latest = item.reports[item.reports.length - 1]!
    return (
      <button
        onClick={() => select(kind, item)}
        style={{
          display: "flex",
          "align-items": "center",
          gap: "6px",
          padding: "4px 6px",
          "text-align": "left",
          background: isActive(kind, item) ? "rgba(128, 128, 128, 0.18)" : "transparent",
          border: "none",
          "border-radius": "4px",
          cursor: "pointer",
          color: "inherit",
          "font-size": "12px",
        }}
      >
        <span style={{ color: dot(item, kind), "flex-shrink": "0" }}>{"\u2022"}</span>
        <span
          class={unread(item, kind) ? "fazuh-report-unread" : undefined}
          style={{
            overflow: "hidden",
            "text-overflow": "ellipsis",
            "white-space": "nowrap",
            "font-weight": "600",
          }}
        >
          {title(item.sessionID)}
        </span>
        <span style={{ opacity: 0.6, "flex-shrink": "0" }}>
          {item.reports.length} · {ago(latest.at)}
        </span>
      </button>
    )
  }

  return (
    <div style={{ display: "flex", "flex-direction": "column", height: "100%", "min-height": "0" }}>
      <div
        style={{
          display: "flex",
          "flex-direction": "column",
          gap: "2px",
          "max-height": "45%",
          "overflow-y": "auto",
          "border-bottom": "1px solid rgba(128, 128, 128, 0.25)",
          "padding-bottom": "6px",
        }}
      >
        <Show when={reportGroups().length > 0}>
          <div style={sectionStyle}>Reports</div>
          <For each={reportGroups()}>{(item) => row("report", item)}</For>
        </Show>
        <Show when={promptGroups().length > 0}>
          <div style={sectionStyle}>Prompts</div>
          <For each={promptGroups()}>{(item) => row("prompt", item)}</For>
        </Show>
        <Show when={!reportGroups().length && !promptGroups().length}>
          <p style={{ margin: "4px 0", opacity: 0.7 }}>No reports yet.</p>
        </Show>
      </div>
      <div style={{ flex: "1", "min-height": "0", "overflow-y": "auto", "padding-top": "6px" }}>
        <Show when={current()} fallback={<p style={{ margin: 0, opacity: 0.7 }}>Pick an agent.</p>}>
          {(report) => (
            <div style={{ display: "flex", "flex-direction": "column", gap: "6px" }}>
              <div style={{ display: "flex", "align-items": "center", gap: "8px", "font-size": "11px", opacity: 0.8 }}>
                <span>
                  {selected() ? title(selected()!.group.sessionID) : ""} · {index() + 1}/
                  {selected()?.group.reports.length ?? 1}
                  {report().kind === "post-task" ? " · report" : " · prompt"} · {stampOf(report())}
                  {report().rev && report().rev! > 1 ? ` · rev ${report().rev}` : ""}
                  {report().answeredAt ? " · answered" : ""}
                  {report().dismissedAt ? " · dismissed" : ""}
                </span>
                <button
                  onClick={() => {
                    const sessionID = selected()?.group.sessionID
                    if (!sessionID) return
                    void props.ctx.system.copy(sessionID).then(
                      () => props.ctx.toast.show({ title: "Session id copied", description: sessionID }),
                      () => props.ctx.toast.show({ title: "Could not copy the session id", variant: "error" }),
                    )
                  }}
                  style={navStyle}
                >
                  Copy ID
                </button>
                <button
                  disabled={index() <= 0}
                  onClick={() => setIndex((value) => Math.max(0, value - 1))}
                  style={navStyle}
                >
                  ← older
                </button>
                <button
                  disabled={index() >= (selected()?.group.reports.length ?? 1) - 1}
                  onClick={() => setIndex((value) => Math.min((selected()?.group.reports.length ?? 1) - 1, value + 1))}
                  style={navStyle}
                >
                  newer →
                </button>
                <Show when={selected()?.kind === "prompt" && needsAnswer(report())}>
                  <button onClick={() => props.answer(report())} style={navStyle}>
                    Answer
                  </button>
                  <button onClick={() => props.dismiss(report())} style={navStyle}>
                    Dismiss
                  </button>
                </Show>
              </div>
              <Show when={report().description}>
                <div style={{ "font-size": "12px", "font-weight": "600" }}>{report().description}</div>
              </Show>
              <ui.Markdown text={markdownOf(report())} />
            </div>
          )}
        </Show>
      </div>
    </div>
  )
}

const sectionStyle = {
  "font-size": "10px",
  "text-transform": "uppercase",
  "letter-spacing": "0.06em",
  opacity: 0.55,
  padding: "4px 6px 2px",
} as const

const navStyle = {
  padding: "1px 6px",
  border: "1px solid rgba(128, 128, 128, 0.35)",
  "border-radius": "4px",
  background: "transparent",
  color: "inherit",
  cursor: "pointer",
  "font-size": "11px",
} as const

export default Plugin.define({
  setup(ctx) {
    const [reports, setReports] = createStore<Record<string, Report[]>>({})

    ctx.add(Style, BLINK)

    const client = () => ctx.servers.get("sidecar")?.client ?? ctx.client
    const familyOf = (sessionID: string): string[] => {
      try {
        const family = ctx.servers.get("sidecar")?.data.session.family(sessionID)
        return Array.isArray(family) && family.length ? family : [sessionID]
      } catch {
        return [sessionID]
      }
    }
    const seed = (sessionID: string) => {
      void client()
        .rpc(Contract)
        .list({ sessionIDs: familyOf(sessionID) })
        .then((result: any) => setReports(sessionID, result?.reports ?? []))
        .catch(() => {})
    }

    async function read(report: Report) {
      try {
        await client().rpc(Contract).read({ sessionID: report.sessionID, reportID: report.id })
      } catch {}
    }

    async function dismiss(report: Report) {
      try {
        await client().rpc(Contract).dismiss({ sessionID: report.sessionID, reportID: report.id })
        ctx.toast.show({ title: "Prompt dismissed", description: report.description ?? report.title })
      } catch (error) {
        ctx.toast.show({ title: "Could not dismiss", description: String(error), variant: "error" })
      }
      const routed = ctx.sessions.current()
      if (routed) seed(routed.id)
    }

    async function answer(report: Report) {
      const questions = report.prompts?.questions ?? []
      if (!questions.length) return
      const answers: Record<string, string> = {}
      for (const [index, question] of questions.entries()) {
        const value = await ctx.dialogs.prompt({
          title: question.title,
          description: question.body,
          placeholder: question.recommendation ?? "Your answer",
          value: answers[String(index)] ?? report.answers?.[String(index)] ?? "",
        })
        if (value === undefined) return
        if (value.trim()) answers[String(index)] = value.trim()
      }
      if (!Object.keys(answers).length) return
      const mode = await ctx.dialogs.select<"steer" | "queue">({
        title: "Send answers",
        options: [
          { title: "Steer", description: "Interrupt and deliver the answer now", value: "steer" },
          { title: "Queue", description: "Deliver after the agent's current turn", value: "queue" },
        ],
      })
      if (!mode) return
      try {
        const result: any = await client()
          .rpc(Contract)
          .answer({ sessionID: report.sessionID, reportID: report.id, answers, mode })
        if (result?.error && !result?.delivered) {
          ctx.toast.show({ title: "Answers saved", description: result.error, variant: "error" })
        } else {
          ctx.toast.show({
            title: mode === "queue" ? "Answers queued" : "Answers steered",
            description: "The agent has them.",
          })
        }
      } catch (error) {
        ctx.toast.show({ title: "Could not save answers", description: String(error), variant: "error" })
      }
    }

    createKeyed(
      () => ctx.servers.get("sidecar")?.client,
      (serverClient: any) => {
        const off = serverClient.rpc(Contract).events.on("changed", (event: any) => {
          const sessionID = String(event?.data?.sessionID ?? "")
          if (!sessionID) return
          const routed = ctx.sessions.current()
          if (!routed) return
          if (!familyOf(routed.id).includes(sessionID)) return
          seed(routed.id)
          const source = ctx.servers.get("sidecar")?.data.session.get(sessionID)?.title
          ctx.toast.show({
            title: "Report saved",
            description:
              sessionID === routed.id || !source
                ? event?.data?.report?.title
                : `${source}: ${event?.data?.report?.title}`,
            actions: [
              {
                label: "Open Reports",
                run: () => ctx.layout.open(`${ctx.id}:${TAB.id}`, routed),
              },
            ],
          })
        })
        onCleanup(off)
      },
    )

    ctx.add(Panel, {
      id: "reports",
      region: "side",
      mobile: { title: TAB.title, order: 52, kind: "menu", icon: "checklist" },
      list: (input) => (input.open.includes(TAB.id) ? [TAB] : []),
      render: (props) => (
        <ReportsView
          ctx={ctx}
          session={() => props.session}
          reports={() => reports[props.session.id] ?? []}
          seed={seed}
          answer={(report) => void answer(report)}
          read={(report) => void read(report)}
          dismiss={(report) => void dismiss(report)}
        />
      ),
    })

    ctx.add(MenuItem, (): any => {
      const session = ctx.sessions.current()
      if (!session) return undefined
      const count = (reports[session.id] ?? []).length
      return {
        menu: "session.panel",
        id: TAB.id,
        title: TAB.title,
        icon: "checklist",
        ...(count ? { description: `${count} report${count === 1 ? "" : "s"}` } : {}),
        opened: ctx.layout.state(`${ctx.id}:${TAB.id}`, session) !== "closed",
        run: () => ctx.layout.open(`${ctx.id}:${TAB.id}`, session),
      }
    })
  },
})
