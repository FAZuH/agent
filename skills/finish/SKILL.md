---
name: finish
description: "End a working session — update the relevant docs, plan the commit grouping and propose `type(scope): description` commit messages for each logical group, hand those proposals to the orchestrator to execute with the user, archive a completed `.scratch/` session workspace, summarize what was accomplished, and suggest next steps. Use when wrapping up a session or when the user asks to finish or commit the session's work. The finish agent never runs `git add`/`git commit` itself."
---

# Finish a session

End a working session: update the relevant docs, plan the commit grouping and propose one conventional message per group, summarize what you accomplished, and suggest next steps. Do the steps in order.

## Mode and commit permission

This agent has NO commit permission at all. You may never run `git add`, `git commit`, or `git push` — not on any argument, and not in an `auto` mode (there is no auto mode). Committing is executed by the orchestrator agent.

Your job in the commit step is only to PLAN the commit grouping and PROPOSE one `type(scope): description` message per logical group. Return the proposed group messages to the orchestrator. The orchestrator restates them to the user, the user can adjust them, and only the orchestrator runs the actual `git add` and `git commit`.

The commit permission does not exist and does not pass to any other request or agent. When in doubt, do not commit; propose and hand off.

## 1. Update relevant docs

Discover the docs before you write or change anything. Scour the `docs/` directory and all markdown files in it (e.g. ADRs under `docs/adr/`), plus any session/plan docs the repo tracks — commonly under `docs/plan/`, `docs/specs/`, or `.scratch/` (spec, checkpoint, archive). Also look for markdown docs and agent docs. The common names are `README.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, `AGENTS.md`, `CONTEXT.md`, and `CLAUDE.md`. Read them first. Build your work on the existing docs. Do not duplicate or contradict them.

Review the conversation. Identify the docs that the changes require. Update the relevant docs. Change the agent docs (`AGENTS.md`, `CONTEXT.md`, `CLAUDE.md`) when the session changes a project convention, a command, a workflow, tooling, or the architecture. If nothing needs a change, say so and skip.

## 2. Commit changes

Check if this directory is a git repository (`git rev-parse --is-inside-work-tree`). If it is not a repository, skip all commit steps.

Read the commit docs of the project, if any. Find and grep for commit docs before proposing commits: search for `CONTRIBUTING.md`, `docs/commits*`, any `COMMITTING.md`/`COMMIT*.md`, and the commit section of `AGENTS.md` or `CLAUDE.md`. Use glob and grep across the whole repo — including `docs/` — to locate them. Read the docs before you write a commit message. Check the last 10 commits with `git log --oneline -10`. Base the message on those docs. Do not invent conventions that the project does not have. If the docs are missing or poor, say so. Propose an addition when the change is not covered. One example is a new commit scope.

Identify the files that you changed this session. Only those files belong in the commit groups you propose.

Split the changes into separate commits. Use one commit per logical change. Do not combine unrelated changes in one commit. Do not write one message that lists several unrelated changes. Group the changed files by logical change first. Then commit each group separately. Do not stage everything and write one commit for it by default.

If there is nothing to commit, say so. Then skip the rest of this section.

You have NO commit permission: you must NOT run `git add`, `git commit`, or `git push` on your own, no matter what. Propose one message for each group. Use the format `type(scope): description`. Hand the proposed group messages to the orchestrator. The orchestrator restates them to the user for approval (the user can adjust the messages) and then runs the actual `git add` and `git commit` for each group. Do not run any other group or proceed to step 3 until you have handed off the full proposal.

## 2.5 Archive a completed `.scratch/` workspace

If the repo uses a `.scratch/` session workspace (see the `scratch` skill) and
the session's feature is genuinely complete, archive it: every checklist item
on the spec is done, all `issues/` tickets are `Status: resolved`, and the
work is merged or the user confirms it is done. Follow the **Completing /
archiving a feature** steps in the `scratch` skill — append an Outcome section
to the spec, move it to `.scratch/complete/`, mark tickets resolved, and
delete the stale checkpoint.

If any item is still open, or the work is not merged/confirmed complete, do
**not** archive. Leave the workspace in place and note in the summary that it
still has open items.

## 3. Summarize the session

Review the conversation so far. Write a concise summary of what you accomplished. Include this information:
- The files that you changed or created
- The problems that you solved or the features that you added
- The decisions that you made

## 4. Suggest next steps

Identify what remains to do. Prioritize the tasks in this order:
1. Tasks deferred on purpose. The examples are sub-tasks, unstarted phases of a plan, and postponed work.
2. Natural follow-ups from the work. The examples are cleanup, testing, documentation, and adjacent features. Suggest 2 or 3 items at most.