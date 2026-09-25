# agent

My personal OpenCode setup: skills, agent definitions, plugins, and commands. Copies are pushed into OpenCode config dirs with `sync.sh`.

## Install

Run the installer from the repository root:

```bash
./install.sh
```

The required install:

- verifies that OpenCode v2 and the required commands are available;
- installs the `mermaid-skill`, Matt Pocock engineering and productivity skills, `simple-english`, and `papercuts`;
- initializes the repository submodules;
- installs the local Rust packages with Cargo;
- creates `.agent-values` when it is missing, then pushes the repository skills, agents, plugins, commands, and scripts to the global OpenCode config.

Use the bonus option to add the optional skills as well:

```bash
./install.sh -b
```

The bonus install adds:

- `miqdadbadjuber/anti-slop` for filtering generic AI-generated UI and copy;
- `kajisho5/ffmpeg-skill` through its manual upstream copy fallback;
- an `ffmpeg` command check because the skill edits media locally.

The installer checks system tools but does not install operating-system packages or use `sudo`. Install missing system tools first, then rerun it.

After editing the repository, push the changed copies with:

```bash
./sync.sh push -g
```

Use `./sync.sh --help` for selective tags, project targets, templates, and other deployment options.

## Skills

These split on how you'll reach for them — a guide, not hard rules about who may call what. In the repo they live under category subdirs (`skills/orchestration/…`); **`sync.sh` installs them flat** (`skills/<name>/`) because skill and agent IDs are path-derived.

- **Orchestration**: Large workflows you run manually. Runs other workflows
- **Workflow**: Workflows/procedures the agent runs. You can invoke them directly, but they're usually pulled in automatically by other skills.
- **Referential**: Modular instructions and conventions other workflows load as dependencies.
- **Standalone**: Standards and conventions the agent consults on its own to guide what it writes.

### Orchestration (you run these)

- **[orchestrate](./skills/orchestration/orchestrate/SKILL.md)**: The orchestrator role in one skill — task/todo management, delegation rules, subagent session reuse, run-mode handling, and final rules. Load it to restore the role mid-session or to start orchestrating on any agent; the routing table lives in @workflows.
- **[pr-to-close](./skills/orchestration/pr-to-close/SKILL.md)**: Take a finished worktree branch all the way to done: open the PR, watch its CI and merge when green, then close the worktree.
- **[worktree-new](./skills/orchestration/worktree-new/SKILL.md)**: Start work on a task in a new git worktree branch, keeping untracked items (`.scratch/`, `.papercuts.jsonl`) on the main project dir.
- **[worktree-finish](./skills/orchestration/worktree-finish/SKILL.md)**: Finish a worktree's pull request safely: conflict resolution, readiness checks, and asking before behavior-changing resolutions.
- **[worktree-close](./skills/orchestration/worktree-close/SKILL.md)**: Finish a worktree session (finish workflow) and clean up the worktree and its branch.

### Workflow (usually agent-run, yours to trigger too)

