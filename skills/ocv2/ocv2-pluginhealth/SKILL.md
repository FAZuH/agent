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
  entries may show `source.package` instead)
- `source` — `{ type: "builtin" | "local" | "package", path?/package? }`
- `status` — `"active"` or `"failed"`
- `error` — full error message WITH stack trace, only on failures
- `tui` — whether it registers TUI extensions

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
2. **Project discovery needs git.** Without a `.git` at/above the working
   directory, opencode2 resolves the location to `project: global` and skips
   project-local config and `.opencode/` dirs entirely — silently. If a
   project's plugins refuse to load, check the response's
   `location.project.directory`: if it says `/`, that's why.
3. **Config key is `plugins`.** v1's singular `plugin` key is auto-translated,
   but new entries should use `"plugins": [{ "package": "..." }]` (strings
   also work). Both keys present is allowed.
4. **Hot-reload scope.** Files under watched dirs (`.opencode/plugin(s)/`)
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
Empty `/api/command` on plain serve means nothing (gotcha 1); on the service,
or with an explicit `?location.directory=<project>`, registered names are
your ground truth.

## Diagnosis workflow

1. Run `opencode2 api get /api/plugin`; scan every entry's status.
2. For any `failed` entry, read `error` — the first line usually names the
   contract violation (e.g. `SchemaError: Expected object at ["default"]`
   = default export doesn't match `{id, setup}`; `ResolveMessage: Cannot
   find module` = stale/deleted path in some config entry).
3. Grep the relevant config layer for the referenced path — global
   (`~/.config/opencode/opencode.json`) AND project (`.opencode/`, which may
   be a dev leftover like `"plugin": ["../index.ts"]` pointing at renamed
   files).
4. After fixing, re-run step 1 (service mode) or verify via `/api/command`.
