# Plugins

Each plugin is one directory under `plugins/` with its own `package.json`.
Shared dependencies live in `plugins/package.json`. A plugin that adds TUI
commands ships a `tui.ts` at its own directory root: the CLI resolves the TUI
entry as `<plugin-dir>/tui` and loads nothing otherwise.

Plugin IDs are `fazuh.<name>`. `sync.sh` copies the plugin directory into the
OpenCode config.

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
  one of four things — `allow` (the call runs, and the prompt never appears),
  `ask` (the user is asked), `deny` (the call is blocked and the agent
  reads the reason), `alert` (the call is blocked, the session is interrupted,
  and the user is notified). A weak answer changes nothing. A repeated call
  reuses the first verdict.
- **`hook_tool_standard`** (off by default): the rules file. Every rule that
  matches the call is scored in one call, and a rule over its threshold is
  violated: `block` denies the call, `ask` asks the user. The file is
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
  `yoloAsk` branch, the `undecided` answer, and the approval lifetime. Each feature carries its
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

## aside (`fazuh.aside`)

`/aside <question>` forks the current session at its latest state, asks the
question in the fork, and reports back to the session that asked. The fork
keeps full history and stays open for follow-ups, unlike `/btw` which answers
once in place. In the TUI the view moves to the fork; on hosts with no TUI
module (desktop, API, mini) the fork id is in the reply. One name, one
owner: the server plugin owns the command and both tools, so they work on
every host.

The question reaches the fork inside `<question>` tags, so the fork can tell
the user's words from the plugin's own instructions around them. The session
that asked hears about the fork once, when the fork starts. That notice
labels the question as the fork's task, so the asking session does not read
it as its own instructions.

The answer comes back on the fork's own initiative through the `aside_report`
tool: the fork calls it once the question is answered, and it arrives here
wrapped in `<aside state="completed">` tags, so the fork curates what that
session gets to read. `/aside-silent` never asks for a report.

- **`/aside <question>`**: fork, ask, and tell this session the fork exists.
- **`/aside-silent <question>`**: fork and ask, with no notice and no report.
- **`aside_ask`** (`question`, `silent?`): the same fork from an agent turn,
  so the agent does not block while the fork works.
- **`aside_report`** (`text`): send the answer back. Only works inside a fork
  this plugin made.

On OpenCode Desktop its `./gui-experimental` half reads the same markers:
a fork of the session on screen opens its tab (a failure toasts instead),
a fork's composer shows a back-link pill to the session that asked, a side
panel lists the forks of the session on screen, and **Ask in a fork**
(`mod+shift+a`) opens a dialog and forks through the `aside.start` RPC,
whose contract is `rpc.ts`. Rebuild with `bun run build:gui` (or
`./dev.sh gui`); tests: `bun test plugins/aside`.


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

- **enter**: send, and steer the target, which interrupts a turn in progress.
- **ctrl+enter**: send queued. The message waits for the target's current turn
  to finish.
- **`--queue` / `--steer`**: the same two modes as a flag in the text, for the
  hosts with no key to press. The flag goes first, so the line reads
  `/tell --queue <session id> <message>`. Ctrl+enter writes the flag, so both
  routes read the same line.

A refused target fails the command, and the TUI says why.

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

## desktop-control (`fazuh.desktop`)

Screen, window, pointer, and keyboard control for this Wayland/Hyprland
desktop. It exists because the `computer-use` server drives Linux through
AT-SPI2 only: on Hyprland the a11y bus carries no real apps (no kitty, Brave,
Steam, or Wine window) and no `org.a11y.atspi.DeviceEventController` exists, so
neither its app list nor its input can work here.

Backends, chosen per action:

| Action | Backend | Reaches |
|---|---|---|
| screenshots | `grim` | every window, every monitor |
| windows, focus | `hyprctl` | every window |
| pointer | `ydotool`, closed loop | every window; needs `ydotoold` |
| keyboard | `wtype` then XTest | every window |

Nine tools: `desktop_windows`, `desktop_screenshot`, `desktop_focus`,
`desktop_click`, `desktop_move`, `desktop_drag`, `desktop_scroll`,
`desktop_type`, `desktop_key`. Coordinates are absolute desktop pixels, the
same ones `desktop_screenshot` returns, so a click can be aimed straight off a
screenshot without conversion.

`desktop_focus` accepts an address from `desktop_windows`, `class:NAME`,
`title:SUBSTR`, or a bare class/title substring; exact class beats a title
mention. `desktop_key` takes a keysym or a chord (`Return`, `ctrl+shift+t`,
`super+1`).

Pointer input needs `ydotool` and a running `ydotoold`; `/dev/uinput` must be
writable by the user. XTest is not a pointer backend: it moves XWayland's own
pointer, which the compositor ignores, so a click lands wherever the real
cursor already was. That is how a click aimed at a tab strip once landed on a
video in another window.

