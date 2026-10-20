---
name: worktree-finish
description: Finish work in a git worktree by following the @finish and @pr-creator skills, checking the pull request for merge conflicts, resolving simple conflicts, and asking the user before behavior-changing or incompatible conflict resolutions. Use when the user wants to finish a worktree, prepare its PR for merge, or check whether a worktree PR is ready.
---

# Worktree finish

Finish a worktree's pull request safely: coordinates PR creation or readiness
with conflict resolution, never silently changes behavior.

> **Load @following-procedures skill first.** It owns procedure narration,
> deviation logging, post-run report. Always follow the rules in the
> *Safety rules* section at the bottom.

## Workflow

### 1. Run the session finish workflow

Read and follow the @finish skill first. Keep its proposed commit groups for
the orchestrator.

### 2. Load the PR workflow

Read and follow the @pr-creator skill before creating, updating, or pushing the
PR. Its branch-safety, template, checks, and push rules are authoritative.

### 3. Identify the worktree and PR

Read-only checks for the current worktree, branch, remote, and PR:

```bash
git worktree list
git branch --show-current
gh pr view --json number,url,state,baseRefName,headRefName,mergeable,mergeStateStatus
```

If no PR exists, complete the applicable @pr-creator steps first. If the
current directory is the main tree rather than the feature worktree, locate
the feature worktree from `git worktree list` and run worktree commands there.

### 4. Check mergeability

Inspect the PR's mergeability and compare the feature branch with its current
base branch. Refresh the base branch first when the repo's normal workflow
permits it. Use the repo's standard PR or CI checks per @pr-creator.

Treat these as conflict signals:

- `mergeable` is `CONFLICTING`.
- `mergeStateStatus` reports conflicts or a blocked merge caused by divergence.
- Git reports conflicts during a merge or rebase against the PR base.
- Required checks reveal a conflict-resolution regression.

### 5. Resolve only simple conflicts

When conflicts are limited, mechanical, and behavior-preserving, resolve them
in the worktree. Examples: importing both independent additions, keeping
compatible formatting changes, choosing the version matching the already-agreed
implementation without changing its behavior.

After each resolution:

1. Inspect every resolved file and the staged diff.
2. Search for conflict markers with `git diff --check` and a repository search.
3. Run the repository's relevant checks from @pr-creator.
4. Commit the conflict resolution using the repository's commit convention.
5. Push the feature branch and re-check the PR's mergeability.

### 6. Ask before semantic resolution

**GATE conflict-resolution (normal → resolve by intent per this skill's
conflict signals, flag every auto-resolved choice in the report):** resolving
a conflict where either side changes behavior, public API, persisted data,
compatibility, security, performance characteristics, or user-visible
semantics, or where the correct side cannot be established from the existing
code, tests, issue, or PR description, is the user's call, not yours.
(Vocabulary: the @gate skill.)

Explain the conflicting choices, likely behavior or compatibility impact, and
the files involved. Never commit, push, or discard either choice until the user
answers.

### 7. Finish the worktree

When the PR is conflict-free and checks pass, report the PR URL, branch,
checks, and whether the worktree is safe to remove. If the user wants it
removed, follow the @worktree skill's "Finishing / cleanup" section.

## Dependency graph

- step1
- step2 -> step1
- step3 -> step1, step2
- step4 -> step3
- step5 -> step4
- step6 -> step4
- step7 -> step5, step6

## Safety rules

- Decide the deploy source before the first commit. When an unmerged branch is
  what the live deploy runs, land the fix on that branch and merge once;
  fixing the base branch instead forces a cherry-pick, and the merge then
  carries the same patch twice (duplicate commits, a pre-push reset).
- Never push the default branch; follow @pr-creator branch-safety rules.
- Never claim a PR is ready until mergeability and relevant checks have been
  verified after the final push.
