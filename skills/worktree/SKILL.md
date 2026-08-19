---
name: worktree
description: Work on a feature/branch inside a separate git worktree so the main working tree stays clean. Use whenever the user wants to work on a branch, create a worktree, start a new isolated task, or do cleanup/finish of a worktree. Keeps untracked project files (like .scratch/ and .papercuts.jsonl) on the main project dir so they survive worktree creation and cleanup.
---

# Worktree branch work

Work on a branch inside its own git worktree. The main working tree keeps the untracked project state, so creating or removing a worktree never touches `.scratch/`, `.papercuts.jsonl`, or other untracked files.

> **Untracked main-tree state:** `.scratch/` (the session workspace; its
> layout and lifecycle live in the `scratch` skill) and `.papercuts.jsonl` are
> untracked, so they live only in the main tree. This skill only needs to know
> they must not be created or edited inside a worktree — see the `scratch`
> skill for anything you actually need to do with `.scratch/`.

## Key idea

`git worktree add` checks out a branch into a separate directory. The **main tree** (the repo's original checkout) keeps all untracked files. Untracked items like `.scratch/` and `.papercuts.jsonl` are not part of any branch — they live only in the main tree and are invisible to worktree operations. This is exactly what we want: they are not duplicated into the worktree, and removing a worktree never deletes them.

- `.scratch/` — session workspace (plans, tickets, deviation logs)
- `.papercuts.jsonl` — papercuts backlog
- any other untracked files/dirs in the main tree

Because these live in the main tree only, they are *not* available inside the worktree. Do work in the worktree using tracked files only. If a task needs `.scratch/` state, that state belongs to the main-tree session, not the branch.

## Creating a worktree

1. **Start from the main tree** so the new worktree branches off current state. (The opencode session may already be running in the main tree.)

2. **Pick a branch name.** Use a short kebab-case slug describing the task, e.g. `feat/my-feature`.

3. **Choose a location.** Worktrees live outside the main tree, in the **same parent directory as the project dir**. For a project at `<parent>/<project>`, the worktree goes in `<parent>/<project>-wt/<branch>`. This keeps the worktree out of the main tree so its files never collide with `.scratch/`/`.papercuts.jsonl`.

4. **Create the worktree** (creates and checks out the branch):
   ```
   git worktree add -b <branch> <path>
   ```
   Where `<path>` is `<parent>/<project>-wt/<branch>`, e.g. for a project at `<parent>/<project>`:
   ```
   git worktree add -b feat/my-feature <parent>/<project>-wt/feat-my-feature
   ```

5. **Work inside the worktree path** (use `workdir` for bash/pty commands). Everything tracked — code, commits — happens there.

## While working

- Commits and edits go into the worktree directory.
- Do **not** run `git worktree remove` or `git branch -D` while work is in progress.
- Untracked main-tree files (`.scratch/`, `.papercuts.jsonl`) are not visible in the worktree; do not try to create or edit them there.

## Finishing / cleanup

Only run cleanup when the branch work is done (merged, or user explicitly wants the worktree gone).

1. **Ensure the branch is merged** (if the work is meant to be kept):
   ```
   git branch --merged <main-branch>
   ```
   If it's not merged and you remove the worktree, you lose the branch's commits.

2. **Remove the worktree** from the main tree (use the main-tree `workdir`):
   ```
   git worktree remove <path>
   ```
   If the worktree has untracked/modified files and refuses to remove, use `--force` **only after** confirming nothing there is worth keeping.

3. **Delete the branch** once the worktree is gone and work is merged/discarded:
   ```
   git branch -D <branch>
   ```

4. **Verify**: `git worktree list` should show the worktree gone, and untracked main-tree items (`.scratch/`, `.papercuts.jsonl`) must still exist in the main tree.

## Safety rules

- Never remove a worktree that has uncommitted work or an unmerged branch unless the user explicitly confirms it's safe to discard.
- Never delete the main tree or its untracked files.
- Always run `git worktree remove`/`git branch -D` from the **main** tree, not from inside the worktree being removed.
