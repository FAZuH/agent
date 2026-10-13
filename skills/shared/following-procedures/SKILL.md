# Skill: following-procedures

# following-procedures

How to run a numbered procedure. Only a procedure that says to load it gets this treatment.

## Before starting

1. Read the whole procedure, every step, top to bottom, before step 1.
2. Note the dependency graph: which steps need which.
3. Note the rules at the bottom; the header points at them. They bind from the start.

## While running: point and call

Per step, one terse line at step boundaries only:

- `STEP n/N: <action>; next: <step n+1 name>`

## If a step fails

- Log it in the deviation log immediately (failed).
- Skip every later step that depends on it; mark each `skipped (depends on step N)`.
- Continue later steps with no failed dependency.

## Deviation log

Running list, entries written immediately, never reconstructed:

- `[date] step N: what happened, why`

Session record with a deviation log (e.g. `.scratch/` workspace): log there. Friction: Hindsight (`type:friction`, per @global-instruction). Else: working notes.

Hiccups (tool failures, dead ends, environment friction) are retained to Hindsight as friction entries wherever one exists.

## Interruption

User interjects mid-procedure:

1. Pause at the current step.
2. Log the interruption as a deviation.
3. Persist resume state: `## Interrupted procedures` in the session `spec.md` (the session skill defines the workspace), else working notes.
4. Handle the message.
5. Resume at the same step.

One entry per interruption, updated in place, deleted only when resumed and finished:

```markdown
## Interrupted procedures
- [date] <procedure>: paused at step n
  - done: <steps already completed>
  - next: <step n+1>
  - notes: <anything needed to resume>
```

## After finishing: the run report

Hand the report to @post-task. It owns the format.

## Authoring convention (for procedure authors)

A procedural skill must:

- Number steps `1.`, `2.`, … top to bottom, one action per step.
- Say at the top: "Always follow the rules in the *Rules* section at the bottom."
- Put references, rules, exceptions at the bottom.
- Include a `## Dependency graph` right after the steps:

  ```
  ## Dependency graph
  - step1
  - step2
  - step3 -> step1
  - step4 -> step1, step2
  ```

  Rules:

  - No arrow: depends on nothing.
  - `step4 -> step1, step2` needs BOTH.
  - Arrows point only backwards (DAG).
  - Required even when linear (`stepN -> stepN-1`).
  - Independent steps may run in parallel; narrate and report each anyway.
  - No "run after failure" operator. A step that must run after a failed dependency lists no dependency; the agent decides and reports it.

- State its deviation-log destination in one line, else the default above applies.
