# Plugins

Each plugin is one directory under `plugins/` with its own `package.json`.
Shared dependencies live in `plugins/package.json`. A plugin that adds TUI
commands ships a `tui.ts` at its own directory root: the CLI resolves the TUI
entry as `<plugin-dir>/tui` and loads nothing otherwise.

Plugin IDs are `fazuh.<name>`. `sync.sh` copies the plugin directory into the
OpenCode config.

## mermaid (`fazuh.mermaid`)

Validates and exports Mermaid diagrams.

- **`mermaid-compile`**: compiles a `.mmd` source to PNG, SVG, or PDF with `mmdc` (mermaid-cli) and exports it to `docs/diagrams/` unless you pass another directory.
- **`mermaid-doctor`**: parses *and* renders every Mermaid block in the given `.html`, `.md`, `.txt`, or `.mmd` files and reports the parser's real errors with file:line locations.

## viz (`fazuh.viz`)

Authoring loops for one visual artifact: `write_mermaid`, `write_svg`,
`edit_mermaid`, `edit_svg`, `render_mermaid`, and `render_svg` write the source,
render it to a PNG, then open the PNG so the agent checks the result. Publishing
goes to `<project>/viz` by default; `/viz-dir [path]` sets another publish
directory.

## jev (`fazuh.jev`)

