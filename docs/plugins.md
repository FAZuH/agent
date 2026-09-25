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
