---
name: ocv2-pluginhealth
description: Inspect OpenCode v2 plugin status and errors — list loaded plugins, read per-plugin failure stacks, and verify plugin registration after config changes. Use whenever a user reports an OpenCode v2/v2-beta plugin not loading, pastes PluginSupervisor / ResolveMessage / SchemaError traces, asks "is my plugin loaded", "check my plugins", wants to debug opencode.json "plugins" config, or after editing any plugin config in v2. Also use proactively after any plugin install or config edit on opencode2 to confirm it actually loaded.
---

# OpenCode v2 plugin inspection

Diagnose plugin loading on opencode2 (OpenCode v2 beta). Everything here was
verified live against `opencode2` beta builds; where behavior differs between
serve modes the differences are called out, because they are the main source
of wrong conclusions.

## The one command that answers most questions

```bash
opencode2 api get /api/plugin
```

Returns JSON: `{ location, data: [...] }` where each entry has:

- `id` — plugin id (present for local/default-exported plugins; package
  entries carry `source.target` instead)
- `source` — `{ type: "builtin" | "local" | "package", path?/target? }`
- `state.status` — `"active"` or `"failed"`
- `state.error` + `state.ref` — short failure message and an error reference,
  only on failures (no stack trace via the API)
- `features` — e.g. `{ server: true }`

Prefer `scripts/oc-plugins.sh [--failed-only]` over the raw call — same
table, and it exits 1 when any plugin failed so callers can gate on it.

Failed plugins are listed alongside healthy ones — a bad plugin never blocks
others from loading, so always scan the whole list rather than stopping at the
first failure.

## Auth (when curl-ing instead of the CLI)

`opencode2 api ...` targets the background service and handles auth itself.
Against a specific server use **basic auth**:

```bash
curl -s -u "opencode:$PASSWORD" http://127.0.0.1:PORT/api/plugin
```

The password is printed by `opencode2 serve` at startup ("server password
..."). Bearer tokens and `x-opencode-password` headers return 401 with an
empty body — if you see empty responses, it is almost always auth or
wrong-port, not missing data.

## Gotchas that cause wrong conclusions

1. **Plain serve lists nothing.** `GET /api/plugin` on a standalone
   `opencode2 serve` process returns `data: []` even when plugins load fine.
   Only the background service supervisor (`--service`) populates the list.
   An empty list proves nothing either way — verify through side effects
   instead (see /api/command below).
2. **The endpoints are global-location-only.** `/api/plugin`, `/api/command`
   and `/api/agent` always report the *service's* default location
   (`location.directory` was `/home/fazuh` on every call, whatever the cwd).
   `?location.directory=<project>` and `--param location.directory=<project>`
   are accepted and IGNORED — byte-identical results (2026-09-13, v2.0.3). A
   project's `.opencode/plugins/` entries NEVER appear in `/api/plugin` (0 of
   91), and project agents are absent from `/api/agent`, so a clean
   "0 failed" says nothing about a project plugin. Grep the server log instead:
   (`~/.local/share/opencode/log/opencode.log`) — the success line is
   `msg="loading plugin" id=<path>`, and the field is **`msg=`** while every
   other line uses `message=`: `message="failed to load plugin" target=<path>`
   (with the cause), `message="watcher subscribe" path=<…>/src/index.ts` proves
   nested files were read, `message="plugin reconciliation started|completed"`
   brackets each reload. `grep 'message="loading plugin"'` finds nothing and
   reads like a plugin that never loaded.
   For project agents, `opencode2 debug agents` IS cwd-scoped and lists them.
3. **Project discovery needs git.** Without a `.git` at/above the working
   directory, opencode2 resolves the location to `project: global` and skips
   project-local config and `.opencode/` dirs entirely — silently. Since the
   service endpoints report their own location (gotcha 2), check the *plugin's
   behaviour* or `opencode2 debug config` from inside the project, not the
   response's `location.project.directory`.
4. **Config key is `plugins`.** v1's singular `plugin` key is auto-translated,
   but new entries should use `"plugins": [{ "package": "..." }]` (strings
   also work). Both keys present is allowed.
5. **Hot-reload scope.** Files under watched dirs (`.opencode/plugin(s)/`)
   hot-reload on change. Config-entry and npm-installed plugins do NOT —
   changing them requires a restart.

## Verifying a plugin actually ran its setup

Plugin list status tells you it *loaded*; to prove `setup()` executed and
registered things, query what setup produces:

```bash
opencode2 api get /api/command
```

Commands registered via `ctx.command.transform(commands.update(...))` appear
by name (note: draft `update()` is upsert — it creates unknown names).
Empty `/api/command` on plain serve means nothing (gotcha 1), and it never
lists a PROJECT plugin's commands either (gotcha 2) — the reliable proof a
project plugin's `setup()` ran is its own side effect: the tool appearing in
the session's catalog, a file it writes, or a log line it emits.

## Loading a plugin outside the service

A plugin can be loaded, listed as healthy, and still fail on every call —
nothing in `/api/plugin` executes `setup()`. Run the loader probe:

```bash
bun ~/.config/opencode/skills/ocv2/ocv2-pluginhealth/scripts/oc-plugin-load.mjs \
  ~/Projects/agent/plugins                 # or: <repo>/.opencode/plugins my-tool.ts
```

It imports each entry and calls `setup()` against a recorded v2.0.3 ctx, then
prints the tools/commands/hooks registered, which ctx keys the plugin wanted
that the fake did not model, and any use of the `ctx.worktree` /
`ctx.directory` idiom (not strings in v2 — they yield `[object Object]` paths
or `The "paths[0]" property must be of type string, got object`). Exits
non-zero on a failed import/setup or on that idiom. No service, no restart, no
side effects — the registered callbacks are never invoked.

## Diagnosis workflow

1. Global plugins: run `opencode2 api get /api/plugin`; scan every entry's
   status. Project plugins are absent there — for those, grep the server log
   for `loading plugin` / `failed to load plugin` with the plugin's path.
2. For any `failed` entry, read `error` — the first line usually names the
   contract violation (e.g. `SchemaError: Expected object at ["default"]`
   = default export doesn't match `{id, setup}`; `ResolveMessage: Cannot
   find module` = stale/deleted path in some config entry).
3. Grep the relevant config layer for the referenced path — global
   (`~/.config/opencode/opencode.json`) AND project (`.opencode/`, which may
   be a dev leftover like `"plugin": ["../index.ts"]` pointing at renamed
   files).
4. After fixing, re-run step 1 (service mode) or verify via `/api/command` —
   remembering both see only the global location.
