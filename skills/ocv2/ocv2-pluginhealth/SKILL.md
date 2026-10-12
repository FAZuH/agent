---
name: ocv2-pluginhealth
description: >-
  Inspect and debug OpenCode v2 plugin loading, covering what loaded, why a
  plugin failed, whether its `setup()` actually ran, and what hot-reloads. Use
  when a plugin is not loading, when a PluginSupervisor / ResolveMessage /
  SchemaError trace appears, when the user asks "is my plugin loaded" or how to
  debug the opencode.json "plugins" config, and after any plugin install or
  config edit.
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
Against a specific server use **basic auth**:

```bash
curl -s -u "opencode:$PASSWORD" http://127.0.0.1:PORT/api/plugin
```

The password is printed by `opencode2 serve` at startup ("server password
..."). Bearer tokens and `x-opencode-password` headers return 401 with an
empty body, so empty response means auth or wrong-port, not missing data.

## Gotchas that cause wrong conclusions

1. **Plain serve lists nothing.** `GET /api/plugin` on a standalone
   `opencode2 serve` process returns `data: []` even when plugins load fine.
   Only the background service supervisor (`--service`) populates the list.
   Empty list proves nothing; verify through side effects
   (see /api/command below).
2. **The endpoints are global-location-only.** `/api/plugin`, `/api/command`
   and `/api/agent` always report the *service's* default location
   (`location.directory` was `/home/<user>` on every call, whatever the cwd).
   `?location.directory=<project>` and `--param location.directory=<project>`
   are accepted and IGNORED (byte-identical results, 2026-09-13, v2.0.3). A
   project's `.opencode/plugins/` entries NEVER appear in `/api/plugin` (0 of
   91), and project agents are absent from `/api/agent`, so clean
   "0 failed" says nothing about project plugins. Grep the server log:
   (`~/.local/share/opencode/log/opencode.log`). Success is
   `msg="loading plugin" id=<path>`, note the field is **`msg=`** while every
   other line uses `message=`: `message="failed to load plugin" target=<path>`
   (with the cause), `message="watcher subscribe" path=<…>/src/index.ts` proves
   nested files were read, `message="plugin reconciliation started|completed"`
   brackets each reload. `grep 'message="loading plugin"'` finds nothing, which
   reads as never loaded.
   For project agents, `opencode2 debug agents` IS cwd-scoped and lists them.
3. **Project discovery needs git.** Without a `.git` at/above the working
   directory, opencode2 resolves to `project: global` and skips
   project-local config and `.opencode/` dirs silently. Service endpoints
   report their own location (gotcha 2), so check the *plugin's
   behaviour* or `opencode2 debug config` from inside the project, not the
   response's `location.project.directory`.
4. **Config key is `plugins`.** v1 `plugin` is auto-translated,
   but new entries use `"plugins": [{ "package": "..." }]` (strings
   also work). Both keys may coexist.
5. **Hot-reload scope is the whole plugin dir, nested files included.** On
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
Empty `/api/command` on plain serve means nothing (gotcha 1), and it never
lists a PROJECT plugin's commands (gotcha 2). Reliable proof a
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
bun ~/.config/opencode/skills/ocv2-pluginhealth/scripts/oc-plugin-load.mjs \
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
@ocv2-plugins.

## Memory

OpenCode v2 findings live in Hindsight bank `coding-agent::faz-lab`, tagged
`topic:opencode-v2`. `recall` a quirk before answering from scratch; `retain`
a new finding after it live-verifies. If the hindsight tools are absent,
continue without memory.
