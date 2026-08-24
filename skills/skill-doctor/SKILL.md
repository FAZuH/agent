---
name: skill-doctor
description: Investigate, validate, and fix relations between skills and agent definitions across all skill roots - builds a deterministic relation graph (loads/routes/documents edges), detects broken links, stale references to renamed skills, name collisions across roots, and drift between the source skills repo and installed copies. Use when the user mentions skill-doctor, asks to check skill relations/graph, validate skills, audit the skill graph, or reports broken links between skills, stale references, renamed skills, collisions, or drift between source repo and installed skills.
---

## Purpose

Investigate, validate, and fix how skills relate to each other and to agent
definitions. The scanner (`scripts/build_graph.py`) reads four sources:

- Skill roots, later-wins on duplicate ids: `~/.agents/skills` (installed),
  `~/.config/opencode/skills` (config), `~/Projects/skills/skills` (source repo).
- Agent definitions: `~/.config/opencode/agents/*.md`.
- Documented references: `~/.config/opencode/AGENTS.md`.

OpenCode v2 discovers skills in: built-ins < `.claude` < `.agents` < `config`
(`~/.config/opencode/skills`) < project `.opencode` < explicit skills-config;
later locations win (see https://opencode.ai/docs/skills/). Among *installed*
roots that means config shadows agents; the repo root is source-only and never
loaded directly.

Outputs on every run:

- `~/.config/opencode/skill-doctor/graph.mmd` — full regeneration; mermaid
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
`~/.config/opencode/skills` and `~/Projects/skills/skills`.

## Procedure

1. Run the doctor from the skill base dir and append history:

   ```bash
   cd ~/.config/opencode/skills/skill-doctor
   python3 scripts/build_graph.py | tee -a ~/.config/opencode/skill-doctor/findings.jsonl
   ```

2. Triage findings by class: `broken-ref` (stale rename or reference to
   something that does not exist), `collision` (same id in multiple active
   roots), `drift` (repo source differs from installed copy).
3. Fix by class — **propose the exact edit first, apply only after the user
   approves. Nothing under `~/.config/opencode/` or any skill file is edited
   without an explicit OK for that specific change:**
   - **Stale-name retarget** — propose retargeting the reference in OWNED
     roots only (`~/.config/opencode/skills`, `~/Projects/skills/skills`);
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
5. Optional: render `graph.mmd` via the `fazuh-diagrams` tooling.

## Common commands

```bash
# Run the doctor and append to history
cd ~/.config/opencode/skills/skill-doctor && python3 scripts/build_graph.py | tee -a ~/.config/opencode/skill-doctor/findings.jsonl

# Summary counts only (first JSONL line)
python3 scripts/build_graph.py | head -1

# High-severity findings only
python3 scripts/build_graph.py | grep '"severity":"high"'

# Noise suppressions live here ([noise] tokens; keep one comment line per group)
$EDITOR ignore.toml

# File friction whose fix lives outside this repo
papercuts -g add --tag self::skill "gui-test-guidelines references test-writing-guidelines, a name that no longer exists (renamed to test-guidelines)"
papercuts -g list --tag self::skill --status open
papercuts -g resolve pc_abc1234 --note "created local agent defs"

# Reinstall a drifted/stale skill from the source repo (verified via `npx skills --help`:
# package = owner/repo, pick the skill with -s/--skill, -g installs globally)
npx skills add fazuh/skills -g -s session
```

## Rules

- Every run appends history: `findings.jsonl` is append-only, never truncate.
- Suppressions need justification comments in `ignore.toml`; no bare token lists.
- Never widen scope to project repos' `.opencode/` dirs unless asked.
