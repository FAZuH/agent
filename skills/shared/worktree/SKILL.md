---
name: worktree
description: Work on a feature/branch inside a separate git worktree so the main working tree stays clean. Use whenever the user wants to work on a branch, create a worktree, start a new isolated task, or do cleanup/finish of a worktree. Keeps untracked project files (like .scratch/) on the main project dir so they survive worktree creation and cleanup.
---

# Worktree branch work

One branch, one git worktree. The main tree keeps all untracked project state, so creating or removing a worktree never touches `.scratch/` or other untracked files.

> **Untracked means main-tree only.** `.scratch/` (see @scratch) is untracked, so it lives only in the main tree: never create or edit it inside a worktree.
>
> **A concurrent session's broad `git clean` deletes them.** Scope cleans to your own paths (`git clean -fd -- <path>`) or dry-run first (`git clean -nd`). Untracked means "not on any branch", not "not wanted".

A worktree sees tracked files only. A task needing `.scratch/` state belongs to the main-tree session, not the branch.

## Creating a worktree

1. **Start from the main tree**, so the worktree branches off current state.
2. **Pick a branch name**: short kebab-case slug, e.g. `feat/my-feature`.
3. **Choose a location** outside the main tree, same parent dir: `<parent>/<project>-wt/<branch>`.
4. **Create it** (creates and checks out the branch):
   ```
   git worktree add -b <branch> <path>
   ```
   e.g. for a project at `<parent>/<project>`:
   ```
   git worktree add -b feat/my-feature <parent>/<project>-wt/feat-my-feature
   ```
5. **Work inside the worktree path** (`workdir` for bash/pty). Tracked work (code, commits) happens there.

## While working

- No `git worktree remove` or `git branch -D` mid-work.
- Rust worktree: `CARGO_TARGET_DIR=<worktree-path>/target` before building. Path-sensitive locks and fingerprints serialize concurrent worktrees on a shared target dir and can force a cold rebuild.

## Finishing / cleanup

Only when the branch work is done (merged, or the user wants the worktree gone).

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

## Safety rules

- No removing a worktree with uncommitted work or an unmerged branch without explicit user confirmation.
- Never delete the main tree or its untracked files.
- `git worktree remove` / `git branch -D` always from the **main** tree, never inside the worktree being removed.
