# Feature implementation / bug fixes

> **Load the @following-procedures skill first.** It defines how you run this
> numbered procedure: point-and-call narration, live deviation logging, and a
> fixed post-run report. Always follow the rules in the *Gates* section at
> the bottom.

## When to use

The user asks to build a feature, implement a ticket/spec/plan, or fix a bug.

## State machine

```
START (user request: feature / ticket / bug fix)
  → PLAN      create a plan in Plan mode
  → GRILL     cover plan gaps
  → PERSIST   session doc + CONTEXT.md + ADRs, then read them
  → RESEARCH  map the code and gather library/API facts
  → IMPLEMENT delegate to implement (tdd; prefer @forkflow after its probe)
  → VERIFY    test/lint/typecheck via test (fork read-only verifier when safe)
      │  failures? → loop back to IMPLEMENT (RESUME sessions via task_id)
  → REVIEW    delegate to review (Standards + Spec; fork from the implement report when safe)
      │  fixes found? → loop back to IMPLEMENT, then VERIFY again (RESUME sessions via task_id)
  → FINISH    only on explicit user request
  → DONE
```

## Steps

| # | State | Owner | Action |
|---|---|---|---|
| 1 | PLAN | you | Create a plan in Plan mode. |
| 2 | GRILL | you | If the plan has gaps: @grilling or @grill-with-docs. If the plan is too large to hold in one session: @wayfinder. |
| 3 | PERSIST | you | @grill-with-docs leaves a `CONTEXT.md` glossary + `docs/adr/` paper trail; read them before implementation so names match the domain language. Persist the plan with @session. Log plan deviations with @session as they surface. |
| 4 | RESEARCH | `research` (Mode 1) | Delegate a preliminary pass to map the relevant code and gather library/API facts, then read the files it points to. For a deeper external fact a decision waits on, invoke the @deep-research skill (Mode 2) — it delegates back to `research` for a cited findings file. |
| 5 | IMPLEMENT | `implement` / `@forkflow` | Prefer `forkflow`: fork the completed research boundary, switch to `implement`, verify, then send the first prompt. Fall back to a fresh `implement` spawn. |
| 6 | VERIFY | `test` / `@forkflow` | Test/lint/typecheck runs before review. A forked test child must be read-only. If checks fail, loop back to IMPLEMENT (step 5). |
| 7 | REVIEW | `review` / `@forkflow` | Fork a read-only review child from the implement report when safe. If it turns up fixes, create or resume an implement session; never switch an already-running child to another agent. |
| 8 | FINISH | `finish` | Commit only when the user explicitly asks — delegate to `finish` to propose grouped commit messages, restate them to the user for approval, then run the `git add` + `git commit` yourself. |

## Dependency graph

- step1
- step2 -> step1
- step3 -> step2
- step4 -> step3
- step5 -> step4
- step6 -> step5
- step7 -> step6
- step8 -> step7

When @forkflow is available, the implementation handoff is `research report →
fork → switch implement → first prompt`. After implementation, review and test
may fork from the implementation report as independent read-only children.
Forks share the working directory, so parallel writers require separate
worktrees. The broader forkflow + setup-dev-docs + task-context session
orchestration is deferred until it is exercised on a real ticket.

## Gates

- GRILL only runs when the plan has gaps.
- A step skipped because its gate did not fire is not a failed step — later steps still run.
- FINISH only runs on explicit user request.
- VERIFY always runs before REVIEW; no implementation reaches review with failing tests.
- Loop REVIEW → IMPLEMENT → VERIFY while review turns up fixes; always resume the same sessions.

## Parallel multi-repo batches

When one piece of work spans multiple repositories (e.g. a dependee/dependency pair),
run the batch in parallel instead of serializing:

- One independent `implement` agent per repo — never share a session across repos.
- Downstream compile gate: after any change that affects a dependee's view
  (visibility, public signatures, message shapes), run `cargo check` (or the
  equivalent) in the dependee before declaring the batch green.
- Bounded retry: when a sibling repo's tree is dirty, retry the dependee check in a
  tight window (a few tries) rather than serializing the whole batch.
- Never-touch-sibling: each `implement` agent edits only its own repo; cross-repo
  coupling is resolved by the downstream gate, not by editing both.
- Keep review gates per repo (delegate `review` for each repo independently).
