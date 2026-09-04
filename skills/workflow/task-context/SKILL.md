---
name: task-context
description: >-
  Create and maintain the per-ticket context packet at
  .scratch/<date>_<task>/context-packet.md — objective, base commit,
  relevant files and symbols, architecture boundaries, invariants,
  decisions, acceptance criteria, verification commands, known failures,
  and role-specific projections for implement, review, test, and research.
  Use when non-trivial ticket work moves from research/design to
  delegation, when a public API, module boundary, or design decision
  changes (refresh), and when resuming after compaction or an interrupted
  delegation. Not for trivial edits; not a durable knowledge store —
  @session owns spec.md and checkpoints, @setup-dev-docs owns docs/dev/.
---

# task-context

The **context packet** is one compact file per ticket —
`.scratch/<YYYY-MM-DD>_<task>/context-packet.md` — holding the current,
distilled view of the work: what to build, where, what must stay true, how
to verify, and what each worker needs from it. Workers receive a
role-specific projection, so raw research transcripts never ride into
delegation prompts.

> **Load the @scratch skill first.** It owns the `.scratch/` layout and slug
> format. The packet lives in the active workspace; when none exists for the
> task, create it per @scratch before writing the packet.

## Boundaries

- `.scratch/<slug>/spec.md` stays the task's source of truth — objective,
  decisions, deviations, gates. The packet is a derived, disposable view,
  rebuildable from the spec plus the code at any time. @session owns that
  lifecycle and the checkpoints; this skill owns only the packet.
- Durable knowledge goes to its home, never into the packet: stable
  workflow → `docs/dev/` (@setup-dev-docs), vocabulary → `CONTEXT.md`,
  decisions → `docs/adr/`.
- The packet is not a second architecture memory. When @scratch-finish
  archives the workspace, the packet goes with it.
- Execution-mode neutral: workers are fresh subagent spawns today; a
  session-fork flow could consume the same packet unchanged. Nothing here
  depends on fork mechanics.

## Packet template

```markdown
# Context packet — <task>

Freshness: updated <YYYY-MM-DD> at base `<sha>`; last checked <YYYY-MM-DD>
against `git status --short` + `git diff --stat <base>..HEAD`.
Spec: `.scratch/<slug>/spec.md` — task truth lives there.

## Objective
<one or two sentences: the ticket's done-state>

## Base commit
`<sha>` — the work under review is `<sha>..<working tree>`

## Relevant files & symbols
- `<path>` — `<symbol>`, `<symbol>`: <why it matters>

## Architecture boundaries
<modules and edges this ticket must not cross; where the seam sits>

## Invariants
<behavior that must keep holding>

## Decisions
- <decision, one line; rationale and changes go to the spec>

## Acceptance criteria
- <checkable statement>

## Verification commands
- `<exact command>` — <what it proves> (verified against <config> <date>)

## Known failures
- <failing check or dead end + why, so no worker rediscovers it> — or `(none)`

## Out of scope
- <explicit non-goal>

## Open questions
- <question — who owns the answer> — or `(none)`
```

## Lifecycle

1. **Create** — after research/design synthesis, before the first
   delegation. Distill the findings into the fields; the findings file keeps
   the detail. Done when: every field is filled or marked `(none)` /
   `(deferred: <owner>)`.
2. **Refresh** — when a trigger fires: a public API, module boundary,
   design decision, acceptance criterion, or verification command changed;
   the base commit moved (commit, rebase, merge); or `git status --short`
   shows files outside the packet's Relevant list. Edit the changed fields
   and bump the Freshness line. A full rewrite means the design changed —
   log that in the spec first.
3. **Changed-file rule** — after every implement/verify round, compare
   `git status --short` and `git diff --stat <base>..HEAD` against Relevant
   files & symbols. A new or removed file joins the list with its symbols,
   or it signals a scope change: update the packet and the spec's deviation
   log together.
4. **Check before delegating** — compare the Freshness line's base commit
   and verification date against the current tree. Stale → refresh first;
   never send a stale projection.
5. **Recover** — after compaction, a fork, or an interrupted spawn, rebuild
   the next projection from the packet plus the code. Chat memory is not an
   input. (Spec and checkpoint recovery live in @session and
   @prepare-compact.)

## Role projections

Pass the projection plus the packet path in each delegation prompt; the
worker reads the full packet only when it needs more.

| Worker | Projection carries |
|---|---|
| `implement` | Objective, relevant files & symbols, boundaries, invariants, acceptance criteria, verification commands, known failures, out of scope |
| `review` | Base commit (diff scope), decisions, invariants, acceptance criteria, out of scope |
| `test` | Objective, acceptance criteria, verification commands, known failures, test surface from Relevant files |
| `research` / you | Open questions, boundaries, decisions |

Raw research transcripts stay in their findings file (`docs/research/`); the
packet carries the distilled facts, and prompts carry the projection.

## Completion criteria

- The packet exists at `.scratch/<slug>/context-packet.md`; every field is
  current or explicitly deferred.
- The Freshness line names a base commit and a verification date that match
  the working tree.
- Each delegation carried its projection — no raw transcripts in prompts.
- Durable facts found along the way went to `docs/dev/`, `CONTEXT.md`, or
  `docs/adr/`; the packet holds task-scoped facts only.
