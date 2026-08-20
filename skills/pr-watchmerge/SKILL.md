---
name: pr-watchmerge
description: Watch a pull request's CI checks and merge it automatically once they pass. Use whenever the user wants to watch PR CI/checks and merge when green, auto-merge, wait for checks then merge, "watch the PR and merge it", or merge a PR as soon as its CI passes. Also trigger when the user says "merge once green", "watch CI then merge", "merge after checks pass", or wants a PR merged immediately on success without manual review. Do NOT use for general PR creation or review — those belong to pr-creator / code-review.
compatibility: Optional opencode-pty plugin — when present, use pty_spawn + pty_wait for the long-running `gh run watch` step.
---

# PR watch-and-merge

Watch a pull request's CI runs to completion, then merge it immediately if everything is green. This saves the user from babysitting the checks tab — you monitor progress and merge the moment CI passes.

## When to use

The user wants a PR merged as soon as its CI/checks pass, without them having to watch or click merge themselves. Common triggers: "watch the PR and merge when green", "merge once CI passes", "wait for checks then auto-merge", "watch CI and merge if it passes".

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

If there are multiple runs, watch each one. `gh run watch` with no id follows the most recent run for the current branch — fine when there's a single workflow run to track.

**If the `opencode-pty` plugin is available**, run the watch as a background PTY so you don't block on it: spawn it with `pty_spawn` (set `notifyOnExit: true` so you're told when it finishes), then wait for it with `pty_wait` (passing the session id). Read its output with `pty_read` afterward to confirm the result. This keeps a potentially long CI watch from occupying the shell/context while it runs.

`gh run watch` prints progress and returns when the run completes. Check the final state:

```bash
gh run view <run-id>
gh pr checks
```

### 3. Resolve conflicts (if any)

Check whether the PR can be merged: `gh pr view <pr> --json mergeable` (MERGEABLE / CONFLICTING / UNKNOWN). If it's **CONFLICTING**:

- Inspect the conflicts (`git fetch`, then `git merge-base`, or the files GitHub lists). Decide whether the conflict is **simple** — pure textual/trivial overlaps (e.g. adjacent lines, whitespace, moving the same unchanged block) with **no actual behavior change** to the merged result.
- If it's a **simple conflict**, resolve it directly: fix the conflict markers by hand or `git checkout --theirs/--ours` per file as appropriate, keep both sides' intended logic, commit the resolution, and push. The PR becomes mergeable again — proceed to merge.
- If the conflict is **non-trivial** — it changes behavior, needs judgment about which side wins, or you can't be confident the resolution preserves intent — do NOT guess. Stop and report the conflict to the user with the details and wait for their instructions.

Only resolve a conflict when you're confident the resolution is behavior-preserving and unambiguous. When in doubt, report and wait.

### 4. Merge if green

If every check/run is green (SUCCESS) and the PR is mergeable, merge immediately:

```bash
gh pr merge --delete-branch
```

Use the repo's conventional merge strategy — typically a merge commit (`--merge`, the default) rather than squash, unless the repo's history shows it uses rebase or squash. Do not squash by default. `--delete-branch` cleans up the remote branch on merge.

If any check **failed**, do NOT merge. Stop and report the failure to the user with the failing run/check details, and let them decide next steps. Never merge a PR with failing CI unless the user explicitly overrides.

## Safety rules

- Never merge a PR with failing checks. Only merge when every run is green, or when the PR has no checks at all.
- If the PR is a draft, stop and surface the blocker rather than force-merging.
- Resolve conflicts only when they are simple and behavior-preserving (no actual behavior change). For non-trivial or ambiguous conflicts, do NOT guess — report to the user and wait for instructions.
- Respect branch protection and merge-queue semantics — if `gh pr merge` requires admin or reports that requirements aren't met, surface that to the user instead of bypassing with `--admin` unless the user explicitly authorizes it.
- Report the merge result (PR number, merge commit, or failure reason) back to the user when done.
