---
name: self-improve
description: Run gated self-improvement, collect proposals via session-retro, validate via skill-doctor, offer the friction-sweep. Use when the user says "self-improve", asks for a retro/doctor check, wants to run self-improvement without finishing the session, or asks what is in the improvement backlog.
---

# Self-improve

Run the collect + validate check, then offer the sweep. This skill only
collects and validates; application belongs to @friction-sweep.

> **Load @following-procedures skill first.** It owns procedure narration,
> deviation logging, post-run report.

Follow the *Rules* section below.

1. **Collect, @session-retro (gated).** Load the @session-retro skill and
   follow it exactly. It owns the mining, the draft format, the proposal
   table, the gate, and the filing.
2. **Validate, @skill-doctor.** Load the @skill-doctor skill and follow its
   Procedure §1 from the skill's base dir:

   ```bash
   cd ~/.config/opencode/skills/skill-doctor
   mkdir -p ${XDG_DATA_HOME:-$HOME/.local/share}/skill-doctor \
     && python3 scripts/build_graph.py | tee -a ${XDG_DATA_HOME:-$HOME/.local/share}/skill-doctor/findings.jsonl
   ```

   Report the run-summary line (`skills, agents, edges, broken, collisions,
   drift`). A `broken` or `drift` finding is a follow-up; the Rules section
   says why this skill does not fix it.
3. **Offer the sweep, do not run it.** **GATE offer-sweep (normal → do
   not run the sweep; note its availability in the report):** running
   @friction-sweep is additional work offered, never auto-run. In auto mode
   this gate skips, so just report the backlog line instead of asking. If
   @session-retro filed any friction entries, or @skill-doctor reported
   `broken`/`drift`, or a `recall` (query "friction open backlog") surfaces
   `type:friction` + `status:open` + `scope:` entries, tell the user:

   > Self-improvement backlog ready: `N` friction entries filed this session, `M`
   > open total, doctor `broken X / drift Y`. Run @friction-sweep now? [y/N]

   Do not run @friction-sweep without an explicit "yes". If the user says
   no, leave the backlog for a later sweep.

## Rules

- Never edit skills, agent defs, or config here; never apply fixes.
  Application belongs to @friction-sweep. New skills need a separate
  `writing-for-agents` workflow after explicit approval.
- Both gates (`friction-file` in step 1, `offer-sweep` in step 3) are `normal`
  gates: explicit user approval required; they skip only in auto mode
  (vocabulary: @gate).
- In a restricted/read-only agent (e.g. Plan mode): keep the deviation log
  in working notes, run diagnostics without persistence (skip the `tee -a`
  append), defer filing to a write-capable mode, and state all of it in the
  run report.

## Dependency graph

- step1
- step2
- step3 -> step1, step2
