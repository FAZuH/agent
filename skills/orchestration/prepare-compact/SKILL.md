---
name: prepare-compact
description: >-
  Persist everything a fresh session needs before a context compaction: the
  session/plan doc, deviations, todo list, session-critical facts, and the
  active goal objective, then clear the goal and gate a compact offer. Use
  when the user says to compact, the context is getting full, or a resume
  checkpoint must survive a compaction.
---

# prepare-compact

Compaction is imminent: the last chance to persist what a fresh session needs
to resume. Assume the conversation history is about to be deleted.

> **Load @following-procedures skill first.** It owns procedure narration,
> deviation logging, post-run report.
>
> **Load @scratch skill if the repo uses `.scratch/`.** It owns the `.scratch/`
> workspace mechanics: layout, slug format, `.scratch/complete/` archive
> location. Follow it when you update the session doc or checkpoint.

Extra notes the user gives count as arguments: persist them as notes, and/or
use them as the feature slug when the repo uses `.scratch/`.

Do the steps in order. Never compress or skip facts; fidelity over brevity.

IMPORTANT: if you lack write access (read-only agent, Plan mode, or any
restriction blocking file edits, todo updates, memory, or goal clearing), do
NOT fail silently. Persist whatever you can, then tell the user in the final
report which steps could not be performed and what will be lost on compaction.

## 1. Snapshot current state

Run `get_goal` and record the goal's objective verbatim; the fresh session
re-creates it. Then capture:

- **Objective**: what is being worked on, in one or two sentences.
- **Done**: what shipped: files created/changed, features working,
  verification passed.
- **In progress**: partial edits, uncommitted work, a design being worked out.
- **Blocked**: external blockers, pending decisions, answers still awaited.
- **Deviations**: anything that diverged from a plan, spec, or request.

## 2. Update the session doc

Detect the repo's session-doc convention rather than assuming one:

- `.scratch/` layout (`.scratch/<feature-slug>/spec.md` exists): update it in
  place. Refresh **Objective**, **Decisions & constraints**, **File layout**,
  **Design**, **Execution** to match reality. Append dated entries to the
  **Deviation log** for every change since the doc was last written.
- Otherwise: update whatever plan/spec doc the repo tracks (common names:
  `spec.md`, `plan.md`, `docs/plan/`, `docs/specs/`). Same refresh plus dated
  deviation entries.
- No session doc: do not invent one. Skip creation, note it in the report.
- Work essentially complete: say so, note the doc should be archived
  (`.scratch/complete/` when the repo uses `.scratch/`, or the repo's
  equivalent).

## 3. Collect the todo list

Gather todos from wherever they live and persist them into the resume
checkpoint (step 6) so a fresh session can pick them up. Sources, in order:

- The active goal objective (step 1) and anything it implies is still open.
- Repo-tracked tickets (`.scratch/<feature-slug>/` tickets when the repo uses
  `.scratch/`, or the repo's issue tracker).
- Your own context: pending or in-progress items stated in the conversation.

Write each item with what remains and how to verify it. Mark anything
actually finished as completed. Merge duplicates. Keep the list short.
No todos: say so in the report and move on.

## 4. Persist session-critical facts

Capture anything cheap to lose and expensive to rediscover:

- **Environment**: dev servers running (and which subagent/PTY owns them),
  ports, URLs, relevant PIDs, current git branch and uncommitted files.
- **Commands**: exact verification commands (build, lint, test, typecheck) and
  any one-off commands that worked.
- **Gotchas**: non-obvious findings, dead ends, API quirks, decisions and
  their rationale. If a friction point was filed to Hindsight, reference its
  `document_id`; do not duplicate it.
- **Secrets**: do NOT write credentials or tokens. Note where they live
  instead (env var, file path).

## 5. Update memory (optional)

If the session changed durable, high-signal facts (new project conventions,
architecture decisions, workflow changes), update the project or global memory
blocks so they survive without the conversation. Never add trivia.

## 6. Write the resume checkpoint

Write the resume checkpoint to `.scratch/<feature-slug>/checkpoint.md` when
the repo uses the `.scratch/` layout; otherwise a generic `RESUME.md` at the
repo root. The checkpoint's section template lives in the @session skill. No
credentials or tokens (see §4). After compaction, the fresh session's first
action is to re-create the goal with the recorded objective
(create_goal/set_goal), then continue from the checkpoint.

## 7. Clear the goal

When all persistence steps are done, clear the active goal with `clear_goal`.
That stops the goal plugin from re-prompting to continue the current goal after
compaction. The objective survives in the resume checkpoint, so nothing is
lost by clearing it.

## 8. Report

Give the user a concise report:

- Where each piece of state was persisted (session doc path, checkpoint, todo
  list, memory; friction is already in Hindsight).
- The goal that was cleared, and the objective they must re-create after
  compaction.
- The single next step they can paste into a fresh session to continue.
- Anything that could NOT be persisted, so they know what is lost on
  compaction.

Do not commit or take any other side action. Step 9 offers the compaction
itself; otherwise the user decides whether to compact or continue.

## 9. Offer compaction

**GATE compact-offer (normal → compact immediately):** after the report, offer
to compact this session now. Skip this step entirely when the agent is not
running in OpenCode; the report in step 8 ends the procedure.

Detect the OpenCode harness first:

- **OpenCode v2**: the environment block carries
  `Current conversation session ID: ses_…`. Compact with the @ocv2-compact
  skill: from that skill's directory run `scripts/oc-compact.sh ses_… --timeout 0`,
  then end the turn.
  The compaction is a steer: it queues behind the current turn and runs once
  the session goes idle. Never wait synchronously inside the turn; it always
  times out.
- **OpenCode v1**: the `compact_context` tool is available. Call it.

When the gate fires (interactive mode), ask with the @gate mechanics: what
was persisted and where (step 8), that compaction replaces the conversation
with the summary, Approve / Abort. Approve → run the compaction for the
detected harness. Abort → stop; the persisted state stands either way.

In auto mode, do not ask; run the compaction immediately after the report.

## Dependency graph

- step1
- step2 -> step1
- step3 -> step2
- step4 -> step2
- step5
- step6 -> step2, step4
- step7 -> step6
- step8 -> step6, step7
- step9 -> step8
