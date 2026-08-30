---
name: following-procedures
description: >-
  How to run a numbered procedure step-by-step without skipping steps:
  point-and-call narration, live deviation logging, and a fixed post-run
  report. Load this skill ONLY when a procedural skill tells you to load it.
  Never on its own — it is not a general instruction. Do not trigger on
  ordinary multi-step tasks.
---

# following-procedures

This skill governs how you run numbered procedures. A procedural skill tells
you to load it; it does not trigger by itself.

## When this applies

- Only procedures that explicitly say to load the `following-procedures`
  skill.
- Never on its own. Do not apply narration or reporting to non-procedural
  work.

## Before starting

1. Read the whole procedure — every numbered step — top to bottom before
   doing step 1.
2. Read the dependency graph. Note which steps depend on which.
3. Note the rules section at the bottom; the procedure header points at it.
   The rules bind from the start.

## While running: point and call

For each step, in one terse line, state:

- `STEP n/N — <action> — next: <step n+1 name>`

Emit at step boundaries only, not per tool call. If the harness has no visible
narration, keep the line in your working notes.

## If a step fails

- Log it immediately in the deviation log (failed).
- From the dependency graph, skip every later step that depends on it; mark
  each `skipped (depends on step N)`.
- Continue any later step that does not depend on the failed step.

## Deviation log

Keep a running list as you work. Write entries immediately — never reconstruct
them from memory at the end.

Entry format:

- `[date] step N: what happened, why`

Where to log:

- If the harness provides a session record with a deviation log (e.g. a
  `.scratch/` workspace), log there.
- Else if the environment provides a friction/issue backlog (e.g.
  `.papercuts.jsonl`), log there.
- Else keep the list in your working notes.

Hiccups (tool failures, dead ends, environment friction) go to the friction
backlog whenever it exists.

## Interruption

If the user interjects mid-procedure:

1. Pause at the current step.
2. Log the interruption as a deviation.
3. Persist resume state. If the harness has a session record, add an entry to
   the `## Interrupted procedures` section in its spec doc (the session skill
   defines the workspace; this section lives in `spec.md`). Else keep the
   entry in your working notes.
4. Handle the user's message.
5. Resume at the same step.

The `## Interrupted procedures` section holds one entry per interruption:

```markdown
## Interrupted procedures
- [date] <procedure> — paused at step n
  - done: <steps already completed>
  - next: <step n+1>
  - notes: <anything needed to resume>
```

Keep the section in `spec.md` alongside the deviation log; update it in place,
never delete an entry until the procedure is resumed and finished.

## After finishing: the run report

In this fixed order, in your final message:

1. **Completed** — what the procedure produced.
2. **Deviations** — every logged deviation.
3. **Hiccups** — every logged hiccup.
4. **Failed / skipped** — failed steps, and steps skipped because of them,
   with reasons.

The run report is a final message to the user. It is not session state; do not
write it to the session record.

## Authoring convention (for procedure authors)

A procedural skill must:

- Number its steps `1.`, `2.`, … top to bottom, one action per step.
- Say at the top: "Always follow the rules in the *Rules* section at the
  bottom."
- Put references, rules, and exceptions at the bottom.
- Include a `## Dependency graph` section right after the steps:

  ```
  ## Dependency graph
  - step1
  - step2
  - step3 -> step1
  - step4 -> step1, step2
  ```

  Rules:

  - A step with no arrow depends on nothing.
  - `step4 -> step1, step2` means step4 needs BOTH step1 and step2 to
    succeed.
  - Dependencies may only point to earlier-numbered steps (the graph is a
    DAG).
  - The graph is required even for strictly linear procedures
    (`stepN -> stepN-1`).
  - Independent steps may run in parallel if the environment allows; narrate
    and report each anyway.
  - There is no "always run after failure" operator. If a step must run after
    a failed dependency, list it without that dependency and leave the
    decision to the agent, reported in the run report.

- If the skill has its own deviation-log destination, say so in one line;
  otherwise the default in the "Deviation log" section above applies.