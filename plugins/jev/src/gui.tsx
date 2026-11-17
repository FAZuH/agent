import { For, Show, createEffect, createSignal, onCleanup } from "solid-js"
import { MenuItem, Panel, Plugin, Style } from "@opencode/plugin/gui"
import { createJevView, type Approval } from "./gui-controller.ts"
import { Contract } from "./rpc.ts"

const TAB = { id: "jev-view-v1", title: "Jev", closable: "compact" as const }
const CSS = `
.fazuh-jev { display: flex; flex-direction: column; gap: 12px; height: 100%; min-height: 0; min-width: 0; padding: 12px; }
.fazuh-jev button { cursor: pointer; }
.fazuh-jev button:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
.fazuh-jev-alert { display: flex; gap: 8px; align-items: center; }
.fazuh-jev-nav { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-shrink: 0; }
.fazuh-jev-title { font-size: 14px; font-weight: 600; }
.fazuh-jev-tabs { display: flex; gap: 2px; border-bottom: 1px solid var(--border-weak-base); flex-shrink: 0; }
.fazuh-jev-tab { border: 0; border-bottom: 2px solid transparent; background: transparent; color: inherit; font-size: 12px; opacity: .7; padding: 6px 9px; }
.fazuh-jev-tab:hover { opacity: 1; }
.fazuh-jev-tab[aria-pressed=true] { opacity: 1; font-weight: 600; border-bottom-color: #e0a458; }
.fazuh-jev-tab-count { opacity: .7; font-variant-numeric: tabular-nums; margin-left: 4px; }
.fazuh-jev-bulk { display: flex; align-items: center; gap: 8px; border: 1px solid var(--border-weak-base); border-radius: 6px; padding: 7px 9px; flex-shrink: 0; }
.fazuh-jev-bulk-label { color: #e0a458; font-weight: 600; font-size: 12px; margin-right: auto; }
.fazuh-jev-link { border: 0; background: transparent; color: inherit; font-size: 12px; opacity: .7; padding: 2px 4px; text-decoration: underline; }
.fazuh-jev-link:hover, .fazuh-jev-link[aria-pressed=true] { opacity: 1; font-weight: 600; }
.fazuh-jev-section { display: flex; flex-direction: column; gap: 6px; flex-shrink: 0; }
.fazuh-jev-section > strong { font-size: 12px; opacity: .7; text-transform: uppercase; letter-spacing: .04em; }
.fazuh-jev-section-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.fazuh-jev-section-head > strong { font-size: 12px; opacity: .7; text-transform: uppercase; letter-spacing: .04em; }
.fazuh-jev-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; width: 100%; text-align: start; padding: 7px 9px; border: 1px solid var(--border-weak-base); border-radius: 6px; background: transparent; color: inherit; font-size: 13px; }
.fazuh-jev-row:hover { background: var(--surface-base-hover); }
.fazuh-jev-row span { min-width: 0; }
.fazuh-jev-row small { display: block; opacity: .6; font-size: 11px; }
.fazuh-jev-row[data-on=true] { box-shadow: inset 2px 0 currentColor; }
.fazuh-jev-empty { font-size: 12px; opacity: .6; padding: 12px 4px; text-align: center; }
.fazuh-jev-log { display: flex; flex-direction: column; gap: 3px; overflow-y: auto; min-height: 0; }
.fazuh-jev-logitem { border: 1px solid var(--border-weak-base); border-radius: 6px; overflow: hidden; flex-shrink: 0; }
.fazuh-jev-logrow { display: flex; align-items: baseline; gap: 8px; width: 100%; text-align: start; font-size: 12px; line-height: 1.5; padding: 5px 8px; border: 0; background: transparent; color: inherit; }
.fazuh-jev-logrow:hover { background: var(--surface-base-hover); }
.fazuh-jev-logtime { flex: 0 0 auto; opacity: .55; font-variant-numeric: tabular-nums; font-size: 11px; }
.fazuh-jev-logverdict { flex: 0 0 auto; font-weight: 600; text-transform: uppercase; font-size: 10px; letter-spacing: .03em; }
.fazuh-jev-logsubject { flex: 1 1 auto; min-width: 0; opacity: .85; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fazuh-jev-detail { padding: 7px 9px; border-top: 1px solid var(--border-weak-base); font-size: 11px; display: flex; flex-direction: column; gap: 7px; }
.fazuh-jev-detailitem { display: flex; flex-direction: column; gap: 1px; }
.fazuh-jev-detailitem b { opacity: .7; font-size: 11px; font-weight: 600; }
.fazuh-jev-detail pre { margin: 0; white-space: pre-wrap; word-break: break-word; font-family: inherit; opacity: .85; }
.fazuh-jev-actions { display: flex; gap: 6px; }
.fazuh-jev-approvals { display: flex; flex-direction: column; gap: 8px; min-height: 0; overflow-y: auto; }
.fazuh-jev-approve { display: flex; flex-direction: column; gap: 7px; border: 1px solid var(--border-weak-base); border-radius: 6px; padding: 9px 10px; }
.fazuh-jev-approve-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; font-size: 12px; }
.fazuh-jev-approve-head b { color: #e0a458; font-family: monospace; }
.fazuh-jev-approve pre { margin: 0; white-space: pre-wrap; word-break: break-word; font-family: inherit; font-size: 12px; opacity: .85; }
`

