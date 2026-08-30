# Interrupted delegation recovery

Use when a subagent spawn returns aborted — "Tool execution interrupted",
"Endpoint is unavailable", or the server restarts mid-flight. Work the
procedure top to bottom; never re-spawn blindly.

## Procedure

1. **Assess landed state before respawning.** Killed agents leave work on
   disk. Check: `git status --short`, the repo's fast compile/check
   equivalent, and any `.scratch` artifacts the agent was working from.
2. **Classify the wreckage:**
   - *Nothing landed* → re-send the original brief unchanged.
   - *Partial* → send a resume-brief (template below).
   - *Looks complete but no report* → run the acceptance gates yourself;
     if green, mark the ticket done from evidence.
3. **Resume-brief template** — the replacement spawn must start with:
   - "You are CONTINUING an interrupted job. Do NOT start over."
   - What the previous agent already did (from git status + checks).
   - The remaining frontier, as concrete steps.
   - Any anomalies spotted (new files not in spec, moved tests) with
     resolve-or-justify instructions.
   - Gates + concise-report requirements, same as the original brief.
4. **Two consecutive kills without progress** → stop re-spawning and report
   to the user. Switching to direct execution is the user's call, not a
   default.
5. **Log it:** one deviation-log line per kill + recovery path taken; infra
   errors also go to the papercuts backlog.

## Rules

- Never assume a fresh spawn means a clean slate — disk state outranks the
  transcript.
- Prefer resuming the same unit over restarting it; prefer smaller units
  when infra is flaky, so kills lose less.
