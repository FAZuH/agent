---
name: worktree-new
description: Start working on a task in a new git worktree branch, keeping untracked items (.scratch/) on the main project dir. Use when the user says "start a new worktree for X", "work on this in a worktree", or "spin up a worktree". Also use when the user references @worktree-new, @worktree-close, or @worktree-finish.
---

# Worktree new

Start a task in a fresh git worktree so the main tree stays clean. Tracked work
(code, commits) happens in the worktree; untracked project state stays on the
main tree.

> **Load @following-procedures skill first.** It owns procedure narration,
> deviation logging, post-run report. Always follow the rules in the
> *Safety rules* section at the bottom.

## When to use

The user wants to begin work on a feature or task in an isolated git worktree.
Extra trigger: "create a branch for this".

## Workflow

1. **Load the worktree mechanics.** Follow the @worktree skill: it owns the
   branch-name convention, the sibling worktree location, and the
   `git worktree add` invocation.

2. **Identify the task.** Use the user's stated task/feature description as the
   goal. If none was given, ask what they want to work on before creating the
   worktree.

3. **Work inside the worktree path.** Use `workdir` for bash/pty commands.
   Tracked work (code and commits) happens there.

4. **Report when done.** Report what changed; note the user can invoke
   @worktree-close to finish and clean up.

## Dependency graph

- step1
- step2
- step3 -> step1, step2
- step4 -> step3

## Safety rules

- Always create the worktree from the **main** tree, not from inside another
  worktree.
- Never create or edit untracked main-tree items (`.scratch/`) inside the
  worktree.
- Don't run `git worktree remove` or `git branch -D` while work is in progress;
  that belongs to @worktree-close.
