---
name: scratch
description: >-
  Manage the repo's `.scratch/` session workspace — the date-prefixed layout,
  lifecycle, and archiving of completed features to `.scratch/complete/`.
  Load this whenever a `.scratch/` workspace is involved: creating, resuming,
  or completing a session workspace, or from any skill that needs the
  `.scratch/` mechanics (session, finish, prepare-compact, worktree). Covers
  the slug format, directory layout, spec → execute → archive lifecycle, the
  conditions under which a workspace may be archived, and how to move a
  shipped feature to `.scratch/complete/`.
---

# scratch

The repo tracks non-trivial work in a `.scratch/` session workspace — one
date-prefixed directory per feature. The workspace survives session forks and
context compactions, so any session can recover the full picture — decisions,
file layout, deviations, status — from the workspace plus the code.

## Does the repo use `.scratch/`?

Verify before assuming: `ls .scratch/` or glob `.scratch/*/spec.md`. If the
repo has no `.scratch/` workspace, this skill does not apply — use whatever
plan/spec docs the repo actually tracks instead.

## Slug format

`<YYYY-MM-DD>_<feature-slug>`, e.g. `2026-08-09_opencode-voice`. Use the
creation date (not the completion date); it never changes afterwards.

## Layout

```
.scratch/
├── <YYYY-MM-DD>_<feature-slug>/    # one dir per feature
│   ├── spec.md         # plan/spec doc — canonical source of truth
│   ├── map.md          # [wayfinder](https://github.com/mattpocock/skills/blob/main/skills/engineering/wayfinder/SKILL.md) map (only for oversized efforts)
│   ├── issues/         # [mattpocock](https://github.com/mattpocock/skills) tickets, one file each
│   │   └── <NN>-<slug>.md
│   └── checkpoint.md   # last pre-compaction resume checkpoint
└── complete/           # archive for shipped features
    └── <YYYY-MM-DD>_<feature-slug>.md
```

## Lifecycle

`.scratch/<YYYY-MM-DD>_<feature-slug>/spec.md` → execute →
`.scratch/complete/<YYYY-MM-DD>_<feature-slug>.md`

1. **Plan** — before implementation, write
   `.scratch/<YYYY-MM-DD>_<feature-slug>/spec.md`.
2. **Split** — if the spec is too big for one session, break it into
   tracer-bullet tickets under `.scratch/<YYYY-MM-DD>_<feature-slug>/issues/`.
3. **Execute** — work the plan; log deviations as they happen.
4. **Complete** — when the work ships, archive the workspace (below).

## Completing / archiving a feature

Archive a workspace only when the work is genuinely done:

- all checklist items on the spec are done;
- all tickets under `issues/` are `Status: resolved` (or no tickets exist);
- the work is merged/shared (commits landed or PR merged) or the user
  confirms it is complete;
- verification passed (tests, lint, build, browser check — whatever the spec
  demands).

If any condition is false, do **not** archive. Report what remains and keep
the workspace in place.

To archive:

1. Mark remaining checklist items done.
2. Append an **Outcome** section to the spec: what shipped, test/lint results,
   anything left for later.
3. Move the spec to
   `.scratch/complete/<YYYY-MM-DD>_<feature-slug>.md` (keep the content).
4. Mark open tickets `Status: resolved`.
5. Delete the now-stale `checkpoint.md`.
6. Leave the archived doc untouched from then on, except to fix factual
   errors.
