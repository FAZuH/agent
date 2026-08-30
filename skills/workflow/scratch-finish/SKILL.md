---
name: scratch-finish
description: >-
  Archive a completed `.scratch/` session workspace: verify the feature is
  genuinely done, mark remaining checklist items done, append an Outcome
  section to the spec, move it to `.scratch/complete/`, mark tickets resolved,
  and delete the stale checkpoint. Load this when a `.scratch/` workspace's
  work is finished and needs archiving, or from any skill that completes a
  workspace (finish, session, worktree-close). The `.scratch/` mechanics —
  verifying the repo uses `.scratch/`, the slug format, and the layout — live
  in the `scratch` skill; load that first if the workspace is unknown.
---

# Archive a completed `.scratch/` workspace

This skill is the single home for the completion checklist and the archive
steps of a `.scratch/` session workspace. Other skills (`finish`, `session`)
and the `scratch` skill itself reference it instead of restating the steps.

> **Load the `following-procedures` skill first.** It defines how you run this
> numbered procedure: point-and-call narration, live deviation logging, and a
> fixed post-run report. Always follow the gate in the *Completion checklist*
> section below.

## Load `scratch` for the mechanics

The `scratch` skill owns the `.scratch/` workspace mechanics — how to verify
the repo uses `.scratch/`, the slug format, and the directory layout. Load it
first if you need any of that. This skill only covers finishing and archiving.

## Does the repo use `.scratch/`?

Verify before assuming: `ls .scratch/` or glob `.scratch/*/spec.md`. If the
repo has no `.scratch/` workspace, this skill does not apply — do not invent
one. Report that there is nothing to archive and stop.

## Completion checklist

Archive a workspace only when every condition holds:

- all checklist items on the spec are done;
- all tickets under `issues/` are `Status: resolved` (or no tickets exist);
- the work is merged/shared (commits landed or PR merged) or the user
  confirms it is complete;
- verification passed (tests, lint, build, browser check — whatever the spec
  demands).

If any condition is false, do **not** archive. Report what remains and keep
the workspace in place.

## Archive steps

1. Mark remaining checklist items done on the spec.
2. Append an **Outcome** section to the spec: what shipped, test/lint results,
   anything left for later.
3. Move the spec to
   `.scratch/complete/<YYYY-MM-DD>_<feature-slug>.md` (keep the content).
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