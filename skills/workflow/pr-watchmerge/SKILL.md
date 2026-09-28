---
name: pr-watchmerge
description: Watch a pull request's CI checks to completion and merge it as soon as they pass. Use whenever the user says "watch the PR and merge it", "merge once green", "watch CI then merge", "merge after checks pass", or wants a PR merged on success without manual review. Not for PR creation (pr-creator) or review (code-review).
---

# PR watch-and-merge

This saves the user from babysitting the checks tab: you monitor progress and merge the moment CI passes.

> **Load the @following-procedures skill first.** It defines how you run this
> numbered procedure: point-and-call narration, live deviation logging, and a
> fixed post-run report. Always follow the rules in the *Safety rules* section
> at the bottom.

## Workflow

### 1. Identify the PR and its checks

Resolve which PR to work on. `gh pr merge` with no argument picks the PR for the current branch, so run the watch from the branch/PR the user means.

Check whether the PR has any CI checks or runs:

```bash
gh pr checks
gh run list --branch <branch>
```

`gh pr checks` lists the required status checks and their state (PENDING / SUCCESS / FAILURE). `gh run list` shows the workflow runs.

- If there are **no checks** (nothing to wait for), merge immediately (step 3).
- If checks are already **all green** (SUCCESS), merge immediately (step 3).
- Otherwise proceed to step 2 to watch the in-flight runs.

### 2. Watch the runs to completion

Watch the in-progress run(s) until they finish. Use `--exit-status` so the watch command itself fails if the run fails:

```bash
gh run watch <run-id> --exit-status
```

If there are multiple runs, watch each one. `gh run watch` with no id follows the most recent run for the current branch, which is fine when there's a single workflow run to
track.

Use OpenCode's built-in `shell` tool with `background: true` for each long-running watch. The tool returns immediately and notifies the session when the command finishes. Wait for that notification instead of polling, then run the final-state checks below.

`gh run watch` prints progress and returns when the run completes. Check the final state:

```bash
gh run view <run-id>
gh pr checks
```

### 3. Resolve conflicts (if any)

Check whether the PR can be merged: `gh pr view <pr> --json mergeable` (MERGEABLE / CONFLICTING / UNKNOWN). If it's **CONFLICTING**:

- Inspect the conflicts (`git fetch`, then `git merge-base`, or the files GitHub lists). Decide whether the conflict is **simple**: pure textual/trivial overlaps (e.g. adjacent lines, whitespace, moving the same unchanged block) with **no actual behavior change** to the merged result.
- If it's a **simple conflict**, resolve it directly: fix the conflict markers by hand or `git checkout --theirs/--ours` per file as appropriate, keep both sides' intended logic, commit the resolution, and push. The PR becomes
mergeable again; proceed to merge.
- If the conflict is **non-trivial**, meaning it changes behavior, needs judgment about which side wins, or you can't be confident the resolution preserves intent, do NOT guess. Stop and report the conflict to the user with the details and wait for their instructions.

Only resolve a conflict when you're confident the resolution is behavior-preserving and unambiguous. When in doubt, report and wait.

### 4. Merge if green

If every check/run is green (SUCCESS) and the PR is mergeable, merge immediately.

**First, settle the merge commit message.** A merge that lands on an
integration branch needs the markers that branch's release flow reads. Under
@branch-flow, a merge into `main` must carry `[no ci]` (it queues the work
without shipping it) and uses a merge commit, never a squash. The squash path
collapses the branch's commits and loses that marker:

```bash
gh pr merge --delete-branch --merge --subject "Merge pull request #N from <owner>/<branch> [no ci]"
```

Check the repo's own branch rules before merging: `gh api repos/{owner}/{repo}/branches/main` for
a `main`-flowing repo, or load @branch-flow when one exists. When the target is
not an integration branch, `gh pr merge --delete-branch` alone is correct.

If the PR title is a usable subject, let GitHub build the message and append the
marker, rather than typing the whole thing by hand.

If any check **failed**, do NOT merge. Stop and report the failure to the user with the failing run/check details, and let them decide next steps. Never merge a PR with failing CI unless the user explicitly overrides.

## Dependency graph

- 1. identify the PR and its checks
- 2. watch the runs to completion -> 1
- 3. resolve conflicts (if any) -> 1
- 4. merge if green -> 2, 3

## Safety rules

- Never merge a PR with failing checks. Only merge when every run is green, or when the PR has no checks at all.
- If the PR is a draft, stop and surface the blocker rather than force-merging.
- Resolve conflicts only when they are simple and behavior-preserving (no actual behavior change). For non-trivial or ambiguous conflicts, do NOT guess: report to the user and wait for instructions.
- Respect branch protection and merge-queue semantics. If `gh pr merge` requires admin or reports that requirements aren't met, surface that to the user instead of bypassing with `--admin`, unless the user explicitly authorizes it.
- Report the merge result (PR number, merge commit, or failure reason) back to the user when done.
