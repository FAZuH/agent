---
name: opencode-guideline
description: >-
  OpenCode v2 operations reference: the HTTP API, compaction, models, plugin
  authoring, plugin loading health, and session forking and control. Use when
  the user says "call the API", "opencode2 api", "where are the API docs", "how
  do I fork/switch model via API", pastes an OpenAPI path, "compact a session",
  "the context-watch warning fires", "the compaction gate auto-resolves",
  "pick a model", "use a free model", "Insufficient account funds", "a plugin
  is not loading", "a PluginSupervisor / ResolveMessage / SchemaError trace
  appears", "is my plugin loaded", "add a plugin", "add a tool", "an
  execute.before hook", "a slash command", "a TUI panel or dialog", "wiring
  settings", "a tool returns the wrong shape", "a hook does not fire", "a
  command is shadowed or duplicated", "a dialog does not open", "the plugin
  types and the runtime disagree", "fork this session", "fork before this
  message", "switch the model/agent in the fork", or asks what models opencode2
  offers.
---

# opencode-guideline

The OpenCode v2 operations reference. Six topics, one skill: the HTTP API, compaction, models, plugin authoring, plugin loading health, and session forking and control.

## Routing

| Task | Read |
|---|---|
| Call the HTTP API, find its docs | `references/api.md` |
| Compact a session | `references/compact.md` |
| Pick a free model, switch model, recover from 402 | `references/models.md` |
| Write or change a plugin | `references/plugins.md` |
| Diagnose plugin loading | `references/pluginhealth.md` |
| Fork and control a session | `references/sessions.md` |
| Run a helper script | `scripts/` below, plus the reference that owns it |

## Scripts

All scripts live in `scripts/`. They wrap `opencode2 api`, put the result on stdout and progress on stderr, and exit 0 on success, 2 on usage or API errors (`oc-wait` exits 1 on failure or timeout).

| Script | Does | Reference |
|---|---|---|
| `scripts/oc-compact.sh` | Trigger a compaction, poll it, report the summary | `references/compact.md` |
| `scripts/oc-fork.sh` | Fork a session at a boundary, print the child id | `references/sessions.md` |
| `scripts/oc-msgs.sh` | List a session's messages as a table, or dump one message | `references/sessions.md` |
| `scripts/oc-plugin-load.mjs` | Load plugins out of process, report what they register | `references/pluginhealth.md` |
| `scripts/oc-plugins.sh` | Plugin load status table, exit 1 when a plugin failed | `references/pluginhealth.md` |
| `scripts/oc-prompt.sh` | Send a prompt to a session, print the message id | `references/sessions.md` |
| `scripts/oc-set.sh` | Switch agent and/or model on a session | `references/sessions.md`, `references/models.md` |
| `scripts/oc-status.sh` | One-line JSON status of a session | `references/sessions.md` |
| `scripts/oc-wait.sh` | Poll a session until the turn ends | `references/sessions.md` |

## Shared facts

These facts show up in more than one reference. They live here once, and the references point here.

1. **Plain serve lists nothing.** `GET /api/plugin` and `/api/command` are empty on a plain `serve` even when plugins load fine (`data: []`). Only the background service supervisor (`--service`) populates the list. Verify through the service (`opencode2 api …` without `--standalone`) and through side effects (see /api/command below). Empty list proves nothing.
2. **The endpoints are global-location-only.** `GET /api/plugin`, `/api/command` and `/api/agent` always report the *service's* default location (`location.directory` was `/home/<user>` on every call, whatever the cwd). `?location.directory=` and `--param location.directory=` are accepted and IGNORED (v2.0.3, live-verified on all three: byte-identical results, 2026-09-13). A project's `.opencode/plugins/` entries never appear in `/api/plugin` (0 of 91), and its `.opencode/` commands and agents never appear in `/api/command` or `/api/agent`: clean "0 failed" says nothing about project plugins. Check the *plugin's behaviour* or `opencode2 debug config` from inside the project, not the response's `location.project.directory`. Grep the server log (`~/.local/share/opencode/log/opencode.log`): success is `msg="loading plugin" id=<path>`, note the field is **`msg=`** while every other line uses `message=`: `message="failed to load plugin" target=<path>` (with the cause), `message="watcher subscribe" path=<…>/src/index.ts` proves nested files were read, `message="plugin reconciliation started|completed"` brackets each reload. `grep 'message="loading plugin"'` finds nothing, which reads as never loaded. For project agents, `opencode2 debug agents` IS cwd-scoped and lists them.
3. **Project discovery needs git.** Without a `.git` at/above the working directory, opencode2 resolves to `project: global` and skips project-local config and `.opencode/` dirs silently.
4. **Config key is `plugins`.** v1 `plugin` is auto-translated, but new entries use `"plugins": [{ "package": "..." }]` (strings also work). Both keys may coexist.
5. **Memory.** OpenCode v2 findings live in Hindsight bank `coding-agent::faz-lab`, tagged `topic:opencode-v2`. `recall` a quirk before answering from scratch; `retain` a new finding after it live-verifies. If the hindsight tools are absent, continue without memory.

## Read a reference

Load the matching file from `references/` before acting on its topic. The routing table names the file; it does not replace it.
