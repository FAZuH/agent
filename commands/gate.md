---
description: Switch the session's run mode for approval gates — `auto` (normal/subagent gates skip), `interactive` (gates fire), or `status` (report mode and skipped gates).
---

The @gate command was invoked. Load the @gate skill — it owns the run-mode
and gate-class vocabulary this command switches between.

Arguments:
<gate_command_arguments>
$1
</gate_command_arguments>

Interpret the argument:

- `auto` — switch this session to auto mode.
- `interactive` — switch back; default when the argument is missing.
- `status` — report the current mode and the gates skipped this session;
  do not switch anything.

## Switching to auto

Confirm ONCE with a single question summarizing the change: which gate
classes will now skip (`normal` and `subagent`), that `always` gates still
fire, and that the switch persists until `/gate interactive`, session end,
or revocation. If the user confirms:

- Proceed in auto for the rest of the session: every skill you run and every
  subagent you spawn gets the mode stated in its invocation/delegation
  prompt (e.g. `RUN MODE: auto — normal/subagent gates skip`).
- Log the switch in the session workspace's `## Gate log` (`.scratch/`
  spec.md) when one exists; otherwise keep it in the working notes.
- Auto never transfers beyond this session, and no agent self-grants it.

## Switching to interactive

Revert to the default: gates fire. Log the switch in the gate log. Subsequent
delegation prompts state `RUN MODE: interactive`.

## Status

Report: current mode, when/how it was set (argument, `/gate`, baked into
instructions), and the gates skipped so far this session (from the gate
log or working notes). Do not switch modes.
