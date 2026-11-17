import { For, Show, createEffect, createSignal, onCleanup } from "solid-js"
import { MenuItem, Panel, Plugin, Style } from "@opencode/plugin/gui"
import { createPromptView, type PromptViewState } from "./gui-controller.ts"
import { Contract } from "./rpc.ts"
import { ago, descriptionOf, groupBySession, markdownOf, needsAnswer, titleOf, type Prompt } from "./shared.ts"

const TAB = { id: "prompt-view-v2", title: "Prompts", closable: "compact" as const }
const CSS = `
.fazuh-prompts { display: flex; flex-direction: column; gap: 10px; height: 100%; min-height: 0; min-width: 0; padding: 12px; overflow-wrap: anywhere; }
.fazuh-prompts button { cursor: pointer; }
.fazuh-prompts button:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
.fazuh-prompts-alert { display: flex; gap: 8px; align-items: center; }
.fazuh-prompts-head { display: flex; flex-direction: column; gap: 2px; flex-shrink: 0; }
.fazuh-prompts-head strong { font-size: 13px; }
.fazuh-prompts-head span { opacity: .65; font-size: 12px; }
.fazuh-prompts-toolbar { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; flex-shrink: 0; }
.fazuh-prompts-toolbar button { font-size: 12px; padding: 4px 9px; border: 1px solid var(--border-weak-base); border-radius: 999px; background: transparent; color: inherit; }
.fazuh-prompts-toolbar button:hover { background: var(--surface-base-hover); }
.fazuh-prompts-toolbar button[aria-pressed=true] { border-color: currentColor; background: var(--surface-base-hover); }
.fazuh-prompts-toolbar button:disabled { opacity: .5; cursor: not-allowed; }
.fazuh-prompts-tabs { display: flex; gap: 4px; flex-wrap: wrap; flex-shrink: 0; }
.fazuh-prompts-tab { display: flex; align-items: center; gap: 6px; padding: 4px 8px; border: 1px solid var(--border-weak-base); border-radius: 999px; background: transparent; color: inherit; font-size: 12px; }
.fazuh-prompts-tab[aria-pressed=true] { border-color: currentColor; background: var(--surface-base-hover); }
.fazuh-prompts-tab i { font-style: normal; opacity: .7; font-size: 11px; }
.fazuh-prompts-list { display: flex; flex-direction: column; gap: 2px; max-height: 34%; overflow-y: auto; flex-shrink: 0; border: 1px solid var(--border-weak-base); border-radius: 6px; padding: 4px; }
.fazuh-prompts-row { display: grid; grid-template-columns: 8px 1fr auto; align-items: center; gap: 8px; width: 100%; text-align: start; padding: 7px 8px; border: 0; border-radius: 4px; background: transparent; color: inherit; font-size: 13px; }
.fazuh-prompts-row:hover { background: var(--surface-base-hover); }
.fazuh-prompts-row[aria-current=true] { background: var(--surface-base-hover); box-shadow: inset 2px 0 currentColor; }
.fazuh-prompts-row > span:nth-child(2) { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fazuh-prompts-dot { width: 6px; height: 6px; border-radius: 50%; border: 1px solid currentColor; }
.fazuh-prompts-dot[data-open=true] { background: #e0a458; border-color: #e0a458; }
.fazuh-prompts-row small { opacity: .6; font-size: 11px; white-space: nowrap; }
.fazuh-prompts-detail { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 8px; }
.fazuh-prompts-detail-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; flex-shrink: 0; }
.fazuh-prompts-detail-head strong { font-size: 14px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fazuh-prompts-state { font-size: 11px; padding: 2px 6px; border-radius: 999px; border: 1px solid var(--border-weak-base); opacity: .8; white-space: nowrap; flex-shrink: 0; }
.fazuh-prompts-content { flex: 1; min-height: 0; overflow: auto; border: 1px solid var(--border-weak-base); border-radius: 6px; padding: 8px 10px; }
.fazuh-prompts-actions { display: flex; justify-content: flex-end; flex-shrink: 0; }
`

/** One line for a session chip. */
function shortTitle(value: string): string {
  return value.length > 28 ? `${value.slice(0, 27)}…` : value
}

function statusOf(prompt: Prompt): string {
  if (prompt.answeredAt) return "Answered"
  if (prompt.dismissedAt) return "Dismissed"
  return "Awaiting answer"
}

