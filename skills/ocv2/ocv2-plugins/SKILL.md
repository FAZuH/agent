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

Everything here was measured on a live v2 host, not read from documentation.
That distinction matters more than usual, because **the published plugin docs
and the shipped type definitions both describe a v1 shape that does not exist
at runtime.** Where the two disagree, this document is right and the types are
wrong; where neither is settled, it says so.

Two branches. Most plugin work is the contract below. A plugin that calls an
external service, holds settings, or can block the host needs one more thing:
[decision plugins](decision-plugins.md).

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
`./sync.sh push -g`. OpenCode v2 hot-reloads plugins, so a restart is rarely
the fix: `ocv2-pluginhealth` is the skill for loading questions.

**A local dir plugin gets no `node_modules`.** No `solid-js`, no
`@opentui/solid`, no `createComponent`, and therefore no JSX. This is the single
constraint that shapes the whole TUI story below, and it is invisible until you
hit it.

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
  the model sees a result and you see an error. Read your own log, not the
  error. This is the most common way a v1 habit silently half-works here.
- The call context (`tctx`) is separate from the plugin context. Tools get
  `ctx` at `setup`; `tctx` arrives per call.

### Hooks

```ts
ctx.tool.hook("execute.before", async (event: any) => {
  const tool = String(event?.tool ?? "").toLowerCase()
  // event.args holds the arguments
})
```

Keyed on `event.tool`. On v2.0.20 these reach tool calls made by `task`
subagents, so a policy hook covers subagent work, verified live, one session
and one subagent, which is enough to refute a bypass report and not enough to
call the boundary airtight.

Argument shapes differ per tool: `apply_patch` uses `patchText`, not
`filePath`. Match on what is present rather than assuming one name.

### Commands

```ts
ctx.command.transform((draft: any) => draft.add({
  name: "example-status",
  description: "…",
  execute: async (input: any) => ({ content: "…" }),
}))
```

The return value is the command's reply text. Anything the user typed after the
slash command arrives as `input.prompt.text`.

## The TUI surface, measured

The real shape of `ctx.ui` and `ctx.ui.dialog` on a live v2.0.20 host:

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
  Use this for every text input. It is undocumented, and it is the only working
  way to ask the user for a value.
- `dialog.select({ title, options })` → `Promise`, resolving with the selection
  (exact value unconfirmed). **It resolves on selection, which closes the
  dialog.** Any panel that has to survive a change has no primitive to build on.
  `dialog.set` is the one untested candidate; its signature is unconfirmed.
- `dialog.clear()` closes. `dialog.show/alert/confirm` exist and are unexamined.

### Registration

Commands and keybindings register from a slot render, because the layer needs a
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
host, so a predicate is the safe form when it needs to change.

### Measuring instead of guessing

Any time the types and the behaviour disagree, log the shape from inside a slot
render and read it:

```ts
trace(JSON.stringify({
  ctxKeys: Object.keys(ctx),
  uiKeys: Object.keys(ctx.ui ?? {}),
  dialogKeys: Object.keys(ctx.ui?.dialog ?? {}),
}))
```

This is one line and it ends hours of guessing. A plugin that renders a panel
should write its own diagnostics: a TUI failure is otherwise **silent**: the
command runs, throws, and the keymap swallows it, so the symptom is "nothing
happens" with no error anywhere.

## One name, one owner

A slash command registered from both the server plugin and the TUI appears
**twice** in the palette, and only one of the two works. Pick the owner by
whether the command needs a dialog:

- **TUI-only**: anything that opens a panel or a dialog, and anything that must
  not exist where dialogs cannot render (the desktop app loads no TUI module).
- **Server-side**: anything that must work in every host, and anything that only
  reports state.

One name, one owner, no exceptions. When a server command would duplicate a
panel, use a different name for the text route rather than reusing the panel's.

## Verify it works

Loading is not working.

```bash
opencode2 api get /api/plugin     # state.status, features, state.error
opencode2 api get /api/command    # which commands actually registered
```

Then **drive a real call** through the HTTP API against a free model and read
the output. A schema-valid answer is not a correct decision; the whole point of
a decision tool is the answer, and only a real call shows it. Pick a free model
per `ocv2-models`.

A stub `ctx` is a genuine testing tool and it caught several real bugs here:
it exercises `setup`, tool `execute`, hook dispatch, command registration, and
dialog lifecycle without a TUI. What it cannot check is pixels, and any
`DialogSelect`-shaped assumption it encodes is only as good as the stub.

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