- **[pr-creator](./skills/workflow/pr-creator/SKILL.md)**: Create PRs following the repo's own template and standards; never from the default branch.
- **[pr-watchmerge](./skills/workflow/pr-watchmerge/SKILL.md)**: Watch a PR's CI checks and merge automatically once they pass.
- **[finish](./skills/workflow/finish/SKILL.md)**: End a session: update docs, archive a completed `.scratch/` workspace, summarize — delegates commit planning to `@commit` and self-improvement to `@self-improve`.
- **[commit](./skills/workflow/commit/SKILL.md)**: Plan commit grouping and propose one conventional message per logical group; orchestrator commits after approval (auto-commits in auto mode).
- **[self-improve](./skills/workflow/self-improve/SKILL.md)**: Gated self-improvement check — collect via `@session-retro`, validate via `@skill-doctor`, offer `@papercut-sweep` (never auto-runs it).
- **[session](./skills/workflow/session/SKILL.md)**: Manage a feature's session workspace: plan/spec doc, tickets, deviation log, checkpoints.
- **[task-context](./skills/workflow/task-context/SKILL.md)**: Per-ticket context packet in `.scratch/` — objective, base commit, relevant files, invariants, verification commands, and role-specific projections for each worker. Task-scoped and disposable; durable docs stay in `docs/dev/` (see [setup-dev-docs](./skills/workflow/setup-dev-docs/SKILL.md)).
- **[forkflow](./skills/workflow/forkflow/SKILL.md)**: Warm per-ticket delegation with OpenCode v2 forks; probes capability, switches the child before its first prompt, polls outcomes, and falls back to a fresh spawn.
- **[setup-dev-docs](./skills/workflow/setup-dev-docs/SKILL.md)**: Bootstrap, audit, or update the repo's durable developer docs under `docs/dev/` (index, development, testing, architecture, operations) — evidence-backed, preserve-existing, fix-stale only.
- **[workflows](./skills/workflow/workflows/SKILL.md)**: The orchestrator's concrete workflows and subagent routing table; loaded before any routing decision.
- **[scratch-finish](./skills/workflow/scratch-finish/SKILL.md)**: Archive a completed `.scratch/` workspace: the completion checklist and archive steps.
- **[prepare-compact](./skills/workflow/prepare-compact/SKILL.md)**: Prepare a session for context compaction: persist state, clear the goal, then offer the compaction (auto mode compacts immediately). Best used with the [opencode-context-watch plugin](https://github.com/FAZuH/opencode-context-watch/).
- **[deep-research](./skills/workflow/deep-research/SKILL.md)**: Investigate against primary sources and capture findings as a single Markdown file; wraps `mattpocock/skills` research methodology via `research-discovery`.
- **[papercut-sweep](./skills/workflow/papercut-sweep/SKILL.md)**: Sweep the global papercuts backlog (`self::` entries) and apply approved self-improvement drafts.
- **[changelog](./skills/workflow/changelog/SKILL.md)**: Create or update the changelog for the next version by comparing the current commit against the latest version.
- **[session-retro](./skills/workflow/session-retro/SKILL.md)**: End-of-session retrospective — files `self::` proposals without touching code.
- **[skill-doctor](./skills/workflow/skill-doctor/SKILL.md)**: Audit the skill/agent relation graph (`loads`/`routes`/`documents`), flag `broken-ref`/`collision`/`drift`, visualize via `scripts/skill-graph` (interactive HTML).
- **[teach](./skills/workflow/teach/SKILL.md)**: Teach anything so it locks in: graded quizzes probe your level, then a dependency map is taught node by node. Ported from [amosblomqvist/learn](https://github.com/amosblomqvist/learn).
- **[visualize](./skills/workflow/visualize/SKILL.md)**: Adds a correct, minimal diagram to a lesson when an idea is clearer as a picture; briefs a maker subagent that renders and verifies the image.
- **[offload](./skills/workflow/offload/SKILL.md)**: Offload builds, checks, or full agent batches to a remote machine over ssh; per-repo memory lives in gitignored `.opencode/offload.md`.
- **[omarchy-plugin-install](./skills/workflow/omarchy-plugin-install/SKILL.md)**: Install an Omarchy shell plugin end-to-end — mandatory clone-first malware audit via the `malware-check` subagent, then plugin add, bar placement, script/keybind setup, retiring the replaced tool, and dotfiles persistence. Machine paths come from `AGENTS.md`.

### Referential (loaded by other skills while they run)

- **[gate](./skills/referential/gate/SKILL.md)**: Approval-gate vocabulary: gate classes (`always`/`normal`/`subagent`), the `auto` run mode, and the one-line `GATE` tag convention; owns the session doc's gate-log format.
- **[following-procedures](./skills/referential/following-procedures/SKILL.md)**: How to run a numbered procedure without skipping steps: point-and-call narration, live deviation logging, and a post-run report. Every procedural skill above loads it first.
- **[scratch](./skills/referential/scratch/SKILL.md)**: The `.scratch/` workspace mechanics: slug format, layout, lifecycle.
- **[worktree](./skills/referential/worktree/SKILL.md)**: Work on a branch in a separate git worktree.

### Standalone (consulted on their own)

- **[agent-map](./skills/standalone/agent-map/SKILL.md)**: Map and maintain this personal-public agent repository: source layout, classification, authoring, validation, templating, and `sync.sh` deployment.
- **[test-guidelines](./skills/standalone/test-guidelines/SKILL.md)**: Test writing guidelines: validity, isolation, determinism, test doubles, anti-patterns, coverage.
- **[gui-test-guidelines](./skills/standalone/gui-test-guidelines/SKILL.md)**: GUI/E2E test automation guidelines: selectors, Page Object, visual regression, accessibility.
- **[rust-idioms](./skills/standalone/rust-idioms/SKILL.md)**: Type-driven Rust design patterns — newtype, typestate, sealed traits, RAII guards, error and dispatch design.
- **[logging-guidelines](./skills/standalone/logging-guidelines/SKILL.md)**: Structured logging with wide events, correlation, and safe redaction.
- **[design-tradeoffs](./skills/standalone/design-tradeoffs/SKILL.md)**: Compare design options with structured tradeoff analysis.
- **[scheduled-task](./skills/standalone/scheduled-task/SKILL.md)**: Manage scheduled tasks with systemd user timers (`octask` CLI on `$PATH` — add/remove/list/enable/disable/status/logs; `octask-` prefixed units, OnCalendar validation).
- **[scheduled-agent](./skills/standalone/scheduled-agent/SKILL.md)**: Schedule unattended agent runs on user timers (`octask add --agent ...`), with a deny-all-by-default restricted agent template.
- **[issue-closeout](./skills/standalone/issue-closeout/SKILL.md)**: Link merged PRs to resolved issues — closeout comment with PR/SHA, close issues where `Closes #N` does not fire.
- **[oop](./skills/standalone/oop/SKILL.md)**: Standard OOP/architecture vocabulary — principles, smells, patterns, and metrics. Use when you want findings, reviews, or design discussions phrased in OOP terms ("use oop terms").
- **[improve-architecture-oop](./skills/standalone/improve-architecture-oop/SKILL.md)**: OOP vocabulary overlay for @improve-codebase-architecture findings and diagrams (loads @oop).
- **[read-pdf](./skills/standalone/read-pdf/SKILL.md)**: Parse/read PDFs — decision tree over pdftotext, rga, pdfplumber, image rendering + vision, OCR; offers to install missing tools and records declined installs as approval gates in the project AGENTS.md.
- **[readme](./skills/standalone/readme/SKILL.md)**: Standardize a README.md to house style: tagline, outline nav, Installation → Preview → Usage up top, Docs → License at bottom.
- **[commit-scopes](./skills/standalone/commit-scopes/SKILL.md)**: Create or update the closed vocabulary for Conventional Commit scopes (`docs/dev/commit-scopes.md`).
- **[rust-tea](./skills/standalone/rust-tea/SKILL.md)**: Renderer-agnostic Elm Architecture (TEA/MVU) for Rust — Model/Message/Update/View/Effects for iced and ratatui apps.
- **[external-skills](./skills/standalone/external-skills/SKILL.md)**: Install, update, list, or remove upstream-owned (External class) skills via the `skills` CLI — check `npx skills --help` first, install with `--global --agent opencode --yes`, manual clone+copy fallback when the CLI rejects a repo.

### OpenCode v2 (ocv2)

- **[ocv2-api](./skills/ocv2/ocv2-api/SKILL.md)**: Use `opencode2 api` to call the v2 HTTP API and where its docs live.
- **[ocv2-compact](./skills/ocv2/ocv2-compact/SKILL.md)**: Compact a v2 session via the API — trigger, poll the summary, nothing-to-compact and steer gotchas.
- **[notes](./skills/standalone/notes/SKILL.md)**: Read and maintain durable notes for tools, CLIs, APIs, scheduled agents, and OpenCode v2.
- **[ocv2-models](./skills/ocv2/ocv2-models/SKILL.md)**: Pick a free model when the default account is dry — list with `opencode2 models | rg -i free`, switch the live session via the model endpoint.
- **[ocv2-sessions](./skills/ocv2/ocv2-sessions/SKILL.md)**: Fork a session and control the fork — switch agent & model, verify, talk, wait.
- **[ocv2-move](./skills/ocv2/ocv2-move/SKILL.md)**: Move a session to another project directory.
- **[ocv2-pluginhealth](./skills/ocv2/ocv2-pluginhealth/SKILL.md)**: Inspect plugin status and errors.
- **[ocv2-unfuck](./skills/ocv2/ocv2-unfuck/SKILL.md)**: Verify top-level tool availability before claiming restricted mode.

## Agents

Agent definitions grouped by role in `agents/<category>/` (installed flat as
`agents/<name>.md`). IDs are path-derived, so the flat install keeps the names
the orchestrator and subagent tool reference.

| Category | Agents |
| --- | --- |
| `primary` | **[orchestrator](./agents/primary/orchestrator.md)** (routes work to subagents), [autocommit](./agents/primary/autocommit.md) (unattended conventional commits; ask-by-default permissions), [chat](./agents/primary/chat.md), [tutor](./agents/primary/tutor.md) |
| `build` | [implement](./agents/build/implement.md) (implementation, verification, dev servers) |
| `review` | [review](./agents/review/review.md), [malware-check](./agents/review/malware-check.md), [pii-check](./agents/review/pii-check.md) |
| `research` | [research-discovery](./agents/research/research-discovery.md) (codebase mapping + primary-source findings), [research-synthesis](./agents/research/research-synthesis.md) (web research brief) |
| `vision` | [image-viewer](./agents/vision/image-viewer.md), [web-viewer](./agents/vision/web-viewer.md), [mermaid-maker](./agents/vision/mermaid-maker.md), [svg-maker](./agents/vision/svg-maker.md) |
| `document` | [document](./agents/document/document.md) |

The learning system (ported from oc-learn) supplies the visual makers
(`mermaid-maker`, `svg-maker`) and the @teach/@visualize skills.

## Plugins

- `plugins/mermaid/` — `mermaid-compile` + `mermaid-doctor` tools (fazuh.mermaid)
- `plugins/md-link/` — live-mirror a session to a markdown file (fazuh.md-link; TUI: `ctrl+alt:m` / `/md-link`)
- `plugins/viz/` — `write_*/edit_*/render_*` authoring loops + `/viz-dir` (fazuh.viz)

A plugin that adds TUI commands ships a file named `tui.ts` at its own
directory root; the CLI resolves the TUI entry as `<plugin-dir>/tui` and loads
nothing otherwise.

### Dependency Diagrams

![Orchestration](docs/diagrams/skill-relations-orchestration.png)

![Referential dependencies](docs/diagrams/skill-relations-referential.png)

## License

MIT
