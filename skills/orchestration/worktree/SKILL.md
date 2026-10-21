---
name: worktree
description: >-
  Work on a feature/branch inside a separate git worktree so the main working
  tree stays clean: create it, finish the branch, then remove it. Use when the
  user says "start a new worktree", "work on this in a worktree", "spin up a
  worktree", "create a worktree", "work on a branch", "start a new isolated
  task", "finish a worktree", "finish and clean up the worktree", "prepare its
  PR for merge", "close the worktree", "merge and remove the worktree", or
  names worktree-new, worktree-close, or worktree-finish. Keeps untracked
  project files (like .scratch/) on the main project dir so they survive
  worktree creation and cleanup.
---

# Worktree branch work

One branch, one git worktree. The main tree keeps all untracked project state, so creating or removing a worktree never touches `.scratch/` or other untracked files.

> **Untracked means main-tree only.** `.scratch/` (see @scratch) is untracked, so it lives only in the main tree: never create or edit it inside a worktree.
>
> **A concurrent session's broad `git clean` deletes them.** Scope cleans to your own paths (`git clean -fd -- <path>`) or dry-run first (`git clean -nd`). Untracked means "not on any branch", not "not wanted".

A worktree sees tracked files only. A task needing `.scratch/` state belongs to the main-tree session, not the branch.

> **Load @following-procedures skill first.** It owns procedure narration, deviation logging, post-run report. Always follow the rules in the *Safety rules* section at the bottom.

## When to use

- **Start**: the user wants to begin work on a feature or task in an isolated git worktree.
  Extra trigger: "create a branch for this".
- **Finish**: the user wants to finish a worktree, prepare its PR for merge, or check whether a worktree PR is ready.
- **Close**: the user wants to wrap up and clean up a worktree session.
  Extra trigger: "done with this worktree".

## Creating a worktree

The mechanics below own the branch-name convention, the sibling worktree location, and the `git worktree add` invocation.

1. **Identify the task.** Use the user's stated task or feature description as the goal. If none was given, ask what they want to work on before creating the worktree.
2. **Start from the main tree**, so the worktree branches off current state.
3. **Pick a branch name**: short kebab-case slug, e.g. `feat/my-feature`.
4. **Choose a location** outside the main tree, same parent dir: `<parent>/<project>-wt/<branch>`.
5. **Create it** (creates and checks out the branch):
   ```
   git worktree add -b <branch> <path>
   ```
   e.g. for a project at `<parent>/<project>`:
   ```
   git worktree add -b feat/my-feature <parent>/<project>-wt/feat-my-feature
   ```
6. **Work inside the worktree path** (`workdir` for bash/pty). Tracked work (code, commits) happens there.

## While working

- No `git worktree remove` or `git branch -D` mid-work; removal belongs to the removal section below.
- Rust worktree: `CARGO_TARGET_DIR=<worktree-path>/target` before building. Path-sensitive locks and fingerprints serialize concurrent worktrees on a shared target dir and can force a cold rebuild.

## Finishing the branch

1. **Run the session finish workflow.** Read and follow the @finish skill first. Keep its proposed commit groups for the orchestrator.
2. **Load the PR workflow.** Read and follow the @pr-creator skill before creating, updating, or pushing the PR. Its branch-safety, template, checks, and push rules are authoritative.
3. **Identify the worktree and PR.** Read-only checks for the current worktree, branch, remote, and PR:

   ```bash
   git worktree list
   git branch --show-current
   gh pr view --json number,url,state,baseRefName,headRefName,mergeable,mergeStateStatus
   ```

   If no PR exists, complete the applicable @pr-creator steps first. If the current directory is the main tree rather than the feature worktree, locate the feature worktree from `git worktree list` and run worktree commands there.
4. **Check mergeability.** Inspect the PR's mergeability and compare the feature branch with its current base branch. Refresh the base branch first when the repo's normal workflow permits it. Use the repo's standard PR or CI checks per @pr-creator.

   Treat these as conflict signals:

   - `mergeable` is `CONFLICTING`.
   - `mergeStateStatus` reports conflicts or a blocked merge caused by divergence.
   - Git reports conflicts during a merge or rebase against the PR base.
   - Required checks reveal a conflict-resolution regression.
5. **Resolve only simple conflicts.** When conflicts are limited, mechanical, and behavior-preserving, resolve them in the worktree. Examples: importing both independent additions, keeping compatible formatting changes, choosing the version matching the already-agreed implementation without changing its behavior.

   After each resolution:

   1. Inspect every resolved file and the staged diff.
   2. Search for conflict markers with `git diff --check` and a repository search.
   3. Run the repository's relevant checks from @pr-creator.
   4. Commit the conflict resolution using the repository's commit convention.
   5. Push the feature branch and re-check the PR's mergeability.
6. **Ask before semantic resolution.**

   **GATE conflict-resolution (normal → resolve by intent per this skill's
   conflict signals, flag every auto-resolved choice in the report):** resolving
   a conflict where either side changes behavior, public API, persisted data,
   compatibility, security, performance characteristics, or user-visible
   semantics, or where the correct side cannot be established from the existing
   code, tests, issue, or PR description, is the user's call, not yours.
   (Vocabulary: the @gate skill.)

   Explain the conflicting choices, likely behavior or compatibility impact, and the files involved. Never commit, push, or discard either choice until the user answers.
7. **Finish the worktree.** When the PR is conflict-free and checks pass, report the PR URL, branch, checks, and what changed, and whether the worktree is safe to remove. If the user wants it removed, follow the removal section below to finish and clean up.

## Removing the worktree

Only when the branch work is done (merged, or the user wants the worktree gone).

1. **Run the session finish workflow.** Run the finish workflow as described in the finishing section above: it owns the wrap-up, so never restate or duplicate its steps here. Skip the steps a merge already satisfied. From @pr-to-close the PR is already merged, so the docs scour and the commit proposal are no-ops: re-running them invites "updating" docs for merged work. Left: the archive and the summary.
2. **Clean up the worktree.** Verify the branch is merged, remove the worktree from the **main** tree, delete the branch, then verify with `git worktree list` that the worktree is gone and that the untracked main-tree items survived:
   1. **Ensure merged** (if keeping the work):
      ```
      git branch --merged <main-branch>
      ```
      Removing an unmerged worktree loses the branch's commits.
   2. **Remove the worktree** from the main tree:
      ```
      git worktree remove <path>
      ```
      Refuses over untracked/modified files: `--force` only after confirming nothing there is worth keeping.
   3. **Delete the branch** once the worktree is gone and work is merged or discarded:
      ```
      git branch -D <branch>
      ```
   4. **Verify**: `git worktree list` shows it gone; `.scratch/` still in the main tree.

## Dependency graph

- step1
- step2
- step3 -> step1, step2
- step4 -> step3
- step5 -> step4
- step6 -> step4
- step7 -> step5, step6

## Safety rules

- Always create the worktree from the **main** tree, not from inside another worktree.
- Never create or edit untracked main-tree items (`.scratch/`) inside the worktree.
- No removing a worktree with uncommitted work or an unmerged branch without explicit user confirmation.
- Never delete the main tree or its untracked files.
- `git worktree remove` / `git branch -D` always from the **main** tree, never inside the worktree being removed.
- Decide the deploy source before the first commit. When an unmerged branch is what the live deploy runs, land the fix on that branch and merge once; fixing the base branch instead forces a cherry-pick, and the merge then carries the same patch twice (duplicate commits, a pre-push reset).
- Never push the default branch; follow @pr-creator branch-safety rules.
- Never claim a PR is ready until mergeability and relevant checks have been verified after the final push.
