---
name: issue-closeout
description: "Connect merged work back to the issues it resolved: collect issue references from a merged PR, post one closeout comment naming the PR and merge SHA plus the relevant commit SHAs, and close the issues that the work fully resolves. Use after merging a PR (manually or via pr-watchmerge), when a session's commits resolve tracked issues, or whenever the user asks to link/close issues for landed work. GitHub auto-close keywords (`Closes #N`) fire ONLY when a PR merges into the repository's DEFAULT branch — on version/release branches this skill is what closes the loop."
---

# Issue closeout

After work lands, every referenced issue gets a connection to what actually
shipped: the PR, the merge SHA, and the specific commits that addressed it.
Do the steps in order. Skip entirely when the PR body references no issues
and the conversation named none.

## 1. Collect references

Gather candidate issues from two places:

- The merged PR body (`gh pr view <pr> --json body`): both `Closes #N` and
  `Refs #N` lines.
- The session conversation: issues created for, briefed from, or explicitly
  resolved by this work.

Deduplicate. For each issue, decide the intent:

- **Resolved** by the merged work → comment AND close.
- **Referenced only** (partial progress, context, follow-up host) → comment,
  do not close.

When the PR body used `Closes #N`, treat it as resolved intent even if the
merge base was not the default branch — that is exactly the case where
GitHub's auto-close silently failed.

## 2. Post the closeout comment

One comment per issue, naming what a reader needs to audit the fix:

```sh
gh issue comment <n> --body "Merged via #<pr> (<merge-sha>). Commits: <short-sha> (<scope>), ... . Notes: <anything non-obvious, e.g. deviations or gate evidence>."
```

Map issues to their commits explicitly when the mapping is not one-to-one.
Include gate/test evidence in the comment when the issue's acceptance
criteria mention verification.

## 3. Close resolved issues

```sh
gh issue close <n>
```

Skip any issue that already carries an equivalent closeout comment or is
already closed — never double-post.

## Rules

- Never close an issue the merged work does not fully resolve; comment-only
  for partial or related work.
- Never widen an issue's scope in the closeout comment; if scope changed,
  say so in one sentence and link the follow-up instead.
- On non-default merge bases, do not rely on `Closes #N` auto-close — this
  skill replaces it.
