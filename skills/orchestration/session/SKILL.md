---
name: session
description: >-
  Manage a feature's session workspace under .scratch/: the plan/spec doc,
  tickets, deviation log, log sections, per-ticket context packet, and
  pre-compaction checkpoints. Use when starting a multi-step task and writing
  an initial plan, resuming after a session fork or compaction, persisting
  state before compaction, logging deviations, drafting a spec and splitting
  it into tickets, or to create or refresh the per-ticket context packet (the
  context packet a worker needs), or when the context is getting full and a
  resume checkpoint must survive a compaction. Not a durable knowledge store:
  @setup-dev-docs owns docs/dev/. The `.scratch/` layout, slug format, and
  lifecycle live in the @scratch skill; the checkpoint, log-section, and
  context-packet templates live here.
---

# session

Every non-trivial feature gets a `.scratch/` workspace. The spec doc inside it
is the single source of truth.

> **Load @following-procedures skill first.** It owns procedure narration,
> deviation logging, post-run report. The `## Interrupted procedures` section
> it defines lives in this workspace's `spec.md`.
>
> **Load @scratch skill first.** It owns the workspace layout, slug format, and
> lifecycle. This skill owns what goes *inside* the workspace.

## Read the workspace first

- **Session start / resume:** read `.scratch/*_*/spec.md` first; it restores
  where the work stands and what was decided.
- **After compaction or fork:** re-read the spec and `checkpoint.md`; they are
  the canonical summary.
- **Mid-task:** check the deviation log for what already changed.

## Writing a plan / spec

Study the codebase first (pages, modules, routes, conventions) so the plan
matches the repo. Keep the doc self-contained: a fresh or compacted session
must resume from the doc plus the code.

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
(implement).

## Gate log
- (none yet)

## Deviation log
- (none yet)
```

Append entries to this log with a shell append (`cat >> spec.md <<'EOF' …`),
or an edit that anchors on the file's final line and ADDS after it. Never
anchor on a duplicated phrase mid-file: replace-edits on recurring log text
silently overwrite an existing entry.

## Log sections

Two more sections sit alongside the deviation log in the same `spec.md`. This
skill owns where they go and the empty placeholder; each owning skill states
its entry format.

- `## Gate log`, approval-gate decisions and run-mode switches. The @gate
  skill owns the entry format; never fold these into the deviation log.
- `## Interrupted procedures`, one entry per interrupted procedure, updated
  in place and never deleted until the procedure resumes and finishes. The
  @following-procedures skill owns the entry format.

## Tickets & specs (mattpocock)

