---
name: finish
description: "End a working session: update the relevant docs, load @commit, archive a completed `.scratch/` workspace, summarize what was accomplished, suggest next steps, then load @self-improve. Use when wrapping up a session or when the user asks to finish or commit the session's work. This skill never runs `git add`/`git commit` itself."
---

# Finish a session

End the session, in order: docs, commit, archive, summary, next steps, self-improvement.

> **Load the @following-procedures skill first.** It defines how you run this
> numbered procedure: point-and-call narration, live deviation logging, and a
> fixed post-run report.

Gates live in the loaded skills: GATE `commit-approval` in @commit, GATE `papercut-file` (via @session-retro) and GATE `offer-sweep` in @self-improve (vocabulary: the @gate skill). `/finish auto` grants `commit-approval`. This skill declares no gates and never runs `git add`, `git commit`, or `git push`: it returns proposed groups to the primary agent for user approval.

## 1. Update relevant docs

Scour `docs/` (ADRs, plan docs, `.scratch/` workspaces) plus `README.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, `AGENTS.md`, `CONTEXT.md`, `CLAUDE.md`. Build on them, never duplicate or contradict. Update agent docs when the session changed a convention, command, workflow, tooling, or architecture. Nothing needs a change: say so and skip.

## 2. Commit changes

Load the @commit skill and follow it exactly. Return its proposed groups unchanged. Do not duplicate its steps here.

## 3. Archive a completed `.scratch/` workspace

Repo uses `.scratch/` (see the @scratch skill): load the @scratch-finish skill and follow it. Open items, or work unmerged or unconfirmed: leave the workspace in place and note it in the summary.

## 4. Summarize the session

Review the conversation. Concise summary: files changed or created, problems solved or features added, decisions made.

## 5. Suggest next steps

Deferred tasks first (sub-tasks, unstarted phases, postponed work), then natural follow-ups (cleanup, testing, docs, adjacent features). Two or three at most.

## 6. Run self-improvement

Load the @self-improve skill and follow it exactly. Do not duplicate its steps here.

## Dependency graph

- step1
- step2 -> step1
- step3 -> step2
- step4 -> step2, step3
- step5 -> step4
- step6 -> step5
