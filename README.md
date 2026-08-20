# skills

My personal agent skills.

## Install

```
npx skills@latest add fazuh/skills
```

Or clone the repo and point your harness's skills directory at it.

## Skills

These split on one axis: who can invoke them. **User-invoked** skills are
reachable only when you type them; their job is to orchestrate. **Model-invoked**
skills can be invoked by you _or_ reached for automatically by the agent when
the task fits; they hold the reusable discipline. A user-invoked skill may
invoke model-invoked skills, but never another user-invoked one.

### User-invoked

- **[pr-to-close](./skills/pr-to-close/SKILL.md)**: Take a finished worktree branch all the way to done: open the PR, watch its CI and merge when green, then close the worktree.
- **[worktree-new](./skills/worktree-new/SKILL.md)**: Start work on a task in a new git worktree branch, keeping untracked items (`.scratch/`, `.papercuts.jsonl`) on the main project dir.
- **[worktree-finish](./skills/worktree-finish/SKILL.md)**: Finish a worktree's pull request safely: conflict resolution, readiness checks, and asking before behavior-changing resolutions.

### Model-invoked

- **[pr-creator](./skills/pr-creator/SKILL.md)**: Create PRs following the repo's own template and standards; never from the default branch.
- **[pr-watchmerge](./skills/pr-watchmerge/SKILL.md)**: Watch a PR's CI checks and merge automatically once they pass.
- **[worktree-close](./skills/worktree-close/SKILL.md)**: Finish a worktree session (finish workflow) and clean up the worktree and its branch.
- **[worktree](./skills/worktree/SKILL.md)**: Work on a branch in a separate git worktree; the mechanics behind `worktree-new`/`worktree-close`/`worktree-finish`.
- **[finish](./skills/finish/SKILL.md)**: End a session: update docs, propose grouped commits, archive a completed `.scratch/` workspace, summarize.
- **[session](./skills/session/SKILL.md)**: Manage a feature's session workspace: plan/spec doc, tickets, deviation log, checkpoints.
- **[scratch](./skills/scratch/SKILL.md)**: The `.scratch/` workspace mechanics: slug format, layout, lifecycle, archiving to `.scratch/complete/`. Loaded by `session`, `finish`, `prepare-compact`, and `worktree`.
- **[prepare-compact](./skills/prepare-compact/SKILL.md)**: Prepare a session for context compaction: persist state, then clear the goal. Best used with the [opencode-context-watch plugin](https://github.com/FAZuH/opencode-context-watch/).
- **[test-guidelines](./skills/test-guidelines/SKILL.md)**: Test writing guidelines: validity, isolation, determinism, test doubles, anti-patterns, coverage.
- **[gui-test-guidelines](./skills/gui-test-guidelines/SKILL.md)**: GUI/E2E test automation guidelines: selectors, Page Object, visual regression, accessibility.
- **[error-message](./skills/error-message/SKILL.md)**: Write/review error message strings per std-library conventions.
- **[logging-guidelines](./skills/logging-guidelines/SKILL.md)**: Structured logging with wide events, correlation, and safe redaction.
- **[design-tradeoffs](./skills/design-tradeoffs/SKILL.md)**: Compare design options with structured tradeoff analysis.
- **[scheduled-task](./skills/scheduled-task/SKILL.md)**: Manage scheduled tasks through crontab and systemd timers.

## License

MIT
