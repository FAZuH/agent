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
| `finish` | End a session: update docs, propose grouped commits, summarize |
| `pr-creator` | Create PRs following the repo's template/standards; never from the default branch |
| `worktree` | Work on a branch in a separate git worktree; keeps untracked files (.scratch/, .papercuts.jsonl) on the main project dir |

## License

MIT