function clock(ts: unknown): string {
  const text = String(ts ?? "")
  const date = new Date(text)
  if (!Number.isNaN(date.getTime())) {
    const hh = String(date.getHours()).padStart(2, "0")
    const mm = String(date.getMinutes()).padStart(2, "0")
    return `${hh}:${mm}`
  }
  const match = text.match(/T(\d\d:\d\d)/)
  return match ? match[1]! : text.slice(0, 5)
}

/**
 * One outcome vocabulary for the badge column. A row's hook is its source,
 * not an outcome, so it never appears here; it moves to the expanded detail.
 */
function rowBadge(row: Record<string, unknown>): string {
  const verdict = row.verdict
  if (typeof verdict === "string" && verdict.trim()) return verdict.toUpperCase()
  if (row.skipped != null && String(row.skipped).trim()) return "SKIPPED"
  const event = row.event
  if (typeof event === "string" && event.trim()) {
    return event.replace(/^supervisor[_-]/i, "").replace(/[_-]/g, " ").toUpperCase()
  }
  return "—"
}

/** A short, always-present label so a log row can never render blank. */
function rowSummary(row: Record<string, unknown>): string {
  const value = row.detail ?? row.subject ?? row.reason ?? row.error ?? row.skipped ?? row.tool ?? row.hook
  const text = value == null ? "" : String(value)
  return text || "jev event"
}

/** The lines a log row expands to. Everything here is already redacted server-side. */
function detailLines(row: Record<string, unknown>): Array<[string, string]> {
  const lines: Array<[string, string]> = []
  if (row.hook) lines.push(["Hook", String(row.hook)])
  if (row.event) lines.push(["Event", String(row.event)])
  if (row.subject) lines.push(["Subject", String(row.subject)])
  if (row.blocked) lines.push(["Blocked", String(row.blocked)])
  if (row.outcome) lines.push(["Outcome", String(row.outcome)])
  if (row.reason) lines.push(["Reason", String(row.reason)])
  if (row.error) lines.push(["Error", String(row.error)])
  if (row.skipped) lines.push(["Skipped", String(row.skipped)])
  if (row.decisions) lines.push(["Decisions", JSON.stringify(row.decisions)])
  if (row.rules) lines.push(["Rules", JSON.stringify(row.rules)])
  if (row.token) lines.push(["Token", String(row.token)])
  if (row.sessionID) {
    const id = String(row.sessionID)
    const title = typeof row.sessionTitle === "string" && row.sessionTitle.trim()
      ? ` (${row.sessionTitle})`
      : ""
    lines.push(["Session", `${id}${title}`])
  }
  lines.push(["Time", String(row.ts ?? "")])
  return lines
}

