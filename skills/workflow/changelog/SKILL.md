---
name: changelog
description: >-
  Create or update the changelog for the next version by comparing the current
  commit against the latest version, following the repo's own changelog docs.
  Loads and follows `docs/dev/changelog.md` and other docs under `docs/dev/`.
  If `docs/dev/changelog.md` does not exist, the repo does NOT support manual
  changelog creation — report that to the user and stop. Use when the user
  asks to write or update the changelog, draft release notes, prepare the next
  version's CHANGELOG.md, or mentions `docs/dev/changelog.md`.
---

# Create the next version's changelog

Create or update `CHANGELOG.md` for the next release. Only do this when the
repo supports manual changelog creation.

> **Load the @following-procedures skill first.** It defines how you run this
> numbered procedure: point-and-call narration, live deviation logging, and a
> fixed post-run report. Always follow the rules in the *Rules* section at
> the bottom.

## 1. Check changelog support

Glob `docs/dev/*`. Load and follow `docs/dev/changelog.md` and any other docs
under `docs/dev/` (commit conventions, changelog style, bump rules).

If `docs/dev/changelog.md` does not exist, the repo does NOT support manual
changelog creation. Report that to the user and stop — do not write or edit a
changelog.

## 2. Gather changes since the last version

Find the latest version commit or tag:

```bash
git describe --tags --abbrev=0
```

List commits since that version:

```bash
git log --oneline --no-decorate "$(git describe --tags --abbrev=0)..HEAD"
```

Decide the next version number and which commits belong in the changelog
according to the docs — user-visible changes only; internal work stays out.

## 3. Draft the changelog

Follow the docs for structure and wording:

- Add or keep a `## [Unreleased]` section at the top of `CHANGELOG.md`.
- Group entries per the docs' conventions.
- One short, plain, past-tense statement per user-visible change. No commit
  hashes, no PR links, no implementation detail — unless the docs allow them.

## 4. Verify

Re-read `CHANGELOG.md` against the docs' rules and examples. Confirm the
version number and date format match the docs. Report what you changed and
the next version number.

## Dependency graph

- step1
- step2 -> step1
- step3 -> step2
- step4 -> step3

## Rules

- Only write a changelog when `docs/dev/changelog.md` exists; otherwise report and stop.
- Follow the repo's docs for version numbers, grouping, wording, and date format.
- User-visible changes only — internal work stays out.
- No commit hashes, PR links, or implementation detail unless the docs allow them.