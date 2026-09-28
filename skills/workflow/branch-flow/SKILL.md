---
name: branch-flow
description: The repository branch flow. Main is the unstable integration line, release is the stable published line, and a [no ci] marker on a merge to main queues work without shipping it. Use when creating a branch, opening a PR, deciding what merges where, cutting a release, or handling a hotfix. Covers the [no ci] gate, the release trigger commit, the merge-commit policy, and why there is no dev branch.
license: MIT
---

# Branch flow

Two long-lived branches, one direction, one gate.

- **`main` is unstable.** Every change lands here first, whether or not it is
  finished. It is the integration line, not the shipping line.
- **`release` is stable.** What users get. CI owns this branch; you never
  commit to it by hand.

There is no `dev`, `develop`, or `development` branch. A staging branch looks
like it separates "unfinished" from "main", but it does not: promoting it ships
the whole batch anyway. Queueing on `main` with a commit marker does the same
job without the extra branch to keep in sync.

## The `[no ci]` gate

Every merge into `main` carries `[no ci]`. GitHub skips the workflows for that
push, so autopromote never fires and the work sits on `main` unshipped.

```bash
git merge --no-ff origin/feat/add-button \
  -m "Merge pull request #12 from FAZuH/feat/add-button [no ci]"
```

This is not a way to dodge the tests. The PR's own run already tested the
branch; the merge to `main` only needs to queue it. The same marker on a
docs-only commit means the ordinary thing. Nothing worth testing.

## Cutting a release

When `main` holds what you want shipped, make one commit on `main` with **no
marker**. That is the whole trigger.

```bash
git commit --allow-empty -m "chore: run release"
git push
```

CI takes it from there, unattended:

1. autopromote merges `main` into `release`
2. the release workflow bumps the version, writes the changelog, tags
3. the version bump syncs back to `main` as `chore(release): vX.Y.Z [skip ci]`

`release` and `main` end up level. Never push to `release` yourself, and never
merge a PR into it.

## Where things merge

| From | To | Who merges | Ships? |
|---|---|---|---|
| `feat/…`, `fix/…` | `main` | you, via PR, carrying `[no ci]` | no, queues |
| `main` | `release` | autopromote, on an unmarked push | yes |
| `release` | `main` | the release workflow, carrying `[skip ci]` | version bump only |
| `v0.6` | `main` | you, via PR, carrying `[no ci]` | no, queues |
| `hotfix/…` (cut from `release`) | `release` | you, by hand | yes |
| `hotfix/…` (cut from `main`) | `main` | you, by hand, carrying `[no ci]` | no, queues |

**CI owns the `main` ↔ `release` round trip and nothing else.** Feature, version,
and hotfix branches merge themselves, by hand, deliberately. Do not try to
automate them and do not wait for a workflow to do it.

## Merge commits, never squash

Use merge commits for every PR. A squash collapses the branch's commits into
one, which loses the `[no ci]` position and the per-commit history the release
notes are built from.

## Rules

- **A PR's base is `main`.** Always. It is the default branch, so tooling that
  detects the default branch is already right. Do not add a staging branch to
  "fix" that.
- **Work reaches `main` by PR merge only.** The one direct commit is
  `chore: run release`.
- **Do not create `dev`, `develop`, `development`, `staging`, or `production`.**
  If a task seems to want one, it wants a feature branch. A branch named
  `development` is the single most common way this flow gets broken.
- **A branch is not a release.** `main` holding unreleased work is the normal
  state, not a problem to fix.

## Version branch

For work that must **not** go out with the next release. Cut from `main`, put
the work there, merge back to `main` by hand when that version is being cut.

```bash
git switch main && git pull && git switch -c v0.6
```

Delete it once that version ships. A version branch still open at the next
release means the release ships whatever it happens to contain. That is the
only real hazard, and it is a decision you make deliberately.

## Hotfix branch

Which branch you cut from depends on whether the bug is already published.

**Already published**: cut from `release`, so unreleased `main` work does not
ride along:

```bash
git switch release && git pull && git switch -c hotfix/panic-on-empty-input
```

Merge it into `release` by hand. Pushing to `release` fires the release
workflow, so it ships, and the version bump syncs back to `main` for you.

**Blocking the queue**: `main` is broken and you need it working to keep
going. Cut from `main`, merge back with `[no ci]`, and cut a release when you
are ready. This ships the queue along with the fix; that is the trade, and it
is the reason to prefer the `release` base when you have the choice.