Bounded decisions from [Jev](https://typesafe.ai), TypeSafe's System One decision
model, over any provider exposing a `/systemone` endpoint. Jev answers typed
questions (`choice`, `noul`, `score`) with probabilities. Hooks only, no tools:
the plugin's power is automatic. Every hook fails open — a Jev outage never
blocks work — and the two tool hooks are off until you turn them on.

The provider is a setting, not an assumption: the wire model id and the endpoint
path are provider-specific and neither has a portable default. `/jev-settings`
edits the endpoint, model, key source, and the per-feature config;
`/jev-features` flips the three feature switches. Both stay open (arrows move,
enter changes one value, esc closes), so they read like OpenCode's own settings
panel. They are TUI commands, since the desktop app loads no TUI module.
`/jev-model <id>`, `/jev-endpoint <url>` do the same as text and work in any
host. The key comes from `$JEV_API_KEY` or a 0600 file. `/jev-key` writes it
from a TUI dialog without echoing or logging it. TUI only, so a key can never
land in a transcript; `/jev-status` reports the path for hosts with no TUI.

- **`hook_skill_pick`** (off by default): on each user prompt, asks Jev which
  installed skill best fits, using the host's skill registry (probed via
  `ctx.skill.list`, falling back to a scan of the same directories the host
  scans). A confident pick is injected into the next context build as one
  system line: `Jev routing: consider loading skill @<name> (P=…)`. One Jev
  call per prompt (cached across the agentic loop's turns), awaited with a
  configurable timeout (default 2000ms); a timeout or low-confidence answer
  injects nothing. Subagent sessions are skipped.
- **`hook_tool_risk`** (off by default): every tool call the host checks for
  permission, inside `hook_tool_risk.actions`, is sent to Jev, which answers
  one of four things — `accept` (the call runs, and the prompt never appears),
  `propagate` (the user is asked), `deny` (the call is blocked and the agent
  reads the reason), `alert` (the call is blocked, the session is interrupted,
  and the user is notified). A weak answer changes nothing. A repeated call
  reuses the first verdict.
- **`hook_tool_standard`** (off by default): the rules file. Every rule that
  matches the call is scored in one call, and a rule over its threshold is
  violated: `block` denies the call, `propagate` asks the user. The file is
  YAML (and YAML reads JSON, so a `.json` file works too), a rule may quote a
  file with `{file:<path>}`, and a rule may override the global action and
  threshold. A file that cannot be parsed changes nothing and says so in the
  log.
- **Sidebar section**: the plugin adds a `Jev` section to the TUI sidebar with
  the recent hook calls, one terse line each. `sidebar`, `sidebarCount` and
  `sidebarSubject` in `/jev-settings` control it.
- **`/jev-features`**: the panel. **Plugin** at the top is the master switch:
  on or off, and it does not touch the three below it. Off means no hook runs
  and nothing is sent, so nothing is spent, while the three keep their values,
  so you can configure with the plugin disabled and get your setup back when
  you re-enable it. Below it: `hook_skill_pick`, `hook_tool_risk`,
  `hook_tool_standard`.
- **`/jev-settings`**: endpoint, model, key, per-feature config rows, the
  `yoloPropagate` branch, and the approval lifetime. Each feature carries its
  own numbers; there are no global thresholds.
- **`/jev-approve [prefix]`**: pick a blocked call and let the next matching
  one through once. The grant is spent by the server, so the approved call
  costs no model call and no tokens. The picker is not filtered by the
  session on screen, because a blocked call often ran in a subagent session.
  TUI only: the picker needs a dialog, and one name has one owner.
- **`/jev-optimize-skills`**: rewrite every unoptimized skill description into a
  terse choice criterion via the host LLM (`<id>` refreshes one). The criteria
  live in `skillCriteria` in `~/.local/share/fazuh-agent/jev-data.json`, keyed
  by description hash.
- **`/jev-log`**: recent calls: what was sent, what came back, what it cost.
  Skipped-hook lines read `<feature> [on <tool>] skipped: <reason>`; a regular
  call lists its decisions and token count.

Semantic grep is upstream [jegrep](https://github.com/can1357/jegrep), installed
by `install.sh -b` and pointed at the loopback shim in `src/shim.ts`, which
injects the bearer token jegrep's `--endpoint local` deliberately omits.

## dispatch (`fazuh.dispatch`)

`/dispatch <task>` spawns a `general` subagent bound to the current session
(`parentID`) and returns immediately. The child runs in the background, same
as ctrl+b, with the parent's model. Its id is in the reply for follow-up.

## aside (`fazuh.aside`)

`/aside <question>` forks the current session at its latest state, asks the
question in the fork, and switches the view to the fork (like `/fork`).
The fork keeps full history and stays open for follow-ups, unlike `/btw`
which answers once in place. In the TUI the switch is automatic; on hosts
with no TUI module (desktop, API, mini) use `/aside-fork`, which forks and
asks but leaves the view alone — the fork id is in the reply.

## ralph (`fazuh.ralph`)

The [Ralph Wiggum](https://ghuntley.com/ralph/) loop in the session that started
it: one prompt, fed back to the model until it is done. The prompt never changes;
the repository does, so each iteration reads the previous one's work and improves
it. Ported from the upstream plugin (anthropics/claude-code), which drives the
loop from a Stop hook, and from open-ralph-wiggum, which drives it from an
external CLI. OpenCode v2 has no Stop hook, so the loop rides session events:
`session.text.ended` remembers the last thing the model said, `session.idle`
decides whether to finish, stop, or prompt again.

One loop per session, in memory. A plugin reload stops a running loop instead of
resurrecting one nobody is watching; `/ralph-status` says so. The completion
promise is checked before the iteration cap, so a turn that finished the work on
the last allowed iteration reports `complete` rather than `max`. Three turns with
no output stop the loop, so an unlimited run cannot ping-pong forever.

- **`/ralph-loop <task>`**: starts the loop. `--max-iterations N` (0 = unlimited),
  `--completion-promise TEXT` (default `COMPLETE`), `--abort-promise TEXT` for a
  task that turns out to be impossible as written. The task needs no quotes;
  quote a multi-word promise.
- **`/cancel-ralph`**: stops the loop in this session and reports the iteration.
- **`/ralph-status`**: every active loop with its iteration, elapsed time, promises, and task.

Server-side toasts are impossible from a plugin, so every decision is appended to
`~/.local/state/fazuh-agent/ralph-loops.jsonl` and the TUI tail announces starts,
stops, and errors.

## Commands

Command definitions are a separate item class and live in `commands/`, not in
`plugins/`. They are Markdown files with a `description` frontmatter field:

- **`/finish`**: loads the finish skill for the end-of-session workflow.
- **`/gate`**: switches the session run mode between `auto` and `interactive`, or reports the current mode.
- **`/status-report`**: reports goal progress, tracked issues, and remaining tasks for the session.
- **`/imagescan-*`**: ten single-purpose image commands (`answer`, `code`, `diagram`, `handwriting`, `latex`, `math`, `obsidian`, `ocr`, `summarize`, `translate`), all on the `chat` agent. The `imagescan` tag in `tags.conf` deploys them with the `scripts/imagescan` wrapper, which grabs a screenshot and runs one of them.
