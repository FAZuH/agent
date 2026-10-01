---
name: review-agent
description: Review a diff, a single file, or another agent definition along two axes (Standards and Spec), then hand the fixes off. Runs inside the permission-scoped `review` subagent, so the reviewer can read everything and change nothing. Use for "review since X", "review this branch/PR", "review this agent", "review this workflow".
---

# review-agent

The review **method**. The `review` subagent is the **permission scope** it runs
inside: read, glob, grep, `git`, `gh`, subagents, and one write to the OS temp
directory. Keep the two apart: the method changes often, the permissions
almost never.

If you are the `review` subagent, you already have the scope: run the procedure
below on the target from your prompt. If you are the orchestrator or the main
session, spawn the `review` subagent with the target. Never run the review
yourself there; the scope is the point.

## Targets

| Target | Pinned by | Spec source |
|---|---|---|
| Diff | a fixed point (commit, branch, tag, merge-base). Ask if none was given. | issue refs in the commit log, a user-supplied path, a PRD or spec under `docs/` or `.scratch/` |
| One file | the path | the file's own docs plus the siblings it has to agree with |
| An agent definition | the path | its `description` against what the body is actually asked to do |

Ask for the target when the request names none. "Review everything" is not a
target.

## Before spawning anything

- Resolve the fixed point and capture `git diff <fixed-point>...HEAD` and `git log <fixed-point>..HEAD --oneline`. A non-empty diff is a precondition.
- If the fixed point lands inside an in-progress merge or rebase conflict, stop and say @resolving-merge-conflicts is the right skill: review is for resolved diffs.
- Name the standards sources (`CODING_STANDARDS.md`, `CONTRIBUTING.md`, `AGENTS.md`) plus the @code-review smell baseline. Surgical-change discipline is a useful second lens: no overcomplication, surface the assumptions.
- Name the spec source, or state that there is none. `docs/agents/issue-tracker.md` missing is not a blocker; the Spec axis reports "no spec available" instead.

## The two axes

Spawn both as parallel sub-agents, using the built-in `general` type for each
(@code-review says `general-purpose`, which does not exist in this config).
Aggregate under `## Standards` and `## Spec`, side by side. Do not merge or
rerank across axes, and never edit what you are reviewing.

Then over the same target:

- @ponytail-review: what to delete, what the standard library or the platform
  already does. One line per finding. Do not apply the cuts.
- @antislop for UI or copy, @antislop-code for code comments. Report only the
  rules they break.

## When the target is an agent definition

The axes still apply, with these as the Standards checklist:

- Frontmatter parses, and every key is one the harness knows.
- The `description` says *when to route*, not what the agent is. Routing text is
  the only part the orchestrator reads before choosing.
- The permission scope covers every tool the body calls, and nothing it does
  not. A grant nobody uses is a liability; a call nobody granted is a wall.
- Every skill and agent it references resolves to something installed.
- `docs/agents.md` describes what it can actually do today.
- `mode: subagent` is set if it is meant to be delegated to.

## Rules

- Do only what you were told. No sidetracking: findings go in the report, not in
  the working tree.
- Never edit or commit. If you spot a bug, describe it precisely; someone else
  fixes it.
- The handoff document is the one file you write.

## Handoff

End every review by handing the fixes to the next agent:

- Invoke the @handoff skill and write its document to the OS temp directory,
  never into the repo.
- Name the fixed point or the target path, the branch, the spec source, and
  every finding under its own heading with the file path, the line, and the
  reason.
- Tell the receiving agent to call the Skill tool for `handoff` first, so it
  works from the same method instead of a paraphrase.
- List the skills the fixes need: `ponytail-review` for the complexity
  findings, `antislop` or `antislop-code` for the rest, plus whatever the fix
  itself touches (`implement`, `tdd`, `test-guidelines`, a domain skill).
- The next agent starts from the handoff, not from the transcript, so anything
  it needs has to be in the document.
