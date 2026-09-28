---
name: issue-closeout
description: "Connect merged work back to the issues it resolved: one comment per issue naming the PR, merge SHA, and the commits that addressed it, then close what the work fully resolves. Use after merging a PR, by hand or via pr-watchmerge, and whenever a session's commits resolve tracked issues. Required on non-default merge bases, where GitHub's `Closes #N` auto-close silently fails."
---

# Issue closeout

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
merge base was not the default branch, which is exactly the case where
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
already closed; never double-post.

## Rules

- Never close an issue the merged work does not fully resolve; comment-only
  for partial or related work.
- Never widen an issue's scope in the closeout comment; if scope changed,
  say so in one sentence and link the follow-up instead.
- On non-default merge bases, do not rely on `Closes #N` auto-close; this
  skill replaces it.
