---
name: scratch-finish
description: >-
  Archive a completed `.scratch/` session workspace: run the completion
  checklist, append an Outcome section, move the spec to `.scratch/complete/`,
  mark tickets resolved, delete the stale checkpoint. Load when a workspace's
  work has finished, or from any skill that completes one
  (finish, session, worktree). The `.scratch/` layout and slug format
  live in the @scratch skill.
---

# Archive a completed `.scratch/` workspace

Single home for the completion checklist and the archive steps. `finish`,
@session, and @scratch reference it instead of restating the steps.

> **Load @following-procedures skill first.** It owns procedure narration,
> deviation logging, post-run report. Always follow the gate in the
> *Completion checklist* section below.
>
> **Load @scratch skill first** for the workspace mechanics: verifying the repo
> uses `.scratch/`, the slug format, the directory layout. This skill covers
> finishing and archiving.

## Completion checklist

No `.scratch/` workspace in the repo: report nothing to archive and stop.
Otherwise archive only when every condition holds:

- all checklist items on the spec are done;
- all tickets under `issues/` are `Status: resolved` (or no tickets exist);
- the work is merged/shared (commits landed or PR merged) or the user
  confirms it is complete;
- verification passed (tests, lint, build, browser check, whatever the spec
  demands).

If any condition is false, do **not** archive. Report what remains and keep
the workspace in place.

## Archive steps

1. Mark remaining checklist items done on the spec.
2. Append an **Outcome** section to the spec: what shipped, test/lint results,
   anything left for later.
3. Move the spec to `.scratch/complete/<YYYY-MM-DD>_<feature-slug>.md` (keep
   the content).
4. Mark open tickets `Status: resolved`.
5. Delete the now-stale `checkpoint.md`.
6. Leave the archived doc untouched from then on, except to fix factual
   errors.

## Dependency graph

- step1
- step2 -> step1
- step3 -> step2
- step4 -> step1
- step5 -> step3
- step6 -> step3
