---
name: pr-to-close
description: "Full end-to-end close of a worktree feature: create a PR (pr-creator), watch its CI and merge when green (pr-watchmerge), then close the worktree (worktree-close). Use when the user wants a finished worktree branch taken all the way to merged and cleaned up in one go, e.g. 'create a PR then close the worktree' or 'ship this worktree and clean up'."
---

# PR to close

Finished worktree branch end to end: open a pull request, watch CI, merge when
green, close the worktree. Three skills in order. Never skip or reorder.

> **Load @following-procedures skill first.** It owns procedure narration,
> deviation logging, post-run report. Always follow the rules in the
> *Safety rules* section at the bottom.

## Workflow

Run these three skills in order. Confirm each step before moving on.

### 1. Create the PR

Follow the @pr-creator skill to open a pull request for the current worktree
branch. It owns branch safety, committing, the repo's checks, pushing, and the
`gh` CLI call, and returns the PR URL/number. No PR, no next step.

### 2. Watch CI and merge when green

Follow the @pr-watchmerge skill on the PR from step 1. Failing checks: do NOT
merge, do NOT close the worktree. Surface the failure and wait. Proceed only
once merged.

### 3. Close the worktree

The branch is now merged, so it is already gone remotely. Follow the
@worktree-close skill: it runs the finish workflow (skipping the steps this
merge already satisfied), then removes the local worktree and branch and
verifies the untracked main-tree items survived.

## Dependency graph

- step1
- step2 -> step1
- step3 -> step2

## Safety rules

- Run the three skills strictly in order. Never merge before a PR is open,
  never close before the PR is merged.
- PR unmerged or checks failing: never close the worktree. Stop and report.
- Each sub-skill's own safety rules still bind; this skill adds none beyond
  the ordering above.
- Report the final state: PR number, merge commit, worktree cleaned up.
