---
name: worktree-new
description: Start working on a task in a new git worktree branch, keeping untracked items (.scratch/, .papercuts.jsonl) on the main project dir. Use whenever the user wants to start an isolated task or feature, work on a branch in a separate worktree, or says something like "start a new worktree for X", "work on this in a worktree", "spin up a worktree". Works with the worktree-new, worktree-close, and worktree-finish skills. Also use when the user references /worktree-new, /worktree-close, or /worktree-finish.
---

# Worktree new

Start working on a task inside a fresh git worktree so the main working tree stays clean. All tracked work — code and commits — happens in the worktree; untracked project state stays on the main tree.

> **Load the `following-procedures` skill first.** It defines how you run this
> numbered procedure: point-and-call narration, live deviation logging, and a
> fixed post-run report. Always follow the rules in the *Safety rules* section
> at the bottom.

## When to use

The user wants to begin work on a feature or task in an isolated git worktree. Triggers: "start a new worktree", "work on X in a worktree", "create a branch for this", "spin up a worktree for the feature".

## Workflow

1. **Load the worktree mechanics.** Follow the `worktree` skill for the exact creating-a-worktree steps: pick a kebab-case branch name, choose a sibling worktree location `<parent>/<project>-wt/<branch>`, and create it from the main tree with:
   ```
   git worktree add -b <branch> <path>
   ```

2. **Identify the task.** Use the user's stated task/feature description as the goal. If none was given, ask what they want to work on before creating the worktree.

3. **Work inside the worktree path** (use `workdir` for bash/pty commands). Everything tracked — code and commits — happens there.

4. **Keep untracked items on the main tree.** `.scratch/` and `.papercuts.jsonl` stay on the main project dir. Do not create or edit them inside the worktree.

5. **Report when done.** When the task is complete, report what changed and note that the user can invoke `worktree-close` to finish the session and clean up the worktree.

## Dependency graph

- step1
- step2
- step3 -> step1, step2
- step4
- step5 -> step3

## Safety rules

- Always create the worktree from the **main** tree, not from inside another worktree.
- Never create or edit untracked main-tree items (`.scratch/`, `.papercuts.jsonl`) inside the worktree.
- Don't run `git worktree remove` or `git branch -D` while work is in progress — that belongs to `worktree-close`.
