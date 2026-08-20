---
name: worktree-finish
description: Finish work in a git worktree by following the /finish and /pr-creator skills, checking the pull request for merge conflicts, resolving simple conflicts, and asking the user before behavior-changing or incompatible conflict resolutions. Use when the user wants to finish a worktree, prepare its PR for merge, or check whether a worktree PR is ready.
---

# Worktree finish

Finish a worktree's pull request safely. This skill coordinates PR creation or
readiness work with conflict resolution; it does not silently change behavior.

> **Load the `following-procedures` skill first.** It defines how you run this
> numbered procedure: point-and-call narration, live deviation logging, and a
> fixed post-run report. Always follow the rules in the *Safety rules* section
> at the bottom.

## Workflow

Run these steps in order.

### 1. Run the session finish workflow

Read and follow the `finish` skill first. Complete its documentation, session-archive, summary, and commit
proposal steps. The finish skill does not grant commit or push permission; keep
its proposed commit groups available for the orchestrator.

### 2. Load the PR workflow

Read and follow the `pr-creator` skill before creating, updating, or pushing the PR. Treat its branch-safety,
template, checks, and push rules as authoritative.

### 3. Identify the worktree and PR

Run read-only checks to identify the current worktree, branch, remote, and PR:

```bash
git worktree list
git branch --show-current
gh pr view --json number,url,state,baseRefName,headRefName,mergeable,mergeStateStatus
```

If no PR exists, complete the applicable `/pr-creator` steps first. If the
current directory is the main tree rather than the feature worktree, locate the
feature worktree from `git worktree list` and run worktree commands there.

### 4. Check mergeability

Inspect the PR's mergeability and compare the feature branch with its current
base branch. Refresh the base branch before testing when the repository's normal
workflow permits it. Use the repository's standard PR or CI checks as described
by `/pr-creator`.

Treat these as conflict signals:

- `mergeable` is `CONFLICTING`.
- `mergeStateStatus` reports conflicts or a blocked merge caused by divergence.
- Git reports conflicts during a merge or rebase against the PR base.
- Required checks reveal a conflict-resolution regression.

### 5. Resolve only simple conflicts

When conflicts are limited, mechanical, and behavior-preserving, resolve them
in the worktree. Examples include importing both independent additions,
retaining compatible formatting changes, or choosing the version that matches
the already-agreed implementation without changing its behavior.

After each resolution:

1. Inspect every resolved file and the staged diff.
2. Search for conflict markers with `git diff --check` and a repository search.
3. Run the repository's relevant checks from `/pr-creator`.
4. Commit the conflict resolution using the repository's commit convention.
5. Push the feature branch and re-check the PR's mergeability.

### 6. Ask before semantic resolution

Stop and ask the user for a decision before resolving a conflict when either
side changes behavior, public API, persisted data, compatibility, security,
performance characteristics, or user-visible semantics. Also ask when the
correct side cannot be established from the existing code, tests, issue, or PR
description.

Explain the conflicting choices, the likely behavior or compatibility impact,
and the files involved. Do not commit, push, or discard either choice until the
user answers.

### 7. Finish the worktree

When the PR is conflict-free and checks pass, report the PR URL, branch, checks,
and whether the worktree is safe to remove. Follow the `worktree` skill's
cleanup rules if the user explicitly asks to remove the worktree:

- Verify the branch is merged, or get explicit confirmation before discarding
  an unmerged branch.
- Run `git worktree remove` and branch deletion from the main tree.
- Verify `git worktree list` and preserve main-tree untracked state.

## Dependency graph

- step1
- step2 -> step1
- step3 -> step1, step2
- step4 -> step3
- step5 -> step4
- step6 -> step4
- step7 -> step5, step6

## Safety rules

- Never resolve a semantic conflict by guessing.
- Never force-remove a worktree with uncommitted or unmerged work without
  explicit user confirmation.
- Never push the default branch; follow `/pr-creator` branch-safety rules.
- Never claim a PR is ready until mergeability and relevant checks have been
  verified after the final push.
