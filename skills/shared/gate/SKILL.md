---
name: gate
description: >-
  The vocabulary for approval gates and the `auto` run mode: gate classes
  (`always` / `normal` / `subagent`), when each may be skipped, and how to
  declare one inside a procedure as a one-line `GATE` tag. Load this skill
  ONLY when a skill or agent references it via a `GATE` tag or an explicit
  @gate mention, or when you are authoring or retrofitting an approval gate.
  Never on its own, it is not a general instruction. Approval gates only:
  verification checks (tests, CI, checklists) and interaction gates (quizzes)
  are not covered and do not reference this skill.
---

# gate

An **approval gate** is a step where an action proceeds only with user approval. Shared vocabulary and one skip rule, so skills stop re-explaining their own. A gate applies only where declared (a `GATE` tag), only to the action that tag guards.

## Run mode

- `interactive`: the default. Gates fire via the `question` tool. Question forms propagate to the user even from a subagent, so any agent can gate.
- `auto`: the user pre-approved the scoped action set. `normal` and `subagent` gates skip; `always` still fires.

**Auto never comes from the agent itself.** Only from the user, by scope:

1. **Command argument** (`/finish auto …`): scoped to the invocation, ends with it, never persists.
2. **Mid-session switch** (`/gate auto`, or "run in auto mode"): session-scoped. Passes into every skill and subagent via the delegation prompt, until `/gate interactive`, session end, or revocation. Recorded in the workspace gate log when one exists.
3. **Headless setup** (`opencode run`, scheduled agents): "run in auto mode" baked into the agent's instructions. Absent: gates fire, forms auto-dismiss, gated actions do not happen. A user configuration problem, not something the skill detects.

In doubt: interactive. Agents never self-grant auto.

## Gate classes

| Class | Interactive | Auto | Subagent context |
|---|---|---|---|
| `always` | ask | **ask (still fires)** | ask (question propagates to top) |
| `normal` | ask | **skip** (auto-resolution, log) | ask (question propagates) |
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

- `<id>`: stable, lowercase-hyphenated (`commit-approval`, `papercut-file`, `new-scope`). Used in the gate log and re-gates.
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

State **what / why / blast radius**, then Approve / Edit / Abort. Batch same-class gates into one question. Re-gate on drift: approval voids if scope grew after granting.

## Gate log

Dedicated `## Gate log` in the workspace `spec.md`, never the deviation log. A skipped gate in auto is expected behavior, not a deviation. The @session skill owns the section template; this skill owns its format.

Entry format (append `- (none yet)` → entries):

```markdown
## Gate log
- (none yet)
- [2026-09-02] commit-approval (normal); skipped (auto): committed 3 groups with inferred messages
- [2026-09-02] new-scope (always); fired: approved ("viz")
- [2026-09-02] papercut-file (normal); skipped (auto): filed 4 entries unprompted
```

Fields: date, gate id, class, then `fired: <outcome>` / `skipped (auto | delegated): <auto-resolution taken>` / `failed: <reason>`. Log mode switches too (`/gate auto` → interactive) so a compacted session recovers the mode.

No `.scratch/` workspace: keep the log in working notes. Auto runs always end with a "Gates skipped" list in the report. A skip is never silent.

## Scope and boundaries

Approval gates only, in skills and agents that reference this skill. Verification steps (tests, CI, checklists) and interaction gates (quizzes) are not approval gates and do not reference it.

Harness permission rules (`ask` / `allow` / `deny`) are a separate layer: a gate calls the `question` tool, not a permission prompt. Never implement a gate as a frontmatter `ask` rule (depth-2 `ask` prompts hang on v2; question forms propagate). See the hindsight memory (bank `coding-agent::faz-lab`, tag `topic:opencode-v2`) for the v2 behavior.
