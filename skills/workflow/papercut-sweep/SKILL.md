---
name: papercut-sweep
description: Run the agent self-improvement loop over the global papercuts store — file cross-project friction about skills/agents/tools (`papercuts -g add --tag self::…`), sweep open `self::` entries, draft and apply improvements to your own skills, agent definitions, and tooling per approval tiers. Use when the user says "self-improve", "improve your skills/agents", "anything to improve", "sweep the backlog", or when filing an agent-behavior lesson that outlives the current repo. For end-of-session proposals use @session-retro; this skill acts on the backlog. NOT for repo-local code sanding (plain `papercuts add`) or for fixing the user's project source.
---

# Papercut sweep

A feedback loop where the agent learns from its own friction: capture
problems while working, then periodically convert them into concrete
improvements to skills, agent definitions, tooling, and process.
Proposals typically arrive here from @session-retro (end-of-session)
or direct capture during work; this skill curates and applies them.

Two stores, one rule:

- **Repo-local** `.papercuts.jsonl` (plain `papercuts add`) — friction whose
  fix lives inside the current repo.
- **Global** `papercuts -g …` — friction whose fix lives outside any one
  repo: skills, agent defs, opencode config, tools, your own behavior.
  Store: `<data_dir>/papercuts/log.jsonl`; `-g` conflicts with `--file` and
  beats `PAPERCUTS_FILE`.

## Capture rules

- **Who files:** anyone. Bash-capable subagents file directly under
  `--agent <their-name>`. Narrow-surface agents (document, finish, review,
  viewers) report friction in their output; the orchestrator files it with
  attribution. File and continue — never stop work to log.
- **Tag namespace** (reserved prefix `self::`): `self::skill`,
  `self::agent-def`, `self::tool`, `self::process`. Extra free-form tags are
  welcome; sweeps filter on the `self::` prefix.
- **Quality bar:** the text must carry a proposal seed, not just a complaint
  — what was tried, what got in the way, what would fix it.

## The loop

Run top to bottom when invoked. Do not skip the user gates.

1. **Sweep** — `papercuts -g list --status open` and group the `self::`
   entries by target artifact (one skill / one agent def / one theme per
   group). Dedup overlapping entries.
2. **Propose** — per group, draft the concrete change (exact edit or diff).
   Check the target is user-owned before drafting: skills in
   `~/Projects/agent/` (source) or `~/.config/opencode/skills/`
   (personal-global); agent defs in `~/.config/opencode/agents/*.md`.
   External skills under `~/.agents/skills/` are install targets — NEVER
   edit them; file upstream issues instead.
3. **Gate by tier**, then apply — applying is always gated (drafting and
   proposals are free; vocabulary: the @gate skill):
   - Process notes in `.scratch/` and docs → not a gate; apply autonomously.
   - Skill content (`~/Projects/agent`, personal-global skills) → **GATE
     sweep-apply-content (normal → apply the approved diff)**: stage the
     exact diff and get explicit OK before writing it.
   - **Any config artifact — agent defs, `opencode.json*`, `AGENTS.md`,
     store configs (`*.toml`) → GATE sweep-apply-config (always → never
     skips; propose, get explicit OK, wait)**. No autonomous config edits,
     ever, even "obvious" ones.
   - Project source code → never through this loop; route to normal work.
4. **Evidence** — when a change rewrites a skill *description*, OFFER to
     validate with the opencode-skill-creator eval tooling
     (`skill_eval`); do not run evals unprompted. Body/content edits need
     no formal evidence unless the user asks.
5. **Graduate big trials** — an idea needing real-world trial (new
   workflow, structural skill change) becomes a `.scratch/<date>_<slug>/`
   session ticket instead of a direct edit; adopt or reject from the
   Outcome block afterwards. For this global loop the session lives under
   the global store's `.scratch/` — `<data_dir>/papercuts/.scratch/<date>_<slug>/`
   (typically `~/.local/share/papercuts/.scratch/...`), not the repo's `.scratch/`.
6. **Close the loop** — for each applied or rejected proposal:
   `papercuts -g resolve <id> --note "adopted: <what landed>"` or
   `--note "rejected: <why>"`. Rejections must record the reason.
7. **Validate** — load the @skill-doctor skill and run it over every
   affected skill root; require a clean report (no broken links, stale refs,
   collisions, drift) before reporting done.

## Common commands

```bash
# File a self-improvement entry (global store)
papercuts -g add --tag self::skill \
  "implement.md says delegate to test subagents but subagent_depth blocks nested spawns at runtime"

# Severity + multiple tags
papercuts -g add --severity major --tag self::agent-def --tag v2-permissions \
  "document.md legacy permission map: root CONTEXT.md edits denied despite '**/*.md': allow"

# Attribute friction reported by a subagent
papercuts -g add --agent test "test agent could not spawn dev-server; ran gates inline instead"

# Sweep candidates
papercuts -g list --tag self::skill --status open
papercuts -g list --status open --format md      # all open, human-readable
papercuts -g list --status all --since 30d       # recent history

# Close the loop
papercuts -g resolve pc_abc1234 --note "adopted: rewrote frontmatter to V2 permissions array"
papercuts -g resolve pc_def5678 --note "rejected: papercuts stays a log; no workflow states"

# Repo-local sanding (NOT global — fix belongs to this repo)
papercuts add "rg -rn silently treats pattern as replace; use rg -n"
```

## Rules

- Capture is cheap and immediate; curation happens at sweep time.
- Never widen a narrow agent surface (docs-only, git-only, read-only) so it
  can file papercuts — attribution-through-report exists for that.
- Every adopted change names its evidence or names itself a judgment call;
  both are fine, silence is not.
