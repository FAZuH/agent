import { For, Show, createEffect, createSignal, onCleanup } from "solid-js"
import { MenuItem, Panel, Plugin, Style } from "@opencode/plugin/gui"
import { createPromptView, tabOf, type PromptTab, type PromptViewState } from "./gui-controller.ts"
import { Contract, DEFAULT_SETTINGS, type SettingKey } from "./rpc.ts"
import { ago, groupBySession, markdownOf, needsAnswer, titleOf, type Prompt } from "./shared.ts"

const TAB = { id: "prompt-view-v2", title: "Prompts", closable: "compact" as const }
const TABS: { key: PromptTab; label: string }[] = [
  { key: "awaiting", label: "Awaiting" },
  { key: "answered", label: "Answered" },
  { key: "dismissed", label: "Dismissed" },
  { key: "settings", label: "Settings" },
]
const SETTING_ROWS: { key: SettingKey; label: string; note: string }[] = [
  { key: "sidebar", label: "Sidebar", note: "Master visibility toggle" },
  { key: "showPrompts", label: "Prompts", note: "Prompts section" },
]
const CSS = `
.fazuh-prompts {
  --state-await: var(--v2-state-warning-fg, var(--text-base));
  --state-answered: var(--v2-state-success-fg, var(--text-base));
  --state-dismissed: var(--text-weak);
  display: flex; flex-direction: column; gap: 10px; height: 100%; min-height: 0; min-width: 0; padding: 12px; overflow-wrap: anywhere; font-size: 13px;
}
.fazuh-prompts button { cursor: pointer; }
.fazuh-prompts button:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
.fazuh-prompts button:disabled { cursor: not-allowed; }
.fazuh-prompts-alert { display: flex; gap: 8px; align-items: center; }
.fazuh-prompts-loading { display: flex; align-items: center; }
.fazuh-prompts-head { display: flex; flex-direction: column; gap: 2px; flex-shrink: 0; }
.fazuh-prompts-head strong { font-size: 14px; font-weight: 600; }
.fazuh-prompts-head span { opacity: .7; font-size: 13px; }
.fazuh-prompts-sessions { display: flex; gap: 6px; flex-wrap: wrap; flex-shrink: 0; }
.fazuh-prompts-chip { display: flex; align-items: center; gap: 6px; padding: 4px 9px; border: 1px solid var(--border-weak-base); border-radius: 999px; background: transparent; color: inherit; font-size: 13px; }
.fazuh-prompts-chip[aria-pressed=true] { border-color: currentColor; background: var(--surface-base-hover); }
.fazuh-prompts-chip i { font-style: normal; opacity: .7; font-size: 13px; }
.fazuh-prompts-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; background: var(--state-dismissed); }
.fazuh-prompts-dot[data-state=awaiting] { background: var(--state-await); }
.fazuh-prompts-dot[data-state=answered] { background: var(--state-answered); }
.fazuh-prompts-dot[data-state=dismissed] { background: var(--state-dismissed); }
.fazuh-prompts-tabs { display: flex; gap: 2px; border-bottom: 1px solid var(--border-weak-base); flex-shrink: 0; }
.fazuh-prompts-tab { display: flex; align-items: center; gap: 6px; padding: 6px 10px; border: 0; border-bottom: 2px solid transparent; background: transparent; color: var(--text-weak); font-size: 13px; }
.fazuh-prompts-tab[aria-pressed=true] { color: var(--text-strong); border-bottom-color: var(--state-await); }
.fazuh-prompts-tab i { font-style: normal; opacity: .7; font-size: 13px; }
.fazuh-prompts-bulk { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border: 1px solid var(--border-weak-base); border-radius: 6px; flex-shrink: 0; }
.fazuh-prompts-bulk > span { margin-right: auto; color: var(--state-await); font-weight: 600; font-size: 13px; }
.fazuh-prompts-list { display: flex; flex-direction: column; gap: 8px; flex: 1; min-height: 0; overflow-y: auto; border: 1px solid var(--border-weak-base); border-radius: 6px; padding: 8px; }
.fazuh-prompts-card { display: flex; flex-direction: column; gap: 5px; padding: 10px; border: 1px solid var(--border-weak-base); border-radius: 6px; background: var(--surface-base); }
.fazuh-prompts-card-title { font-size: 13px; font-weight: 600; }
.fazuh-prompts-card-preview { font-size: 13px; opacity: .8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fazuh-prompts-card-meta { font-size: 13px; opacity: .65; }
.fazuh-prompts-actions { display: flex; gap: 7px; justify-content: flex-end; flex-shrink: 0; }
.fazuh-prompts-detail { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 10px; }
.fazuh-prompts-detail-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; flex-shrink: 0; }
.fazuh-prompts-detail-head strong { font-size: 14px; font-weight: 600; }
.fazuh-prompts-badge { font-size: 13px; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--border-weak-base); white-space: nowrap; flex-shrink: 0; }
.fazuh-prompts-badge[data-state=awaiting] { color: var(--state-await); border-color: var(--state-await); }
.fazuh-prompts-badge[data-state=answered] { color: var(--state-answered); border-color: var(--state-answered); }
.fazuh-prompts-badge[data-state=dismissed] { color: var(--state-dismissed); border-color: var(--state-dismissed); }
.fazuh-prompts-session-line { font-size: 13px; opacity: .7; flex-shrink: 0; }
.fazuh-prompts-content { flex: 1; min-height: 0; overflow: auto; border: 1px solid var(--border-weak-base); border-radius: 6px; padding: 8px 10px; }
.fazuh-prompts-settings { display: flex; flex-direction: column; gap: 32px; flex: 1; min-height: 0; overflow-y: auto; }
.fazuh-prompts-settings-header { position: sticky; top: 0; z-index: 1; display: flex; flex-direction: column; gap: 6px; padding-block: 8px; background: var(--v2-background-bg-base, var(--surface-base)); }
.fazuh-prompts-settings-title { font-size: 15px; font-weight: 640; color: var(--v2-text-text-base, var(--text-strong)); }
.fazuh-prompts-settings-subtitle { font-size: 13px; font-weight: 440; line-height: 20px; color: var(--v2-text-text-muted, var(--text-weak)); }
.fazuh-prompts-settings-section { display: flex; flex-direction: column; gap: 16px; }
.fazuh-prompts-settings-section-title { font-size: 13px; font-weight: 530; color: var(--v2-text-text-base, var(--text-strong)); }
.fazuh-prompts-settings [data-component="settings-list"] { background: var(--v2-background-bg-layer-01, var(--surface-base)); box-shadow: inset 0 0 0 .5px var(--v2-border-border-muted, var(--border-weak-base)); border-radius: 8px; padding-inline: 20px; }
.fazuh-prompts-settings [data-component="settings-row"] { display: flex; align-items: center; gap: 16px; width: 100%; padding-block: 20px; border: 0; border-bottom: .5px solid var(--v2-border-border-base, var(--border-weak-base)); background: transparent; color: inherit; text-align: left; font-size: 13px; }
.fazuh-prompts-settings [data-component="settings-row"]:last-child { border-bottom: 0; }
.fazuh-prompts-setting-text { display: flex; flex-direction: column; flex: 1; gap: 8px; min-width: 0; }
.fazuh-prompts-setting-text strong { font-size: 13px; font-weight: 530; color: var(--v2-text-text-base, var(--text-strong)); }
.fazuh-prompts-setting-text small { font-size: 13px; font-weight: 440; line-height: 20px; color: var(--v2-text-text-muted, var(--text-weak)); }
.fazuh-prompts-settings [data-slot="settings-row-control"] { display: flex; flex-shrink: 0; justify-content: flex-end; }
.fazuh-prompts-switch { width: 30px; height: 16px; border-radius: 999px; border: 1px solid var(--border-weak-base); background: var(--surface-base-hover); position: relative; flex-shrink: 0; }
.fazuh-prompts-switch > span { position: absolute; top: 1px; left: 1px; width: 12px; height: 12px; border-radius: 50%; background: var(--text-weak); transition: transform .12s ease; }
.fazuh-prompts-setting[data-on=true] .fazuh-prompts-switch { border-color: var(--state-await); background: var(--state-await); }
.fazuh-prompts-setting[data-on=true] .fazuh-prompts-switch > span { transform: translateX(14px); background: var(--surface-base); }
`

