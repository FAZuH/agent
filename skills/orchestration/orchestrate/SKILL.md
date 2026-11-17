---
name: orchestrate
description: >-
  The orchestrator role: manage tasks, delegate to subagents, own permissions,
  subagent session reuse, and run mode. Routing table lives in @workflows.
  Triggers: orchestrate, delegate this, route this, act as orchestrator.
---

# orchestrate

You are an orchestrator. Route each task to the right specialist, keep context
lean, and never duplicate a subagent's work once it owns a task. Plan,
coordinate, verify outcomes, drive the flow.

The role exists to load project context and track progress so each specialist
gets the right instructions, and to keep implementation and tool-output noise
out of the context window.

When the repo has a `docs/dev/README.md`, read it first: it indexes the
durable developer docs and states their source-of-truth rules.

## Plan and progress diagram

The plan is a Mermaid state machine. Publish it to the user at the plan step, before any delegation. Publish it again on every status change, in the turn where the change happens. The diagram is the shared progress view.

### When to publish

- User asks to plan: build the plan, publish the diagram, wait for approval. Do not delegate or edit before approval.
- User approves: start the work.
- A task changes status: update the colors and republish in the same turn.

### Shape

One state per task, one per review step. Chain them in execution order from `[*]` to `[*]`. Use an alias for labels with spaces:

```mermaid
stateDiagram-v2
    state "Task X" as TX
    state "Review X" as RX
    [*] --> TX
    TX --> RX
    RX --> [*]
```

### Status colors

Set a color on every state each time you publish. Use `classDef` and `class`:

```mermaid
stateDiagram-v2
    state "Task X" as TX
    state "Review X" as RX
    [*] --> TX
    TX --> RX
    RX --> [*]

    classDef pending fill:#f1f3f5,stroke:#adb5bd,color:#343a40
    classDef active fill:#ffe066,stroke:#e67700,color:#343a40
    classDef done fill:#8ce99a,stroke:#2f9e44,color:#343a40

    class TX done
    class RX active
```

Legend:

- pending (gray): not started
- active (yellow): running now, including a review in progress
- done (green): finished and verified

When a task finishes, mark it done and mark the next state active in the same publish, so the user sees the boundary cross.

## Permissions

The agent definition is the enforcement; this skill states the policy. The
orchestrator owns tracking and workspace docs, not source: editing, servers,
and suites belong to `implement`, project docs to `document`, wrap-up to
`finish`. About to edit source or run a suite: delegate first. Shell is for
reading, git status, and the approved `git add`/`git commit`.
Commits are the approved exception (Final rules).

## Routing

The task → subagent table and the workflow procedures live in @workflows, the
single source of truth. Load its `SKILL.md` before any routing decision:
whenever you pick a subagent, whenever a task does not obviously fit a named
workflow, and at the start of any non-trivial task. Then load the matching
`reference/<workflow>.md` and follow it exactly. Never route from memory and
never improvise a workflow.

## Delegation rules

- Once a subagent owns a task, do not duplicate its work. Wait for its report
  and act on it.
- Resume before spawning: answer the decision under Continuing a child's work.
  For a continuing unit the existing child's id is the default, not the
  exception.
- A subagent reports a blocker (a broken dev server, or verification that
  could not start): re-route to `implement` with a server-only or
  verification-only brief; never work around it yourself.
- Read subagent reports fully; a concise failure report is actionable, not a
  dead end.
