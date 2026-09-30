# Plugins

Each plugin is one directory under `plugins/` with its own `package.json`.
Shared dependencies live in `plugins/package.json`. A plugin that adds TUI
commands ships a `tui.ts` at its own directory root: the CLI resolves the TUI
entry as `<plugin-dir>/tui` and loads nothing otherwise.

Plugin IDs are `fazuh.<name>`. `sync.sh` copies the plugin directory into the
OpenCode config; a `ponytail` change also needs a cold restart, because the
nested `require()` calls inside the submodule are not cache-busted by hot
reload.

## mermaid (`fazuh.mermaid`)

Validates and exports Mermaid diagrams.

- **`mermaid-compile`** — compiles a `.mmd` source to PNG, SVG, or PDF with `mmdc` (mermaid-cli) and exports it to `docs/diagrams/` unless you pass another directory.
- **`mermaid-doctor`** — parses *and* renders every Mermaid block in the given `.html`, `.md`, `.txt`, or `.mmd` files and reports the parser's real errors with file:line locations.

## md-link (`fazuh.md-link`)

Mirrors the focused session into a Markdown file as it runs, for notes apps
that read the same directory.

Every command is client-side; nothing is sent to the model.

- TUI: `ctrl+alt:n` or `/md-link [dir]` toggles the mirror, `/md-link-open` opens it, `/md-link-open-with` sets the opener, `/md-link-auto-open [on|off]`, `/md-link-sessions`, `/md-link-dir`, `/md-link-keep [n]`, and `/md-link-persist [on|off]` control the rest.

## viz (`fazuh.viz`)

Authoring loops for one visual artifact: `write_mermaid`, `write_svg`,
`edit_mermaid`, `edit_svg`, `render_mermaid`, and `render_svg` write the source,
render it to a PNG, then open the PNG so the agent checks the result. Publishing
goes to `<project>/viz` by default; `/viz-dir [path]` sets another publish
directory.

## jev (`fazuh.jev`)

Bounded decisions from [Jev](https://typesafe.ai), TypeSafe's System One decision
model, over any provider exposing a `/systemone` endpoint. Jev answers typed
questions (`choice`, `noul`, `score`) with probabilities; it never acts, and
every tool here fails open when Jev is unavailable. Advisory only — an answer is
a signal to weigh, not a verdict.

The provider is a setting, not an assumption: the wire model id and the endpoint
path are provider-specific and neither has a portable default. `/jev-settings`
edits the endpoint, model, key source, and thresholds; `/jev-features` flips the
six feature switches. Both stay open — arrows move, enter changes one value, esc
closes — so they read like OpenCode's own settings panel. They are TUI commands,
since the desktop app loads no TUI module. `/jev-model <id>`,
`/jev-endpoint <url>`, `/jev-on`, `/jev-gate on|off`, and
`/jev-feature <name> on|off` do the same as text and work in any host. The key comes from `$CMD_API_KEY`/`$JEV_API_KEY` or a 0600
file. `/jev-key` writes it from a TUI dialog without echoing or logging it — TUI
only, so a key can never land in a transcript; `/jev-status` reports the path
for hosts with no TUI.

- **`jev_pick_skill`** — picks which installed skill to load, from the same
  `name`/`description` frontmatter the native `skill` tool already exposes.
- **`jev_check`** — one yes/no question about a piece of text, returns P(yes).
- **`jev_review_rank`** — ranks changed code by review attention and flags rules
  the change may break. Order and warnings only: a low score and a clean gate
  list never exclude code, and every item comes back.
- **`jev_pick_control`** — picks which extracted on-page control matches a goal.
  Text only; Jev cannot see a page.
- **`/jev-features`** — flips the six switches: `pick_skill`, `pick_control`,
  `review_rank`, `check`, `review_gates`, `risk_hook`. A tool whose switch is
  off refuses before sending anything, so nothing is spent. All on by default
  except `risk_hook`. The panel stays open as you toggle.
- **`/jev-gate on|off`** and **`/jev-on`** — shorthand for the `risk_hook`
  switch. With it on, every
  `bash`/`edit`/`write`/`apply_patch` call is sent to Jev and logged. A call
  blocks only when the answer is both **confident** and at or above
  `gateProbability`; a Jev failure, a low-confidence answer, or a weak one
  proceeds. Off by default, because a blocked call has no interactive prompt.
- **`/jev-log`** — recent calls: what was sent, what came back, what it cost.

Semantic grep is upstream [jegrep](https://github.com/can1357/jegrep), installed
by `install.sh -b` and pointed at the loopback shim in `src/shim.ts`, which
injects the bearer token jegrep's `--endpoint local` deliberately omits.

## ponytail (`fazuh.ponytail`)

A v2 adapter over the [ponytail](https://github.com/DietrichGebert/ponytail)
submodule at `plugins/ponytail/upstream`. Upstream ships a v1 adapter that v2
refuses to load, so this shim reuses the upstream builders and registers them
through v2 transforms. A context hook injects the mode instructions into every
session, subagents included, and the upstream command templates are registered
so `/ponytail` and its siblings work. Update the submodule with
`git submodule update --remote plugins/ponytail/upstream`.

## Commands

Command definitions are a separate item class and live in `commands/`, not in
`plugins/`. They are Markdown files with a `description` frontmatter field:

- **`/finish`** — loads the finish skill for the end-of-session workflow.
- **`/gate`** — switches the session run mode between `auto` and `interactive`, or reports the current mode.
- **`/status-report`** — reports goal progress, tracked issues, and remaining tasks for the session.
- **`/imagescan-*`** — ten single-purpose image commands (`answer`, `code`, `diagram`, `handwriting`, `latex`, `math`, `obsidian`, `ocr`, `summarize`, `translate`), all on the `chat` agent. The `imagescan` tag in `tags.conf` deploys them with the `scripts/imagescan` wrapper, which grabs a screenshot and runs one of them.
