# agent

My personal OpenCode setup: skills, agent definitions, plugins, and commands. Copies are pushed into OpenCode config dirs with `sync.sh`.

## Install

### Prerequisites

- [creating-mermaid-diagrams](https://github.com/Agents365-ai/creating-mermaid-diagrams): For creating mermaid diagrams
- [mattpocock's skills](https://github.com/mattpocock/skills): Software engineering
- [papercuts](https://github.com/FAZuH/papercuts): Tiny CLI that gives AI agents a complaint box

```bash
npx skills add Agents365-ai/mermaid-skill -g -a opencode -y
npx skills add https://github.com/mattpocock/skills/tree/main/skills/engineering --skill '*' -g -y
npx skills add https://github.com/mattpocock/skills/tree/main/skills/productivity --skill '*' -g -y
cargo install --git https://github.com/FAZuH/papercuts
```

Then install [rsync](https://github.com/RsyncProject/rsync) from your package manager.

## Install

```bash
./sync.sh push -g                # global (~/.config/opencode)
./sync.sh push -g -t dev,ocv2    # only items tagged dev or ocv2 (tags.conf)
./sync.sh push -g -t utils       # utility skills (scheduling, PDFs)
./sync.sh push agents            # same target (global), one top only
./sync.sh push ~/Notes           # project (<project>/.opencode)
./sync.sh diff -g                # preview drift (push + pull directions)
# --dry-run to preview; needs restart after
```

### What it syncs

Copies `skills/ agents/ plugins/ commands/` (tracked in `.agent-sync.json`). Files that are not ours are left alone.

### Tagging

Items can be tagged in `tags.conf` (`tag=pattern,pattern` against repo paths) and deployed selectively:

```bash
./sync.sh push -g -t learn,dev
```

No `-t` deploys everything. `"all"` is reserved.

### Templating

Files may carry `{{KEY}}` placeholders. `sync.sh` substitutes values from the gitignored `.agent-values` at push time (template: `.agent-values.example`). An undefined key fails the run. `pull` skips templated files.

### Editing workflow

Installs are copies — edits in the repo apply only where they've been pushed. Run `./sync.sh push -g` after changing anything.

### Other commands

- `pull` — copies target edits back (existing files only)
- `remove` — uninstalls exactly what was pushed
- `all` — runs across every target in `targets.conf`

### Caveat

Config roots shadow `~/.agents/skills`. Delete shadowed npx copies when `sync.sh` warns.

## Skills

These split on how you'll reach for them — a guide, not hard rules about who may call what. In the repo they live under category subdirs (`skills/orchestration/…`); **`sync.sh` installs them flat** (`skills/<name>/`) because skill and agent IDs are path-derived.

- **Orchestration**: Large workflows you run manually. Runs other workflows
- **Workflow**: Workflows/procedures the agent runs. You can invoke them directly, but they're usually pulled in automatically by other skills. 
- **Referential**: Modular instructions and conventions other workflows load as dependencies. 
- **Standalone**: Standards and conventions the agent consults on its own to guide what it writes.

### Orchestration (you run these)

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
- **[prepare-compact](./skills/workflow/prepare-compact/SKILL.md)**: Prepare a session for context compaction: persist state, then clear the goal. Best used with the [opencode-context-watch plugin](https://github.com/FAZuH/opencode-context-watch/).
- **[deep-research](./skills/workflow/deep-research/SKILL.md)**: Investigate against primary sources and capture findings as a single Markdown file; wraps `mattpocock/skills` research methodology via the `research` subagent.
- **[papercut-sweep](./skills/workflow/papercut-sweep/SKILL.md)**: Sweep the global papercuts backlog (`self::` entries) and apply approved self-improvement drafts.
- **[changelog](./skills/workflow/changelog/SKILL.md)**: Create or update the changelog for the next version by comparing the current commit against the latest version.
- **[session-retro](./skills/workflow/session-retro/SKILL.md)**: End-of-session retrospective — files `self::` proposals without touching code.
- **[skill-doctor](./skills/workflow/skill-doctor/SKILL.md)**: Audit the skill/agent relation graph (`loads`/`routes`/`documents`), flag `broken-ref`/`collision`/`drift`, optionally render via `creating-mermaid-diagrams`.
- **[teach](./skills/workflow/teach/SKILL.md)**: Teach anything so it locks in: graded quizzes probe your level, then a dependency map is taught node by node. Ported from [amosblomqvist/learn](https://github.com/amosblomqvist/learn).
- **[visualize](./skills/workflow/visualize/SKILL.md)**: Adds a correct, minimal diagram to a lesson when an idea is clearer as a picture; briefs a maker subagent that renders and verifies the image.
- **[offload](./skills/workflow/offload/SKILL.md)**: Offload builds, checks, or full agent batches to a remote machine over ssh; per-repo memory lives in gitignored `.opencode/offload.md`.

### Referential (loaded by other skills while they run)

- **[gate](./skills/referential/gate/SKILL.md)**: Approval-gate vocabulary: gate classes (`always`/`normal`/`subagent`), the `auto` run mode, and the one-line `GATE` tag convention; owns the session doc's gate-log format.
- **[following-procedures](./skills/referential/following-procedures/SKILL.md)**: How to run a numbered procedure without skipping steps: point-and-call narration, live deviation logging, and a post-run report. Every procedural skill above loads it first.
- **[scratch](./skills/referential/scratch/SKILL.md)**: The `.scratch/` workspace mechanics: slug format, layout, lifecycle.
- **[worktree](./skills/referential/worktree/SKILL.md)**: Work on a branch in a separate git worktree.

### Standalone (consulted on their own)

- **[test-guidelines](./skills/standalone/test-guidelines/SKILL.md)**: Test writing guidelines: validity, isolation, determinism, test doubles, anti-patterns, coverage.
- **[gui-test-guidelines](./skills/standalone/gui-test-guidelines/SKILL.md)**: GUI/E2E test automation guidelines: selectors, Page Object, visual regression, accessibility.
- **[error-message](./skills/standalone/error-message/SKILL.md)**: Write/review error message strings per std-library conventions.
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
- **[rust-idioms](./skills/standalone/rust-idioms/SKILL.md)**: Type-driven Rust design patterns — newtype, typestate, sealed traits, RAII guards, error and dispatch design.
- **[rust-tea](./skills/standalone/rust-tea/SKILL.md)**: Renderer-agnostic Elm Architecture (TEA/MVU) for Rust — Model/Message/Update/View/Effects for iced and ratatui apps.

### OpenCode v2 (ocv2)

- **[ocv2-api](./skills/ocv2/ocv2-api/SKILL.md)**: Use `opencode2 api` to call the v2 HTTP API and where its docs live.
- **[ocv2-findings](./skills/ocv2/ocv2-findings/SKILL.md)**: Save and retrieve hard-won OpenCode v2 findings.
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
| `primary` | **[orchestrator](./agents/primary/orchestrator.md)** (routes work to subagents), [autocommit](./agents/primary/autocommit.md) (unattended conventional commits; deny-all permissions), [chat](./agents/primary/chat.md), [tutor](./agents/primary/tutor.md) |
| `build` | [implement](./agents/build/implement.md), [dev-server](./agents/build/dev-server.md) |
| `review` | [review](./agents/review/review.md), [test](./agents/review/test.md), [malware-check](./agents/review/malware-check.md), [pii-check](./agents/review/pii-check.md) |
| `research` | [research](./agents/research/research.md) (discovery + deep research), [researcher](./agents/research/researcher.md) (web synthesis) |
| `vision` | [image-viewer](./agents/vision/image-viewer.md), [web-viewer](./agents/vision/web-viewer.md), [mermaid-maker](./agents/vision/mermaid-maker.md), [svg-maker](./agents/vision/svg-maker.md) |
| `document` | [document](./agents/document/document.md), [finish](./agents/document/finish.md) |

The learning system (ported from oc-learn) supplies the visual makers
(`mermaid-maker`, `svg-maker`) and the @teach/@visualize skills.

## Plugins

- `plugins/mermaid/` — `mermaid-compile` + `mermaid-doctor` tools (fazuh.mermaid)
- `plugins/quiz/` — graded `quiz_ask` / `quiz_grade` pair (fazuh.quiz)
- `plugins/md-link/` — live-mirror a session to a markdown file (fazuh.md-link; TUI: `ctrl+alt:m` / `/md-link`)
- `plugins/viz/` — `write_*/edit_*/render_*` authoring loops + `/viz-dir` (fazuh.viz)
- `plugins/tui/` — TUI discovery shims for md-link/viz (see its README: the CLI loads local TUI modules only from this scan dir)

### Dependency Diagrams

![Orchestration](docs/diagrams/skill-relations-orchestration.png)

![Referential dependencies](docs/diagrams/skill-relations-referential.png)

## License

MIT
