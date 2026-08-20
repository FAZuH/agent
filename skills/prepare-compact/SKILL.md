---
name: prepare-compact
description: >-
  Prepare the current session for context compaction. Use when the user is
  about to compact the session context window, asks to prepare for
  compaction, says the context is getting full or running low, wants to
  persist state before compacting, or wants a resume checkpoint so work
  survives a compaction. Persists the session/plan doc, deviations, decisions,
  todo list, session-critical facts, and the active goal objective, then
  clears the goal so it stops re-prompting after compaction.
---

# prepare-compact

If you're told to call this skill, it means a session compaction is imminent. This is the last
chance to persist everything a fresh session needs to resume seamlessly. Be
thorough: assume the conversation history is about to be deleted.

> **Load the `following-procedures` skill first.** It defines how you run this
> numbered procedure: point-and-call narration, live deviation logging, and a
> fixed post-run report.

> **Load the `scratch` skill if the repo uses `.scratch/`.** It owns the
> `.scratch/` workspace mechanics — layout, slug format, and the
> `.scratch/complete/` archive location. Follow it when you update the session
> doc or checkpoint.

Extra notes the user gives (see the conversation) count as arguments: use them
as notes to persist, and/or the feature slug when the repo uses the `.scratch/`
layout.

Do the steps in order. Do not compress or skip facts; the goal is fidelity,
not brevity.

IMPORTANT: If you lack write access — a read-only agent, Plan mode, or any restriction that
blocks editing files, updating todos, memory, or clearing the goal — do NOT fail
silently. Persist whatever you can, and explicitly tell the user in the final
report which persistence steps could not be performed and what will therefore be
lost on compaction.

## 1. Snapshot current state

Run `get_goal` and record the current goal's objective verbatim — the fresh
session will need to re-create it. Then, from your own context, capture:

- **Objective** — what is being worked on right now, in one or two sentences.
- **Done** — what shipped so far: files created/changed, features working,
  verification passed.
- **In progress** — anything half-finished: partial edits, uncommitted work, a
  design being worked out.
- **Blocked** — external blockers, pending decisions, answers you are still
  waiting on.
- **Deviations** — anything that diverged from a plan, spec, or original
  request.

## 2. Update the session doc

Detect the repo's session-doc convention rather than assuming one:

- If the repo uses the `.scratch/` layout (`.scratch/<feature-slug>/spec.md`
  exists), update it in place: refresh **Objective**, **Decisions &
  constraints**, **File layout**, **Design**, and **Execution** status to
  match reality. Append dated entries to the **Deviation log** for every
  change since the doc was last written.
- Otherwise, update whatever plan/spec doc the repo already tracks (find it
  by common names: `spec.md`, `plan.md`, `docs/plan/`, `docs/specs/`), if one
  exists. Keep the same section refresh + dated deviation entries.
- If no session doc exists, do not invent one — skip creation and note it in
  the report.
- If the work is essentially complete, say so and note that the doc should be
  archived (`.scratch/complete/` when the repo uses `.scratch/`, or the
  repo's equivalent archive location).

## 3. Sync the todo list

- Read the current todos (todowrite). Rewrite them so a fresh session can pick
  them up: each pending or in-progress item must state what remains and how to
  verify it.
- Mark anything actually finished as completed. Merge duplicate items. Keep the
  list short enough to be useful.

## 4. Persist session-critical facts

Capture anything that is cheap to lose and expensive to rediscover:

- **Environment** — dev servers running (and which subagent/PTY owns them),
  ports, URLs, relevant PIDs, current git branch and uncommitted files.
- **Commands** — exact verification commands (build, lint, test, typecheck)
  and any one-off commands that worked.
- **Gotchas** — non-obvious findings, dead ends, API quirks, decisions and
  their rationale. If a friction point hit a papercuts log, reference it; do
  not duplicate it.
- **Secrets** — do NOT write credentials or tokens. Note where they live
  instead (env var, file path).

## 5. Update memory (optional)

If this session changed durable, high-signal facts — new project conventions,
architecture decisions, or workflow changes — update the project or global
memory blocks so they survive without the conversation. Do not add trivia.

## 6. Write the resume checkpoint

Write the resume checkpoint to `.scratch/<feature-slug>/checkpoint.md` when
the repo uses the `.scratch/` layout; otherwise write a generic `RESUME.md` at
the repo root. The checkpoint contains exactly:

```
# Resume checkpoint — <feature>

## Goal to re-create
<the goal objective recorded in step 1, verbatim>

## Next step
<the single next action, with file paths and line numbers if known>

## Verify with
<exact command or test to confirm state>

## Context to re-read first
<session doc path, specific files, code sections>

## Open questions
<anything still unanswered>

## Session facts
- Environment: dev servers (and which subagent/PTY owns them), ports, PIDs,
  git branch, uncommitted files.
- Commands: exact verification commands and any one-off commands that worked.
- Gotchas: non-obvious findings, dead ends, API quirks, decisions and
  rationale.
```

Do NOT write credentials or tokens — note where they live instead (env var,
file path). After compaction, the first action of the fresh session must be to
re-create the goal with the recorded objective (create_goal/set_goal), then
continue from the resume checkpoint.

## 7. Clear the goal

When all persistence steps are done, clear the active goal with `clear_goal`.
This stops the goal plugin from re-prompting to continue the current goal after
compaction. The objective survives in the resume checkpoint, so nothing is lost
by clearing it.

## 8. Report

Give the user a concise report:

- Where each piece of state was persisted (session doc path, checkpoint,
  todo list, memory, papercuts).
- The goal that was cleared, and the objective they must re-create after
  compaction.
- The single next step they can paste into a fresh session to continue.
- Anything that could NOT be persisted, so they know what will be lost on
  compaction.

Do not commit or take any other side action. The user will compact or continue
after reviewing your report.

## Dependency graph

- step1
- step2 -> step1
- step3 -> step2
- step4 -> step2
- step5
- step6 -> step2, step4
- step7 -> step6
- step8 -> step6, step7