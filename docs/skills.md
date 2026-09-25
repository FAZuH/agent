# Skills

Skills split by what they do, not by how they are loaded. ⭐ marks the entry
points you or an agent load first.

`sync.sh` installs them flat as `skills/<name>/`. Skill IDs are path-derived, so
the category directory never reaches the installed name.

- **Orchestration**: controls, delegates, tracks, and finishes agent work
- **Workflow**: repeatable procedures with a defined process
- **Dev**: engineering guidelines and conventions
- **Utils**: general machine and tool helpers
- **Meta**: agent-system and repository maintenance
- **Shared**: cross-cutting rules and mechanics
- **OpenCode v2**: OpenCode v2 operations

## Orchestration

- ⭐ **[orchestrate](../skills/orchestration/orchestrate/SKILL.md)**: Manage tasks, delegation, permissions, run mode, and subagent session reuse.
- ⭐ **[workflows](../skills/orchestration/workflows/SKILL.md)**: Select the concrete workflow and subagent route for a task.
- **[forkflow](../skills/orchestration/forkflow/SKILL.md)**: Warm per-ticket delegation with OpenCode v2 forks.
- **[session](../skills/orchestration/session/SKILL.md)**: Manage the feature session workspace, spec, tickets, deviations, and checkpoints.
- **[task-context](../skills/orchestration/task-context/SKILL.md)**: Create per-ticket context packets for workers.
- **[prepare-compact](../skills/orchestration/prepare-compact/SKILL.md)**: Persist session state before context compaction.
- ⭐ **[finish](../skills/orchestration/finish/SKILL.md)**: End a session, archive its workspace, summarize, and route closeout.
- **[self-improve](../skills/orchestration/self-improve/SKILL.md)**: Run the gated retrospective and skill-system improvement check.
- **[session-retro](../skills/orchestration/session-retro/SKILL.md)**: Propose self-improvement lessons after a session.
- **[papercut-sweep](../skills/orchestration/papercut-sweep/SKILL.md)**: Sweep approved global self-improvement entries.
- **[long-horizon](../skills/orchestration/long-horizon/SKILL.md)**: Keep long-running agent work alive with supervisors and heartbeats.
- **[offload](../skills/orchestration/offload/SKILL.md)**: Move builds, checks, and agent batches to remote machines.
- **[scratch-finish](../skills/orchestration/scratch-finish/SKILL.md)**: Archive a completed `.scratch/` workspace.
- **[worktree-new](../skills/orchestration/worktree-new/SKILL.md)**: Start isolated work in a new git worktree.
- **[worktree-finish](../skills/orchestration/worktree-finish/SKILL.md)**: Prepare a worktree branch and its pull request for merge.
- **[worktree-close](../skills/orchestration/worktree-close/SKILL.md)**: Finish a worktree session and remove the worktree and branch.
- **[pr-to-close](../skills/orchestration/pr-to-close/SKILL.md)**: Take a finished worktree branch through PR creation, merge, and cleanup.

## Workflow

- **[changelog](../skills/workflow/changelog/SKILL.md)**: Create or update the changelog for the next version.
- **[commit](../skills/workflow/commit/SKILL.md)**: Plan commit grouping and propose conventional commit messages.
- **[deep-research](../skills/workflow/deep-research/SKILL.md)**: Investigate a narrow external question and capture one cited findings file.
- **[issue-closeout](../skills/workflow/issue-closeout/SKILL.md)**: Link merged pull requests to resolved issues and close them where needed.
- **[pr-creator](../skills/workflow/pr-creator/SKILL.md)**: Create a pull request using the repository's standards and template.
- **[pr-watchmerge](../skills/workflow/pr-watchmerge/SKILL.md)**: Watch pull request checks and merge once they pass.
- **[setup-dev-docs](../skills/workflow/setup-dev-docs/SKILL.md)**: Bootstrap, audit, or update durable `docs/dev/` documentation.
- **[teach](../skills/workflow/teach/SKILL.md)**: Run the multi-session teaching workflow, including probing, planning, quizzes, and durable lesson records.
- **[visualize](../skills/workflow/visualize/SKILL.md)**: Create one correct, minimal visual artifact and verify it after rendering.

## Dev

