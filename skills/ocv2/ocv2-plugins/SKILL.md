---
name: ocv2-plugins
description: >-
  Write and change OpenCode v2 plugins: the real plugin contract, custom tools,
  hooks, commands, the TUI surface, and how to verify any of it works. Use when
  adding a plugin under `plugins/`, adding a tool, an `execute.before` hook, or
  a slash command, building a TUI panel or dialog, wiring settings, or when a
  tool returns the wrong shape, a hook does not fire, a command is shadowed or
  duplicated, a dialog does not open or closes on selection, or the plugin
  types and the runtime disagree.
---

# Writing OpenCode v2 plugins

Measured on a live v2 host, not read from docs. **The published plugin docs
and the shipped type definitions both describe a v1 shape that does not exist
at runtime.** Where the two disagree, this document is right and the types are
wrong; where unsettled, it says so.

Most work is the contract below. External service, settings, or host-blocking
needs one more thing: [decision plugins](decision-plugins.md).

## Layout

```
plugins/<name>/
  package.json    # type: module; exports "." -> src/index.ts, "./tui" -> src/tui.ts
  index.ts        # re-exports src/index.ts
  tui.ts          # re-exports src/tui.ts, which the CLI resolves <plugin-dir>/tui
  src/
```

`export default { id, tui: true, setup }` is what makes the CLI look for
`<plugin-dir>/tui`. Without `tui: true` it loads nothing there.

`sync.sh` discovers `plugins/*` and copies the directory to
`~/.config/opencode/plugins/`. A repository edit is not live until
`./sync.sh push -g`. Hot-reload makes restart rarely the fix:
`ocv2-pluginhealth` covers loading.

**A local dir plugin gets no `node_modules`.** No `solid-js`, no
`@opentui/solid`, no `createComponent`, and therefore no JSX. This single
constraint shapes the whole TUI story, and it stays invisible until hit.

## The server contract

```ts
export default {
  id: "fazuh.example",
  tui: true,
  setup: async (ctx: any) => {
    await ctx.tool.transform((tools: any) => {
      tools.add({
        name: "example_thing",
        description: "…",
        input: { type: "object", properties: { … }, required: [ … ] },
        execute: async (input: any, tctx: any) => ({ content: "…" }),
      })
    })
  },
}
```

- `input` is a **JSON Schema object**, not a Zod schema.
- `execute` returns **`{ content: string }`**. Returning a bare string throws
  `s is not an Object` at the harness *while the tool call still succeeds*, so
  the model sees a result and you see an error. Read your log, not the
  error. The most common v1 habit half-working here.
- Call context (`tctx`) is separate from plugin context. `ctx` arrives
  at `setup`; `tctx` arrives per call.

### Hooks

```ts
ctx.tool.hook("execute.before", async (event: any) => {
  const tool = String(event?.tool ?? "").toLowerCase()
  // event.args holds the arguments
})
```

Keyed on `event.tool`. On v2.0.20 these reach `task`
subagent calls, so a policy hook covers subagent work, verified live on one
session and one subagent: enough to refute bypass, not to call the boundary
airtight.

Argument shapes differ per tool: `apply_patch` uses `patchText`, not
`filePath`. Match on presence, never assume one name.

### Commands

```ts
ctx.command.transform((draft: any) => draft.add({
  name: "example-status",
  description: "…",
  execute: async (input: any) => ({ content: "…" }),
}))
```

Return value is the reply text. Text after the slash arrives as `input.prompt.text`.

## The TUI surface, measured

Real `ctx.ui` and `ctx.ui.dialog` shape on live v2.0.20 host:

```
ctx keys    options, location, app, renderer, client, data, attention, theme,
            themeMode, markdown, keymap, storage, ui
ui keys     dialog, toast, format, router, panel, tabs, model, slot
ui types    all objects except slot, which is a function
dialog      show, set, clear, alert, confirm, prompt, select   (all functions)
```

`ui.DialogSelect`, `ui.DialogPrompt`, and `TuiDialogStack.replace` appear in
`@opencode-ai/plugin/dist/tui.d.ts` and **do not exist at runtime**. What does
exist:

- `dialog.prompt({ title, description, value, placeholder })` → `Promise<string>`.
  Use it for every text input. Undocumented, and the only working
  text-input primitive.
- `dialog.select({ title, options })` → `Promise`, resolving with the selection
  (exact value unconfirmed). **It resolves on selection, which closes the
  dialog.** No surviving panel has a primitive to build on.
  `dialog.set` is untested; signature unconfirmed.
- `dialog.clear()` closes. `dialog.show/alert/confirm` exist and are unexamined.

### Registration

Commands and keybindings register from a slot render; the layer needs a
rendered component:

```ts
ctx.ui.slot?.({
  append: "app",
  render: () => {
    ctx.keymap.layer(() => ({
      mode: "global",     // "modal" to sit above a dialog
      priority: 1,
      enabled: true,       // the host's own layers pass a function here
      commands: [{ id, title, group, palette: true, slash: { name }, run }],
    }))
    return null
  },
})
```

A layer command is bound by `bind: "left"` for a literal key, or by `id` when
the host's keybind config should decide. `enabled` is read as a function by the
host, so a predicate is the safe changing form.

### Measuring instead of guessing

Types disagree with behaviour: log the shape from inside a slot
render and read it:

```ts
trace(JSON.stringify({
  ctxKeys: Object.keys(ctx),
  uiKeys: Object.keys(ctx.ui ?? {}),
  dialogKeys: Object.keys(ctx.ui?.dialog ?? {}),
}))
```

One line, ends hours of guessing. A plugin that renders a panel
should write its own diagnostics: a TUI failure is otherwise **silent**: the
command runs, throws, and the keymap swallows it, so the symptom is "nothing
happens" with no error anywhere.

## One name, one owner

A slash command from both server plugin and TUI appears
**twice** in the palette, and only one works. Pick owner by
dialog need:

- **TUI-only**: anything that opens a panel or a dialog, and anything that must
  not exist where dialogs cannot render (the desktop app loads no TUI module).
- **Server-side**: anything that must work in every host, and anything that only
  reports state.

One name, one owner, no exceptions. A server command duplicating a
panel takes a different text-route name.

## Verify it works

Loading is not working.

```bash
opencode2 api get /api/plugin     # state.status, features, state.error
opencode2 api get /api/command    # which commands actually registered
```

Then **drive a real call** through the HTTP API against a free model and read
the output. Schema-valid is not correct; only a real call shows the decision.
Pick a free model per `ocv2-models`.

A stub `ctx` is a genuine testing tool and it caught several real bugs here:
it exercises `setup`, tool `execute`, hook dispatch, command registration, and
dialog lifecycle without a TUI. It cannot check pixels, and any
`DialogSelect`-shaped assumption is only as good as the stub.

## Things that bite

1. **`{ content: string }` or nothing.** A bare string half-works: the call
   succeeds, the harness throws.
2. **A plugin that renders nothing without saying so.** Guard every entry point
   that opens UI, toast the error, and log it. Silence is the default failure
   mode.
3. **A keybinding that cannot fire is worse than an absent one.** It reads as a
   promise in the palette and does nothing at the key. Register only what works.
4. **A fix that depends on every future throw site staying careful is not a
   fix.** When one code path is allowed to block, give it its own error class
   and let everything else fall through.
5. **Registration from a component body works; registration from `setup` alone
   does not** for keymap layers.
6. **Trust the runtime over the types, and the log over both.**
