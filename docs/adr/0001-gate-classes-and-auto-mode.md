# ADR 0001 — Gate classes and the `auto` run mode

- Status: accepted (2026-09-02)
- Scope: agent-facing skill/agent conventions (`skills/referential/gate/`, retrofit sites)

## Context

Approval gates were hand-rolled at a dozen sites, each re-explaining its own
skip conditions in its own words ("never file without explicit approval",
"do not skip the user gates", "permission active when the argument begins
with `auto`"). There was no shared vocabulary, no rule for when a gate may
be skipped, and only `/finish` had a pre-approved path. OpenCode question
forms propagate up to the user even from subagents, so any agent can gate;
headless runs auto-dismiss those forms, so gated actions do not happen
there unless the run is configured for it.

## Decision

1. **One vocabulary, one skill.** `skills/referential/gate/` defines run
   modes (`interactive` / `auto`), gate classes, the one-line `GATE`
   tag convention, and the gate-log format. Skills declare gates as tags;
   they no longer restate skip mechanics. The skill is loaded only where
   referenced — it makes no global claims.

2. **Three gate classes**, each with exactly one skip trigger:
   - `always` — irreversible/destructive/global/convention-changing. Never
     skipped, not even in auto.
   - `normal` — skip in auto (and only in auto).
   - `subagent` — additionally skips when executing as a subagent, because
     the spawning context already holds the decision. Kept separate from
     `normal` on purpose: folding it in either makes `normal` gates
     silently auto-resolve inside subagents (unsafe), or loses the
     delegation-implied case, or re-creates the ad-hoc runtime notes this
     vocabulary replaces.

3. **Auto comes only from the user**: a command argument (`/finish auto`),
   the `/gate` command mid-session (carried into every delegation prompt as
   `RUN MODE: …`), or instructions baked into an unattended agent. Agents
   never self-grant. Unconfigured headless runs are a user configuration
   problem, not something the skill detects.

4. **Every gate declares its auto-resolution** — the concrete action
   "proceed" means when the gate skips. A gate tag without one is invalid.

5. **Gates log to a dedicated `## Gate log`** section in the session
   workspace's `spec.md`, separate from the deviation log: a gate skipped
   in auto is expected behavior, not a deviation. Runs in auto end with a
   "Gates skipped" list; a skip is never silent.

## Consequences

- Existing gate sites were retrofitted to tags (finish, session-retro,
  papercut-sweep tiers, research/deep-research, pr-creator,
  worktree-finish, commit-scopes). Verification gates (tests, CI,
  completion checklists) and interaction gates (teach quizzes) are not
  approval gates and stay untouched.
- `subagent` currently has one user (research-plan). If it stays
  single-site, demoting the class is the recorded escape hatch.
- Future extension candidates, deliberately deferred: scoped auto,
  skip budgets, a gate registry linted by skill-doctor.
