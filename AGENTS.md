# AGENTS.md

Personal OpenCode setup. This repo is the source of truth. In the managed
config dirs a symlink is repo-managed; a real file is machine-private.
`sync.sh deploy` promotes the local `deploy` branch into an XDG clone and links
each item into `~/.config/opencode/`; script executables are linked from
`~/.local/bin/`. `install.sh` installs the Rust `agent` package.

## Commands

- Check install health: `./install.sh --check` (read-only, exits 1 when a
  required item is missing). Do not run plain `./install.sh` unless asked.
- Format, lint, test: `./dev.sh all`, or `./dev.sh format lint test`. CI runs
  from `scripts/`: `cargo +nightly fmt --all -- --check`,
  `cargo clippy --all-features --all-targets --no-deps -- -D warnings`, then
  `cargo test --workspace --all-features --no-fail-fast`.
- Single Rust test: `cargo test --manifest-path scripts/Cargo.toml -p <crate> <name>`.
- Router tests: `python3 scripts/route_test.py`.
- Plugin GUI bundles: `./dev.sh gui` (bun, only dirs with `vite.config.ts`).
- Skill reference graph: `cd skills/meta/skill-doctor && python3 scripts/build_graph.py`.
- `./dev.sh docs` compiles Mermaid diagrams and may `npm install -g
  @mermaid-js/mermaid-cli` when `mmdc` is missing.

## Deploy

- `./sync.sh deploy` promotes the local `deploy` branch into
  `${XDG_DATA_HOME:-$HOME/.local/share}/fazuh-agent/config`. It links each
  skill, agent, plugin, command, and instruction into `~/.config/opencode/`
  and links script executables into `~/.local/bin/`. Add `-n` for a dry run,
  `-f` to adopt colliding real entries, `-t` to filter by `tags.conf`.
- `./sync.sh list` shows managed links beside private entries; `./sync.sh diff [ref]`
  compares the clone with the promoted ref; `./sync.sh remove` unlinks managed
  items only.
- A symlink in a managed config dir is repo-managed; a real file is
  machine-private. Never hand-edit repo-managed items or their links under
  `~/.config/opencode/` and `~/.local/bin/`: fix the repo, then deploy. There
  is no project-target config, no `pull`, no `-g`, and no placeholder templating.
- No command restarts the service. A newly added instruction link is not picked
  up until the config changes; plugin `setup()` re-runs on edit, but old
  closures keep firing until restart.
- There is no repo-side `opencode.json`; `install.sh` writes the instructions
  glob into the live config.
- External skills in `~/.agents/skills/` are upstream-owned, installed and
  updated by the `skills` CLI or their own installer. Never edit them in place;
  change upstream or reinstall. This repo's `skills/` are the only skills to edit.

## Layout

- `skills/<category>/<name>/SKILL.md` installs flat as `skills/<name>/`; the
  category directory never reaches the skill ID.
- `agents/<role>/<name>.md` installs flat as `agents/<name>.md`.
- `instructions/*.md` loads in every session through the `instructions` glob in
  `~/.config/opencode/opencode.json`. `install.sh` symlinks `terse` and
  `antislop-copywriting` into that directory so their bodies are preloaded.
- `plugins/<name>/` are OpenCode v2 plugins sharing `plugins/package.json`.
  `node_modules/` is gitignored, so run `bun install --frozen-lockfile` in
  `plugins/` after a fresh clone.
- `scripts/` is a Rust workspace (`scripts/Cargo.toml`, crates under
  `scripts/crates/`) plus Python helpers. Each executable is copied into
  `${XDG_DATA_HOME:-$HOME/.local/share}/fazuh-agent/bin/` and linked from
  `~/.local/bin/`.
- `docs/skills.md` and `docs/agents.md` are hand-maintained indexes: update
  them when adding, renaming, or removing a skill or agent.
- `.agent-values` (gitignored, from `.agent-values.example`) is kept for
  machine-local values; `sync.sh` no longer substitutes placeholders.

## Conventions

- Conventional Commits, one logical change per commit. Only `feat`, `fix`,
  `perf`, and `revert` enter the generated changelog; other allowed types are
  `docs`, `refactor`, `chore`, `test`, `build`, `ci`. A breaking change takes
  `!` or a `BREAKING CHANGE:` footer.
- Scopes are a closed vocabulary in `docs/dev/commit-scopes.md`. A new scope
  needs explicit user approval before the commit.
- `main` is unstable, `release` is CI-owned. PRs target `main`; every merge into
  `main` carries `[no ci]`; merge commits, never squash. Shipping is one
  unmarked `chore: run release` commit on `main`.
- Bump the versions pinned in `install.sh` with the `update-pins` skill, never
  by hand.
- Any artifact leaving the machine (commit, PR, issue, doc, comment, report,
  screenshot, log) passes the @report-hygiene gate first. Docs and comments
  follow @terse; published prose gets the @antislop-copywriting pass.
- New skills need frontmatter `name` plus a trigger-rich `description`;
  `skill-doctor` flags broken references and source drift.
- Do not commit another session's in-progress files. Check `git status` and
  stage only the files you changed.

## Agent skills

### Issue tracker

Engineering skills use GitHub Issues for issues and published specs.
Before tracker operations, read `docs/agents/issue-tracker.md`.
This repo configuration overrides older local-tracker instructions.

### Triage labels

Before triaging or changing state labels, read
`docs/agents/triage-labels.md`.

### Domain docs

This repo uses one domain context.
Before domain exploration or recording decisions, read
`docs/agents/domain.md`.