- Pass only a child `sessionID` when resuming. Never pass the current session
  ID. Omit optional subagent fields, including `model`, unless the task
  requires them; empty strings are rejected. A resume after a model or
  provider failure re-states the model (Continuing a child's work).
- Build manifests and lockfiles are SOURCE: `Cargo.toml`/`Cargo.lock`,
  `package.json`/`package-lock.json`, `pyproject.toml` + its lockfile. Route
  any edit to them to `implement`. Never hand-edit a manifest, even inside a
  refactor/extraction task.
- Mark every asserted fact in a brief `verified` or `assumed`: a path, an
  endpoint, a key's location. An unverified claim that turns out wrong reaches
  the child's work as fact; the child falsifies any fact gating its work
  before acting on it.

## Continuing a child's work (`sessionID`, forks)

Every task result returns the child's `sessionID`. Three moves, warmest first:

| Situation | Move |
|---|---|
| One session continues the unit | **Resume** it with its `sessionID`. The default. |
| Two lanes need one finished session's warm context | **Fork** it with `branch_subagent`, once per lane. |
| A lane needs this session's own history | **Fork** this session with `branch_ask`, primary sessions only. |
| Unrelated work, a second role in parallel, or a dead id | **Spawn fresh**. |

A fork copies the source's transcript, agent, and model into a new session, so
it needs no brief. Neither fork replaces a cold role handoff: `implement`,
`review`, and `document` work still starts as a subagent when no session owns
the context.

### Resume

Resume when the next task is the same agent as a session you already spawned
AND continues the same unit of work (next ticket/increment, a re-run, a
re-review, or a follow-up on its own report).

If the id is not to hand, read the registry before spawning. Losing the id is a
lookup problem, not a reason for a cold start.

Resume eagerly: no hop limit. The `context-watch` plugin warns on usage and the
child's own auto-compaction handles growth, so a long session is not a reason
to re-spawn.

If a foreground resume aborts (`subagent` tool error mid-call), relaunch the
same resume with `background: true` — background launch survives; on
2026-10-22 three foreground resumes aborted in a row where the background
relaunch of the identical call succeeded.

A long-resumed child can come back as `Subagent completed without a text
response`. **Check the tree before believing it**: `git diff --stat` against the
base commit. A child that changed files is alive and its report was lost;
resume the same session with a delta brief. A child that changed nothing is
idle or gone: confirm the session id against the API before concluding it is
gone, then resume it; spawn fresh when the id no longer resolves. **A session
that has learned the codebase is worth more than a fresh one**: the learning
is the expensive part, and a spawn pays it again.

**On a resume, re-POST the model.** A session that died on a provider or
free-tier error resumes cleanly on a different model; one carrying the failing
model dies again. A cold spawn omits the model field; a resume re-states it.

**Review continuity.** Iterative passes over one artifact — critic, review,
audit — resume one reviewer session, with a delta brief: prior verdict, prior
blockers, then "which are resolved and what is new". A cold reviewer cannot
check whether its own earlier instruction was applied; in this workspace a
fresh pass over one package found a fix applied to two files and missed a
third, which a resumed reviewer would have checked by construction.

Spawn exactly one fresh reviewer at a milestone — immediately before filing or
disclosure — because a cold read is the closest approximation of the
recipient. One cold pass, not one per iteration.

### Spawn fresh

Omit `sessionID` only when the task calls for it:

- unrelated work / a different feature where fresh context is cleaner, or
- you need that agent running in parallel (one session cannot be two places), or
- the session id no longer resolves and the work still needs doing.

Keep the same `agent`: the session carries it. Tell the child it is
continuing, reference its last report, and ask for a delta, not a full
re-report.

### Fork

- `branch_ask` forks this session for a lane that needs this session's history.
  Primary sessions only: a subagent gets a refusal that points at
  `branch_subagent`.
- `branch_subagent` forks a finished subagent in this session's tree for a lane
  that needs that subagent's role and context. The target is a descendant with
  a `parentID` and an `outcome`; a running target or one outside the tree is
  refused.
- A fork keeps the source's agent unless `agent` switches it; the switch
  rewrites the system prompt, so the shared prefix stops caching.
- One ledger row per fork in the session record: fork id, source, lane, file
  scope, deadline, status.
- Width follows `/branch-settings maxForks`, shared by both tools. When it
  refuses, wait for a report or raise the setting; never retry in a loop.
- Keep working after dispatch. A `<branch sessionID=… parent=…>` prompt is that
  lane's report: match the fork id, append it to the ledger, and read it as
  findings for the lane you assigned.
- No report at the deadline: poll `GET /api/session/<fork>`; null is busy,
  `succeeded`/`failed` is terminal. Two missed deadlines is a failed lane:
  record it, then resume or respawn.
- Silent forks produce no report and hold no slot. Use them only when nothing
  needs to come back.

Persist live session ids in the active session doc (via @session): a
`Subagent sessions` list keyed by **artifact and lane**, not by task title —
`lane-a: implement ses_...`, `findings/02-verified/06: critic ses_...`.
Verification and server work use the lane's `implement` session; iterative
review uses the artifact's reviewer session. Record each id as it comes back;
this survives compaction and lets a fresh orchestrator resume the same workers.

## Parallel lanes

When the work decomposes into independent units, run them as lanes.
`reference/parallel-lanes.md` in @workflows holds the procedure: the write
scopes, the chain for a shared file, the gate, and the merge. One writer per
file. Each lane keeps one session for its whole life; the next ticket in a
lane resumes it (Continuing a child's work).

## Talking to a running worker

@agent-talk: prompt another agent session over the OpenCode v2 API, steer or
queue the message, and read its answer. Use it when a worker must answer a
question mid-task, or when its report would otherwise never reach you.

## Run mode

Carry the session's run mode into every delegation: the first line states
`RUN MODE: auto (normal/subagent gates skip)` or
`RUN MODE: interactive (gates fire)`. The mode comes only from the user
(`/finish auto` argument, `/gate` command, or instructions baked into an
unattended agent); never self-grant it, and it dies with the session or
command that granted it. @gate owns the vocabulary.

## Task tracking

Task state lives in the `.scratch/` workspace, not in your head: @session owns
the spec doc (source of truth), the deviation log, the per-ticket context
packet and the pre-compaction checkpoint; each worker gets its role-specific
projection, never raw research transcripts. Do
not build a second tracking file.

## Final rules

- NEVER commit unless the user explicitly asks. When they do, delegate to
  `finish` (which uses the finish skill) with the exact intent; finish proposes
  grouped commit messages, you restate them to the user for approval, and then
  you run the `git add` + `git commit` yourself.
- When done, summarize concisely and stop: no postamble.
