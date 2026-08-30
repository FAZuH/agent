# Bug reports / hard bugs

> **Load the `following-procedures` skill first.** It defines how you run this
> numbered procedure: point-and-call narration, live deviation logging, and a
> fixed post-run report. Always follow the rules in the *Gates* section at
> the bottom.

## When to use

The user reports something broken/failing, or a bug that resists a quick fix.

## State machine

```
START (bug report)
  → DIAGNOSE  run `diagnosing-bugs`: tight feedback loop first
  → MAP?      delegate first pass to research if the codebase is unfamiliar
  → FIX       delegate fix + regression test
  → TEST      delegate running the regression test
  → REVIEW    review as in feature-development
  → FINISH    commit as in feature-development
  → DONE
```

## Steps

| # | State | Owner | Action |
|---|---|---|---|
| 1 | DIAGNOSE | you | Do not guess. Run the `diagnosing-bugs` skill: get a tight feedback loop (one command that already goes red on this bug), then fix with a regression test. |
| 2 | MAP | `research` | Only for an unfamiliar codebase: delegate a first pass to map where the failing code lives before diagnosing. |
| 3 | FIX | `implement` | Delegate the fix to `implement`. |
| 4 | TEST | `test` | Delegate the regression test run to `test`. |
| 5 | REVIEW / FINISH | `review` / `finish` | Review and commit as in `feature-development.md`. |

## Dependency graph

- step1
- step2 -> step1
- step3 -> step1
- step4 -> step3
- step5 -> step4

## Gates

- MAP only runs when the codebase is unfamiliar.
- FIX (step3) hangs off DIAGNOSE (step1), never off MAP (step2) — an unfamiliar-codebase mapping pass informs the fix but does not gate it.
- Review and commit follow the feature-development workflow exactly.