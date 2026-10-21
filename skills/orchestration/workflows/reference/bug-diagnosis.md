# Bug reports / hard bugs

> **Load the @following-procedures skill first.** It defines how you run this
> numbered procedure: point-and-call narration, live deviation logging, and a
> fixed post-run report. Always follow the rules in the *Gates* section at the
> bottom.

## When to use

Broken, failing, or resisting a quick fix.

## State machine

```
START (bug report)
  → DIAGNOSE  run @diagnosing-bugs: tight feedback loop first
  → MAP?      delegate first pass to research-discovery if the codebase is unfamiliar
  → FIX       delegate fix + regression test
  → TEST      delegate running the regression test
  → REVIEW    review as in feature-development
  → FINISH    commit as in feature-development
  → DONE
```

## Steps

| # | State | Owner | Action |
|---|---|---|---|
| 1 | DIAGNOSE | you | Do not guess. Run @diagnosing-bugs: get a tight feedback loop (one command that already goes red on this bug), then fix with a regression test. |
| 2 | MAP | `research-discovery` | Only for an unfamiliar codebase: delegate a first pass to map where the failing code lives before diagnosing. |
| 3 | FIX | `implement` | Delegate the fix. |
| 4 | TEST | `implement` | Delegate the regression test run in verification-only mode. |
| 5 | REVIEW / FINISH | `review` / `finish` | As in `feature-development.md`. |

## Dependency graph

- DIAGNOSE gates FIX; MAP informs FIX but does not gate it

## Gates

- MAP only runs on an unfamiliar codebase.
- FIX hangs off DIAGNOSE, never off MAP.
- Review and commit follow the feature-development workflow exactly.