- **[comments](../skills/dev/comments/SKILL.md)**: Write useful comments without narration or change-history noise.
- **[commit-scopes](../skills/dev/commit-scopes/SKILL.md)**: Create and maintain the closed vocabulary for Conventional Commit scopes.
- **[design-tradeoffs](../skills/dev/design-tradeoffs/SKILL.md)**: Compare design options with structured tradeoffs.
- **[gui-test-guidelines](../skills/dev/gui-test-guidelines/SKILL.md)**: Write reliable GUI, browser, and accessibility tests.
- **[improve-architecture-oop](../skills/dev/improve-architecture-oop/SKILL.md)**: Apply the OOP vocabulary to architecture analysis and reports.
- **[logging-guidelines](../skills/dev/logging-guidelines/SKILL.md)**: Design structured logs, safe redaction, correlation, and useful events.
- **[oop](../skills/dev/oop/SKILL.md)**: Use standard OOP and architecture vocabulary.
- **[readme](../skills/dev/readme/SKILL.md)**: Standardize README structure and house style.
- **[rust-idioms](../skills/dev/rust-idioms/SKILL.md)**: Apply type-driven Rust design patterns.
- **[rust-tea](../skills/dev/rust-tea/SKILL.md)**: Design Rust UIs with TEA/MVU architecture.
- **[secrets-argv](../skills/dev/secrets-argv/SKILL.md)**: Keep secrets out of process arguments, history, logs, and transcripts.
- **[test-guidelines](../skills/dev/test-guidelines/SKILL.md)**: Write focused, deterministic, meaningful tests.

## Utils

- **[notes](../skills/utils/notes/SKILL.md)**: Read and maintain durable notes for tools, CLIs, APIs, scheduled agents, and OpenCode behavior.
- **[omarchy-plugin-install](../skills/utils/omarchy-plugin-install/SKILL.md)**: Install an Omarchy shell plugin end to end, including malware review and dotfiles persistence.
- **[plan-confirm](../skills/utils/plan-confirm/SKILL.md)**: Present large plans or audits for grouped confirmation.
- **[read-pdf](../skills/utils/read-pdf/SKILL.md)**: Read PDFs and extract text, tables, images, and structured data.
- **[scheduled-agent](../skills/utils/scheduled-agent/SKILL.md)**: Schedule restricted unattended agents with systemd user timers.
- **[scheduled-task](../skills/utils/scheduled-task/SKILL.md)**: Manage scheduled tasks with `octask` and systemd user timers.

## Meta

- ⭐ **[agent-map](../skills/meta/agent-map/SKILL.md)**: Map and maintain this personal-public agent repository.
- **[external-skills](../skills/meta/external-skills/SKILL.md)**: Install, update, list, or remove upstream-owned skills.
- ⭐ **[skill-doctor](../skills/meta/skill-doctor/SKILL.md)**: Audit skill references, names, collisions, and source drift.

## Shared

These skills are loaded only when another skill or agent references them.

- **[following-procedures](../skills/shared/following-procedures/SKILL.md)**: Run numbered procedures without skipping steps.
- **[gate](../skills/shared/gate/SKILL.md)**: Define approval gates, run modes, and the `GATE` tag format.
- **[scratch](../skills/shared/scratch/SKILL.md)**: Define the `.scratch/` workspace lifecycle and layout.
- **[worktree](../skills/shared/worktree/SKILL.md)**: Define safe git worktree creation and cleanup mechanics.

## OpenCode v2

- **[ocv2-api](../skills/ocv2/ocv2-api/SKILL.md)**: Use `opencode2 api` to call the v2 HTTP API.
- **[ocv2-compact](../skills/ocv2/ocv2-compact/SKILL.md)**: Compact a v2 session and wait for its summary.
- **[ocv2-models](../skills/ocv2/ocv2-models/SKILL.md)**: Pick and switch models through the v2 API.
- **[ocv2-sessions](../skills/ocv2/ocv2-sessions/SKILL.md)**: Fork and control OpenCode v2 sessions.
- **[ocv2-move](../skills/ocv2/ocv2-move/SKILL.md)**: Move a v2 session to another project directory.
- **[ocv2-pluginhealth](../skills/ocv2/ocv2-pluginhealth/SKILL.md)**: Inspect plugin status and errors.
- **[ocv2-unfuck](../skills/ocv2/ocv2-unfuck/SKILL.md)**: Verify top-level tool availability before claiming restricted mode.

Run `./sync.sh list` to see the deployed skills, and
[agent-map](../skills/meta/agent-map/SKILL.md) for the repository rules they
follow. To know which skill to load at a given point in the work, read the
[skill guide](skill-guide.md).
