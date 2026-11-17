# AGENTS.md

Personal OpenCode setup. This repo is the source of truth: `sync.sh` copies
skills, agents, plugins, commands, and instructions into `~/.config/opencode/`,
executables into `~/.local/bin/`, and installs the Rust `agent` package.

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

- `./sync.sh push -g` deploys everything. Scope it: `./sync.sh push skills` or
  `./sync.sh push skills agents`; `-t dev,utils,ocv2,desktop` filters by `tags.conf`.
- A top-scoped push still ships every changed item under that top, including
  another session's uncommitted work. Run `./sync.sh diff <top>` first.
- Never hand-edit deployed copies: `~/.config/opencode/**`, `~/.local/bin/*`,
  or `~/.agents/skills/**`. Fix the repo, then push. There is no repo-side
  `opencode.json`; `install.sh` writes the instructions glob into the live config.
- External skills in `~/.agents/skills/` are upstream-owned, installed and
  updated by the `skills` CLI or their own installer. Never edit them in place;
  change upstream or reinstall. This repo's `skills/` are the only skills to edit.
- `./sync.sh pull` overwrites repo files from the live config. Run it only when
  the live copy is the intended source.
- OpenCode v2 hot-reloads most components. Do not restart after a push unless a
  component stays missing or a plugin fails to load.

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
  `scripts/crates/`) plus Python helpers. Every executable file in `scripts/`
  deploys to `~/.local/bin/`.
- `docs/skills.md` and `docs/agents.md` are hand-maintained indexes: update
  them when adding, renaming, or removing a skill or agent.
- `.agent-values` (gitignored, from `.agent-values.example`) fills `{{KEY}}`
  placeholders; a push fails on an unresolved placeholder.

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
