---
name: finish
description: "End a working session — update the relevant docs, archive a completed `.scratch/` session workspace, summarize what was accomplished, suggest next steps, then delegate to @commit (§2) and @self-improve (§6). Use when wrapping up a session or when the user asks to finish or commit the session's work. The finish agent never runs `git add`/`git commit` itself."
---

# Finish a session

End a working session: update the relevant docs, delegate commit planning to @commit, archive the workspace, summarize what you accomplished, suggest next steps, then delegate self-improvement to @self-improve. Do the steps in order.

> **Load the @following-procedures skill first.** It defines how you run this
> numbered procedure: point-and-call narration, live deviation logging, and a
> fixed post-run report.

Commit and self-improvement gates live in the delegated skills: GATE
`commit-approval` in @commit, GATE `papercut-file` (via @session-retro) and
GATE `offer-sweep` in @self-improve (vocabulary: the @gate skill). The
`/finish` command wrapper grants `commit-approval` when its argument begins
with `auto`. This skill declares no gates of its own and never runs `git
add`, `git commit`, or `git push` — it only returns the delegated skills'
proposals to the orchestrator.

## 1. Update relevant docs

Discover the docs before you write or change anything. Scour the `docs/` directory and all markdown files in it (e.g. ADRs under `docs/adr/`), plus any session/plan docs the repo tracks — commonly under `docs/plan/`, `docs/specs/`, or `.scratch/` (spec, checkpoint, archive). Also look for markdown docs and agent docs. The common names are `README.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, `AGENTS.md`, `CONTEXT.md`, and `CLAUDE.md`. Read them first. Build your work on the existing docs. Do not duplicate or contradict them.

Review the conversation. Identify the docs that the changes require. Update the relevant docs. Change the agent docs (`AGENTS.md`, `CONTEXT.md`, `CLAUDE.md`) when the session changes a project convention, a command, a workflow, tooling, or the architecture. If nothing needs a change, say so and skip.

## 2. Commit changes

Load the @commit skill and follow it exactly. It owns the commit permission
gate, the commit-docs lookup, the `git log` convention check, and the
group-then-propose procedure. Return its proposed group messages to the
orchestrator unchanged. Do not restate or duplicate its steps here.

## 3 Archive a completed `.scratch/` workspace

If the repo uses a `.scratch/` session workspace (see the @scratch skill),
load the @scratch-finish skill and follow it. It owns the completion
checklist and the archive steps — append an Outcome section to the spec, move
it to `.scratch/complete/`, mark tickets resolved, and delete the stale
checkpoint. Do not restate or duplicate those steps here.

If any completion item is still open, or the work is not merged/confirmed
complete, do **not** archive. Leave the workspace in place and note in the
summary that it still has open items.

## 4. Summarize the session

Review the conversation so far. Write a concise summary of what you accomplished. Include this information:
- The files that you changed or created
- The problems that you solved or the features that you added
- The decisions that you made

## 5. Suggest next steps

Identify what remains to do. Prioritize the tasks in this order:
1. Tasks deferred on purpose. The examples are sub-tasks, unstarted phases of a plan, and postponed work.
2. Natural follow-ups from the work. The examples are cleanup, testing, documentation, and adjacent features. Suggest 2 or 3 items at most.

## 6. Run self-improvement

Load the @self-improve skill and follow it exactly. It owns the collect
(@session-retro, gated) + validate (@skill-doctor) + offer-sweep (gated)
sequence. Do not restate or duplicate those steps here.

## Dependency graph

- step1
- step2 -> step1
- step3 -> step2
- step4 -> step2, step3
- step5 -> step4
- step6 -> step5
