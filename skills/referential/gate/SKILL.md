---
name: gate
description: >-
  The vocabulary for approval gates and the `auto` run mode: gate classes
  (`always` / `normal` / `subagent`), when each may be skipped, and how to
  declare one inside a procedure as a one-line `GATE` tag. Load this skill
  ONLY when a skill or agent references it via a `GATE` tag or an explicit
  @gate mention, or when you are authoring or retrofitting an approval gate.
  Never on its own — it is not a general instruction. Approval gates only:
  verification checks (tests, CI, checklists) and interaction gates (quizzes)
  are not covered and do not reference this skill.
---

# gate

An **approval gate** is a step where an action may proceed only after the
user approves it. This skill gives gates a shared vocabulary and one rule for
when a gate may be skipped, so skills stop re-explaining their own skip
conditions. A gate applies only where it is explicitly declared (a `GATE`
tag) and only to the action that tag guards.

## Run mode

Gates depend on the run mode:

- `interactive` — the default. Gates fire; ask via the `question` tool
  (internally `default.question`). Question forms propagate up to the user
  even from a subagent, so any agent can gate.
- `auto` — the user pre-approved the scoped action set for this run.
  `normal` and `subagent` gates skip; `always` gates still fire.

**Auto never comes from the agent itself.** It comes only from the user, in
one of these ways, by order of scope:

1. **Command argument** — e.g. `/finish auto …`. Scoped to that command
   invocation; ends when the command does; never persists.
2. **Mid-session switch** — the user invokes `/gate auto` or says "run in
   auto mode". Scoped to the session: the current agent proceeds in auto,
   passes the mode into every skill it runs and every subagent it spawns
   (stated in the delegation prompt), and it persists until `/gate
   interactive`, session end, or revocation. Recorded in the session
   workspace's gate log (below) when one exists.
3. **Headless setup** — unattended runs (`opencode run`, scheduled agents)
   get auto by instruction: the user bakes "run in auto mode" into the
   agent's instructions when configuring it. If they do not, gates fire and
   the question forms get auto-dismissed, so gated actions do not happen —
   that is a configuration problem on the user's side, not something the
   skill detects or works around.

When in doubt, treat the run as interactive. An agent never self-grants auto.

## Gate classes

| Class | Interactive | Auto | Subagent context |
|---|---|---|---|
| `always` | ask | **ask — still fires** | ask (question propagates to top) |
| `normal` | ask | **skip** (auto-resolution, log) | ask (question propagates) |
| `subagent` | ask | skip (auto-resolution, log) | **skip — delegation covered it** |

- `always` — irreversible, destructive, global, or convention-changing
  (push, config edits, publishing, deletions, closed-vocabulary changes).
  Never skipped by any mode.
- `normal` — the default class. Skip in auto, and only in auto.
- `subagent` — additionally skips when executing as an agent with
  `mode: subagent`, because the spawning context already holds the decision.
  Use only when delegation itself implies the approval (the @deep-research
  precedent: research's Mode 1 plan-approval is skipped by Mode 2 because
  the user already asked for the outcome).

### Why `subagent` is its own class

Each class answers exactly one author question, with exactly one skip
trigger:

- `always` — *can this action be undone cheaply?* No → always.
- `normal` — *did the user pre-approve this kind of action by choosing
  auto?* Skip only in auto.
- `subagent` — *did the user already make this decision by requesting the
  delegation itself?* Skip in auto and under delegation.

Combining `subagent` into `normal` fails concretely: making `normal` skip in
any subagent context lets a `normal` gate like commit-approval silently
execute its auto-resolution inside a subagent even in interactive mode
(unsafe); keeping one skip trigger loses the research case (the subagent
re-asks what the user just answered by delegating); and handling coverage at
runtime with an ad-hoc "gate covered" note in the delegation prompt is
exactly the hand-rolled prose this skill replaces — forgettable and
unauditable.

## Declaring a gate

A gate in a procedure or skill is a one-line tag; the mechanics live here.

```
**GATE <id> (<class> → <auto-resolution>):** <what the gate guards>
```

- `<id>` — a stable, lowercase-hyphenated name (`commit-approval`,
  `papercut-file`, `research-plan`). Used in the gate log and re-gates.
- `<class>` — `always` | `normal` | `subagent`.
- `<auto-resolution>` — the concrete thing "proceed" means when the gate
  skips. It is load-bearing: without it, "skip the gate" is ambiguous.
- The trailing text is what the gate protects (keep it; it is site-specific
  detail, not duplicated mechanics).

### Authoring checklist

Classify with these questions, in order — the first that hits wins:

1. Destructive or irreversible, or harms a closed vocabulary / convention /
   an external system or store → `always`.
2. Redundant under delegation (the caller already decided) → `subagent`.
3. Otherwise → `normal`.

Also state the auto-resolution as a concrete action, never "proceed": what
file/command/store changes, and what the fallback is.

### Asking

State **what / why / blast radius**, then offer options Approve / Edit /
Abort. Batch same-class gates into one question (the session-retro
precedent: File all / Pick individually / File none). Re-gate on drift: an
approval is void if the action's scope grew after it was granted.

## Gate log

Gate decisions go to a **dedicated `## Gate log` section** in the session
workspace's `spec.md` — never the deviation log. A skipped gate in auto mode
is expected behavior, not a deviation; mixing them buries real deviations in
noise. The @session skill owns the template for this section; this skill
owns its format.

Entry format (append `- (none yet)` → entries):

```markdown
## Gate log
- (none yet)
- [2026-09-02] commit-approval (normal) — skipped (auto): committed 3 groups with inferred messages
- [2026-09-02] research-plan (subagent) — skipped (delegated): ran without re-asking
- [2026-09-02] new-scope (always) — fired: approved ("viz")
```

Fields: date, gate id, class, decision — `fired: <outcome>` /
`skipped (auto | delegated): <auto-resolution taken>` / `failed: <reason>`.
Log mode switches too (`/gate auto` → interactive) so a compacted session
recovers the mode.

Fallback when there is no `.scratch/` workspace: keep the log in working
notes. Runs in auto always end with a "Gates skipped" list in the report. A
skip is never silent.

## Scope and boundaries

Approval gates only, and only in the skills and agents that explicitly
reference this skill. It states no rules about anything else. Verification
steps (tests pass, CI green, review clean, completion checklists) and
interaction gates (teach's quiz pacing) are not approval gates — they are
simply not this skill's subject and do not reference it.

Harness permission rules (agent frontmatter `ask` / `allow` / `deny`) are a
separate layer from gates: a gate is a procedure step that calls the
`question` tool, not a permission prompt. Compare ocv2-findings: depth-2
`ask` *permission* prompts hang, while question-form gates propagate to the
top. Do not try to implement a gate as a frontmatter `ask` rule.
