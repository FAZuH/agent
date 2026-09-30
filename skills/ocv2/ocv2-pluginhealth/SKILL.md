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

Everything here was verified live against `opencode2` beta builds. Where
behavior differs between serve modes the differences are called out, because
they are the main source of wrong conclusions.

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

Prefer `scripts/oc-plugins.sh [--failed-only]` over the raw call: same table,
and it exits 1 when any plugin failed so callers can gate on it.

Failed plugins are listed alongside healthy ones, because a bad plugin never
blocks others from loading, so scan the whole list rather than stopping at the
first failure.

## Auth (when curl-ing instead of the CLI)

`opencode2 api ...` targets the background service and handles auth itself.
Against a specific server use **basic auth**:

```bash
curl -s -u "opencode:$PASSWORD" http://127.0.0.1:PORT/api/plugin
```

The password is printed by `opencode2 serve` at startup ("server password
..."). Bearer tokens and `x-opencode-password` headers return 401 with an
empty body, so an empty response is almost always auth or wrong-port, not
missing data.

## Gotchas that cause wrong conclusions

1. **Plain serve lists nothing.** `GET /api/plugin` on a standalone
   `opencode2 serve` process returns `data: []` even when plugins load fine.
   Only the background service supervisor (`--service`) populates the list.
   an empty list proves nothing either way, so verify through side effects
   instead (see /api/command below).
2. **The endpoints are global-location-only.** `/api/plugin`, `/api/command`
   and `/api/agent` always report the *service's* default location
   (`location.directory` was `/home/<user>` on every call, whatever the cwd).
   `?location.directory=<project>` and `--param location.directory=<project>`
   are accepted and IGNORED (byte-identical results, 2026-09-13, v2.0.3). A
   project's `.opencode/plugins/` entries NEVER appear in `/api/plugin` (0 of
   91), and project agents are absent from `/api/agent`, so a clean
   "0 failed" says nothing about a project plugin. Grep the server log instead:
   (`~/.local/share/opencode/log/opencode.log`). The success line is
   `msg="loading plugin" id=<path>`, where the field is **`msg=`** while every
   other line uses `message=`: `message="failed to load plugin" target=<path>`
   (with the cause), `message="watcher subscribe" path=<…>/src/index.ts` proves
   nested files were read, `message="plugin reconciliation started|completed"`
   brackets each reload. `grep 'message="loading plugin"'` finds nothing and so
   reads like a plugin that never loaded.
   For project agents, `opencode2 debug agents` IS cwd-scoped and lists them.
3. **Project discovery needs git.** Without a `.git` at/above the working
   directory, opencode2 resolves the location to `project: global` and skips
   project-local config and `.opencode/` dirs entirely, silently. Since the
   service endpoints report their own location (gotcha 2), check the *plugin's
   behaviour* or `opencode2 debug config` from inside the project, not the
   response's `location.project.directory`.
4. **Config key is `plugins`.** v1's singular `plugin` key is auto-translated,
   but new entries should use `"plugins": [{ "package": "..." }]` (strings
   also work). Both keys present is allowed.
5. **Hot-reload scope is the whole plugin dir, nested files included.** On
   v2.0.3 an edit to `plugins/<name>/src/<file>.ts`, not the entry, was live
   after `sync.sh push` with no restart (proved by a marker string appearing in
   the tool's own output). Each changed file fires its own `msg="loading plugin"`.
   What does NOT hot-reload: config-entry (`"plugins": [...]`) and
   npm-installed plugins, which need a restart. So when a push seems to have
   done nothing, suspect a stale installed copy (`sync.sh diff -g plugins`), a
   cached session tool catalog, or config that is inert (opencode.json has no
   top-level `env` key, so a var set there never reaches the plugin host; verify
   with `tr '\0' '\n' < /proc/$(pgrep -f "opencode2 serve"|head -1)/environ`.
   This is not module caching. Prove which build is live with a behaviour marker
   rather than trusting a log line.

## Verifying a plugin actually ran its setup

Plugin list status tells you it *loaded*; to prove `setup()` executed and
registered things, query what setup produces:

```bash
opencode2 api get /api/command
```

Commands registered via `ctx.command.transform(commands.update(...))` appear
by name (note: draft `update()` is upsert. It creates unknown names).
Empty `/api/command` on plain serve means nothing (gotcha 1), and it never
lists a PROJECT plugin's commands either (gotcha 2). The reliable proof a
project plugin's `setup()` ran is its own side effect: the tool appearing in
the session's catalog, a file it writes, or a log line it emits. Note that a tool
missing from the *top-level* tool list proves nothing either: with Code Mode
active, plugin tools are reached through that catalog (`tools["mermaid-doctor"](…)`),
and a top-level call answers `No tool named "mermaid-doctor" is currently available`
while the plugin is perfectly loaded (2026-09-13, v2.0.3).

## Loading a plugin outside the service

A plugin can be loaded, listed as healthy, and still fail on every call,
because nothing in `/api/plugin` executes `setup()`. Run the loader probe:

```bash
bun ~/.config/opencode/skills/ocv2-pluginhealth/scripts/oc-plugin-load.mjs \
  ~/Projects/agent/plugins                 # or: <repo>/.opencode/plugins my-tool.ts
```

It imports each entry and calls `setup()` against a recorded v2.0.3 ctx, then
prints the tools/commands/hooks registered, which ctx keys the plugin wanted
that the fake did not model, and any use of the `ctx.worktree` /
`ctx.directory` idiom (not strings in v2, which yield `[object Object]` paths
or `The "paths[0]" property must be of type string, got object`). Exits
non-zero on a failed import/setup or on that idiom. No service, no restart, no
side effects: the registered callbacks are never invoked. `--self-test` checks
the scanner's own line reporting against a fixture whose hit hides under a block
comment.

## Diagnosis workflow

1. Global plugins: run `opencode2 api get /api/plugin`; scan every entry's
   status. Project plugins are absent there, so for those grep the server log
   for `loading plugin` / `failed to load plugin` with the plugin's path.
2. For any `failed` entry, read `error`. The first line usually names the
   contract violation (e.g. `SchemaError: Expected object at ["default"]`
   = default export doesn't match `{id, setup}`; `ResolveMessage: Cannot
   find module` = stale/deleted path in some config entry).
3. Grep the relevant config layer for the referenced path, both the global
   (`~/.config/opencode/opencode.json`) and project (`.opencode/`, which may
   be a dev leftover like `"plugin": ["../index.ts"]` pointing at renamed
   files).
4. After fixing, re-run step 1 (service mode) or verify via `/api/command`,
   remembering both see only the global location.
