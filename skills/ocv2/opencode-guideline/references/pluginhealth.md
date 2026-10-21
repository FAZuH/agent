Load this when a plugin is not loading, when a PluginSupervisor / ResolveMessage / SchemaError trace appears, when the user asks "is my plugin loaded" or how to debug the opencode.json "plugins" config, and after any plugin install or config edit. Inspect and debug OpenCode v2 plugin loading: what loaded, why a plugin failed, whether its `setup()` actually ran, and what hot-reloads.

---

# OpenCode v2 plugin inspection

Verified live against `opencode2` beta builds. Serve-mode differences are
called out; they cause most wrong conclusions.

## The one command that answers most questions

```bash
opencode2 api get /api/plugin
```

Returns JSON: `{ location, data: [...] }` where each entry has:

- `id`: plugin id (present for local/default-exported plugins; package
  entries carry `source.target` instead)
- `source`: `{ type: "builtin" | "local" | "package", path?/target? }`
- `state.status`: `"active"` or `"failed"`
- `state.error` + `state.ref`: short failure message and an error reference,
  only on failures (no stack trace via the API)
- `features`: e.g. `{ server: true }`

Prefer `scripts/oc-plugins.sh [--failed-only]`: same table,
exits 1 when any plugin failed so callers can gate on it.

A bad plugin never blocks others. Scan the whole list, not just the first failure.

## Auth (when curl-ing instead of the CLI)

`opencode2 api ...` targets the background service and handles auth itself.
Against a specific server use **basic auth**: a bearer token returns 401 with
an empty body, so an empty response means auth or wrong-port, not missing
data. The full contract is in `references/api.md`:

```bash
curl -s -u "opencode:$PASSWORD" http://127.0.0.1:PORT/api/plugin
```

## Gotchas that cause wrong conclusions

Gotchas 1 to 4 (plain serve lists nothing, global-location-only endpoints, project discovery needs git, the plugins config key) live in the umbrella SKILL.md, Shared facts.

1. **Hot-reload scope is the whole plugin dir, nested files included.** On
   v2.0.3 an edit to `plugins/<name>/src/<file>.ts`, not the entry, was live
   after `sync.sh push` with no restart (marker string in the tool's own
   output). Each changed file fires its own `msg="loading plugin"`.
   No hot-reload: config-entry (`"plugins": [...]`) and
   npm-installed plugins, which need a restart. A push that seems to do
   nothing means suspect a stale installed copy (`sync.sh diff -g plugins`), a
   cached session tool catalog, or inert config (opencode.json has no
   top-level `env` key, so a var set there never reaches the plugin host; verify
   with `tr '\0' '\n' < /proc/$(pgrep -f "opencode2 serve"|head -1)/environ`.
   Not module caching. Prove the live build with a behaviour marker,
   never a log line.

## Verifying a plugin actually ran its setup

Plugin list status proves *loaded*; `setup()` execution needs what setup
produces:

```bash
opencode2 api get /api/command
```

Commands registered via `ctx.command.transform(commands.update(...))` appear
by name (draft `update()` is upsert. It creates unknown names).
Empty `/api/command` on plain serve means nothing (shared fact 1), and it never
lists a PROJECT plugin's commands (shared fact 2). Reliable proof a
project plugin's `setup()` ran is its own side effect: the tool in
the session catalog, a file it writes, or a log line it emits. A tool
missing from the *top-level* tool list proves nothing: with Code Mode
active, plugin tools arrive through that catalog (`tools["mermaid-doctor"](…)`),
and a top-level call answers `No tool named "mermaid-doctor" is currently available`
while loaded (2026-09-13, v2.0.3).

## Loading a plugin outside the service

A loaded, healthy-listed plugin can still fail every call,
because nothing in `/api/plugin` executes `setup()`. Run the loader probe:

```bash
bun ~/.config/opencode/skills/opencode-guideline/scripts/oc-plugin-load.mjs \
  ~/Projects/agent/plugins                 # or: <repo>/.opencode/plugins my-tool.ts
```

It imports each entry and calls `setup()` against a recorded v2.0.3 ctx, then
prints registered tools/commands/hooks, unmodeled ctx keys the plugin wanted,
and any `ctx.worktree` /
`ctx.directory` idiom (not strings in v2, which yield `[object Object]` paths
or `The "paths[0]" property must be of type string, got object`). Exits
non-zero on failed import/setup or that idiom. No service, no restart, no
side effects: registered callbacks never run. `--self-test` checks
the scanner's line reporting against a fixture whose hit hides under a block
comment.

## Diagnosis workflow

1. Global plugins: run `opencode2 api get /api/plugin`; scan every
   status. Project plugins are absent, so grep the server log
   for `loading plugin` / `failed to load plugin` with the plugin's path.
2. For any `failed` entry, read `error`. The first line usually names the
   contract violation (e.g. `SchemaError: Expected object at ["default"]`
   = default export doesn't match `{id, setup}`; `ResolveMessage: Cannot
   find module` = stale/deleted path in some config entry).
3. Grep the config layer for the referenced path, both global
   (`~/.config/opencode/opencode.json`) and project (`.opencode/`, which may
   be a dev leftover like `"plugin": ["../index.ts"]` pointing at renamed
   files).
4. After fixing, re-run step 1 (service mode) or verify via `/api/command`,
   remembering both see only the global location.

## Writing one instead

This skill diagnoses loading. To author one, read
`references/plugins.md`.

## Memory

The Hindsight memory contract lives in the umbrella SKILL.md, Shared facts.
