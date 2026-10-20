---
name: finish
description: "End a working session: update the relevant docs, load @commit, archive a completed `.scratch/` workspace, summarize the session, suggest next steps, then load @self-improve. Use when wrapping up a session or when the user asks to finish or commit the session's work. It never runs `git add`/`git commit` itself."
---

# Finish a session

End the session, in order: docs, commit, archive, summary, next steps,
self-improvement.

> **Load @following-procedures skill first.** It owns procedure narration,
> deviation logging, post-run report.

Gates live in the loaded skills: GATE `commit-approval` in @commit and GATE
`offer-sweep` in @self-improve (vocabulary: the @gate skill). `/finish auto`
grants `commit-approval`. This skill declares no gates and never runs
`git add`, `git commit`, or `git push`: it returns proposed groups to the
primary agent for user approval.

## 1. Update relevant docs

Scour `docs/` (ADRs, plan docs, `.scratch/` workspaces) plus `README.md`,
`CONTRIBUTING.md`, `CHANGELOG.md`, `AGENTS.md`, `CONTEXT.md`, `CLAUDE.md`.
Build on them, never duplicate or contradict. Update agent docs when the
session changed a convention, command, workflow, tooling, or architecture.
Nothing needs a change: say so and skip.

## 2. File session friction

Anything noticed during the session that was never filed goes to Hindsight now,
per the friction contract in @global-instruction and the entry format in
@session-retro. Nothing carries past this step unfiled, and it is not a bug
tracker: one or two sentences each.

The `/finish` invocation is the approval to file: retain these directly, with
no further gate. GATE `friction-file` in @session-retro covers only a
standalone retro, where no `/finish` preceded it.

## 3. Commit changes

Load the @commit skill and follow it exactly. Return its proposed groups
unchanged. Do not duplicate its steps here.

## 4. Archive a completed `.scratch/` workspace

Repo uses `.scratch/` (see the @scratch skill): load the @scratch-finish skill
and follow it. Open items, or work unmerged or unconfirmed: leave the
workspace in place and note it in the summary.

## 5. Summarize the session

Review the conversation. Concise summary: files changed or created, problems
solved or features added, decisions made. If the hindsight MCP tools are
present, `retain` the summary; absent → skip.

## 6. Suggest next steps

Deferred tasks first (sub-tasks, unstarted phases, postponed work), then
natural follow-ups (cleanup, testing, docs, adjacent features). Two or three
at most.

## 7. Run self-improvement

Load the @self-improve skill and follow it exactly. Do not duplicate its steps
here.

## Dependency graph

- step1
- step2 -> step1
- step3 -> step1
- step4 -> step3
- step5 -> step2, step4
- step6 -> step5
- step7 -> step6
