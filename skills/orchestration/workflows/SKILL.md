---
name: workflows
description: The task-to-subagent routing table and the concrete workflow procedures for the orchestrator agent, as state machines in `reference/`. Use when acting as orchestrator and about to route a piece of work, or when a task does not obviously fit a named workflow. Delegation rules live in @orchestrate.
---

# workflows

Workflows live as state machines in `reference/`: load the matching file and
follow it. This file picks the subagent and the procedure.

Skill selection is @agent-map's job: it inventories every installed skill and
what it is for. Load one from there when a task needs it.

## Subagent routing

| Task | Subagent |
|---|---|
| Implement a ticket/spec/plan; run suites; own dev servers | `implement` |
| Review a diff/branch/PR (Standards + Spec, read-only) | `review` |
| Write ADRs, docs, changelogs | `document` |
| Map the codebase to file:line pointers, or write one cited findings file | `research-discovery` |
| Search several web sources, return a cited brief | `research-synthesis` |
| Explore the codebase, investigate | `general` / `explore` |
| Malicious-code scan | `malware-check` |
| PII and secret scan | `pii-check` |
| Mermaid diagram | `mermaid-maker` |
| Hand-written SVG | `svg-maker` |

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

## Loading rules

- Load the reference file for the workflow you are about to run and follow its
  procedure.
- When a workflow hands a step to a subagent, follow the @orchestrate
  delegation rules: no duplication, resume with the child's `sessionID`.
- Non-trivial ticket work: build the context packet in @session before the
  first delegation, then pass each worker its role projection and the packet
  path, never raw research transcripts.
