---
name: gate
description: >-
  Approval gates and the `auto` run mode: gate classes (always, normal,
  subagent), when each may be skipped, and the `GATE` tag. Load only when a
  skill or agent references a gate. Not verification or interaction gates.
---

# gate

An **approval gate** is a step where an action proceeds only with user approval. Shared vocabulary and one skip rule, so skills stop re-explaining their own. A gate applies only where declared (a `GATE` tag), only to the action that tag guards.

## Run mode

- `interactive`: the default. Use @prompt-user to present gates and recover their stored status and answers.
- `auto`: the user pre-approved the scoped action set. `normal` and `subagent` gates skip; `always` still fires.

**Auto never comes from the agent itself.** Only from the user, by scope:

1. **Command argument** (`/finish auto …`): scoped to the invocation, ends with it, never persists.
2. **Mid-session switch** (`/gate auto`, or "run in auto mode"): session-scoped. Passes into every skill and subagent via the delegation prompt, until `/gate interactive`, session end, or revocation. Recorded in the workspace gate log when one exists.
3. **Headless setup** (`opencode run`, scheduled agents): "run in auto mode" baked into the agent's instructions. Absent: gates fire, forms auto-dismiss, gated actions do not happen. A user configuration problem, not something the skill detects.

In doubt: interactive. Agents never self-grant auto.

## Gate classes

| Class | Interactive | Auto | Subagent context |
|---|---|---|---|
| `always` | ask | **ask (still fires)** | ask through @prompt-user |
| `normal` | ask | **skip** (auto-resolution, log) | ask through @prompt-user |
| `subagent` | ask | skip (auto-resolution, log) | **skip (delegation covered it)** |

- `always`: irreversible, destructive, global, or convention-changing (push, config edits, publishing, deletions, closed-vocabulary changes). Never skipped.
- `normal`: the default. Skips in auto, only in auto.
- `subagent`: skips under delegation too, because the spawning context holds the decision. Only when delegation implies approval (precedent: @deep-research plan-approval skipped by Mode 2).

### Why `subagent` is its own class

Each class answers one author question with one skip trigger:

- `always`: *can this action be undone cheaply?* No → always.
- `normal`: *did the user pre-approve this kind of action by choosing
  auto?* Skip only in auto.
- `subagent`: *did the user already make this decision by requesting the
  delegation itself?* Skip in auto and under delegation.

Folding `subagent` into `normal` fails three ways: a `normal` gate auto-resolving inside an interactive subagent (unsafe); the research case lost, where the subagent re-asks what delegating just answered; ad-hoc "gate covered" notes in delegation prompts, which are unauditable.

## Declaring a gate

One-line tag; mechanics live here.

```
**GATE <id> (<class> → <auto-resolution>):** <what the gate guards>
```

- `<id>`: stable, lowercase-hyphenated (`commit-approval`, `friction-file`, `new-scope`). Used in the gate log and re-gates.
- `<class>`: `always` | `normal` | `subagent`.
- `<auto-resolution>`: the concrete thing "proceed" means when the gate skips. Load-bearing: without it, "skip the gate" is ambiguous.
- Trailing text is what the gate protects (keep it; site-specific detail, not duplicated mechanics).

### Authoring checklist

Classify in order; first hit wins:

1. Destructive or irreversible, or harms a closed vocabulary / convention / external system or store → `always`.
2. Redundant under delegation (the caller already decided) → `subagent`.
3. Otherwise → `normal`.

State the auto-resolution as a concrete action, never "proceed": what file/command/store changes, and the fallback.

### Asking

State what changes, why, and the affected scope, then Approve / Edit / Abort.
Batch same-class gates into one prompt.

Before mutation, recheck the relevant approval scope and action preconditions.
Unrelated edits do not void approval. If scope grows or a relevant precondition
changes, resolve that change before acting. Existing explicit approval in the
conversation remains valid for its original scope. Do not ask for it again.
If authorization is unknown, do not mutate.

### Recovery

Record the prompt ID and guarded scope when a gate fires. After resume or
compaction, use @prompt-user's lookup procedure to recover stored status and
answers. The prompt store owns answers. Do not create a second answer store.

Pending, deferred, and dismissed prompts are not approval. Reuse an existing
pending card instead of creating a duplicate. An answered prompt grants approval
only if its answer explicitly approves the action. A recovered approval covers
only the original guarded scope. Recheck its scope and preconditions before mutation.

## Gate log

Dedicated `## Gate log` in the workspace `spec.md`, never the deviation log. A skipped gate in auto is expected behavior, not a deviation. The @session skill owns the section template; this skill owns its format.

Entry format (append `- (none yet)` → entries):

```markdown
## Gate log
- (none yet)
- [2026-09-02] commit-approval (normal); scope: 3 reviewed groups; skipped (auto): committed approved groups
- [2026-09-02] new-scope (always); scope: add "viz"; prompt: <promptID>; fired: answered, approved
```

Fields: date, gate ID, class, guarded scope, prompt ID when fired, and outcome:
`fired: <status>` / `skipped (auto | delegated): <auto-resolution taken>` /
`failed: <reason>`. For conversational approval, record its scope and reference
instead of inventing a prompt ID. Log mode switches too so a compacted session
recovers the mode.

No `.scratch/` workspace: keep the log in working notes. Auto runs always end with a "Gates skipped" list in the report. A skip is never silent.

## Scope and boundaries

Approval gates only, in skills and agents that reference this skill. Verification steps (tests, CI, checklists) and interaction gates (quizzes) are not approval gates and do not reference it.

Harness permission rules (`ask` / `allow` / `deny`) are a separate layer.
@prompt-user owns the gate's presentation and lookup, not permission prompts.
Never implement a gate as a frontmatter `ask` rule.
