---
name: worktree-close
description: Finish a worktree session and clean up the git worktree. Runs the end-of-session finish workflow, then removes the worktree and its branch, keeping untracked items (.scratch/) on the main project dir. Use when the user says "close the worktree", "finish and clean up the worktree", or "merge and remove the worktree". Also use when the user references @worktree-new, @worktree-close, or @worktree-finish.
---

# Worktree close

Run the end-of-session finish workflow, then remove the worktree and its
branch. Untracked items (`.scratch/`) stay on the main project dir.

> **Load @following-procedures skill first.** It owns procedure narration,
> deviation logging, post-run report. Always follow the rules in the
> *Safety rules* section at the bottom.

## When to use

The user wants to wrap up and clean up a worktree session. Extra trigger:
"done with this worktree".

## Workflow

### 1. Run the session finish workflow

Load the @finish skill and follow it exactly; it owns the wrap-up. Never
restate or duplicate its steps here.

Skip the steps a merge already satisfied. From @pr-to-close the PR is already
merged, so the docs scour and the commit proposal are no-ops: re-running them
invites "updating" docs for merged work. Left: the archive and the summary.

### 2. Clean up the worktree

Follow the @worktree skill's "Finishing / cleanup" steps: verify the branch is
merged, remove the worktree from the **main** tree, delete the branch, then
verify with `git worktree list` that the worktree is gone and that the
untracked main-tree items survived.

## Dependency graph

- step1
- step2 -> step1

## Safety rules

- Never remove a worktree that has uncommitted work or an unmerged branch
  unless the user explicitly confirms it's safe to discard.
- Never delete the main tree or its untracked files.
- Always run `git worktree remove`/`git branch -D` from the **main** tree, not
  from inside the worktree being removed.
