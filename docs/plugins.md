# Plugins

Each plugin is one directory under `plugins/` with its own `package.json`.
Shared dependencies live in `plugins/package.json`. A plugin that adds TUI
commands ships a `tui.ts` at its own directory root: the CLI resolves the TUI
entry as `<plugin-dir>/tui` and loads nothing otherwise.

Plugin IDs are `fazuh.<name>`. `sync.sh` copies the plugin directory into the
OpenCode config.

## jev (`fazuh.watchdog`)

Bounded decisions from [Jev](https://typesafe.ai), TypeSafe's System One decision
model, over any provider exposing a `/systemone` endpoint. Jev answers typed
questions (`choice`, `noul`, `score`) with probabilities. Hooks only, no tools:
the plugin's power is automatic. Every Jev decision hook fails open, so a Jev
outage never blocks work, except the no-respawn admission path, which denies
when it cannot decide. All five switches are off until you turn them on.

The provider is a setting, not an assumption: the wire model id and the endpoint
path are provider-specific and neither has a portable default. `/jev-settings`
edits the endpoint, model, key source, and the per-feature config;
`/jev-features` flips the five feature switches. Both stay open (arrows move,
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
  configurable timeout (default 5000ms); a timeout or low-confidence answer
  injects nothing. Subagent sessions are skipped.
- **`hook_tool_risk`** (off by default): every tool call the host checks for
  permission, inside `hook_tool_risk.actions`, is sent to Jev, which answers
  one of four things — `allow` (the call runs, and the prompt never appears),
  `propagate` (the user is asked), `deny` (the call is blocked and the agent
  reads the reason), `abort` (the session stops and the user is notified).
  A weak answer changes nothing. A repeated call reuses the first verdict.
- **`hook_tool_standard`** (off by default): the rules file. Every rule that
  matches the call is scored in one call, and a rule over its threshold is
  violated: `block` denies the call, `propagate` routes it to the user. The file is
  YAML (and YAML reads JSON, so a `.json` file works too), a rule may quote a
  file with `{file:<path>}`, and a rule may override the global action and
  threshold. A file that cannot be parsed changes nothing and says so in the
  log.
- **`hook_no_respawn`** (off by default): stops an aborted task from being
  replaced automatically in the same turn. Admission runs before the wrapped
  `subagent` call; a replacement holds as the host's own permission prompt,
  where `once` grants that call, `reject` denies it, and `always` grants that
  call only, because the plugin passes no `save` array. An unanswered hold
  denies after 60 seconds when it is the session's only pending prompt. State
  under `~/.local/state/opencode/jev/nospawn/`; see [jev.md](jev.md).
- **`hook_supervisor`** (off by default): resolves a Jev `propagate`, `deny`, or
  `abort` through a separate supervisor model before the human prompt. It stays
  off until its own model and endpoint are configured, and adds no second
  permission hook: the native hold stays open while a bounded investigation
  runs in the background. The four verdicts are `allow`, `deny`, `abort` and
  `propagate`. An `allow` releases the call; a `deny` hands it back to the user;
  an `abort` stops the session. Failure and budget exhaustion become `propagate`.
  There is no silent allow. Evidence is read-only project files, search and constrained Git inside
  the configured root, bounded by 30 seconds, three model rounds and six
  evidence calls. This is a workflow guardrail, not a security sandbox; see
  [jev.md](jev.md#the-hooks).
- **Sidebar section**: the plugin adds a `Jev` section to the TUI sidebar with
  the recent hook calls, one terse line each. `sidebar`, `sidebarCount` and
  `sidebarSubject` in `/jev-settings` control it.
- **`/jev-features`**: the panel. **Plugin** at the top is the master switch:
  on or off, and it does not touch the five below it. Off means no hook runs
  and nothing is sent, so nothing is spent, while the five keep their values,
  so you can configure with the plugin disabled and get your setup back when
  you re-enable it. Below it: `hook_skill_pick`, `hook_tool_risk`,
  `hook_tool_standard`, `hook_no_respawn`, `hook_supervisor`.
- **`/jev-settings`**: endpoint, model, key, per-feature config rows, the
  `yoloAsk` branch, the `undecided` answer, and the approval lifetime. Each feature carries its
  own numbers; there are no global thresholds. The `hook_supervisor` rows hold
  its separate model, endpoint, protocol, key, evidence root and budget.
- **`/jev-approve [prefix]`**: pick a blocked call and let the next matching
  one through once. The grant is spent by the server, so the approved call
  costs no model call and no tokens. The picker is not filtered by the
  session on screen, because a blocked call often ran in a subagent session.
  TUI only: the picker needs a dialog, and one name has one owner.
- **`/jev-abort [prefix] | session`**: stop a task of this session by
  fingerprint prefix, or the whole session. It seals the tombstone before
  revoking, interrupts the bound children, and fences each one. It refuses with
  a named reason when no host is registered, the switch is off, nothing matches,
  a prefix is ambiguous, the store is unreadable, or the task already ended, and
  it reports `NOT DURABLE` and `NOT FENCED` rather than implying either.
- **`/jev-optimize-skills`**: rewrite every unoptimized skill description into a
  terse choice criterion via the host LLM (`<id>` refreshes one). The criteria
  live in `skillCriteria` in `~/.local/state/opencode/jev/jev-data.json`, keyed
  by description hash.
- **`/jev-log`**: recent calls: what was sent, what came back, what it cost.
  Skipped-hook lines read `<feature> [on <tool>] skipped: <reason>`; a regular
  call lists its decisions and token count.

Semantic grep is upstream [jegrep](https://github.com/can1357/jegrep), pointed
at the loopback shim in `src/shim.ts`, which injects the bearer token jegrep's
`--endpoint local` deliberately omits. `install.sh` does not install it;
install it yourself if you want that use case (see
[jev.md](jev.md#the-jegrep-shim)).

## dispatch (`fazuh.dispatch`)

`/dispatch <task>` spawns a `general` subagent bound to the current session
(`parentID`) and returns immediately. The child runs in the background, same
as ctrl+b, with the parent's model. Its id is in the reply for follow-up.
The child is marked in its session metadata (`dispatch` key), the only link
between a parent and its dispatches.

On OpenCode Desktop its `./gui-experimental` half reads those markers. A
dispatch from the session on screen opens the child's tab in the background
and toasts with a **View subagent** action, and the composer shows a pill
with every dispatch of the session, its status, and a click to switch to
it. Rebuild with `bun run build:gui` (or `./dev.sh gui`); tests:
`bun test plugins/dispatch`.

## branch (`fazuh.branch`)

The plugin forks a session, sends it a prompt, and lets the fork report back to
the session that asked. Two sources:

- `/branch <prompt>` and `branch_ask` fork the current primary session. The
  fork keeps that session's agent and full history, so it needs no brief.
- `branch_subagent` forks a finished subagent below the caller in the session
  tree. The fork keeps that subagent's agent, model, and history, so follow-on
  work starts from what that subagent already did.

`/branch-silent` and `silent: true` skip both the notice and the report. A fork
stays open for follow-ups, unlike `/btw` which answers once in place. The fork
id is in the reply; the TUI and desktop open the fork when the asking session
is on screen, unless `background` is set. One name, one owner: the server owns
the commands and the three tools, so they work on every host.

The prompt reaches the fork inside `<prompt>` tags, so the fork can tell the
user's words from the plugin's own instructions around them. The session that
asked hears about the fork once, when the fork starts. That notice labels the
prompt as the fork's task, so the asking session does not read it as its own
instructions.

The answer comes back on the fork's own initiative through the `branch_report`
tool: the fork calls it when the work is done, and it arrives here wrapped in
`<branch state="completed">` tags, so the fork curates what that session gets
to read. A fork reports once; a second call is refused. A silent fork never
asks for a report.

- **`/branch <prompt>`**: primary session only. Fork, send the prompt, and tell
  this session the fork exists.
- **`/branch-silent <prompt>`**: primary session only. Fork with no notice and
  no report.
- **`branch_ask`** (`prompt`, `agent?`, `silent?`, `background?`): primary
  session only. The same fork from an agent turn, so the turn does not block.
- **`branch_subagent`** (`sessionID`, `prompt`, `agent?`, `silent?`,
  `background?`): any agent. Fork a finished subagent in this session's tree.
  The target must be a child or deeper descendant with a parent and a completed
  turn; a running target is refused so the fork copies a whole turn, and a
  target outside the tree is refused.
- **`branch_report`** (`text`): send the answer back. Only works inside a fork
  this plugin made, once.

`agent` switches the fork's role before it starts. The switch rewrites the
system prompt, so the shared prefix is no longer cached; omit it to keep the
source's role and the cache. A fork of a subagent is a root session, so the
caller collects through `branch_report`, not OpenCode's automatic subagent
report.

`/branch-settings` sets `maxForks`, the reporting forks in flight per caller
(0 = unlimited), and `reportBatchMs`, which batches reports to one prompt
(0 = off). Silent forks are not counted, and `branch_ask` and `branch_subagent`
share the cap.

On OpenCode Desktop its `./gui-experimental` half reads the same markers: a
fork of the session on screen opens its tab (a failure toasts instead), a
fork's composer shows a back-link pill to the session that asked, a side panel
lists the forks of the session on screen, and **Ask in a fork**
(`mod+shift+a`) opens a dialog and forks through the `branch.start` RPC, whose
contract is `rpc.ts`. The command is disabled in a subagent session. Rebuild
with `bun run build:gui` (or `./dev.sh gui`); tests: `bun test plugins/branch`.


## tell (`fazuh.tell`)

`/tell <session id> <message>` sends the message to a subagent of the session
that asked. The target has to sit in the caller's own tree: a child, a
grandchild, or deeper. Anything outside the tree is refused, whether the id
was picked from the list or typed by hand.

In the TUI, `/tell ` opens a list of the caller's subagents with their titles.
The typed text filters the list, arrows move, enter puts the session id where
the id belongs, esc closes. The message is typed after the id. One name, one
owner: the server owns the command, so the text form works in every host,
including the ones that load no TUI module.

- **enter**: send, and steer the target. Steer runs after the target's current
  turn ends; measured on 2.2.7, it aborts nothing.
- **ctrl+enter**: send queued. The message waits for the target's current turn
  to finish.
- **`--queue` / `--steer`**: the same two modes as a flag in the text, for the
  hosts with no key to press. The flag goes first, so the line reads
  `/tell --queue <session id> <message>`. Ctrl+enter writes the flag, so both
  routes read the same line.

A refused target fails the command, and the TUI says why.

## announce (`fazuh.announce`)

`/announce-global <message>` sends the message to every currently running
OpenCode session, subagents included. `/announce-session <message>` sends it
to the calling session and its running descendants. The server owns both
commands. They have no TUI half and take no flags in v1.

The target set comes from `GET /api/session/active`. "Active" means running,
not merely alive or idle. A session that is open but not running a turn is not
a target. For a session announcement, the command maps each session to its
children, then walks down from the caller to its descendants and keeps only
those that are running.

Each delivery is a steer prompt. It wakes an idle target and runs after any
current turn, so it never interrupts work already in progress. Every target
runs a new turn on receipt. A global broadcast reaches many sessions and so
costs many turns.

The message is framed with an `[announce ...]` prefix that names the scope and
the calling session. The message text is unchanged apart from trimmed outer
whitespace.

An empty message fails with a usage error in the transcript. A failed lookup
of the active sessions also fails, with the reason in the transcript. One dead
target does not block delivery to the others; the command reports the ids it
could not reach in one error.

## board-bridge (`fazuh.board-bridge`)

Wakes OpenCode sessions from a self-hosted Vercel Board. The plugin long-polls
the board's `/events` endpoint in the `wake` channel and delivers a steer prompt
to the session named by the `wake` label on a new message. It has no commands or
tools.

To wake a session, post in `wake` with a label that holds its session id:

```sh
BOARD_URL=http://127.0.0.1:4100/api/board vb post wake "please review" \
  --label wake=ses_example00000000 --as fx
```

The prompt names the channel, message id, author, and hop count, then the
message text. It tells the session to treat that text as information and reply
in the same thread. Steer wakes an idle session and queues behind a running
turn.

Credentials come from `BOARD_TOKEN`, `BOARD_BRIDGE_TOKEN_FILE`, or the token
file written by `vb serve` under `~/.config/board/local/`. The board URL
defaults to `http://127.0.0.1:4100/api/board`; set `BOARD_URL` to change it.
`BOARD_BRIDGE_CHANNEL`, `BOARD_BRIDGE_LABEL`, `BOARD_BRIDGE_HOP_LIMIT`,
`BOARD_BRIDGE_MAX_PER_MINUTE`, and `BOARD_BRIDGE_SEEN_TTL_MS` override the
defaults. `BOARD_BRIDGE_DISABLE=1` skips setup. The last event cursor and the
recent message ids are kept in plugin storage, so a restart resumes where it
stopped instead of replaying or losing messages posted while it was down.

A `hops` label carries a chain count. A wake at or above the hop limit is
suppressed, as is a repeated message id or more than ten wakes for one session
in a minute. The plugin writes nothing back to the board. Poll failures back
off and retry; a bad token disables it with a warning.

Tests: `bun test plugins/board-bridge`.

## tree (`fazuh.tree`)

Localhost viewer for one session family as a message-level graph: each
session is a vertical lane, each node a message, like a git history. `/tree`
opens `http://127.0.0.1:47821/?session=<current session>`.

- Lane columns are ordered by session creation. A lane's header carries the
  session title in its kind colour (slate root, blue subagent, purple fork);
  below it follow the recent messages, newest at the bottom. The last 120
  messages of a root, 60 of a fork, and 30 of a subagent render, plus the
  branch points below; longer gaps collapse into an `… N` ellipsis node.
- Solid grey flow edges join consecutive messages in a lane. A subagent
  starts with a dotted blue spawn edge from the parent message nearest its
  birth; a dashed purple fork edge runs from the boundary message to the
  fork's header. A stopped, succeeded subagent gets a solid blue merge edge
  from its last message back into the parent's next message, and the lane is
  marked `merged`.
- A busy subagent is live: its newest message pulses (a class toggled every
  500 ms) and its header tooltip says `live`. A stopped one does not pulse.
  History past the per-kind cap is dropped, never merged away.
- Families over 40 lanes group subagents by agent: each agent with at least
  two lanes collapses into one rounded-rectangle group header
  (`<agent> × <count>`, plus `live ×<n>` when any member is busy) placed at
  its earliest member's position, rendering no member messages or edges.
  Forks, the root, and single-member agents stay as normal lanes. A
  collapsed group is one node only; member message nodes appear only on
  expansion. Clicking a group header expands its lanes in place
  (`?expand=<agent>`, repeatable); clicking it again collapses. Each
  expanded member's header reads `<agent> · <messages> msg · <cost>`. The
  header counts read `<total lanes> lanes · <groups> groups · …`.
- Rendered messages are capped in total at 2000 by default
  (`options.maxNodes`, `OPENCODE_TREE_MAX`, or `?max=`; `?max=0` disables
  the cap). Over the budget the oldest message nodes drop, per lane oldest
  first; headers and branch/merge boundary nodes stay. The payload reports
  `omittedMessages` and `budgeted: true` in `graph.stats`.
- The first load opens centred at ~1x on the focused lane's header (the
  `?session=` lane, its group lane, else the first busy lane) instead of
  fitting the whole family. Changing the root re-fits only families under
  40 lanes; larger ones centre the same way.
- Click any node to open a floating dialog anchored to it (Esc, backdrop,
  or the close button dismisses it); clicking never navigates directly.
  The dialog shows the session's title, agent, model, status, cost, token
  counts, directory, last update (and merged time when applicable), and the
  last 5 message previews of that lane; message nodes add the clicked
  message's role, index, and preview. Its `Open in OpenCode` button is the
  only link to `<web base>/session/<session>`. A group header's dialog
  shows the group counts, an Expand/Collapse button, and a small
  `show in OpenCode` link to the earliest member. Hover on a message shows
  role, `msg <i> of <n>`, a 60-character preview, and relative time; on a
  header it shows agent, model, outcome, status, cost, token counts,
  directory, last update, and `merged <rel>` when applicable; a group
  header shows its member count and live count. Preview text is capped at
  240 characters per message.
- Live refresh every 3 s, root selector, Labels Auto/On/Off, zoom and fit.
  Wheel zoom is eased towards the cursor and wheel speed is raised to 1.5;
  labels auto-hide above 60 nodes or below 0.75 zoom (group header labels
  stay visible unless Labels is Off).
- Link base: `options.webBaseURL` or `OPENCODE_TREE_WEB_BASE`, else the
  configured service host:port (`~/.config/opencode/service.json`) when it
  answers within 500 ms, else the live service URL
  (`~/.local/state/opencode/service.json`), else `http://127.0.0.1:4096`.
  `?base=` overrides it per page load.
- Server: `Bun.serve` on `127.0.0.1:47821`; `OPENCODE_TREE_HOST` and
  `OPENCODE_TREE_PORT` change the binding, and the next port is used when the
  default is taken. Read-only and unauthenticated: session titles, ids,
  directories, and message previews are visible to anything that can reach
  that port, so leave it on loopback.
- No dependencies. `web/cytoscape.min.js` is vendored (MIT, 3.34.4).
  Tests: `bun test plugins/tree`.

## desktop-ask (`fazuh.desktop-ask`)

Sends a screenshot from a keybind to one armed session and asks the
instruction that session stored. The target is
`${XDG_STATE_HOME:-~/.local/state}/opencode/desktop-ask/target.json`, one file
that every plugin instance and the CLI read, so the last session to arm wins.

Arming is explicit. `/desktop-ask <instruction>` or the `desktop_ask_arm` tool
makes the current session the target; `/desktop-ask off` or
`desktop_ask_disarm` clears it. `SUPER + SHIFT + V` runs
`~/.local/bin/desktop-ask trigger`, which captures with `grim` and prompts the
target with the image attached.

- Delivery defaults to `queue`; `--steer` wakes an idle target and otherwise
  runs after the current turn.
- Full screen by default; `--window` captures the focused window.
- `--region` takes image pixels, `WxH` or `X,Y WxH`, and is converted to layout
  coordinates before grim runs. Shots are captured at layout scale, so each
  image pixel matches a desktop coordinate.
- `--ask TEXT` overrides the instruction for one trigger.
- When the turn ends, the answer is copied to the clipboard with `wl-copy`
  (`xclip`/`xsel` fallback). `--no-copy` skips it for one trigger.
- The trigger prompt asks for the text to paste inside `<copy>` and `</copy>`
  so the rest of the reply stays out of the clipboard; the tags are stripped.
  A reply without them is copied whole.
- The copy runs in the plugin after the trigger returns. Its outcome lands in
  `.../desktop-ask/last-copy.json`, and `desktop-ask status` prints it.
- RPC: `POST /api/rpc/desktop-ask/{trigger,arm,status,disarm}`, routed with
  `location[directory]`. Trigger errors: `not_armed`, `no_session`,
  `capture_failed`, `prompt_failed`, `state_failed`.
- Shots go to `.../desktop-ask/shots/`; the newest 50 are kept.
- The prompt fences the user instruction and tells the agent to treat the
  screenshot as data, not instructions.

Tests: `bun test plugins/desktop-ask`.

## prompt (`fazuh.prompt`)

`prompt_user` replaces the prompt-user block at the end of a reply. The tool
stores a record; the reply carries only the answer. The skill in
`skills/shared/prompt-user` calls the tool and keeps the printed block as a
fallback for hosts without the plugin.

- **`prompt_user`** (`description`, `procedures?`, `questions?`, `block?`): the
  @prompt-user block for a standalone ask. `description` is required and at
  most 35 characters. Calls are non-blocking by default: the tool returns
  immediately and the answer arrives as a new message. Set `block: true` only
  when the user explicitly asks to wait for the answer in the same turn; it
  needs at least one question. A dismissed blocking prompt returns as
  dismissed, and a deferred one returns as deferred and stays unanswered.
- A question left blank, on a card submitted with no field values or in the TUI,
  is recorded with no answer and shown as "Not answered" in the agent's text
  and the views. The recommendation stays a hint on the card and is never used
  as an answer.

Records are one JSON file per session under
`${XDG_STATE_HOME:-~/.local/state}/opencode/prompt/prompts/`, newest last,
capped at 50; `OPENCODE_PROMPT_STATE_HOME` overrides the root. The server
writes them atomically and exposes `prompt.list({sessionIDs})`,
`prompt.answer`, `prompt.dismiss`, `prompt.defer`,
`prompt.reopen({sessionID, promptID?})`, and a `changed` event over RPC. The
view passes the routed session's family (`data.session.family`), so a
subagent's prompts appear in the parent's view. Forks stay out of the family.

The server also opens each prompt as a native question card through
`POST /api/session/{id}/form`, with `metadata.kind: "question"` because Desktop
and the web client render only that kind (and `mcp-elicitation` and
`websearch.provider`). Creating it server-side is what reaches the mobile web
app, which loads no plugin UI half. Its fields are one per question, with the
recommendation as the first option and free text still allowed. The host paints
`description ?? title` as the card's question text and never shows `title` on
its own, and newlines collapse, so each description leads with a bracketed
title to keep it distinct from the body. The server
listens for `form.replied` and `form.cancelled` and settles the same record the
RPC handles, so answering the card, the TUI section, or the Desktop panel all
take one path. `/prompt-latest` reopens the latest unanswered prompt as a new
card when the old one is still pending or has scrolled away. It is registered
once, server-side, so TUI, Desktop, and mobile autocomplete each show a single
entry. GUI errors are read from the object's `message` field so RPC failures do
not render as `[object Object]`.

The Desktop panel is read-only history in three tabs: **Awaiting**, **Answered**
and **Dismissed**, each with a count. One tab shows at a time; the session bar
switches sessions when the family has more than one. A card shows the title, a
one-line preview and the session with a relative time, plus **Reopen card** and
**Dismiss** for an awaiting record. **View full prompt** replaces the list with
the whole prompt: a state badge, the session line, the Markdown, and the same
two actions. A single `← Prompts` button returns to the tabbed list. The panel does not answer through
its own dialogs, so the native card is the only answer surface. **Reopen card**
calls `prompt.reopen` with the prompt id. Because the host shows one card at a
time and queues later ones, `prompt.reopen` cancels every card this plugin has
open in that session before creating the new one: the selected prompt replaces
the card on screen instead of waiting behind it. The prompts themselves stay
unanswered. **Dismiss** asks for confirmation in both the card and the full
view, then calls `prompt.dismiss` with the session and prompt id.

The Awaiting tab has a bulk bar with the family-wide awaiting count and
**Dismiss all**. It asks for confirmation, then calls
`prompt.dismissAll({sessionIDs})` to mark every unresolved prompt in the family
as dismissed, including prompts with no questions. The bulk handler reads each
session's prompts before settling any of them, so one pass cannot dismiss a
prompt twice. It closes any card those prompts had open and leaves answered and
already-dismissed records untouched.

The TUI half (`./tui`) adds one sidebar section, a slot per agent (the routed
session and each subagent that has a record). OpenCode Desktop's
`./gui-experimental` half adds **Prompts** to the session panel menu. It lists
the same family, opens each agent's prompt history, and offers **Answer** and
**Dismiss**. Answering walks the questions, then offers steer or queue;
cancelling defers the prompt without answering. Both delivery modes wait for
a running turn to end; steer also wakes an idle agent. Rebuild its shipped
`dist/gui-experimental.cjs` with `bun run --cwd plugins/prompt build:gui` or
`./dev.sh gui`. The TUI dot is yellow while a record has questions without
answers, and muted once it is
answered or dismissed. Clicking a slot opens that agent's history: `←`/`→`
move through it, `Ctrl+↑`/`Ctrl+↓` switch to the previous/next session in the
list the history was opened from (wrapping at the ends; with the attention
filter on, sessions with nothing matching are skipped), and `enter` on an open
prompt walks the questions and sends the answers to the agent. Answering uses
**Enter** to steer the answer or **Ctrl+Enter** to queue it; both wait for the
agent's current turn to end, and steer is the lane that wakes an idle session.
An empty answer takes the question's recommendation. The answers reach the
agent as a `# Prompt: <description>` block with each question and its answer
under it, like the host's question card. The dialog renders the record as
Markdown with padding, shows the reporting session's title, its 35-character
description, and its relative age, colors keybinds apart from their
descriptions, and grows with `↑/↓`, `PgUp`/`PgDn`, and `Home`/`End` scrolling
up to about half the terminal height; the scroll hint appears only when the
record overflows. The native card caps each question body at 12 lines and
1,200 characters and appends a pointer to the Prompts section, because the
host card has no height cap or scroll. The answer dialog centers vertically and bounds the question
body to about a quarter of the terminal height, with `PgUp`/`PgDn` scrolling,
so the answer field and key hints stay visible under a long question.

The section shows at most five slots: unanswered first, then the rest, each
group newest first. The picker lists every slot. The number beside the section
header counts only the slots needing an answer. `Ctrl+A` in the picker toggles
the section between all entries and unanswered-only (default: all); inside a
history it filters the entries to unanswered prompts, using the state when the
key was pressed so dismissing the shown entry does not remove it, and `Ctrl+A`
again shows all. `/prompts` opens the same history by picker;
`/dismiss-prompts` dismisses every prompt still awaiting an answer. Context
usage is not drawn here: the `opencode-context-watch` plugin renders its own
sidebar section. `/prompt-settings` toggles the whole sidebar and the Prompts
section; the flags persist in the `prompt-view-v2` view store, and the
existing collapse state stays separate. Tests: `bun test plugins/prompt`.

## Commands

Command definitions are a separate item class and live in `commands/`, not in
`plugins/`. They are Markdown files with a `description` frontmatter field:

- **`/finish`**: loads the finish skill for the end-of-session workflow.
- **`/gate`**: switches the session run mode between `auto` and `interactive`, or reports the current mode.
- **`/status-report`**: reports goal progress, tracked issues, and remaining tasks for the session.
- **`/imagescan-*`**: ten single-purpose image commands (`answer`, `code`, `diagram`, `handwriting`, `latex`, `math`, `obsidian`, `ocr`, `summarize`, `translate`), all on the `chat` agent. The `imagescan` tag in `tags.conf` deploys them with the `scripts/imagescan` wrapper, which grabs a screenshot and runs one of them.
