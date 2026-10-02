---
name: commit
description: Plan commit grouping and propose one conventional commit message per logical group, without committing. Use whenever the user asks to commit, group changes, check what would commit, review staged diffs, or write commit messages, even when they do not name this skill. Proposes the groups and hands them to the orchestrator; never runs git add/commit/push itself.
---

# Commit

> **Load the @following-procedures skill first.** It defines how you run this
> numbered procedure: point-and-call narration, live deviation logging, and a
> fixed post-run report. Always follow the rules in the *Mode and commit
> permission* section below.

## Mode and commit permission

**GATE commit-approval (normal → commit each group with the inferred conventional message):** staging and committing the session's logical groups
requires user approval. The `/finish` command wrapper grants that approval
when its argument begins with `auto`: that is `auto` mode for this
invocation (see the @gate skill). In auto mode, the orchestrator may stage
and commit each proposed logical group without asking. In all other modes,
the orchestrator must propose the groups and wait for confirmation.

This skill remains read-only with respect to commits: it never runs
`git add`, `git commit`, or `git push`. It only proposes groups for the
orchestrator.

Your job is only to PLAN the grouping and PROPOSE one `type(scope): description` message per logical group. Return them to the orchestrator.

The commit permission does not persist beyond the command invocation and does
not pass to any other request or agent. When in doubt, do not commit; propose
and hand off.

## Procedure

Not a git repo (`git rev-parse --is-inside-work-tree` fails): skip everything.

Read the project's commit docs first: grep for `CONTRIBUTING.md`, `docs/commits*`, `COMMITTING.md`/`COMMIT*.md`, `docs/dev/commit-scopes.md`, and the commit section of `AGENTS.md`/`CLAUDE.md`. Check `git log --oneline -10`. Base the message on those docs, never invent conventions.

When the repo has a commit-scopes vocabulary (`docs/dev/commit-scopes.md` or equivalent), load the @commit-scopes skill and follow its scope rules: closed vocabulary, singular, real-slice, never colliding with a type, ≤8 chars. Every group picks a scope from that table or takes no scope. If the docs are missing or poor, say so. When no existing scope fits, follow @commit-scopes to propose the new scope: GATE `new-scope` is `always`, so propose name + definition + example subject and wait for explicit approval before committing with it. One example is a new commit scope.

Identify the files changed this session. Only those belong in the groups.

One commit per logical change. Group changed files by logical change first. Never stage everything into one commit by default.

Nothing to commit: say so and skip the rest.

You have NO commit permission: you must NOT run `git add`, `git commit`, or `git push` on your own, no matter what. Propose one message for each group. Use the format `type(scope): description`. Hand the proposed group messages to the orchestrator. The orchestrator restates them to the user for approval (the user can adjust the messages) and then runs the actual `git add` and `git commit` for each group.