`ydotoold`'s virtual device advertises `EV_REL` only, so `ydotool mousemove
--absolute` does not work either — it warps. And the gain is not 1:1: on this
machine 100 units move 200 layout pixels. So `desktop_move`, `desktop_click`,
`desktop_drag`, and `desktop_scroll` close the loop against `hyprctl
cursorpos`, stepping until the pointer is within 2 px, then re-reading to
confirm the move was not still in flight. A click is only issued after that
confirmation; if the pointer does not arrive, the call reports where it
stopped and presses nothing.

Screenshot pixels are not layout pixels: the monitor sits at `332,-68`, so a
layout point is `screenshot + layoutOrigin()`. That offset is read from
`hyprctl monitors`, not assumed.

None of this makes a coordinate meaningful. The screen can change between the
screenshot that suggested a point and the click — an app going fullscreen
hides the bar — so take a fresh screenshot immediately before clicking and
check that the thing under the point is still the thing meant.

Wayland window addresses are not X11 window ids, so the plugin tells which
client is XWayland by matching class and title against the X11 window list
(`src/xtest.py windows`).

No dependencies beyond the system binaries. Tests: `bun test
plugins/desktop-control`.

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

- Delivery defaults to `queue`; `--steer` interrupts the target mid-turn.
- Full screen by default; `--window` captures the focused window.
- `--ask TEXT` overrides the instruction for one trigger.
- When the turn ends, the answer is copied to the clipboard with `wl-copy`
  (`xclip`/`xsel` fallback). `--no-copy` skips it for one trigger.
- The trigger prompt asks for the text to paste inside `<copy>` and `</copy>`
  so the post-task report stays out of the clipboard; the tags are stripped.
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

## report (`fazuh.report`)

`post_task` and `prompt_user` replace the two skill blocks at the end of a
reply. The tool stores a record; the reply carries only the answer. The
skills in `skills/shared/post-task` and `skills/shared/prompt-user` call the
tools and keep the printed block as a fallback for hosts without the plugin.

- **`post_task`** (`description`, `completed`, `deviations`, `hiccups`,
  `failed`, `next`): the @post-task report. `description` is required and at
  most 35 characters; it is the slot label. Decisions go in a separate
  `prompt_user` call.
- **`prompt_user`** (`description`, `procedures?`, `questions?`): the
  @prompt-user block for a standalone ask. `description` is required and at
  most 35 characters.
- **`report_update`** (`id?`, the same section fields): patches one record in
  place, keeping every field the call omits, and bumps its revision. `id`
  defaults to the session's latest report. Use it to revise a section instead
  of writing a second report that repeats the first.

Records are one JSON file per session under
`${XDG_STATE_HOME:-~/.local/state}/fazuh-agent/reports/`, newest last,
capped at 50; `REPORT_STATE_HOME` overrides the root. The server writes them
atomically and exposes `report.list({sessionIDs})`, `report.read`,
`report.answer`, and a `changed` event over RPC. Views pass the routed session's family
(`data.session.family`), so a subagent's reports appear in the parent's view.
Forks stay out of the family.

The TUI half (`./tui`) adds two sidebar sections, each a slot per agent
(the routed session and each subagent that has a record). **Reports** holds
post-task records, **Prompts** holds prompt-user records. The dot is yellow
while a record has questions without answers, green while unread, and gray
once read; an unread slot's name blinks. Clicking a slot opens that agent's
history for the section: `←`/`→` move through it, and `enter` on an open
prompt walks the questions and sends the answers to the agent. Opening a
record marks it read (`report.read`); reading never bumps its revision.
Answering uses **Enter** to steer the answer (interrupt and deliver now) or
**Ctrl+Enter** to queue it behind the agent's current turn; an empty answer
takes the question's recommendation. The dialog renders the record
as Markdown with padding, shows the reporting session's title, its 35-character
description, and the timestamp, colors keybinds apart from their descriptions,
and grows with `↑/↓`, `PgUp/PgDn`, and `Home/End` scrolling up to about half
the terminal height; the scroll hint appears only when the record overflows.
Each section shows at most five slots: slots needing attention first
(unread reports, unanswered prompts), then the rest, each group newest first.
The pickers list every slot. The number beside a section header counts only
the slots needing attention. `Ctrl+A` in either picker toggles that section
between all entries and attention-only (default: all). `/reports` and `/prompts` open the same histories by
picker. The GUI half
mirrors the two sections, dots, blink, older/newer, and Answer buttons in a
side panel, with a `+` menu row. Tests: `bun test plugins/report`; GUI
bundle: `./dev.sh gui`.

## Commands

Command definitions are a separate item class and live in `commands/`, not in
`plugins/`. They are Markdown files with a `description` frontmatter field:

- **`/finish`**: loads the finish skill for the end-of-session workflow.
- **`/gate`**: switches the session run mode between `auto` and `interactive`, or reports the current mode.
- **`/status-report`**: reports goal progress, tracked issues, and remaining tasks for the session.
- **`/imagescan-*`**: ten single-purpose image commands (`answer`, `code`, `diagram`, `handwriting`, `latex`, `math`, `obsidian`, `ocr`, `summarize`, `translate`), all on the `chat` agent. The `imagescan` tag in `tags.conf` deploys them with the `scripts/imagescan` wrapper, which grabs a screenshot and runs one of them.
