# skills

My personal agent skills.

## Install

```
npx skills@latest add fazuh/skills
```

Or clone the repo and point your harness's skills directory at it.

## Skills

| Skill | Purpose |
|-------|---------|
| `design-tradeoffs` | Compare design options with structured tradeoff analysis |
| `error-message` | Write/review error message strings per std-library conventions |
| `gui-test-guidelines` | GUI/UI test automation guidelines (selectors, Page Object, visual regression) |
| `test-guidelines` | Comprehensive test writing guidelines (unit, integration, mocking, TDD) |
| `prepare-compact` | Prepare a session for context compaction (persist state, clear goal)<br>Best used with [opencode-context-watch plugin](https://github.com/FAZuH/opencode-context-watch/) |
| `finish` | End a session: update docs, propose grouped commits, archive a completed `.scratch/` workspace, summarize |
| `session` | Manage a feature's session workspace: plan/spec doc, tickets, deviation log, checkpoints |
| `scratch` | The `.scratch/` workspace mechanics: slug format, layout, lifecycle, archiving to `.scratch/complete/`<br>Loaded by `session`, `finish`, `prepare-compact`, and `worktree` |
| `pr-creator` | Create PRs following the repo's template/standards; never from the default branch |
| `pr-to-close` | End-to-end close of a worktree feature: create the PR, watch CI and merge when green, then close the worktree |
| `pr-watchmerge` | Watch a PR's CI checks and merge automatically once they pass |
| `worktree` | Work on a branch in a separate git worktree; keeps untracked files (.scratch/, .papercuts.jsonl) on the main project dir |
| `worktree-close` | Finish a worktree session (finish workflow) and clean up the worktree and its branch |
| `worktree-finish` | Finish a worktree's PR safely: conflict resolution and readiness checks |
| `worktree-new` | Start work on a task in a new git worktree branch, keeping untracked items on the main project dir |

## License

MIT
