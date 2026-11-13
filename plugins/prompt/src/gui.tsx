import { For, Show, createEffect, createSignal, onCleanup } from "solid-js"
import { MenuItem, Panel, Plugin, Style } from "@opencode/plugin/gui"
import { createPromptView, type PromptViewState } from "./gui-controller.ts"
import { Contract } from "./rpc.ts"
import { ago, descriptionOf, groupBySession, markdownOf, needsAnswer } from "./shared.ts"

const TAB = { id: "prompt-view-v2", title: "Prompts", closable: "compact" as const }
const CSS = `
.fazuh-prompts { display: flex; flex-direction: column; gap: 12px; height: 100%; min-height: 0; min-width: 0; padding: 12px; overflow-wrap: anywhere; }
.fazuh-prompts button { cursor: pointer; min-height: 44px; }
.fazuh-prompts button:disabled { cursor: not-allowed; }
.fazuh-prompts button:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
.fazuh-prompts-agents { display: flex; flex-direction: column; gap: 4px; max-height: 35%; overflow-y: auto; flex-shrink: 0; }
.fazuh-prompts-agent { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; text-align: start; padding: 8px; border: 1px solid var(--border-weak-base); border-radius: 4px; background: transparent; color: inherit; }
.fazuh-prompts-agent:hover { background: var(--surface-base-hover); }
.fazuh-prompts-agent:active { transform: translateY(1px); }
.fazuh-prompts-agent[aria-pressed=true] { border-color: currentColor; }
.fazuh-prompts-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.fazuh-prompts-content { flex: 1; min-height: 0; overflow: auto; }
`

function PromptsView(props: { ctx: any; session: any; server: any }) {
  const ui = props.ctx.ui
  const [state, setState] = createSignal<PromptViewState>({ prompts: [], loading: true })
  const [active, setActive] = createSignal<string>()
  const [index, setIndex] = createSignal<number>()
  const [busy, setBusy] = createSignal(false)
  const rpc = props.server.client.rpc(Contract)
  const view = createPromptView(
    {
      list: (input) => rpc.list(input),
      answer: (input) => rpc.answer(input),
      dismiss: (input) => rpc.dismiss(input),
      defer: (input) => rpc.defer(input),
      subscribe: (listener) => rpc.events.on("changed", (event: any) => listener(event.data)),
    },
    {
      update: setState,
      question: (question, value) =>
        props.ctx.dialogs.prompt({
          title: question.title,
          description: question.body,
          placeholder: question.recommendation ?? "Your answer",
          value: value || question.recommendation || "",
          submit: "Continue",
        }),
      delivery: () =>
        props.ctx.dialogs.select({
          title: "Send answers",
          options: [
            {
              title: "Steer",
              description: "Wake an idle agent, or wait for its running turn to end",
              value: "steer",
            },
            { title: "Queue", description: "Deliver after the agent's current turn", value: "queue" },
          ],
        }),
      error: (description) =>
        props.ctx.toast.show({ title: "Prompt action failed", description, variant: "error" }),
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
  createEffect(() => {
    props.session.id
    setActive(undefined)
    setIndex(undefined)
  })
  const groups = () =>
    groupBySession(state().prompts).sort(
      (a, b) =>
        Number(b.prompts.some(needsAnswer)) - Number(a.prompts.some(needsAnswer)) ||
        (b.prompts.at(-1)?.at ?? 0) - (a.prompts.at(-1)?.at ?? 0),
    )
  const selected = () => groups().find((group) => group.sessionID === active()) ?? groups()[0]
  const position = () =>
    Math.max(
      0,
      Math.min(index() ?? (selected()?.prompts.length ?? 1) - 1, (selected()?.prompts.length ?? 1) - 1),
    )
  const current = () => selected()?.prompts[position()]
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
        <div role="alert">
          <p>{state().error}</p>
          <ui.Button onClick={() => void view.load(family())}>Retry</ui.Button>
        </div>
      </Show>
      <Show when={!state().loading && !state().error && !groups().length}>
        <p>No prompts yet.</p>
      </Show>
      <div class="fazuh-prompts-agents" aria-label="Agents">
        <For each={groups()}>
          {(group) => (
            <button
              class="fazuh-prompts-agent"
              aria-pressed={selected()?.sessionID === group.sessionID}
              onClick={() => {
                setActive(group.sessionID)
                setIndex(undefined)
              }}
            >
              <strong>{title(group.sessionID)}</strong>
              <span>
                {descriptionOf(group.prompts.at(-1)!)} · {ago(group.prompts.at(-1)!.at)}
              </span>
              <span>{group.prompts.some(needsAnswer) ? "Awaiting answer" : "No unanswered questions"}</span>
            </button>
          )}
        </For>
      </div>
      <Show when={current()}>
        {(prompt) => (
          <>
            <div class="fazuh-prompts-toolbar">
              <ui.Button disabled={position() === 0} onClick={() => setIndex(position() - 1)}>
                Older
              </ui.Button>
              <span>
                {position() + 1}/{selected()?.prompts.length}
              </span>
              <ui.Button
                disabled={position() >= (selected()?.prompts.length ?? 1) - 1}
                onClick={() => setIndex(position() + 1)}
              >
                Newer
              </ui.Button>
              <Show when={needsAnswer(prompt())}>
                <ui.Button
                  variant="contrast"
                  busy={busy()}
                  onClick={() => void act(() => view.answer(prompt()))}
                >
                  Answer
                </ui.Button>
                <ui.Button disabled={busy()} onClick={() => void act(() => view.dismiss(prompt()))}>
                  Dismiss
                </ui.Button>
              </Show>
            </div>
            <strong>{descriptionOf(prompt())}</strong>
            <Show when={prompt().answeredAt || prompt().dismissedAt}>
              <p role="status">{prompt().answeredAt ? "Answered" : "Dismissed"}</p>
            </Show>
            <div class="fazuh-prompts-content">
              <ui.Markdown text={markdownOf(prompt())} />
            </div>
          </>
        )}
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
