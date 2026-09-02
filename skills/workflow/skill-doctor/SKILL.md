---
name: skill-doctor
description: Investigate, validate, and fix relations between skills and agent definitions across all skill roots - builds a deterministic relation graph (loads/routes/documents edges), detects broken links, stale references to renamed skills, name collisions across roots, and drift between the source skills repo and installed copies. Use when the user mentions skill-doctor, asks to check skill relations/graph, validate skills, audit the skill graph, or reports broken links between skills, stale references, renamed skills, collisions, or drift between source repo and installed skills.
---

## Purpose

Investigate, validate, and fix how skills relate to each other and to agent
definitions. The scanner (`scripts/build_graph.py`) reads three sources:

- Skill roots, later-wins on duplicate ids: `~/.agents/skills` (installed),
  `~/.config/opencode/skills` (config), `~/Projects/agent/skills` (source repo, in
  category subdirs; copies are pushed into the config root by the repo's sync.sh).
- Agent definitions: `~/.config/opencode/agents/*.md`.
- Documented references: `~/.config/opencode/AGENTS.md`.

From each SKILL.md body it extracts two reference forms:

- `@name` — the canonical skill/agent invocation form. Every at-mention
  must resolve to a skill id or an agent definition; anything else is a
  `broken-ref` finding (high). There is no suppression list — a reference to
  something that does not exist is always reported.
- Backticked spans that exactly match an agent id — subagent delegation,
  recorded as `routes` edges. Other backticked prose tokens are ambiguous by
  design and produce nothing.

OpenCode v2 discovers skills in: built-ins < `.claude` < `.agents` < `config`
(`~/.config/opencode/skills`) < project `.opencode` < explicit skills-config;
later locations win (see https://opencode.ai/docs/skills/). Among *installed*
roots that means config shadows agents; the repo root is source-only and never
loaded directly.

State lives under the XDG data home (never in the config dir):

- `$XDG_DATA_HOME/skill-doctor/graph.mmd` (default `~/.local/share/skill-doctor/graph.mmd`) — full regeneration; mermaid
  flowchart LR, one subgraph per root plus an agent-defs subgraph. The header
  comments define the legend; keep them true if you ever touch generation.
- stdout — JSONL: first a run-summary line
  `{skills,agents,edges,broken,collisions,drift}`, then one line per finding
  `{ts,check,severity,item,detail}` with checks `broken-ref` (high),
  `collision` (medium), `drift` (medium).

## THE HARD RULE

**NEVER create, edit, or delete anything under `~/.agents/skills` or
`~/.claude/skills`.** They are install targets only — even for one-line fixes,
even when a file is obviously wrong, even when the fix is trivial. If a fix
belongs there: propose the change upstream in the source repo AND file
`papercuts -g add --tag self::skill "..."`, or hand the user the reinstall
command so their tooling rewrites the copy. Owned roots you may edit directly:
`~/.config/opencode/skills` and `~/Projects/agent/skills`.

## Procedure

1. Run the doctor from the skill base dir and append history:

   ```bash
   cd ~/.config/opencode/skills/skill-doctor   # installed (config) base dir of this skill
   mkdir -p ${XDG_DATA_HOME:-$HOME/.local/share}/skill-doctor && python3 scripts/build_graph.py | tee -a ${XDG_DATA_HOME:-$HOME/.local/share}/skill-doctor/findings.jsonl
   ```

2. Triage findings by class: `broken-ref` (stale rename or reference to
   something that does not exist), `collision` (same id in multiple active
   roots), `drift` (repo source differs from installed copy).
3. Fix by class.

   **GATE fix-approval (normal → apply the proposed edit in owned roots
   only, then reinstall):** each fix class proposes the exact edit first
   and applies it only after the user approves that specific change. Nothing
   under `~/.config/opencode/` or any skill file is edited without an
   explicit OK. Owned only: `~/.config/opencode/skills`,
   `~/Projects/agent/skills`; never touch install targets. (Vocabulary: the
   @gate skill.)

   - **Stale-name retarget** — propose retargeting the reference in OWNED
     roots only (`~/.config/opencode/skills`, `~/Projects/agent/skills`);
     apply after OK; then reinstall.
   - **Missing subagent** (routes to a nonexistent agent def) — report to the
     user and file a `papercuts -g` entry; do not invent agent definitions.
   - **Collision** — document the winner (config over agents), propose removing
     the loser copy only in owned roots; never touch install targets.
   - **Drift repo-vs-installed** — give the user the reinstall command below.
     NEVER hand-sync files between repo and install targets.
4. Regenerate `graph.mmd`, then append disposition records to
   `findings.jsonl`: keep the original finding line untouched and add a new
   line merging `{"disposition":"proposed-fix|reported|documented|upstream|user-action","note":"..."}`
   into a copy of it.
5. Optional: render `graph.mmd` via the `creating-mermaid-diagrams` skill (`~/.agents/skills/creating-mermaid-diagrams`, source `Agents365-ai/365-skills`).

## Common commands

```bash
# Run the doctor and append to history
cd ~/.config/opencode/skills/skill-doctor   # installed (config) base dir of this skill && mkdir -p ${XDG_DATA_HOME:-$HOME/.local/share}/skill-doctor && python3 scripts/build_graph.py | tee -a ${XDG_DATA_HOME:-$HOME/.local/share}/skill-doctor/findings.jsonl

# Summary counts only (first JSONL line)
python3 scripts/build_graph.py | head -1

# High-severity findings only
python3 scripts/build_graph.py | grep '"severity":"high"'

# There is no suppression list — an unresolvable @-mention is a real finding.
# To silence one, fix the reference or install the target.

# File friction whose fix lives outside this repo
papercuts -g add --tag self::skill "gui-test-guidelines references test-writing-guidelines, a name that no longer exists (renamed to test-guidelines)"
papercuts -g list --tag self::skill --status open
papercuts -g resolve pc_abc1234 --note "created local agent defs"

# Repo changes need a push — global installs are copies, not symlinks:
~/Projects/agent/sync.sh push -g
```

## Rules

- Every run appends history: `findings.jsonl` is append-only, never truncate.
- @-mentions are canonical: an unresolvable @-mention is a real finding — fix
  the reference or install the target; never re-add a suppression file.
- Never widen scope to project repos' `.opencode/` dirs unless asked.