function shortTitle(value: string): string {
  return value.length > 28 ? `${value.slice(0, 27)}…` : value
}

function labelOf(key: PromptTab): string | undefined {
  return TABS.find((item) => item.key === key)?.label
}

function previewOf(prompt: Prompt): string {
  const question = prompt.prompts?.questions?.[0]?.body
  const procedure = prompt.prompts?.procedures?.[0]
  return (question || procedure?.description || procedure?.steps?.[0] || prompt.description || titleOf(prompt)).trim()
}

function PromptsView(props: { ctx: any; session: any; server: any }) {
  const ui = props.ctx.ui
  const [state, setState] = createSignal<PromptViewState>({ prompts: [], loading: true, settings: DEFAULT_SETTINGS })
  const [active, setActive] = createSignal<string>()
  const [tab, setTab] = createSignal<PromptTab>("awaiting")
  const [viewing, setViewing] = createSignal<string>()
  const [busy, setBusy] = createSignal(false)
  const rpc = props.server.client.rpc(Contract)
  const view = createPromptView(
    {
      list: (input) => rpc.list(input),
      reopen: (input) => rpc.reopen(input),
      dismiss: (input) => rpc.dismiss(input),
      dismissAll: (input) => rpc.dismissAll(input),
      getSettings: () => rpc.getSettings({}),
      setSetting: (input) => rpc.setSetting(input),
      subscribe: (listener) => rpc.events.on("changed", (event: any) => listener(event.data)),
    },
    {
      update: setState,
      error: (description) =>
        props.ctx.toast.show({ title: "Prompt", description, variant: "error" }),
    },
  )
  onCleanup(view.dispose)
  void view.loadSettings()

  const family = () => {
    const id = props.session.id
    const ids = props.server.data.session.family(id)
    return Array.isArray(ids) && ids.length ? ids : [id]
  }
  createEffect(() => {
    void view.load(family())
  })

  const groups = () =>
    groupBySession(state().prompts).sort(
      (a, b) =>
        Number(b.prompts.some((prompt) => tabOf(prompt) === "awaiting")) -
          Number(a.prompts.some((prompt) => tabOf(prompt) === "awaiting")) ||
        (b.prompts.at(-1)?.at ?? 0) - (a.prompts.at(-1)?.at ?? 0),
    )
  const group = () => groups().find((item) => item.sessionID === active()) ?? groups()[0]
  const counts = (): Record<PromptTab, number> => {
    const list = (group()?.prompts ?? []).map(tabOf)
    return {
      awaiting: list.filter((item) => item === "awaiting").length,
      answered: list.filter((item) => item === "answered").length,
      dismissed: list.filter((item) => item === "dismissed").length,
      settings: 0,
    }
  }
  const familyAwaiting = () => state().prompts.filter((prompt) => tabOf(prompt) === "awaiting").length
  const tabPrompts = () =>
    (group()?.prompts ?? [])
      .filter((prompt) => tabOf(prompt) === tab())
      .slice()
      .sort((a, b) => b.at - a.at)
  const viewed = () => state().prompts.find((prompt) => prompt.id === viewing())

  createEffect(() => {
    if (viewing() && !viewed()) setViewing(undefined)
  })

  const title = (id: string) => props.server.data.session.get(id)?.title || id
  const act = async (action: () => Promise<void>) => {
    if (busy()) return
    setBusy(true)
    try {
      await action()
    } finally {
      setBusy(false)
    }
  }

  const dismissPrompt = async (prompt: Prompt) => {
    const confirmed = await props.ctx.dialogs.confirm({
      title: "Dismiss this prompt?",
      description: "The prompt is marked dismissed. The record stays.",
      confirm: "Dismiss",
      cancel: "Cancel",
      danger: true,
    })
    if (confirmed) await view.dismiss(prompt.sessionID, prompt.id)
  }

  return (
    <section class="fazuh-prompts" aria-label="Prompts">
      <Show when={state().loading}>
        <div class="fazuh-prompts-loading">
          <ui.Loader size="large" />
        </div>
      </Show>
      <Show when={state().error}>
        <div class="fazuh-prompts-alert" role="alert">
          <span>{state().error}</span>
          <ui.Button onClick={() => void view.load(family())}>Retry</ui.Button>
        </div>
      </Show>

      <Show when={!state().loading}>
        <Show
          when={viewed()}
          fallback={
            <>
              <Show when={groups().length > 0 && tab() !== "settings"}>
                <div class="fazuh-prompts-head">
                  <strong>{title(group()?.sessionID ?? "")}</strong>
                  <span>
                    {group()?.prompts.length} prompts · {counts().awaiting} awaiting
                  </span>
                </div>

                <Show when={groups().length > 1}>
                  <div class="fazuh-prompts-sessions" role="group" aria-label="Sessions">
                    <For each={groups()}>
                      {(item) => (
                        <button
                          class="fazuh-prompts-chip"
                          aria-pressed={group()?.sessionID === item.sessionID}
                          onClick={() => setActive(item.sessionID)}
                        >
                          {shortTitle(title(item.sessionID))}
                          <Show when={item.prompts.some((prompt) => tabOf(prompt) === "awaiting")}>
                            <i class="fazuh-prompts-dot" data-state="awaiting" />
                            {item.prompts.filter((prompt) => tabOf(prompt) === "awaiting").length}
                          </Show>
                        </button>
                      )}
                    </For>
                  </div>
                </Show>
              </Show>

              <div class="fazuh-prompts-tabs" role="group" aria-label="Prompt state">
                <For each={TABS}>
                  {(item) => (
                    <button
                      class="fazuh-prompts-tab"
                      aria-pressed={tab() === item.key}
                      onClick={() => setTab(item.key)}
                    >
                      {item.label}
                      <Show when={item.key !== "settings"}>
                        <i>{counts()[item.key]}</i>
                      </Show>
                    </button>
                  )}
                </For>
              </div>

              <Show when={tab() === "settings"}>
                <div class="fazuh-prompts-settings" role="group" aria-label="Prompt settings">
                  <div class="fazuh-prompts-settings-header">
                    <div class="fazuh-prompts-settings-title">Settings</div>
                    <div class="fazuh-prompts-settings-subtitle">Control which prompt sections appear.</div>
                  </div>
                  <div class="fazuh-prompts-settings-section">
                    <div class="fazuh-prompts-settings-section-title">Panel visibility</div>
                    <div data-component="settings-list">
                      <For each={SETTING_ROWS}>
                        {(row) => (
                          <button
                            class="fazuh-prompts-setting"
                            data-component="settings-row"
                            role="switch"
                            data-on={state().settings?.[row.key] !== false}
                            aria-checked={state().settings?.[row.key] !== false}
                            aria-label={row.label}
                            disabled={busy()}
                            onClick={() =>
                              void act(() => view.setSetting(row.key, state().settings?.[row.key] === false))
                            }
                          >
                            <span class="fazuh-prompts-setting-text" data-slot="settings-row-copy">
                              <strong data-slot="settings-row-title">{row.label}</strong>
                              <small data-slot="settings-row-description">{row.note}</small>
                            </span>
                            <span data-slot="settings-row-control">
                              <span class="fazuh-prompts-switch" aria-hidden="true">
                                <span />
                              </span>
                            </span>
                          </button>
                        )}
                      </For>
                    </div>
                  </div>
                </div>
              </Show>

              <Show when={tab() !== "settings"}>
                <Show when={groups().length > 0} fallback={<p role="status">No prompts yet.</p>}>
                  <Show when={tab() === "awaiting"}>
                    <div class="fazuh-prompts-bulk">
                      <span>{familyAwaiting()} awaiting</span>
                      <ui.Button
                        variant="danger"
                        size="small"
                        disabled={busy() || familyAwaiting() === 0}
                        busy={busy()}
                        onClick={() =>
                          void act(async () => {
                            const confirmed = await props.ctx.dialogs.confirm({
                              title: "Dismiss all awaiting prompts?",
                              description:
                                "Every unanswered prompt in this session family is marked dismissed. The records stay.",
                              confirm: "Dismiss all",
                              cancel: "Cancel",
                              danger: true,
                            })
                            if (confirmed) await view.dismissAll(family())
                          })
                        }
                      >
                        Dismiss all
                      </ui.Button>
                    </div>
                  </Show>

                  <div class="fazuh-prompts-list" data-scrollable aria-label="Prompts">
                    <Show when={!tabPrompts().length}>
                      <p role="status">No {labelOf(tab())?.toLowerCase()} prompts.</p>
                    </Show>
                    <For each={tabPrompts()}>
                      {(prompt) => (
                        <div class="fazuh-prompts-card">
                          <span class="fazuh-prompts-card-title">{titleOf(prompt)}</span>
                          <span class="fazuh-prompts-card-preview">{previewOf(prompt)}</span>
                          <span class="fazuh-prompts-card-meta">
                            {title(prompt.sessionID)} · {ago(prompt.at)}
                          </span>
                          <div class="fazuh-prompts-actions">
                            <ui.Button variant="contrast" size="small" onClick={() => setViewing(prompt.id)}>
                              View full prompt
                            </ui.Button>
                            <Show when={needsAnswer(prompt)}>
                              <ui.Button
                                variant="ghost"
                                size="small"
                                busy={busy()}
                                onClick={() => void act(() => view.reopen(prompt.sessionID, prompt.id))}
                              >
                                Reopen card
                              </ui.Button>
                            </Show>
                            <Show when={tabOf(prompt) === "awaiting"}>
                              <ui.Button
                                variant="danger"
                                size="small"
                                busy={busy()}
                                onClick={() => void act(() => dismissPrompt(prompt))}
                              >
                                Dismiss
                              </ui.Button>
                            </Show>
                          </div>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
              </Show>
            </>
          }
        >
          {(prompt) => (
            <div class="fazuh-prompts-detail">
              <ui.Button variant="ghost" size="small" onClick={() => setViewing(undefined)}>
                ← Prompts
              </ui.Button>
              <div class="fazuh-prompts-detail-head">
                <strong>{titleOf(prompt())}</strong>
                <span class="fazuh-prompts-badge" data-state={tabOf(prompt())}>
                  {labelOf(tabOf(prompt()))}
                </span>
              </div>
              <div class="fazuh-prompts-session-line">
                {title(prompt().sessionID)} · {ago(prompt().at)}
              </div>
              <div class="fazuh-prompts-content" data-scrollable>
                <ui.Markdown text={markdownOf(prompt())} />
              </div>
              <Show when={tabOf(prompt()) === "awaiting"}>
                <div class="fazuh-prompts-actions">
                  <Show when={needsAnswer(prompt())}>
                    <ui.Button
                      variant="contrast"
                      size="small"
                      busy={busy()}
                      onClick={() => void act(() => view.reopen(prompt().sessionID, prompt().id))}
                    >
                      Reopen card
                    </ui.Button>
                  </Show>
                  <ui.Button
                    variant="danger"
                    size="small"
                    busy={busy()}
                    onClick={() => void act(() => dismissPrompt(prompt()))}
                  >
                    Dismiss
                  </ui.Button>
                </div>
              </Show>
            </div>
          )}
        </Show>
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
      mobile: { title: TAB.title, order: 52, kind: "menu", icon: "checklist" },
      list: (input) => (input.open.includes(TAB.id) ? [TAB] : []),
      render: (props) => (
        <Show
          when={ctx.servers.get(props.session.server.id)}
          keyed
          fallback={<p role="status">Connecting to prompts…</p>}
        >
          {(server) => <PromptsView ctx={ctx} session={props.session} server={server} />}
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
        icon: "checklist" as const,
        opened: ctx.layout.state(`${ctx.id}:${TAB.id}`, session) !== "closed",
        run: () => ctx.layout.open(`${ctx.id}:${TAB.id}`, session),
      }
    })
  },
})
