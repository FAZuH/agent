# Unit and/or integration tests

> **Load the `following-procedures` skill first.** It defines how you run this
> numbered procedure: point-and-call narration, live deviation logging, and a
> fixed post-run report. Always follow the rules in the *Gates* section at
> the bottom.

## When to use

The user asks to write, plan, or run a test suite.

## State machine

```
START (test work requested)
  → PLAN      plan in Plan mode with test guidelines
  → TRIM      drop tautological cases
  → BUILD     proceed in Build mode with /goal
  → IMPLEMENT delegate test writing (test-first) + running
  → ITERATE   until the suite passes and tests add real signal
  → REVIEW    optional, only if the user wants it
  → FINISH    mark plan complete, /finish cleanup
  → DONE
```

## Steps

| # | State | Owner | Action |
|---|---|---|---|
| 1 | PLAN | you | Create a plan in Plan mode with `test-guidelines` (add `gui-test-guidelines` if the suite touches the UI). |
| 2 | TRIM | you | Adjust the plan: remove testing that "tests apples is apples" — drop tautological or redundant cases. |
| 3 | BUILD | you | Proceed in Build mode with `/goal`. |
| 4 | IMPLEMENT | `implement` + `test` | Delegate writing the tests to `implement` (test-first) and running them to `test`. |
| 5 | ITERATE | `implement` / `test` | Iterate until the suite passes and the new tests add real signal. |
| 6 | REVIEW | `review` | Review the test work with `review` if the user wants it. |
| 7 | FINISH | `finish` | Mark the plan complete; `/finish` to cleanup — finish proposes grouped commit messages, you restate them to the user for approval, then commit yourself. |

## Dependency graph

- step1
- step2 -> step1
- step3 -> step2
- step4 -> step3
- step5 -> step4
- step6 -> step5
- step7 -> step5

## Gates

- REVIEW is optional and only on user request.
- FINISH (step7) depends on ITERATE (step5), never on REVIEW (step6) — a skipped or failed review does not block finish; a red suite does.
- Iteration loop ends when the suite is green and the new tests add real signal.