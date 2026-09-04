---
name: forkflow
description: >-
  Run warm per-ticket delegation with OpenCode v2 session forks: probe fork
  capabilities, fork a completed session at a boundary, switch the child
  agent before its first prompt, send a focused task prompt, poll its outcome,
  and read the result. Fall back to a fresh subagent when fork support is not
  available. Use for orchestrated research-to-implementation or review/test
  handoffs; do not use as a replacement for @task-context or @setup-dev-docs.
---

# forkflow

`forkflow` is the warm-delegation layer for the orchestration workflow. It
uses the current ticket's session history as an accelerator. The ticket's
durable contract remains its spec and, when used, its @task-context packet.

## Non-negotiable order

For every child:

```text
fork → switch agent → verify → first prompt
```

Switching after the child has already run a turn changes session metadata and
message tags, but does not reliably replace the model's system prompt.

## Preconditions

- The source session has completed the phase that produced the boundary.
- The boundary is explicit when the source contains unrelated later messages.
- The child role is known before forking.
- Parallel children are read-only, or each writer has its own worktree. Forks
  share the working directory; they are not filesystem isolation.

## Capability probe

Probe once per orchestrator session before relying on warm delegation:

1. Fork a disposable completed session with `boundary: {type: through}`.
2. Switch the child to a subagent before its first prompt.
3. Send a prompt that asks the child to identify its agent definition.
4. Verify the session metadata and reply. Mark forkflow available only when
   both report the requested child agent.

If any probe step fails, use a normal fresh `subagent` spawn and pass the
role-specific task brief. Do not make the ticket depend on fork support.

## Delegation procedure

1. Resolve the source session and the boundary message.
2. `POST /api/session/{source}/fork` with an explicit `through` or `before`
   boundary. Save the returned child session ID.
3. `POST /api/session/{child}/agent` with the target subagent name. Do this
   before any prompt is sent to the child.
4. Verify `GET /api/session/{child}` reports the target agent.
5. Send exactly one first prompt containing the run mode and the focused role
   brief. If a task packet exists, pass only its role projection and path;
   do not paste raw research transcripts.
6. Poll `GET /api/session/{child}` until `.data.outcome` is `succeeded` or
   `failed`. The deployed server may not support the documented `/wait`
   operation, so polling is the portable method.
7. Read the newest assistant message and report the child ID, outcome, and
   result to the orchestrator.

## Phase patterns

```text
research report
  → fork + switch implement + first prompt
  → implement report
      ├→ fork + switch review + first prompt
      └→ fork + switch test   + first prompt
```

Review and test may run in parallel only when they are read-only. If review
finds a fix, resume or fork an implement child with the new explicit boundary;
do not switch the agent of a child that already ran a turn.

## Ledger and fallback

Record child IDs, source boundary IDs, target agents, outcomes, and fallback
decisions in the active session's existing session record. `forkflow` does not
create a second ticket-context or architecture-memory file. On fallback,
record the failed probe and continue with ordinary delegation.

Raw API mechanics live in @ocv2-sessions; this skill owns the orchestration
policy and ordering constraints.
