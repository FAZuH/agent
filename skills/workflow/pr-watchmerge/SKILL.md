---
name: pr-watchmerge
description: Watch a pull request's CI checks to completion and merge it as soon as they pass. Use whenever the user says "watch the PR and merge it", "merge once green", "watch CI then merge", "merge after checks pass", or wants a PR merged on success without manual review. Not for PR creation (pr-creator) or review (code-review).
---

# PR watch-and-merge

> **Load the @following-procedures skill first.** It defines how you run this
> numbered procedure: point-and-call narration, live deviation logging, and a
> fixed post-run report. Always follow the rules in the *Safety rules* section
> at the bottom.

## Workflow

### 1. Identify the PR and its checks

Resolve the PR first. Bare `gh pr merge` picks the current branch's PR, so run from the branch the user means.

Check whether the PR has any CI checks or runs:

```bash
gh pr checks
gh run list --branch <branch>
```

`gh pr checks` shows check states (PENDING / SUCCESS / FAILURE); `gh run list` shows workflow runs.

- If there are **no checks** (nothing to wait for), merge immediately (step 3).
- If checks are already **all green** (SUCCESS), merge immediately (step 3).
- Otherwise proceed to step 2 to watch the in-flight runs.

### 2. Watch the runs to completion

Watch the in-progress run(s) until they finish. Use `--exit-status` so the watch command itself fails if the run fails:

```bash
gh run watch <run-id> --exit-status
```

Several runs: watch each one. Bare `gh run watch` follows the current branch's most recent run, fine for a single workflow.

Run each long watch with `background: true`. It returns immediately and notifies on completion; wait for that, never poll.

`gh run watch` prints progress and returns on completion. Then check the final state:

```bash
gh run view <run-id>
gh pr checks
```

### 3. Resolve conflicts (if any)

Check whether the PR can be merged: `gh pr view <pr> --json mergeable` (MERGEABLE / CONFLICTING / UNKNOWN). If it's **CONFLICTING**:

- Inspect the conflicts (`git fetch`, then `git merge-base`, or the files GitHub lists). A **simple** conflict is pure textual overlap (adjacent lines, whitespace, a moved unchanged block) with **no behavior change** in the result.
- A **simple** conflict: resolve by hand or `git checkout --theirs/--ours` per file, keep both sides' logic, commit, push, then merge.
- **Non-trivial** (changes behavior, needs judgment, intent unclear): do NOT guess. Report with details and wait.

### 4. Merge if green

If every check/run is green (SUCCESS) and the PR is mergeable, merge immediately.

**First, settle the merge commit message.** Under @branch-flow, a merge into
`main` carries `[no ci]` and uses a merge commit, never squash (squash loses
the marker):

```bash
gh pr merge --delete-branch --merge --subject "Merge pull request #N from <owner>/<branch> [no ci]"
```

Check branch rules first: `gh api repos/{owner}/{repo}/branches/main`, or load
@branch-flow. Non-integration target: bare `gh pr merge --delete-branch`.

Usable PR title: let GitHub build the message and append the marker.

Any check **failed**: do NOT merge. Report the failing run/check and let the user decide. Red CI merges only on explicit user override.

## Dependency graph

- 1. identify the PR and its checks
- 2. watch the runs to completion -> 1
- 3. resolve conflicts (if any) -> 1
- 4. merge if green -> 2, 3

## Safety rules

- Never merge on failing checks. Merge only when every run is green, or the PR has no checks.
- Draft PR: stop and surface the blocker, never force-merge.
- Conflicts: resolve only simple, behavior-preserving ones. Non-trivial or ambiguous: report and wait, never guess.
- Respect branch protection and merge-queue semantics. Admin requirements or unmet conditions: surface them instead of `--admin`, unless explicitly authorized.
- Report the result (PR number, merge commit, or failure reason) when done.
