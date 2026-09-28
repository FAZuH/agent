---
name: pr-to-close
description: "Full end-to-end close of a worktree feature: create a PR (pr-creator), watch its CI and merge when green (pr-watchmerge), then close the worktree (worktree-close). Use when the user wants a finished worktree branch taken all the way to merged and cleaned up in one go, e.g. 'create a PR then close the worktree' or 'ship this worktree and clean up'."
---

# PR to close

Take a finished worktree branch through the whole lifecycle: open a pull request, watch its CI, merge it as soon as it's green, then close the worktree. This composes three skills in order. Do not skip or reorder any step.

> **Load the @following-procedures skill first.** It defines how you run this
> numbered procedure: point-and-call narration, live deviation logging, and a
> fixed post-run report. Always follow the rules in the *Safety rules* section
> at the bottom.

## Workflow

Run these three skills in order. After each, confirm the step succeeded before moving to the next.

### 1. Create the PR

Follow the @pr-creator skill to open a pull request for the current worktree branch. It owns branch safety, committing, the repo's checks, pushing, and the `gh` CLI call, and it returns the PR URL/number. Do not proceed until a PR exists for the worktree branch.

### 2. Watch CI and merge when green

Follow the @pr-watchmerge skill on the PR from step 1. If any check fails it stops and reports: do NOT merge, do NOT close the worktree. Surface the failure to the user and wait for their decision. Only proceed once the PR is merged.

### 3. Close the worktree

The branch is now merged, so it is already gone remotely. Follow the @worktree-close skill: it runs the finish workflow, then removes the local worktree and branch and verifies the untracked main-tree items survived.

## Dependency graph

- step1
- step2 -> step1
- step3 -> step2

## Safety rules

- Run the three skills strictly in order. Never merge before a PR is open, never close the worktree before the PR is merged.
- Never close the worktree if the PR merge failed or had failing checks. Stop and report instead.
- Each sub-skill's own safety rules still bind; this skill adds none beyond the ordering above.
- Report the final state back to the user: PR number, merge commit, and that the worktree was cleaned up.
