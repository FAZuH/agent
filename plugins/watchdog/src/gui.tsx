import { For, Show, createEffect, createSignal, onCleanup } from "solid-js"
import { MenuItem, Panel, Plugin, Style } from "@opencode/plugin/gui"
import { createJevView, type Approval, type ToolBanInfo, type SettingsInfo } from "./gui-controller.ts"
import { Contract } from "../../../lib/jev/rpc.ts"
import { auditFieldLabel, groupLabel, settingMeta } from "../../../lib/jev/setting-meta.ts"
import { filterSettings } from "./gui-search.ts"

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
.fazuh-jev-empty { font-size: 12px; opacity: .6; padding: 12px 4px; text-align: center; }
.fazuh-jev-callcontrols { display: flex; align-items: center; gap: 8px; }
.fazuh-jev-filters { display: flex; gap: 6px; flex-shrink: 0; }
.fazuh-jev-select, .fazuh-jev-search { font-size: 12px; padding: 4px 6px; border: 1px solid var(--border-weak-base); border-radius: 6px; background: transparent; color: inherit; min-width: 0; }
.fazuh-jev-search { flex: 1 1 auto; }
.fazuh-jev-setting { display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%; text-align: start; padding: 9px 2px; border: 0; border-bottom: 1px solid var(--border-weak-base); background: transparent; color: inherit; font-size: 13px; }
.fazuh-jev-setting:last-child { border-bottom: 0; }
.fazuh-jev-setting:disabled { opacity: .6; cursor: default; }
.fazuh-jev-setting-text { min-width: 0; }
.fazuh-jev-setting-text strong { font-weight: 600; }
.fazuh-jev-setting-text small { display: block; opacity: .6; font-size: 11px; margin-top: 2px; }
.fazuh-jev-switch { flex: 0 0 auto; width: 30px; height: 17px; border-radius: 9px; background: var(--surface-base-hover); position: relative; transition: background .12s; }
.fazuh-jev-switch > span { position: absolute; top: 2px; left: 2px; width: 13px; height: 13px; border-radius: 50%; background: currentColor; transition: transform .12s; }
.fazuh-jev-setting[data-on=true] .fazuh-jev-switch { background: #e0a458; }
.fazuh-jev-setting[data-on=true] .fazuh-jev-switch > span { transform: translateX(13px); }
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
.fazuh-jev-tool-bans { display: flex; flex-direction: column; gap: 5px; padding: 6px 0; }
.fazuh-jev-tool-ban { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 8px; border: 1px solid var(--border-weak-base); border-radius: 6px; font-size: 12px; }
.fazuh-jev-tool-bans [data-component="settings-row"] { display: flex; align-items: center; flex-wrap: nowrap; gap: 16px; padding-block: 12px; border-bottom: .5px solid var(--v2-border-border-base, var(--border-weak-base)); }
.fazuh-jev-tool-bans [data-component="settings-row"]:last-child { border-bottom: 0; }
.fazuh-jev-tool-bans [data-slot="settings-row-copy"] { display: flex; flex-direction: column; flex: 1; gap: 8px; min-width: 0; }
.fazuh-jev-tool-bans [data-slot="settings-row-title"] { font-size: 13px; font-weight: 530; color: var(--v2-text-text-base, var(--text-strong)); }
.fazuh-jev-tool-bans [data-slot="settings-row-description"] { font-size: 13px; font-weight: 440; line-height: 20px; color: var(--v2-text-text-muted, var(--text-weak)); }
.fazuh-jev-tool-bans [data-slot="settings-row-control"] { display: flex; flex-shrink: 0; justify-content: flex-end; gap: 6px; }
.fazuh-jev-approve { display: flex; flex-direction: column; gap: 7px; border: 1px solid var(--border-weak-base); border-radius: 6px; padding: 9px 10px; }
.fazuh-jev-approve-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; font-size: 12px; }
.fazuh-jev-approve-head b { color: #e0a458; font-family: monospace; }
.fazuh-jev-approve pre { margin: 0; white-space: pre-wrap; word-break: break-word; font-family: inherit; font-size: 12px; opacity: .85; }
.fazuh-jev-settings { display: flex; flex-direction: column; gap: 32px; flex: 1; min-height: 0; overflow-y: auto; padding: 0 2px 24px; margin-top: -12px; }
.fazuh-jev-settings-header { position: sticky; top: 0; z-index: 1; display: flex; flex-direction: column; gap: 6px; padding: 0 0 8px; background: var(--v2-background-bg-base, var(--surface-base)); }
.fazuh-jev-settings-title { font-size: 15px; font-weight: 640; color: var(--v2-text-text-base, var(--text-strong)); }
.fazuh-jev-settings-subtitle { font-size: 13px; font-weight: 440; line-height: 20px; color: var(--v2-text-text-muted, var(--text-weak)); }
.fazuh-jev-settings-headrow { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.fazuh-jev-settings-searchrow { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.fazuh-jev-settings-search { box-sizing: border-box; width: 180px; height: 28px; padding-inline: 8px; border: 0; border-radius: 6px; box-shadow: var(--v2-elevation-input, inset 0 0 0 1px var(--border-weak-base)); background: var(--v2-background-bg-base, var(--surface-base)); color: inherit; font-size: 13px; }
.fazuh-jev-settings-search:focus-visible { outline: 2px solid var(--v2-border-border-focus, #e0a458); outline-offset: -1px; }
.fazuh-jev-settings-section { display: flex; flex-direction: column; gap: 16px; }
.fazuh-jev-settings-section-title { font-size: 13px; font-weight: 530; color: var(--v2-text-text-base, var(--text-strong)); }
.fazuh-jev-settings [data-component="settings-list"] { background: var(--v2-background-bg-layer-01, var(--surface-base)); box-shadow: inset 0 0 0 .5px var(--v2-border-border-muted, var(--border-weak-base)); border-radius: 8px; padding-inline: 20px; }
.fazuh-jev-settings [data-component="settings-row"] { display: flex; align-items: center; flex-wrap: nowrap; gap: 16px; padding-block: 20px; border-bottom: .5px solid var(--v2-border-border-base, var(--border-weak-base)); }
.fazuh-jev-settings [data-component="settings-row"]:last-child { border-bottom: 0; }
.fazuh-jev-settings [data-slot="settings-row-copy"] { display: flex; flex-direction: column; flex: 1; gap: 8px; min-width: 0; }
.fazuh-jev-settings [data-slot="settings-row-title"] { font-size: 13px; font-weight: 530; color: var(--v2-text-text-base, var(--text-strong)); }
.fazuh-jev-settings [data-slot="settings-row-description"] { font-size: 13px; font-weight: 440; line-height: 20px; color: var(--v2-text-text-muted, var(--text-weak)); }
.fazuh-jev-settings [data-slot="settings-row-control"] { display: flex; flex-shrink: 0; justify-content: flex-end; max-width: 100%; }
.fazuh-jev-settings [data-component="text-input-v2"], .fazuh-jev-settings [data-component="select-v2"] { box-sizing: border-box; width: 280px; height: 28px; padding-inline: 8px; border: 0; border-radius: 6px; box-shadow: var(--v2-elevation-input, inset 0 0 0 1px var(--border-weak-base)); background: var(--v2-background-bg-base, var(--surface-base)); color: inherit; font-size: 13px; }
.fazuh-jev-settings [data-component="text-input-v2"]:focus-visible, .fazuh-jev-settings [data-component="select-v2"]:focus-visible { outline: 2px solid var(--v2-border-border-focus, #e0a458); outline-offset: -1px; }
.fazuh-jev-settings input[type="checkbox"] { width: 16px; height: 16px; accent-color: #e0a458; }
.fazuh-jev-inline { display: flex; align-items: center; gap: 6px; }
.fazuh-jev-secret { display: flex; align-items: center; gap: 8px; }
.fazuh-jev-secret-state { font-size: 10px; text-transform: uppercase; letter-spacing: .04em; opacity: .7; color: #e0a458; min-width: 44px; }
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

import { rowBadge, rowSummary, filterRows, distinctHooks, distinctBadges } from "./gui-filter.ts"

/** Stable identity for a log row so expansion survives rows shifting. */
function rowKey(row: Record<string, unknown>): string {
  return [row.ts, row.hook, row.sessionID, row.tool, row.event, rowSummary(row)].join("|")
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
  if (row.rawVerdict) lines.push([auditFieldLabel("rawVerdict"), String(row.rawVerdict)])
  if (row.decisionNote) lines.push([auditFieldLabel("decisionNote"), String(row.decisionNote)])
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

function FieldRow(props: { title: string; description: string; children: any }) {
  return (
    <div data-component="settings-row" data-align="center">
      <div data-slot="settings-row-copy">
        <div data-slot="settings-row-title">{props.title}</div>
        <div data-slot="settings-row-description">{props.description}</div>
      </div>
      <div data-slot="settings-row-control">{props.children}</div>
    </div>
  )
}

function BoolField(props: { title: string; description: string; checked: boolean; onToggle: () => void }) {
  return (
    <FieldRow title={props.title} description={props.description}>
      <input type="checkbox" aria-label={props.title} checked={props.checked} onChange={props.onToggle} />
    </FieldRow>
  )
}

function SelectField(props: { title: string; description: string; value: string; options: Array<[string, string]>; onSelect: (v: string) => void }) {
  return (
    <FieldRow title={props.title} description={props.description}>
      <select
        data-component="select-v2"
        aria-label={props.title}
        value={props.value}
        onChange={(event) => props.onSelect(event.currentTarget.value)}
      >
        <For each={props.options}>{([value, label]) => <option value={value}>{label}</option>}</For>
      </select>
    </FieldRow>
  )
}

function TextField(props: { ui: any; title: string; description: string; value: string | number; onSave: (v: string) => void; kind?: "text" | "number" }) {
  const Button = props.ui.Button
  const [draft, setDraft] = createSignal(String(props.value ?? ""))
  const commit = () => props.onSave(draft())
  return (
    <FieldRow title={props.title} description={props.description}>
      <div class="fazuh-jev-inline">
        <input
          data-component="text-input-v2"
          type={props.kind ?? "text"}
          aria-label={props.title}
          value={draft()}
          onInput={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={(event) => { if (event.key === "Enter") commit() }}
        />
        <Button size="small" onClick={commit}>Save</Button>
      </div>
    </FieldRow>
  )
}

/** A credential is never read back: the password field starts empty and is
 *  cleared after saving. Only a presence flag is shown. */
function SecretField(props: { ui: any; title: string; description: string; present: boolean; onSave: (v: string) => void }) {
  const Button = props.ui.Button
  const [draft, setDraft] = createSignal("")
  const save = () => {
    const value = draft()
    if (!value.trim()) return
    props.onSave(value)
    setDraft("")
  }
  return (
    <FieldRow title={props.title} description={props.description}>
      <div class="fazuh-jev-secret">
        <small class="fazuh-jev-secret-state">{props.present ? "set" : "MISSING"}</small>
        <div class="fazuh-jev-inline">
          <input
            type="password"
            data-component="text-input-v2"
            aria-label={`New ${props.title}`}
            placeholder={props.present ? "replace" : "paste value"}
            value={draft()}
            onInput={(event) => setDraft(event.currentTarget.value)}
            onKeyDown={(event) => { if (event.key === "Enter") save() }}
          />
          <Button size="small" onClick={save}>Save</Button>
        </div>
      </div>
    </FieldRow>
  )
}

function JevView(props: { ctx: any; server: any; sessionID: string }) {
  const ui = props.ctx.ui
  const [state, setState] = createSignal({
    rows: [] as Array<Record<string, unknown>>,
    approvals: [] as Approval[],
    toolBans: [] as ToolBanInfo[],
    loading: true,
    busy: undefined as string | undefined,
    error: undefined as string | undefined,
    status: undefined as any,
    settings: undefined as SettingsInfo | undefined,
  })
  const [expanded, setExpanded] = createSignal<string>()
  const [tab, setTab] = createSignal<"blocked" | "features" | "calls" | "settings">("blocked")
  const [scope, setScope] = createSignal<"all" | "session">("all")
  const [hookFilter, setHookFilter] = createSignal("all")
  const [badgeFilter, setBadgeFilter] = createSignal("all")
  const [query, setQuery] = createSignal("")
  const [settingsQuery, setSettingsQuery] = createSignal("")
  const [limit, setLimit] = createSignal(15)
  const [paused, setPaused] = createSignal(false)
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
      getSettings: (input) => rpc.getSettings(input),
      setSetting: (input) => rpc.setSetting(input),
      setSecret: (input) => rpc.setSecret(input),
      listToolBans: (input) => rpc.listToolBans(input),
      stopSession: (input) => rpc.stopSession(input),
      liftToolBan: (input) => rpc.liftToolBan(input),
      liftToolBanAndResume: (input) => rpc.liftToolBanAndResume(input),
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
  const settings = () => state().settings
  const features = () => status()?.features ?? []
  const running = (key: string) => state().busy === key
  const recent = () =>
    filterRows(state().rows, { hook: hookFilter(), badge: badgeFilter(), query: query() }).slice(0, limit())
  const hooks = () => distinctHooks(state().rows)
  const badges = () => distinctBadges(state().rows)
  const changeFilter = (next: () => void) => {
    next()
    setExpanded(undefined)
  }
  createEffect(() => {
    const availableHooks = hooks()
    const availableBadges = badges()
    let changed = false
    if (hookFilter() !== "all" && !availableHooks.includes(hookFilter())) {
      setHookFilter("all")
      changed = true
    }
    if (badgeFilter() !== "all" && !availableBadges.includes(badgeFilter())) {
      setBadgeFilter("all")
      changed = true
    }
    if (changed) setExpanded(undefined)
  })
  const selectTab = (next: "blocked" | "features" | "calls" | "settings") => {
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
        <button class="fazuh-jev-tab" aria-pressed={tab() === "settings"} onClick={() => selectTab("settings")}>
          Settings
        </button>
      </div>

      <Show when={tab() === "blocked"}>
        <div class="fazuh-jev-section" style={{ flex: "1", "min-height": "0" }}>
          <Show when={state().approvals.length > 0 || state().toolBans.length > 0}>
            <div class="fazuh-jev-bulk">
              <span class="fazuh-jev-bulk-label">{state().approvals.length} calls need you</span>
              <Show when={state().approvals[0]?.sessionID}>
                <ui.Button
                  size="small"
                  disabled={!!state().busy}
                  busy={running(`liftToolBan:${state().approvals[0]!.sessionID}`)}
                  onClick={() => void controller.liftToolBan(state().approvals[0]!.sessionID)}
                >
                  Lift tool ban
                </ui.Button>
              </Show>
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
                      <ui.Button
                        variant="danger"
                        size="small"
                        disabled={!!state().busy}
                        busy={running(`stop:${approval.sessionID}`)}
                        onClick={() => void controller.stopSession(approval.sessionID)}
                      >
                        Stop session
                      </ui.Button>
                    </div>
                  </div>
                )}
              </For>
            </Show>
          </div>
          <Show when={state().toolBans.length > 0}>
            <div class="fazuh-jev-tool-bans">
              <span class="fazuh-jev-bulk-label">Tool bans</span>
              <For each={state().toolBans}>
                {(toolBan) => (
                  <div class="fazuh-jev-tool-ban" data-component="settings-row">
                    <div data-slot="settings-row-copy">
                      <div data-slot="settings-row-title">Tool ban · {toolBan.sessionID}{toolBan.tool ? ` · ${toolBan.tool}` : ""}</div>
                      <div data-slot="settings-row-description">Tool calls are blocked in this session. Lifting the ban also clears its session ban.</div>
                    </div>
                    <div data-slot="settings-row-control" class="fazuh-jev-actions">
                      <ui.Button
                        size="small"
                        variant="contrast"
                        disabled={!!state().busy}
                        busy={running(`liftToolBan:${toolBan.sessionID}`)}
                        onClick={() => void controller.liftToolBan(toolBan.sessionID)}
                      >
                        Lift tool ban
                      </ui.Button>
                      <ui.Button
                        size="small"
                        disabled={!!state().busy}
                        busy={running(`liftToolBanAndResume:${toolBan.sessionID}`)}
                        onClick={() => void controller.liftToolBanAndResume(toolBan.sessionID)}
                      >
                        Lift tool ban & resume
                      </ui.Button>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>
      </Show>

      <Show when={tab() === "features"}>
        <div class="fazuh-jev-section">
          <strong>Features</strong>
          <For each={features()}>
            {(feature) => (
              <button
                class="fazuh-jev-setting"
                role="switch"
                data-on={feature.on}
                aria-pressed={feature.on}
                aria-checked={feature.on}
                aria-label={feature.label}
                disabled={running(feature.key)}
                onClick={() => void controller.setFeature(feature.key, !feature.on)}
              >
                <span class="fazuh-jev-setting-text">
                  <strong>{feature.label}</strong>
                  <small>{feature.what}</small>
                </span>
                <span class="fazuh-jev-switch" aria-hidden="true"><span /></span>
              </button>
            )}
          </For>
        </div>
      </Show>

      <Show when={tab() === "calls"}>
        <div class="fazuh-jev-section" style={{ flex: "1", "min-height": "0" }}>
          <div class="fazuh-jev-section-head">
            <strong>Recent calls</strong>
            <div class="fazuh-jev-callcontrols">
              <button
                class="fazuh-jev-link"
                aria-pressed={paused()}
                aria-label={paused() ? "Live updates are paused" : "Live updates are on"}
                title={paused() ? "Live updates paused" : "Live updates on"}
                onClick={() => {
                  const next = !paused()
                  setPaused(next)
                  controller.setPaused(next)
                }}
              >
                {paused() ? "Paused" : "Live"}
              </button>
              <Show when={paused()}>
                <button class="fazuh-jev-link" onClick={() => controller.refresh()}>Refresh</button>
              </Show>
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
          </div>
          <div class="fazuh-jev-filters">
            <select
              class="fazuh-jev-select"
              aria-label="Filter by hook"
              value={hookFilter()}
              onChange={(event) => changeFilter(() => setHookFilter(event.currentTarget.value))}
            >
              <option value="all">All hooks</option>
              <For each={hooks()}>{(value) => <option value={value}>{value}</option>}</For>
            </select>
            <select
              class="fazuh-jev-select"
              aria-label="Filter by outcome"
              value={badgeFilter()}
              onChange={(event) => changeFilter(() => setBadgeFilter(event.currentTarget.value))}
            >
              <option value="all">All outcomes</option>
              <For each={badges()}>{(value) => <option value={value}>{value}</option>}</For>
            </select>
            <input
              class="fazuh-jev-search"
              aria-label="Search calls"
              placeholder="Search calls"
              value={query()}
              onInput={(event) => changeFilter(() => setQuery(event.currentTarget.value))}
            />
            <select
              class="fazuh-jev-select"
              aria-label="Rows to show"
              value={String(limit())}
              onChange={(event) => {
                const n = Number(event.currentTarget.value)
                setLimit(n)
                controller.setLimit(n)
                setExpanded(undefined)
              }}
            >
              <For each={[15, 30, 50, 100]}>{(n) => <option value={String(n)}>{`Last ${n}`}</option>}</For>
            </select>
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
              {(row) => (
                <div class="fazuh-jev-logitem">
                  <button
                    class="fazuh-jev-logrow"
                    aria-expanded={expanded() === rowKey(row)}
                    onClick={() => setExpanded(expanded() === rowKey(row) ? undefined : rowKey(row))}
                  >
                    <span class="fazuh-jev-logtime">{clock(row.ts)}</span>
                    <span class="fazuh-jev-logverdict">{rowBadge(row)}</span>
                    <span class="fazuh-jev-logsubject">{rowSummary(row)}</span>
                  </button>
                  <Show when={expanded() === rowKey(row)}>
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

      <Show when={tab() === "settings"}>
        <div class="fazuh-jev-settings" role="group" aria-label="Jev settings">
          <div class="fazuh-jev-settings-header">
            <div class="fazuh-jev-settings-headrow">
              <div>
                <div class="fazuh-jev-settings-title">Settings</div>
                <div class="fazuh-jev-settings-subtitle">Connection, secrets, and per-feature settings.</div>
              </div>
              <div class="fazuh-jev-settings-searchrow">
                <input
                  class="fazuh-jev-settings-search"
                  type="search"
                  aria-label="Search settings"
                  placeholder="Search settings"
                  value={settingsQuery()}
                  onInput={(event) => setSettingsQuery(event.currentTarget.value)}
                />
                <Show when={settingsQuery().length > 0}>
                  <ui.Button size="small" onClick={() => setSettingsQuery("")}>Clear</ui.Button>
                </Show>
              </div>
            </div>
          </div>
          <Show when={settings()} keyed fallback={<span class="fazuh-jev-empty">Loading settings…</span>}>
            {(cfg) => {
              const putState = (key: string, value: boolean | string | number) =>
                void controller.setSetting({ scope: "state", key, value })
              const putFeature = (feature: string, key: string, value: boolean | string | number) =>
                void controller.setSetting({ scope: "feature", feature, key, value })
              const filtered = () => filterSettings(settingsQuery(), cfg.config)
              return (
                <>
                  <Show when={filtered().connection.length > 0}>
                    <div class="fazuh-jev-settings-section">
                      <div class="fazuh-jev-settings-section-title">Connection</div>
                      <div data-component="settings-list">
                        <Show when={filtered().connection.includes("protocol")}>
                          <SelectField
                            title="Protocol"
                            description="How Jev is asked for a decision."
                            value={cfg.protocol}
                            options={[["systemone", "System One"], ["chat", "Chat"], ["opencode", "OpenCode"]]}
                            onSelect={(v) => putState("protocol", v)}
                          />
                        </Show>
                        <Show when={filtered().connection.includes("think")}>
                          <BoolField title="Thinking" description="Whether the model reasons before it answers." checked={cfg.think} onToggle={() => putState("think", !cfg.think)} />
                        </Show>
                        <Show when={filtered().connection.includes("model")}>
                          <TextField ui={ui} title="Model" description="The provider's wire model id." value={cfg.model} onSave={(v) => putState("model", v)} />
                        </Show>
                        <Show when={filtered().connection.includes("keyEnv")}>
                          <TextField ui={ui} title="Key env vars" description="Comma-separated env var names, checked in order before the key file." value={cfg.keyEnv} onSave={(v) => putState("keyEnv", v)} />
                        </Show>
                        <Show when={filtered().connection.includes("keyFile")}>
                          <TextField ui={ui} title="Key file" description="Key file, read when no env var matched." value={cfg.keyFile} onSave={(v) => putState("keyFile", v)} />
                        </Show>
                        <Show when={filtered().connection.includes("yoloAsk")}>
                          <SelectField
                            title="YOLO propagate"
                            description="What a propagate verdict does while the client auto-accepts."
                            value={cfg.yoloAsk}
                            options={[["block-notify", "Block and notify"], ["no-op", "No-op"]]}
                            onSelect={(v) => putState("yoloAsk", v)}
                          />
                        </Show>
                        <Show when={filtered().connection.includes("approveTtl")}>
                          <TextField ui={ui} title="Approval TTL" description="Seconds a blocked call stays approvable." value={cfg.approveTtl} kind="number" onSave={(v) => putState("approveTtl", Number(v))} />
                        </Show>
                        <Show when={filtered().connection.includes("sidebar")}>
                          <BoolField title="Sidebar" description="Whether the sidebar shows recent hook calls." checked={cfg.sidebar} onToggle={() => putState("sidebar", !cfg.sidebar)} />
                        </Show>
                        <Show when={filtered().connection.includes("sidebarCount")}>
                          <TextField ui={ui} title="Sidebar calls" description="How many recent calls the sidebar shows." value={cfg.sidebarCount} kind="number" onSave={(v) => putState("sidebarCount", Number(v))} />
                        </Show>
                        <Show when={filtered().connection.includes("sidebarSubject")}>
                          <BoolField title="Sidebar subjects" description="Whether each sidebar line carries a clipped subject." checked={cfg.sidebarSubject} onToggle={() => putState("sidebarSubject", !cfg.sidebarSubject)} />
                        </Show>
                        <Show when={filtered().connection.includes("toast")}>
                          <BoolField title="Toast calls" description="Master switch for toasts; off means no call is announced." checked={cfg.toast} onToggle={() => putState("toast", !cfg.toast)} />
                        </Show>
                        <Show when={filtered().connection.includes("logMax")}>
                          <TextField ui={ui} title="Log cap" description="Call-log cap; older lines are pruned to keep this many." value={cfg.logMax} kind="number" onSave={(v) => putState("logMax", Number(v))} />
                        </Show>
                      </div>
                    </div>
                  </Show>

                  <Show when={filtered().secrets.length > 0}>
                    <div class="fazuh-jev-settings-section">
                      <div class="fazuh-jev-settings-section-title">Secrets</div>
                      <div data-component="settings-list">
                        <Show when={filtered().secrets.includes("apiKey")}>
                          <SecretField ui={ui} title="API key" description="Provider key. Write-only: it is never read back." present={cfg.secrets.keyPresent} onSave={(v) => void controller.setSecret({ key: "apiKey", value: v })} />
                        </Show>
                        <Show when={filtered().secrets.includes("alertWebhook")}>
                          <SecretField ui={ui} title="Alert webhook" description="Discord webhook for alerts; empty turns it off." present={cfg.secrets.webhookPresent} onSave={(v) => void controller.setSecret({ key: "alertWebhook", value: v })} />
                        </Show>
                        <Show when={filtered().secrets.includes("endpoint")}>
                          <SecretField ui={ui} title="Endpoint" description="Full URL of the decisions or chat endpoint." present={cfg.secrets.endpointPresent} onSave={(v) => putState("endpoint", v)} />
                        </Show>
                        <Show when={filtered().secrets.includes("supervisorEndpoint")}>
                          <SecretField
                            ui={ui}
                            title="Supervisor endpoint"
                            description="Endpoint for the supervisor's review call."
                            present={cfg.secrets.supervisorEndpointPresent}
                            onSave={(v) => putFeature("hook_supervisor", "endpoint", v)}
                          />
                        </Show>
                      </div>
                    </div>
                  </Show>

                  <For each={Object.entries(cfg.config)}>
                    {([feature, fields]) => {
                      const matchedKeys = () => filtered().groups.find((group) => group.feature === feature)?.fields.map((field) => field.key) ?? []
                      const visible = () => Object.entries(fields).filter(([k]) => k !== "alertWebhook" && !(feature === "hook_supervisor" && k === "endpoint") && matchedKeys().includes(k))
                      return (
                        <Show when={visible().length > 0}>
                          <div class="fazuh-jev-settings-section">
                            <div class="fazuh-jev-settings-section-title">{groupLabel(feature)}</div>
                            <div data-component="settings-list">
                              <For each={visible()}>
                                {([key, value]) => {
                                  const meta = settingMeta(feature, key)
                                  return typeof value === "boolean" ? (
                                    <BoolField title={meta.label} description={meta.description} checked={value} onToggle={() => putFeature(feature, key, !value)} />
                                  ) : typeof value === "number" ? (
                                    <TextField ui={ui} title={meta.label} description={meta.description} value={value} kind="number" onSave={(v) => putFeature(feature, key, Number(v))} />
                                  ) : (
                                    <TextField ui={ui} title={meta.label} description={meta.description} value={value} onSave={(v) => putFeature(feature, key, v)} />
                                  )
                                }}
                              </For>
                            </div>
                          </div>
                        </Show>
                      )
                    }}
                  </For>

                  <Show when={filtered().empty}>
                    <span class="fazuh-jev-empty">No settings match the search.</span>
                  </Show>
                </>
              )
            }}
          </Show>
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