> [!NOTE]
> These skills come from the external
> [mattpocock/skills](https://github.com/mattpocock/skills) repo, not this one.
> If they are not installed, follow the installation instructions at
> https://github.com/mattpocock/skills

`.scratch/` doubles as the local issue tracker. Follow the conventions from
[`setup-matt-pocock-skills/issue-tracker-local.md`](https://github.com/mattpocock/skills/blob/main/skills/engineering/setup-matt-pocock-skills/SKILL.md).
The mattpocock skills use `<feature-slug>` as the directory name; on this
machine the slug is always date-prefixed, so hand them
`<YYYY-MM-DD>_<feature-slug>`:

- **Spec**: [@to-spec](https://github.com/mattpocock/skills/blob/main/skills/engineering/to-spec/SKILL.md) publishes `.scratch/<YYYY-MM-DD>_<feature-slug>/spec.md`.
- **Tickets**: [@to-tickets](https://github.com/mattpocock/skills/blob/main/skills/engineering/to-tickets/SKILL.md) splits the spec into one file per ticket at
  `.scratch/<YYYY-MM-DD>_<feature-slug>/issues/<NN>-<slug>.md`, numbered from
  `01` in dependency order (blockers first). Each ticket has a `Blocked by:`
  line and a `Status:` line (`ready-for-agent` / `claimed` / `resolved`).
- **Map**: [@wayfinder](https://github.com/mattpocock/skills/blob/main/skills/engineering/wayfinder/SKILL.md) writes `.scratch/<YYYY-MM-DD>_<effort>/map.md` and one
  child ticket per decision. The **frontier** is the scan of
  `.scratch/<YYYY-MM-DD>_<effort>/issues/` for files that are open, unblocked,
  and unclaimed; first by number wins.

When marking a ticket resolved, replace `Status:` with `resolved (<date>)` and
append an **Outcome** paragraph: what landed, key judgment calls, pointer to
spec deviation-log entries, flagged follow-ups. Sessions recovering from forks
or killed subagents rely on these Outcome blocks more than on chat history.

## Logging deviations

As work diverges from the plan, log it immediately in the deviation log and
update the affected section in place, so the doc reflects reality and not just
records that reality changed. Log every change to a decision, file layout,
design, or scope. Date every entry and include enough context to be
self-explanatory.

```markdown
## Deviation log
- (none yet)
- [2026-07-31] Replaced the static known-rates list with the rarity-tier
  theory table; updated "Known rates" section.
```

## The per-ticket context packet

The context packet is one compact file per ticket,
`.scratch/<YYYY-MM-DD>_<task>/context-packet.md`: the distilled view of what
to build, where, what must stay true, how to verify, and what each worker
needs. Workers get a role-specific projection; raw research transcripts never
enter delegation prompts.

The packet lives in the active workspace; when none exists for the task,
create it per @scratch before writing the packet.

### Boundaries

- `.scratch/<slug>/spec.md` stays the task's source of truth: objective,
  decisions, deviations, gates. The packet is a derived, disposable view,
  rebuildable from the spec plus the code at any time. This skill owns that
  lifecycle and the checkpoints; this section owns only the packet.
- Durable knowledge goes home, never into the packet: stable workflow →
  `docs/dev/` (@setup-dev-docs), vocabulary → `CONTEXT.md`, decisions →
  `docs/adr/`.
- The packet is not a second architecture memory. When @scratch-finish
  archives the workspace, the packet goes with it.
- Execution-mode neutral: workers are fresh subagent spawns today; a
  session-fork flow could consume the same packet unchanged.

### Packet template

```markdown
# Context packet: <task>

Freshness: updated <YYYY-MM-DD> at base `<sha>`; last checked <YYYY-MM-DD>
against `git status --short` + `git diff --stat <base>..HEAD`.
Spec: `.scratch/<slug>/spec.md`, task truth lives there.

## Objective
<one or two sentences: the ticket's done-state>

## Base commit
`<sha>`, the work under review is `<sha>..<working tree>`

## Relevant files & symbols
- `<path>`: `<symbol>`, `<symbol>`: <why it matters>

## Architecture boundaries
<modules and edges this ticket must not cross; where the seam sits>

## Invariants
<behavior that must keep holding>

## Decisions
- <decision, one line; rationale and changes go to the spec>

## Acceptance criteria
- <checkable statement>
- Whether verification may touch production or a shared stack; when a scratch
  stack proves the same property, prefer it and ask before the production one.
- Every mechanism a plan prescribes (Cargo `[patch]`, npm overrides/aliases,
  config keys) is validated against the package manager's manifest rules
  before work is scheduled; a manifest-invalid mechanism invalidates every
  ticket that assumes it.

## Verification commands
- `<exact command>`: <what it proves> (verified against <config> <date>)
  - depends on an ephemeral artifact (`/tmp` download, running server)? name
    it and put the recreate step beside the command

## Known failures
- <failing check or dead end + why, so no worker rediscovers it>, or `(none)`

## Out of scope
- <explicit non-goal>

## Open questions
- <question, who owns the answer>, or `(none)`
```

### Lifecycle

1. **Create**: after research/design synthesis, before the first delegation.
   Distill the findings into the fields; the findings file keeps the detail.
   Done when every field is filled or marked `(none)` / `(deferred: <owner>)`.
2. **Refresh**: on trigger: a public API, module boundary, design decision,
   acceptance criterion, or verification command changed; the base commit moved
   (commit, rebase, merge); or `git status --short` shows files outside
   Relevant. Edit the changed fields and bump the Freshness line. A full
   rewrite means the design changed: log it in the spec first.
3. **Changed-file rule**: after every implement/verify round, compare
   `git status --short` and `git diff --stat <base>..HEAD` against Relevant
   files & symbols. A new or removed file joins the list with its symbols, or
   it signals a scope change: update the packet and the spec's deviation log
   together.
4. **Check before delegating**: compare the Freshness line's base commit and
   verification date against the current tree. Stale → refresh first; never
   send a stale projection.
5. **Recover**: after compaction, a fork, or an interrupted spawn, rebuild the
   next projection from the packet plus the code. Chat memory is not an input.
   (Spec and checkpoint recovery live in 'Read the workspace first' and
   'Persisting before compaction'.)

### Role projections

Pass the projection plus the packet path in each delegation prompt; the
worker reads the full packet only when it needs more.

| Worker | Projection carries |
|---|---|
| `implement` | Objective, relevant files & symbols, boundaries, invariants, acceptance criteria, verification commands and test surface, known failures, out of scope |
| `review` | Base commit (diff scope), decisions, invariants, acceptance criteria, out of scope |
| `research-discovery` / you | Open questions, boundaries, decisions |

Raw research transcripts stay in their findings file (`docs/research/`).

### Fleet dispatches

When dispatching N>1 children from one packet, pre-render one projection file
per child into the workspace (`projections/<role>.md`) and pass the file path
in each dispatch prompt instead of pasting inline. Inline briefs drift apart
across children; files stay comparable and diffable, and a re-dispatch reuses
the file unchanged.

### Completion criteria

- The packet exists at `.scratch/<slug>/context-packet.md`; every field is
  current or explicitly deferred.
- The Freshness line names a base commit and a verification date that match
  the working tree.
- Each delegation carried its projection, no raw transcripts in prompts.

## Persisting before compaction

Compaction is imminent: the last chance to persist what a fresh session needs
to resume. Assume the conversation history is about to be deleted.

> **Load @scratch skill if the repo uses `.scratch/`.** It owns the `.scratch/`
> workspace mechanics: layout, slug format, `.scratch/complete/` archive
> location. Follow it when you update the session doc or checkpoint.

Extra notes the user gives count as arguments: persist them as notes, and/or
use them as the feature slug when the repo uses `.scratch/`.

### Resume checkpoint template

The compaction procedure lives in the steps of this section. The template
below is written to `.scratch/<YYYY-MM-DD>_<feature-slug>/checkpoint.md`; a
repo that compacts without a `.scratch/` workspace can copy it into
`RESUME.md`.

```markdown
# Resume checkpoint: <feature>

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

Do NOT write credentials or tokens, note where they live instead (env var,
file path). After compaction, the first action of the fresh session must be to
re-create the goal from the checkpoint, then continue from the next step.

### The steps

Do the steps in order. Never compress or skip facts; fidelity over brevity.

IMPORTANT: if you lack write access (read-only agent, Plan mode, or any
restriction blocking file edits, todo updates, memory, or goal clearing), do
NOT fail silently. Persist whatever you can, then tell the user in the final
report which steps could not be performed and what will be lost on compaction.

#### 1. Snapshot current state

Run `get_goal` and record the goal's objective verbatim; the fresh session
re-creates it. Then capture:

- **Objective**: what is being worked on, in one or two sentences.
- **Done**: what shipped: files created/changed, features working,
  verification passed.
- **In progress**: partial edits, uncommitted work, a design being worked out.
- **Blocked**: external blockers, pending decisions, answers still awaited.
- **Deviations**: anything that diverged from a plan, spec, or request.

#### 2. Update the session doc

Detect the repo's session-doc convention rather than assuming one:

- `.scratch/` layout (`.scratch/<feature-slug>/spec.md` exists): update it in
  place. Refresh **Objective**, **Decisions & constraints**, **File layout**,
  **Design**, **Execution** to match reality. Append dated entries to the
  **Deviation log** for every change since the doc was last written.
- Otherwise: update whatever plan/spec doc the repo tracks (common names:
  `spec.md`, `plan.md`, `docs/plan/`, `docs/specs/`). Same refresh plus dated
  deviation entries.
- No session doc: do not invent one. Skip creation, note it in the report.
- Work essentially complete: say so, note the doc should be archived
  (`.scratch/complete/` when the repo uses `.scratch/`, or the repo's
  equivalent).

#### 3. Collect the todo list

Gather todos from wherever they live and persist them into the resume
checkpoint (step 6) so a fresh session can pick them up. Sources, in order:

- The active goal objective (step 1) and anything it implies is still open.
- Repo-tracked tickets (`.scratch/<feature-slug>/` tickets when the repo uses
  `.scratch/`, or the repo's issue tracker).
- Your own context: pending or in-progress items stated in the conversation.

Write each item with what remains and how to verify it. Mark anything
actually finished as completed. Merge duplicates. Keep the list short.
No todos: say so in the report and move on.

#### 4. Persist session-critical facts

Capture anything cheap to lose and expensive to rediscover:

- **Environment**: dev servers running (and which subagent/PTY owns them),
  ports, URLs, relevant PIDs, current git branch and uncommitted files.
- **Commands**: exact verification commands (build, lint, test, typecheck) and
  any one-off commands that worked.
- **Gotchas**: non-obvious findings, dead ends, API quirks, decisions and
  their rationale. If a friction point was filed to Hindsight, reference its
  `document_id`; do not duplicate it.
- **Secrets**: do NOT write credentials or tokens. Note where they live
  instead (env var, file path).

#### 5. Update memory (optional)

If the session changed durable, high-signal facts (new project conventions,
architecture decisions, workflow changes), update the project or global memory
blocks so they survive without the conversation. Never add trivia.

#### 6. Write the resume checkpoint

Write the resume checkpoint to `.scratch/<feature-slug>/checkpoint.md` when
the repo uses the `.scratch/` layout; otherwise a generic `RESUME.md` at the
repo root. The checkpoint's section template lives in 'Resume checkpoint
template' above. No credentials or tokens (see §4). After compaction, the
fresh session's first action is to re-create the goal with the recorded
objective (create_goal/set_goal), then continue from the checkpoint.

#### 7. Clear the goal

When all persistence steps are done, clear the active goal with `clear_goal`.
That stops the goal plugin from re-prompting to continue the current goal
after compaction. The objective survives in the resume checkpoint, so nothing
is lost by clearing it.

#### 8. Report

Give the user a concise report:

- Where each piece of state was persisted (session doc path, checkpoint, todo
  list, memory; friction is already in Hindsight).
- The goal that was cleared, and the objective they must re-create after
  compaction.
- The single next step they can paste into a fresh session to continue.
- Anything that could NOT be persisted, so they know what is lost on
  compaction.

Do not commit or take any other side action. Step 9 offers the compaction
itself; otherwise the user decides whether to compact or continue.

#### 9. Offer compaction

**GATE compact-offer (normal → compact immediately):** after the report, offer
to compact this session now. Skip this step entirely when the agent is not
running in OpenCode; the report in step 8 ends the procedure.

Detect the OpenCode harness first:

- **OpenCode v2**: the environment block carries
  `Current conversation session ID: ses_…`. Compact with the @ocv2-compact
  skill: from that skill's directory run `scripts/oc-compact.sh ses_… --timeout 0`,
  then end the turn.
  The compaction is a steer: it queues behind the current turn and runs once
  the session goes idle. Never wait synchronously inside the turn; it always
  times out.
- **OpenCode v1**: the `compact_context` tool is available. Call it.

When the gate fires (interactive mode), ask with the @gate mechanics: what
was persisted and where (step 8), that compaction replaces the conversation
with the summary, Approve / Abort. Approve → run the compaction for the
detected harness. Abort → stop; the persisted state stands either way.

In auto mode, do not ask; run the compaction immediately after the report.

### Dependency graph

- step1
- step2 -> step1
- step3 -> step2
- step4 -> step2
- step5
- step6 -> step2, step4
- step7 -> step6
- step8 -> step6, step7
- step9 -> step8

## Completing a feature

@scratch-finish owns the completion checklist and archive steps. Follow it. Do
not archive until the work ships and every item is done.