function JevView(props: { ctx: any; server: any; sessionID: string }) {
  const ui = props.ctx.ui
  const [state, setState] = createSignal({
    rows: [] as Array<Record<string, unknown>>,
    approvals: [] as Approval[],
    loading: true,
    busy: undefined as string | undefined,
    error: undefined as string | undefined,
    status: undefined as any,
  })
  const [expanded, setExpanded] = createSignal<number>()
  const [tab, setTab] = createSignal<"blocked" | "features" | "calls">("blocked")
  const [scope, setScope] = createSignal<"all" | "session">("all")
  const rpc = props.server.client.rpc(Contract)
  const controller = createJevView(
    {
      // The client wraps the method input as { input: ... }, so every method
      // takes an argument object. status/log/approvals take an empty one; an
      // omitted argument serializes to a missing body and fails validation.
      status: (input) => rpc.status(input),
      log: (input) => rpc.log(input),
      approvals: (input) => rpc.approvals(input),
      approve: (input) => rpc.approve(input),
      reject: (input) => rpc.reject(input),
      approveAll: (input) => rpc.approveAll(input),
      rejectAll: (input) => rpc.rejectAll(input),
      setEnabled: (input) => rpc.setEnabled(input),
      setFeature: (input) => rpc.setFeature(input),
      subscribe: (listener) => rpc.events.on("changed", (event: any) => listener({ reason: String(event?.data?.reason ?? "") })),
    },
    {
      update: setState,
      error: (description) => props.ctx.toast.show({ title: "Jev", description, variant: "error" }),
    },
  )
  onCleanup(controller.dispose)
  createEffect(() => void controller.load())

  const status = () => state().status
  const features = () => status()?.features ?? []
  const running = (key: string) => state().busy === key
  const recent = () => state().rows.slice(0, 15)
  const selectTab = (next: "blocked" | "features" | "calls") => {
    setTab(next)
    setExpanded(undefined)
  }
  const toggleScope = () => {
    const next = scope() === "all" ? "session" : "all"
    setScope(next)
    setExpanded(undefined)
    controller.setSessionFilter(next === "session" ? props.sessionID : undefined)
  }
  const runBulk = async (kind: "approveAll" | "rejectAll") => {
    const count = state().approvals.length
    if (kind === "approveAll") {
      const confirmed = await props.ctx.dialogs.confirm({
        title: `Approve all ${count} held calls?`,
        description: "Every call currently held by Jev gets a one-time grant.",
        confirm: "Approve all",
        cancel: "Cancel",
      })
      if (confirmed) await controller.approveAll()
    } else {
      const confirmed = await props.ctx.dialogs.confirm({
        title: `Reject all ${count} held calls?`,
        description: "Every call currently held by Jev is rejected. The calls stay in the log.",
        confirm: "Reject all",
        cancel: "Cancel",
        danger: true,
      })
      if (confirmed) await controller.rejectAll()
    }
  }

  return (
    <section class="fazuh-jev" aria-label="Jev">
      <Show when={state().loading && !status()}>
        <p role="status">Loading Jev…</p>
      </Show>
      <Show when={state().error}>
        <div class="fazuh-jev-alert" role="alert">
          <span>{state().error}</span>
          <ui.Button onClick={() => void controller.load()}>Retry</ui.Button>
        </div>
      </Show>

      <div class="fazuh-jev-nav">
        <span class="fazuh-jev-title">Jev</span>
        <Show when={status()}>
          <ui.Button
            variant="contrast"
            size="small"
            busy={running("enabled")}
            onClick={() => void controller.setEnabled(!status().enabled)}
          >
            {status().enabled ? "Turn Jev off" : "Turn Jev on"}
          </ui.Button>
        </Show>
      </div>

      <div class="fazuh-jev-tabs" role="group" aria-label="Jev sections">
        <button class="fazuh-jev-tab" aria-pressed={tab() === "blocked"} onClick={() => selectTab("blocked")}>
          Blocked<span class="fazuh-jev-tab-count">{state().approvals.length}</span>
        </button>
        <button class="fazuh-jev-tab" aria-pressed={tab() === "features"} onClick={() => selectTab("features")}>
          Features
        </button>
        <button class="fazuh-jev-tab" aria-pressed={tab() === "calls"} onClick={() => selectTab("calls")}>
          Calls
        </button>
      </div>

      <Show when={tab() === "blocked"}>
        <div class="fazuh-jev-section" style={{ flex: "1", "min-height": "0" }}>
          <Show when={state().approvals.length > 0}>
            <div class="fazuh-jev-bulk">
              <span class="fazuh-jev-bulk-label">{state().approvals.length} calls need you</span>
              <ui.Button
                variant="contrast"
                size="small"
                disabled={!!state().busy || state().approvals.length === 0}
                busy={running("approveAll")}
                onClick={() => void runBulk("approveAll")}
              >
                Approve all
              </ui.Button>
              <ui.Button
                variant="danger"
                size="small"
                disabled={!!state().busy || state().approvals.length === 0}
                busy={running("rejectAll")}
                onClick={() => void runBulk("rejectAll")}
              >
                Reject all
              </ui.Button>
            </div>
          </Show>
          <div class="fazuh-jev-approvals">
            <Show when={state().approvals.length > 0} fallback={<span class="fazuh-jev-empty">Nothing blocked</span>}>
              <For each={state().approvals}>
                {(approval) => (
                  <div class="fazuh-jev-approve">
                    <div class="fazuh-jev-approve-head">
                      <b>{approval.token}</b>
                      <span>{approval.action}</span>
                    </div>
                    <pre>{approval.subject}</pre>
                    <div class="fazuh-jev-actions">
                      <ui.Button
                        variant="contrast"
                        busy={running(`approve:${approval.token}`)}
                        onClick={() => void controller.approve(approval.token, approval.sessionID)}
                      >
                        Approve once
                      </ui.Button>
                      <ui.Button
                        busy={running(`reject:${approval.token}`)}
                        onClick={() => void controller.reject(approval.token)}
                      >
                        Reject
                      </ui.Button>
                    </div>
                  </div>
                )}
              </For>
            </Show>
          </div>
        </div>
      </Show>

      <Show when={tab() === "features"}>
        <div class="fazuh-jev-section">
          <strong>Features</strong>
          <For each={features()}>
            {(feature) => (
              <button
                class="fazuh-jev-row"
                data-on={feature.on}
                aria-pressed={feature.on}
                disabled={running(feature.key)}
                onClick={() => void controller.setFeature(feature.key, !feature.on)}
              >
                <span>
                  {feature.label}
                  <small>{feature.what}</small>
                </span>
                <span>{feature.on ? "on" : "off"}</span>
              </button>
            )}
          </For>
        </div>
      </Show>

      <Show when={tab() === "calls"}>
        <div class="fazuh-jev-section" style={{ flex: "1", "min-height": "0" }}>
          <div class="fazuh-jev-section-head">
            <strong>Recent calls</strong>
            <button
              class="fazuh-jev-link"
              aria-pressed={scope() === "session"}
              aria-label={scope() === "all" ? "Show recent calls for this session only" : "Show recent calls from all sessions"}
              title={scope() === "all" ? "Showing all sessions" : "Showing this session"}
              onClick={toggleScope}
            >
              {scope() === "all" ? "All sessions" : "This session"}
            </button>
          </div>
          <div class="fazuh-jev-log" role="log">
            <For
              each={recent()}
              fallback={
                <span role="status">
                  {scope() === "session" ? "No Jev calls in this session yet." : "No Jev calls logged yet."}
                </span>
              }
            >
              {(row, index) => (
                <div class="fazuh-jev-logitem">
                  <button
                    class="fazuh-jev-logrow"
                    aria-expanded={expanded() === index()}
                    onClick={() => setExpanded(expanded() === index() ? undefined : index())}
                  >
                    <span class="fazuh-jev-logtime">{clock(row.ts)}</span>
                    <span class="fazuh-jev-logverdict">{rowBadge(row)}</span>
                    <span class="fazuh-jev-logsubject">{rowSummary(row)}</span>
                  </button>
                  <Show when={expanded() === index()}>
                    <div class="fazuh-jev-detail">
                      <For each={detailLines(row)}>
                        {([key, value]) => (
                          <div class="fazuh-jev-detailitem">
                            <b>{key}</b>
                            <pre>{value}</pre>
                          </div>
                        )}
                      </For>
                    </div>
                  </Show>
                </div>
              )}
            </For>
          </div>
        </div>
      </Show>
    </section>
  )
}

export default Plugin.define({
  setup(ctx) {
    ctx.add(Style, CSS)
    ctx.add(Panel, {
      id: TAB.id,
      region: "side",
      mobile: { title: TAB.title, order: 51, kind: "menu", icon: "shield" },
      list: (input) => (input.open.includes(TAB.id) ? [TAB] : []),
      render: (props) => (
        <Show
          when={ctx.servers.get(props.session.server.id)}
          keyed
          fallback={<p role="status">Connecting to Jev…</p>}
        >
          {(server) => <JevView ctx={ctx} server={server} sessionID={props.session.id} />}
        </Show>
      ),
    })
    ctx.add(MenuItem, () => {
      const session = ctx.sessions.current()
      if (!session) return undefined
      return {
        menu: "session.panel" as const,
        id: TAB.id,
        title: TAB.title,
        icon: "shield" as const,
        opened: ctx.layout.state(`${ctx.id}:${TAB.id}`, session) !== "closed",
        run: () => ctx.layout.open(`${ctx.id}:${TAB.id}`, session),
      }
    })
  },
})
