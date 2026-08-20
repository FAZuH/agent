---
name: worktree-close
description: Finish a worktree session and clean up the git worktree. Runs the end-of-session finish workflow (update docs, plan and make commits, summarize, suggest next steps), then removes the worktree and its branch, keeping untracked items (.scratch/, .papercuts.jsonl) on the main project dir. Use whenever the user wants to finish/close a worktree, wrap up a worktree session, or says "close the worktree", "finish and clean up the worktree", "merge and remove the worktree". Works with the worktree-new, worktree-close, and worktree-finish skills. Also use when the user references /worktree-new, /worktree-close, or /worktree-finish.
---

# Worktree close

Finish a worktree session end-to-end: run the finish workflow (docs, commits, summary, next steps), then remove the worktree and its branch. Keeps untracked items (`.scratch/`, `.papercuts.jsonl`) on the main project dir.

## When to use

The user wants to wrap up and clean up a worktree session. Triggers: "close the worktree", "finish and clean up the worktree", "merge and remove the worktree", "done with this worktree". Pairs with `worktree-new`.

## Workflow

Run the finish skill's steps in order, then the worktree cleanup.

### 1. Update relevant docs

Follow the `finish` skill's step 1 — discover and update the relevant docs, or say nothing needs a change and skip.

### 2. Commit changes

Follow the `finish` skill's step 2: inspect git read-only, identify the files changed this session, split them into one commit per logical group, and propose one `type(scope): description` message per group.

Commit permission rules:
- If the user passed `auto` as an argument, you may commit each group without asking.
- Otherwise (no argument or any other text), there is NO commit permission. Propose one message per group, then stop and wait for explicit user confirmation before running `git add`/`git commit`. Treat any non-`auto` argument as extra instructions for the whole workflow, committing interactively.

### 3. Summarize the session

Follow the `finish` skill's step 3 exactly.

### 4. Suggest next steps

Follow the `finish` skill's step 4 exactly.

### 5. Clean up the worktree

Follow the `worktree` skill's "Finishing / cleanup" steps:

1. **Verify the branch is merged** (`git branch --merged <main-branch>`) if the work is meant to be kept. If it has uncommitted or unmerged work, confirm with the user before discarding anything.
2. **Remove the worktree** from the **main** tree (`git worktree remove <path>`), then delete the branch (`git branch -D <branch>`) once it's gone. Use `--force` only after confirming nothing there is worth keeping.
3. **Verify**: `git worktree list` shows the worktree gone, and untracked main-tree items (`.scratch/`, `.papercuts.jsonl`) still exist in the main project dir.

## Safety rules

- Never remove a worktree that has uncommitted work or an unmerged branch unless the user explicitly confirms it's safe to discard.
- Never delete the main tree or its untracked files.
- Always run `git worktree remove`/`git branch -D` from the **main** tree, not from inside the worktree being removed.
- Respect commit-permission semantics: only commit on your own when the user passed `auto`; otherwise propose and wait.
