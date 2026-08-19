---
name: session
description: >-
  Manage a feature's session workspace under .scratch/, one date-prefixed
  directory per feature — plan and spec doc, mattpocock-style tickets,
  deviation log, and pre-compaction checkpoints. Use when starting a
  multi-step task and writing an initial plan, resuming or recovering context
  after a session fork or context compaction, persisting state before
  compaction, logging deviations during execution, or drafting a spec and
  splitting it into tickets. The session doc is the single source of truth
  that keeps work consistent across sessions. The `.scratch/` workspace
  mechanics (slug format, layout, lifecycle, archiving) live in the `scratch`
  skill.
---

# session

Every non-trivial feature gets a session workspace in `.scratch/` under a
date-prefixed slug: `.scratch/<YYYY-MM-DD>_<feature-slug>/`. The doc survives
session forks and context compactions, so any session can recover the full
picture — decisions, file layout, deviations, status — from the workspace
plus the code.

> **Load the `scratch` skill first.** It owns the `.scratch/` workspace
> mechanics — the slug format, directory layout, lifecycle, and archiving of
> completed features to `.scratch/complete/`. Follow its layout exactly when
> you read or write `.scratch/` files.

## Read the workspace first

- **Session start / resume:** read `.scratch/*_*/spec.md` before doing
  anything; it restores where the work stands and what was already decided.
- **After compaction or fork:** re-read the spec and `checkpoint.md` before
  continuing — they are the canonical summary of the work.
- **Mid-task:** check the deviation log to see what already changed.

## Writing a plan / spec

Study the codebase first (existing pages, modules, routes, conventions) so the
plan matches the repo's actual structure and style. Keep the doc
self-contained: a fresh agent or a compacted session must be able to resume
from the doc plus the code.

Template (`.scratch/<YYYY-MM-DD>_<feature-slug>/spec.md`):

```markdown
# Spec: <short title>

## Objective
Why the work exists; concrete outcomes as a numbered list.

## Decisions & constraints
Key design decisions with rationale; non-negotiables (dependencies, style).

## File layout
New and modified files, one bullet each, with a one-line purpose.

## Design / Math
The core approach in enough detail that a fresh agent could re-derive it.

## Execution
How to verify (tests, lint, build); which subagents to delegate to
(dev-server, test-runner, web-viewer).

## Deviation log
- (none yet)
```

## Tickets & specs (mattpocock)

> [!NOTE]
> If mattpocock's skills is not installed, follow installation instruction 
> at https://github.com/mattpocock/skills

`.scratch/` doubles as the local issue tracker. Follow the conventions from
`setup-matt-pocock-skills/issue-tracker-local.md`. The mattpocock skills use
`<feature-slug>` as the directory name — on this machine the slug is always
date-prefixed, so hand them `<YYYY-MM-DD>_<feature-slug>`:

- **Spec** — `to-spec` publishes `.scratch/<YYYY-MM-DD>_<feature-slug>/spec.md`.
- **Tickets** — `to-tickets` splits the spec into one file per ticket at
  `.scratch/<YYYY-MM-DD>_<feature-slug>/issues/<NN>-<slug>.md`, numbered from
  `01` in dependency order (blockers first). Each ticket has a `Blocked by:`
  line and a `Status:` line (`ready-for-agent` / `claimed` / `resolved`).
- **Map** — `wayfinder` writes `.scratch/<YYYY-MM-DD>_<effort>/map.md` and one
  child ticket per decision. The **frontier** is the scan of
  `.scratch/<YYYY-MM-DD>_<effort>/issues/` for files that are open, unblocked,
  and unclaimed; first by number wins.

## Logging deviations

As work diverges from the plan, log it immediately in the deviation log and
update the affected section in place. The doc must always reflect reality.

```markdown
## Deviation log
- (none yet)
- [2026-07-31] Replaced the static known-rates list with the rarity-tier
  theory table; updated "Known rates" section.
```

Rules:

- Log every change to a decision, file layout, design, or scope.
- Update the affected section too — the doc reflects reality, it doesn't just
  record that reality changed.
- Date every entry and include enough context to be self-explanatory.

## Persisting context before compaction

When the session is about to be compacted (context-watch warning, explicit
request), persist a resume checkpoint so a fresh session can pick up. Assume
the conversation history is about to be deleted.

1. **Snapshot state** — capture: objective, done, in progress, blocked,
   deviations.
2. **Update `spec.md`** — refresh Objective / Decisions & constraints /
   File layout / Design / Execution to match reality; append dated entries to
   the Deviation log.
3. **Write `.scratch/<YYYY-MM-DD>_<feature-slug>/checkpoint.md`** with:

```markdown
# Resume checkpoint — <feature>

## Goal to re-create
<the goal objective, verbatim>

## Next step
<the single next action, with file paths and line numbers if known>

## Verify with
<exact command or test to confirm state>

## Context to re-read first
<spec path, specific files, code sections>

## Open questions
<anything still unanswered>

## Session facts
- Environment: dev servers (and which subagent/PTY owns them), ports, PIDs,
  git branch, uncommitted files.
- Commands: exact verification commands and any one-off commands that worked.
- Gotchas: non-obvious findings, dead ends, API quirks, decisions and
  rationale.
```

Do NOT write credentials or tokens — note where they live instead (env var,
file path). After compaction, the first action of the fresh session must be to
re-create the goal from the checkpoint, then continue from the next step.

## Completing a feature

To archive a finished workspace, follow the **Completing / archiving a
feature** steps in the `scratch` skill: mark remaining items done, append an
Outcome section, move the spec to `.scratch/complete/`, mark tickets resolved,
and delete the stale checkpoint. Do not archive until the work ships and all
its items are done.
