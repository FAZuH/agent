# Documentation / decisions

> **Load the @following-procedures skill first.** It defines how you run this
> numbered procedure: point-and-call narration, live deviation logging, and a
> fixed post-run report. Always follow the rules in the *Gates* section at
> the bottom.

## When to use

The user asks for ADRs, glossary, or runbook updates, or wants to record an architectural decision.

## State machine

```
START (docs / decision request)
  → DELEGATE  ADRs, glossary, runbook updates to document
  → GLOSSARY  keep CONTEXT.md sharp (@domain-modeling / document)
  → ADR       record architectural decisions via document
  → LOG       @session when it affects an active plan
  → DONE
```

## Steps

| # | State | Owner | Action |
|---|---|---|---|
| 1 | DELEGATE | `document` | Delegate ADRs, glossary, and runbook updates to `document`. |
| 2 | GLOSSARY | you / `document` | Keep the project's `CONTEXT.md` glossary sharp: when a new term solidifies during work, run @domain-modeling or have `document` capture it — a stale glossary is worse than none. |
| 3 | ADR | `document` | For architectural decisions, have `document` record an ADR with context, decision, and consequences (via @documentation-and-adrs). |
| 4 | LOG | you | Log the decision with @session when it affects an active plan. |

## Dependency graph

- step1
- step2
- step3
- step4 -> step3

## Gates

- GLOSSARY maintenance is continuous — trigger whenever a new term solidifies.
- LOG runs only when the decision affects an active plan.