function PromptsView(props: { ctx: any; session: any; server: any }) {
  const ui = props.ctx.ui
  const [state, setState] = createSignal<PromptViewState>({ prompts: [], loading: true })
  const [active, setActive] = createSignal<string>()
  const [selected, setSelected] = createSignal<string>()
  const [unansweredOnly, setUnansweredOnly] = createSignal(false)
  const [busy, setBusy] = createSignal(false)
  const rpc = props.server.client.rpc(Contract)
  const view = createPromptView(
    {
      list: (input) => rpc.list(input),
      reopen: (input) => rpc.reopen(input),
      subscribe: (listener) => rpc.events.on("changed", (event: any) => listener(event.data)),
    },
    {
      update: setState,
      error: (description) =>
        props.ctx.toast.show({ title: "Prompt", description, variant: "error" }),
    },
  )
  onCleanup(view.dispose)

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
        Number(b.prompts.some(needsAnswer)) - Number(a.prompts.some(needsAnswer)) ||
        (b.prompts.at(-1)?.at ?? 0) - (a.prompts.at(-1)?.at ?? 0),
    )
  const group = () => groups().find((item) => item.sessionID === active()) ?? groups()[0]
  const prompts = () =>
    (group()?.prompts ?? [])
      .filter((prompt) => !unansweredOnly() || needsAnswer(prompt))
      .slice()
      .sort((a, b) => b.at - a.at)
  const awaitingCount = () => state().prompts.filter(needsAnswer).length

  createEffect(() => {
    const chosen = selected()
    if (chosen && prompts().some((prompt) => prompt.id === chosen)) return
    setSelected(prompts().find(needsAnswer)?.id ?? prompts()[0]?.id)
  })

  const current = () => prompts().find((prompt) => prompt.id === selected()) ?? prompts()[0]
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

  return (
    <section class="fazuh-prompts" aria-label="Prompts">
      <Show when={state().loading}>
        <p role="status">Loading prompts…</p>
      </Show>
      <Show when={state().error}>
        <div class="fazuh-prompts-alert" role="alert">
          <span>{state().error}</span>
          <ui.Button onClick={() => void view.load(family())}>Retry</ui.Button>
        </div>
      </Show>

      <Show when={groups().length > 0} fallback={<p>No prompts yet.</p>}>
        <div class="fazuh-prompts-head">
          <strong>{title(group()?.sessionID ?? "")}</strong>
          <span>
            {group()?.prompts.length} prompts · {group()?.prompts.filter(needsAnswer).length} awaiting
          </span>
        </div>

        <div class="fazuh-prompts-toolbar">
          <button aria-pressed={unansweredOnly()} onClick={() => setUnansweredOnly(!unansweredOnly())}>
            Only awaiting
          </button>
          <button
            disabled={busy() || awaitingCount() === 0}
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
          </button>
        </div>

        <Show when={groups().length > 1}>
          <div class="fazuh-prompts-tabs" role="group" aria-label="Sessions">
            <For each={groups()}>
              {(item) => (
                <button
                  class="fazuh-prompts-tab"
                  aria-pressed={group()?.sessionID === item.sessionID}
                  onClick={() => {
                    setActive(item.sessionID)
                    setSelected(undefined)
                  }}
                >
                  {shortTitle(title(item.sessionID))}
                  <Show when={item.prompts.some(needsAnswer)}>
                    <i>{item.prompts.filter(needsAnswer).length}</i>
                  </Show>
                </button>
              )}
            </For>
          </div>
        </Show>

        <div class="fazuh-prompts-list" aria-label="Prompt history">
          <Show when={!prompts().length}>
            <p role="status">No awaiting prompts.</p>
          </Show>
          <For each={prompts()}>
            {(prompt) => (
              <button
                class="fazuh-prompts-row"
                aria-current={current()?.id === prompt.id}
                aria-label={`${titleOf(prompt)} — ${statusOf(prompt)}, ${ago(prompt.at)}`}
                onClick={() => setSelected(prompt.id)}
              >
                <span class="fazuh-prompts-dot" data-open={needsAnswer(prompt)} />
                <span>{titleOf(prompt)}</span>
                <small>{ago(prompt.at)}</small>
              </button>
            )}
          </For>
        </div>

        <Show when={current()}>
          {(prompt) => (
            <div class="fazuh-prompts-detail">
              <div class="fazuh-prompts-detail-head">
                <strong>{descriptionOf(prompt())}</strong>
                <span class="fazuh-prompts-state">{statusOf(prompt())}</span>
              </div>
              <div class="fazuh-prompts-content">
                <ui.Markdown text={markdownOf(prompt())} />
              </div>
              <Show when={needsAnswer(prompt())}>
                <div class="fazuh-prompts-actions">
                  <ui.Button
                    variant="contrast"
                    busy={busy()}
                    onClick={() => void act(() => view.reopen(prompt().sessionID, prompt().id))}
                  >
                    Reopen card
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
