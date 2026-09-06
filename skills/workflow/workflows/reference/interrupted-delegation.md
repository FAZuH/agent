# Interrupted delegation recovery

Use when a subagent spawn returns aborted — "Tool execution interrupted",
"Endpoint is unavailable", or the server restarts mid-flight. Never re-spawn
blindly — but first check the transient signatures below: one retry there;
the wreckage procedure only if the retry fails too.

## Transient signatures (retry the dispatch once, then classify)

- `Agent not found: <name>` right after a server restart while the agent
  file exists on disk (`~/.config/opencode/agents/<name>.md`) → registry not
  reloaded yet; retry the spawn once before calling it a routing error.
- Dispatch dies with `context deadline exceeded` or
  `UNKNOWN_CERTIFICATE_VERIFICATION_ERROR` → transient provider hop; retry
  the dispatch once.
- Any DNS-signed failure (`ENOTFOUND llm.internal.fazuh.com`) → the litellm
  router lives behind tailscale; check tailscale is up before anything else.
- NOT transient: litellm `BadRequest` deserialize on a large prompt (shrink
  the prompt), and a resumed session carrying images into a text-only model
  (use a vision model or a fresh session).

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
