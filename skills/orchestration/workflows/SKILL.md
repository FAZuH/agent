---
name: workflows
description: The task-to-subagent routing table and the concrete workflow procedures for the orchestrator agent, as state machines in `reference/`. Use when acting as orchestrator and about to route a piece of work, or when a task does not obviously fit a named workflow. Delegation rules live in @orchestrate.
---

# workflows

Assumes the `mattpocock/skills` set and this repo (`fazuh/agent`) are
installed as skills. Skill names refer to installed skills directly.

Concrete workflows live as state machines in `reference/`: load the matching
file and follow it. This file summarises each workflow, when to use it, and the
routing table for picking a subagent.

## Subagent routing

Use it whenever you must pick a subagent or a task does not obviously fit a
named workflow.

| Task | Subagent | Notes |
|---|---|---|
| Orchestrator role: manage tasks, delegate, restore the role | @orchestrate | Load first when acting as orchestrator, or when the role needs restating |
| Warm per-ticket delegation | `@forkflow` | Probe once, then fork → switch agent → first prompt; fall back to a fresh spawn |
| Implement a ticket/spec/plan | `implement` | Drives implement + @tdd skills; also owns verification and server PTYs |
| Run test/lint/typecheck suites | `implement` | Verification-only mode; concise analysis, no edits |
| Review a diff/branch/PR | `review` | Standards + Spec axes; read-only |
| Write ADRs / docs / changelogs | `document` | Docs-only; simple-english |
| Finish a session (docs + archive + summary) | `finish` | Uses the @finish skill; delegates commit planning to @commit (proposes grouped messages, which you restate to the user for approval and then commit yourself) and self-improvement to @self-improve (gated retro + @skill-doctor, offers the sweep, never auto-runs it); only when the user explicitly asks |
| Start/monitor dev servers | `implement` | Server-only mode; owns PTY lifecycle |
| Preliminary codebase discovery | `research-discovery` | Starts immediately, no approval gate; returns `file:line` pointers |
| Deep research (cited findings file) | @deep-research → `research-discovery` | Narrow question against primary sources; writes ONE cited findings `.md`, returns path |
| Broad web research synthesis | `research-synthesis` | Returns a focused, cited brief in chat |
| Explore codebase / research | `general` / `explore` | For investigation |
| Sharpen a plan/design | @grilling / @grill-with-docs | Use yourself |
| Diagnose a hard bug | @diagnosing-bugs | Use yourself |
| Oversized effort | @wayfinder | Use yourself |
| Cross-session context | @handoff | Use yourself |
| Persist plans / log deviations / context packet / pre-compaction checkpoint | @session | Use yourself |
| Isolate work on a branch, then finish or close its worktree | @worktree | Use yourself |
| Bootstrap/audit/update `docs/dev/` | @setup-dev-docs | Use yourself on an explicit user request only |
| Plan commit grouping + propose messages (no commit) | @commit | Use yourself; restate groups to the user for approval, then commit yourself |
| Gated self-improvement check (retro + doctor, offers sweep) | @self-improve | Use yourself |
| Pick the right workflow when unsure | @ask-matt | Use yourself, router over the skills |
| Maintain CONTEXT.md glossary + ADRs | @domain-modeling | Use yourself; @grill-with-docs runs it |
| Turn a thread into a spec | @to-spec | Use yourself after @grilling |
| Split a plan/spec into tracer tickets | @to-tickets | Use yourself; per project once setup ran |
| Triage incoming issues | @triage | Use yourself for issues not created by you |
| Design deep modules | @codebase-design | Use yourself at seams |
| Deepening survey | @improve-codebase-architecture | Use yourself periodically, candidates only; load @improve-architecture-oop for output language |
| Answer a design question cheaply | @prototype | Use yourself; bridge via @handoff |
| User message didn't land | @wait-what | Use yourself; re-pitch in CONTEXT.md vocab |
| Human-only steps (infra/secrets/migration) | @wizard | Use yourself |
| Merge/rebase conflict | @resolving-merge-conflicts | Use yourself; never --abort |
| Writing AGENTS.md / SKILL.md | @writing-for-agents | Use yourself |
| Approval gate declared with a `GATE` tag, or authoring one | @gate | Load for the run-mode/gate-class vocabulary; delegate prompts carry `RUN MODE: …` |

Delegation rules live in @orchestrate (no-duplication, resume over spawn,
blocker re-routing, run mode in every prompt). This table only picks the
subagent.

## Workflows at a glance

| Workflow | What it does | When to use | Load |
|---|---|---|---|
| Feature implementation / bug fixes | Plan → grill → research → implement → verify → review → finish | A feature, ticket/spec/plan, or a bug fix | `reference/feature-development.md` |
| Unit & integration tests | Plan with test guidelines, trim tautologies, implement test-first, iterate | Writing or running a test suite | `reference/testing.md` |
| Hard-bug diagnosis | Tight feedback loop first, then fix with a regression test | A bug that resists a quick fix | `reference/bug-diagnosis.md` |
| Documentation / decisions | ADRs, glossary, runbooks via `document`; ADR paper trail | Docs or architectural decisions | `reference/documentation.md` |
| Parallel lanes | Declare scopes → dispatch every lane → gate the shared files → collect → verify once | Work that decomposes into units touching different files | `reference/parallel-lanes.md` |
| Recover an interrupted subagent spawn | yourself | Spawn aborted / server restarted mid-task | `reference/interrupted-delegation.md` |
| Batch of user requests needs validity check | yourself, before grilling | N items in, claims unverified | `reference/claim-audit-intake.md` |

## Ticket context and durable docs

- Non-trivial ticket work: after research/design synthesis, build the context
  packet in @session before the first delegation, then pass each worker its
  role projection and the packet path, never raw research transcripts. The
  packet is derived; the spec stays the source of truth.
- `docs/dev/` changes only through @setup-dev-docs, on explicit user request;
  ordinary feature work writes task context instead.

## Loading rules

- Load the reference file for the workflow you are about to run and follow its
  procedure.
- When a workflow hands a step to a subagent, follow the @orchestrate
  delegation rules (no duplication, resume with the child's `sessionID`).
