---
name: changelog
description: >-
  Create or update the changelog for the next version by comparing the current
  commit against the latest version, following the repo's own changelog docs.
  Loads and follows `docs/dev/changelog.md` and other docs under `docs/dev/`.
  If `docs/dev/changelog.md` does not exist, the repo does NOT support manual
  changelog creation, so report and stop. Use when the user asks to write or
  update the changelog, draft release notes, prepare the next version's
  CHANGELOG.md, or mentions `docs/dev/changelog.md`.
---

# Create the next version's changelog

> **Load the @following-procedures skill first.** It defines how you run this
> numbered procedure: point-and-call narration, live deviation logging, and a
> fixed post-run report.

## 1. Check changelog support

Glob `docs/dev/*`. Follow `docs/dev/changelog.md` plus the commit, style, and bump docs under it.

If `docs/dev/changelog.md` does not exist, the repo does NOT support manual
changelog creation. Report and stop. Do not write or edit a changelog.

## 2. Gather changes since the last version

Find the latest version commit or tag:

```bash
git describe --tags --abbrev=0
```

List commits since that version:

```bash
git log --oneline --no-decorate "$(git describe --tags --abbrev=0)..HEAD"
```

Per the docs, decide the next version and which commits belong in the
changelog: user-visible changes only, internal work stays out.

## 3. Draft the changelog

Follow the docs for structure and wording:

- Add or keep a `## [Unreleased]` section at the top of `CHANGELOG.md`.
- Group entries per the docs' conventions.
- One short, plain, past-tense statement per user-visible change. No commit
  hashes, no PR links, no implementation detail, unless the docs allow them.

## 4. Verify

Re-read `CHANGELOG.md` against the docs' rules and examples. Confirm version
and date format match. Report what changed and the next version number.

## Dependency graph

- 1. check changelog support
- 2. gather changes since the last version -> 1
- 3. draft the changelog -> 2
- 4. verify -> 3