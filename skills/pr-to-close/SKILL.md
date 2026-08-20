---
name: pr-to-close
description: "Full end-to-end close of a worktree feature: create a PR (pr-creator), watch its CI and merge when green (pr-watchmerge), then close the worktree (worktree-close). Use whenever the user wants to take a finished worktree branch all the way to merged and cleaned up — 'create a PR then close the worktree', 'ship this worktree and clean up', 'open a PR, merge when green, close the worktree', 'merge and close the worktree'. This composes pr-creator, pr-watchmerge, and worktree-close into one flow. Use in a worktree context when the user wants the whole lifecycle done."
---

# PR to close

Take a finished worktree branch through the whole lifecycle: open a pull request, watch its CI, merge it as soon as it's green, then close the worktree. This composes three skills in order — do not skip or reorder any step.

## When to use

The user has finished work in a worktree and wants it shipped and cleaned up in one go. Triggers: "create a PR then close the worktree", "ship this and clean up the worktree", "open a PR, merge when green, then close the worktree", "take this worktree to done".

## Workflow

Run these skills in order. After each, confirm the step succeeded before moving to the next.

### 1. Create the PR

Follow the `pr-creator` skill to open a pull request for the current worktree branch. It handles branch safety (never from the default branch), committing, running the repo's checks, pushing, and creating the PR with the `gh` CLI. It returns the PR URL/number.

Do not proceed until a PR exists for the worktree branch.

### 2. Watch CI and merge when green

Follow the `pr-watchmerge` skill on the PR from step 1: check its CI checks/runs, watch in-flight runs with `gh run watch --exit-status` until they complete, and merge immediately when everything is green (or when there are no checks).

- If any check **fails**, `pr-watchmerge` stops and reports — do NOT merge and do NOT close the worktree. Surface the failure to the user and wait for their decision.
- Only proceed once the PR is merged.

### 3. Close the worktree

The branch is now merged into the default branch. Follow the `worktree-close` skill to finish the session (docs, commits, summary, next steps) and remove the worktree and its now-merged branch, keeping untracked items (`.scratch/`, `.papercuts.jsonl`) on the main project dir.

Because the PR was merged, the branch is already gone remotely; `worktree-close` removes the local worktree/branch and verifies untracked main-tree items survive.

## Safety rules

- Run the three skills strictly in order — never merge before a PR is open, never close the worktree before the PR is merged.
- Never close the worktree if the PR merge failed or had failing checks; stop and report instead.
- Respect each sub-skill's own safety rules (pr-creator's branch safety, pr-watchmerge's no-merge-on-fail, worktree-close's commit-permission and no-discard-without-confirmation rules).
- Report the final state back to the user: PR number, merge commit, and that the worktree was cleaned up.
