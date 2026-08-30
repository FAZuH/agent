---
name: workflows
description: Concrete workflows for the orchestrator agent — feature implementation/bug fixes, unit & integration tests, hard-bug diagnosis, documentation/decisions, visual verification, and the subagent routing table. This skill summarize each workflow, the routing table, and when to use each. Use when acting as orchestrator and about to route or run a piece of work, or when a task does not obviously fit a named workflow.
---

# workflows

Assumes the `mattpocock/skills` set and this repo (`fazuh/agent`) are installed as
skills on this machine. Skill names below refer to installed skills directly.

This skill separates the orchestrator's concrete workflows from the agent prompt so the prompt stays lean. The full procedures live as state machines in `reference/` — load the matching file and follow it. This file only summarises each workflow and when to use it, plus the routing table you use to pick a subagent.

## Subagent routing

Task → subagent table. Use it whenever you must pick a subagent or a task does not obviously fit a named workflow.

| Task | Subagent | Notes |
|---|---|---|
| Implement a ticket/spec/plan | `implement` | Drives implement + `tdd` skills; no PTY |
| Run test/lint/typecheck suites | `test` | Returns concise analysis only |
| Review a diff/branch/PR | `review` | Standards + Spec axes; read-only |
| Write ADRs / docs / changelogs | `document` | Docs-only; simple-english |
| Finish a session (docs + summary + proposed commits + gated retro + doctor; offers sweep) | `finish` | Uses the `finish` skill; proposes grouped commit messages, which you restate to the user for approval and then commit yourself, then runs gated `session-retro` + `skill-doctor` and offers `papercut-sweep` (never auto-runs it); only when the user explicitly asks |
| Start/monitor dev servers | `dev-server` | Owns PTY lifecycle |
| Inspect web pages visually | `web-viewer` | Playwright; no PTY, no bash |
| Read/transcribe image files | `image-viewer` | Vision, read-only |
| Preliminary discovery (codebase + web) | `research` | Mode 1: presents its plan and waits for approval before running; read-only, returns `file:line` pointers |
| Deep research (cited findings file) | `deep-research` skill → delegates to `research` | Mode 2: narrow question against primary sources, writes ONE cited findings `.md`, returns path |
| Explore codebase / research | `general` / `explore` | For investigation |
| Sharpen a plan/design | `grilling` / `grill-with-docs` (skill) | Use yourself |
| Diagnose a hard bug | `diagnosing-bugs` (skill) | Use yourself |
| Oversized effort | `wayfinder` (skill) | Use yourself |
| Cross-session context | `handoff` (skill) | Use yourself |
| Persist plans / log deviations / pre-compaction checkpoints | `session` (skill) | Use yourself |
| Pick the right workflow when unsure | `ask-matt` (skill) | Use yourself — router over the skills |
| Maintain CONTEXT.md glossary + ADRs | `domain-modeling` (skill) | Use yourself; `grill-with-docs` runs it |
| Turn a thread into a spec | `to-spec` (skill) | Use yourself after `grilling` |
| Split a plan/spec into tracer tickets | `to-tickets` (skill) | Use yourself; per project once setup ran |
| Triage incoming issues | `triage` (skill) | Use yourself for issues not created by you |
| Design deep modules | `codebase-design` (skill) | Use yourself at seams |
| Deepening survey | `improve-codebase-architecture` (skill) | Use yourself periodically; candidates only. Load `improve-architecture-oop` for output language |
| Answer a design question cheaply | `prototype` (skill) | Use yourself; bridge via `handoff` |
| User message didn't land | `wait-what` (skill) | Use yourself; re-pitch in CONTEXT.md vocab |
| Human-only steps (infra/secrets/migration) | `wizard` (skill) | Use yourself |
| Merge/rebase conflict | `resolving-merge-conflicts` (skill) | Use yourself; never --abort |
| Writing AGENTS.md / SKILL.md | `writing-for-agents` (skill) | Use yourself |

Delegation rules:
- Once a subagent owns a task, do not duplicate its work. Wait for its report and act on it.
- Prefer resuming an existing session for the same unit of work over spawning cold.
- Delegate noisy or long-running work so raw output stays out of your context.
- If a subagent reports a blocker (e.g. web-viewer found a broken dev server, test found a failing setup), re-route to the right owner (`dev-server`, `implement`, `test`) — do not try to work around it yourself.
- Read subagent reports fully; a concise failure report is actionable, not a dead end.

## Workflows at a glance

| Workflow | What it does | When to use | Load |
|---|---|---|---|
| Feature implementation / bug fixes | Plan → grill → research → implement → verify → review → finish | A feature, ticket/spec/plan, or a bug fix | `reference/feature-development.md` |
| Unit & integration tests | Plan with test guidelines, trim tautologies, implement test-first, iterate | Writing or running a test suite | `reference/testing.md` |
| Hard-bug diagnosis | Tight feedback loop first, then fix with a regression test | A bug that resists a quick fix | `reference/bug-diagnosis.md` |
| Documentation / decisions | ADRs, glossary, runbooks via `document`; ADR paper trail | Docs or architectural decisions | `reference/documentation.md` |
| Visual verification | `web-viewer` for pages/UI, `image-viewer` for still images | UI or image needs visual judgment | `reference/visual-verification.md` |
| Recover an interrupted subagent spawn | yourself | Spawn aborted / server restarted mid-task | `reference/interrupted-delegation.md` |
| Batch of user requests needs validity check | yourself, before grilling | N items in, claims unverified | `reference/claim-audit-intake.md` |

## Loading rules

- Load the reference file for the workflow you are about to run and follow its procedure.
- When a workflow hands a step to a subagent, do not duplicate its work — wait for its report and act on it. Prefer resuming the same subagent session (`task_id`) over spawning cold.
