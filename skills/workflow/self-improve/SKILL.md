---
name: self-improve
description: Run gated self-improvement — collect proposals via session-retro, validate via skill-doctor, offer the papercut-sweep. Use when the user says "self-improve", asks for a retro/doctor check, wants to run self-improvement without finishing the session, or asks what is in the improvement backlog. Gated and non-destructive — never auto-applies fixes, never auto-runs the sweep.
---

# Self-improve

Run the collect + validate self-improvement check, then offer the sweep. This
skill only collects and validates; application belongs to @papercut-sweep.

> **Load the @following-procedures skill first.** It defines how you run this
> numbered procedure: point-and-call narration, live deviation logging, and a
> fixed post-run report.

This check is gated and non-destructive — it never auto-applies fixes.

1. **Collect — @session-retro (gated).** Load the @session-retro skill and
   follow it exactly: mine the session for friction / repeated corrections /
   skill gaps / wins / new-skill candidates, draft papercut proposals (do not file yet), render the
   proposal table, gate with `default.question` (File all / Pick individually /
   File none), and file only the approved subset. If the user picks none, file
   nothing and note it.
2. **Validate — @skill-doctor.** Load the @skill-doctor skill and follow its
   Procedure §1 from the skill's base dir:

   ```bash
   cd ~/.config/opencode/skills/skill-doctor
   mkdir -p ${XDG_DATA_HOME:-$HOME/.local/share}/skill-doctor \
     && python3 scripts/build_graph.py | tee -a ${XDG_DATA_HOME:-$HOME/.local/share}/skill-doctor/findings.jsonl
   ```

   Report the run-summary line (`skills, agents, edges, broken, collisions,
   drift`). If `broken` or `drift` > 0, note them as follow-ups but do not
   fix them here — fixing belongs to @papercut-sweep or a dedicated follow-up.
3. **Offer the sweep — do not run it.** **GATE offer-sweep (normal → do
   not run the sweep; note its availability in the report):** running
   @papercut-sweep is additional work offered, never auto-run. In auto mode
   this gate skips — just report the backlog line, do not ask. If
   @session-retro filed any papercuts, or @skill-doctor reported
   `broken`/`drift`, or `papercuts -g list --status open` shows open `self::`
   entries, tell the user:

   > Self-improvement backlog ready — `N` papercuts filed this session, `M`
   > open total, doctor: `broken X / drift Y`. Run @papercut-sweep now?
   > [y/N]

   Do not run @papercut-sweep without an explicit "yes". If the user says
   no, leave the backlog for a later sweep.
