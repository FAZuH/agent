---
name: commit
description: Plan commit grouping and propose conventional commit messages without committing. Use whenever the user asks to commit, group changes, check what would commit, review staged diffs, or write commit messages — even when they do not name this skill. Proposes one type(scope): description message per logical group and hands them to the orchestrator; never runs git add/commit/push itself.
---

# Commit

Plan the commit grouping and propose one conventional message per logical
group. This skill only plans; the orchestrator executes with the user.

> **Load the @following-procedures skill first.** It defines how you run this
> numbered procedure: point-and-call narration, live deviation logging, and a
> fixed post-run report. Always follow the rules in the *Mode and commit
> permission* section below.

## Mode and commit permission

**GATE commit-approval (normal → commit each group with the inferred conventional message):** staging and committing the session's logical groups
requires user approval. The `/finish` command wrapper grants that approval
when its argument begins with `auto` — that is `auto` mode for this
invocation (see the @gate skill). In auto mode, the orchestrator may stage
and commit each proposed logical group without asking. In all other modes,
the orchestrator must propose the groups and wait for confirmation.

This skill remains read-only with respect to commits: it never runs
`git add`, `git commit`, or `git push`. It only proposes groups for the
orchestrator.

Your job is only to PLAN the commit grouping and PROPOSE one `type(scope): description` message per logical group. Return the proposed group messages to the orchestrator. The orchestrator restates them to the user, the user can adjust them, and only the orchestrator runs the actual `git add` and `git commit`.

The commit permission does not persist beyond the command invocation and does
not pass to any other request or agent. When in doubt, do not commit; propose
and hand off.

## Procedure

Check if this directory is a git repository (`git rev-parse --is-inside-work-tree`). If it is not a repository, skip all commit steps.

Read the commit docs of the project, if any. Find and grep for commit docs before proposing commits: search for `CONTRIBUTING.md`, `docs/commits*`, any `COMMITTING.md`/`COMMIT*.md`, `docs/dev/commit-scopes.md`, and the commit section of `AGENTS.md` or `CLAUDE.md`. Use glob and grep across the whole repo — including `docs/` — to locate them. Read the docs before you write a commit message. Check the last 10 commits with `git log --oneline -10`. Base the message on those docs. Do not invent conventions that the project does not have.

When the repo has a commit-scopes vocabulary (`docs/dev/commit-scopes.md` or equivalent), load the @commit-scopes skill and follow its scope rules: closed vocabulary, singular, real-slice, never colliding with a type, ≤8 chars. Every group picks a scope from that table or takes no scope. If the docs are missing or poor, say so. When no existing scope fits, follow @commit-scopes to propose the new scope — GATE `new-scope` is `always`, so propose name + definition + example subject and wait for explicit approval before committing with it. One example is a new commit scope.

Identify the files that you changed this session. Only those files belong in the commit groups you propose.

Split the changes into separate commits. Use one commit per logical change. Do not combine unrelated changes in one commit. Do not write one message that lists several unrelated changes. Group the changed files by logical change first. Then commit each group separately. Do not stage everything and write one commit for it by default.

If there is nothing to commit, say so. Then skip the rest of this section.

You have NO commit permission: you must NOT run `git add`, `git commit`, or `git push` on your own, no matter what. Propose one message for each group. Use the format `type(scope): description`. Hand the proposed group messages to the orchestrator. The orchestrator restates them to the user for approval (the user can adjust the messages) and then runs the actual `git add` and `git commit` for each group.
