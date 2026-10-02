---
name: scratch
description: >-
  The `.scratch/` session workspace mechanics: the date-prefixed slug format,
  the directory layout, and the spec → execute → archive lifecycle. Load this
  whenever a `.scratch/` workspace is involved: creating, resuming, or
  completing one, or from any skill that needs the mechanics (session,
  finish, prepare-compact, worktree). What goes *inside* the workspace lives
  in the @session skill; the completion checklist and archive steps live in
  the @scratch-finish skill.
---

# scratch

Non-trivial work lives in `.scratch/`: one date-prefixed directory per feature. It survives forks and compactions, so any session recovers decisions, layout, deviations, and status from workspace plus code.

## Does the repo use `.scratch/`?

Verify first: `ls .scratch/` or glob `.scratch/*/spec.md`. No `.scratch/`: this skill does not apply, use the repo's actual plan/spec docs.

## Slug format

`<YYYY-MM-DD>_<feature-slug>`, e.g. `2026-08-09_opencode-voice`. Use the
creation date (not the completion date); it never changes afterwards.

## Layout

```
.scratch/
├── <YYYY-MM-DD>_<feature-slug>/    # one dir per feature
│   ├── spec.md         # plan/spec doc: canonical source of truth
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

1. **Plan**: write the spec before implementing (@session owns its sections and templates).
2. **Split**: too big for one session: tracer-bullet tickets under `.../issues/`.
3. **Execute**: work the plan; log deviations as they happen.
4. **Complete**: shipped: archive (next section).

## Completing / archiving a feature

Checklist and steps live in @scratch-finish: load and follow it. The workspace moves from `.scratch/<slug>/` to `.scratch/complete/<slug>.md`; do not duplicate those steps here.
