---
name: friction-sweep
description: Run the agent self-improvement loop over the Hindsight friction store, sweep open `scope:` entries, draft and apply improvements to your own skills, agent definitions, and tooling per approval tiers. Use when the user says "sweep the backlog", "apply the friction entries", "improve your skills/agents", "anything to improve", or when acting on a filed agent-behavior lesson that outlives the current repo. For end-of-session collect + validate use @self-improve; for proposals use @session-retro; this skill acts on the backlog. NOT for repo-local code sanding (fix it in normal work) or for fixing the user's project source.
---

# Friction sweep

A feedback loop where the agent learns from its own friction: capture
problems while working, then convert them into improvements to skills, agent
definitions, tooling, and process. Proposals arrive here from @session-retro
or direct capture during work (the @global-instruction friction contract);
this skill curates and applies them.

One store: Hindsight, tag-filtered (`type:friction`, `status:open`). A single
bank serves every project and node; entries carry `machine:`/`project:` tags
instead of living in per-repo files.

## Capture rules

- **Who files:** anyone. Bash-capable subagents file directly. Narrow-surface
  agents (document, finish, review, viewers) report friction in their output;
  the orchestrator files it with attribution. File and continue; never stop
  work to log.
- **Scope tag** (required for sweep candidates): `scope:skill`,
  `scope:agent-def`, `scope:tool`, `scope:process`, `scope:new-skill`. Repo
  friction gets `project:<repo>` instead and is fixed in normal work, not here.
- **Quality bar:** the text must carry a proposal seed, not just a complaint:
  what was tried, what got in the way, what would fix it.

## The loop

Run top to bottom when invoked. Do not skip the user gates.

1. **Sweep**: `recall` with a broad query ("friction open backlog"), then keep
   only results whose `tags` include `type:friction`, `status:open`, and a
   `scope:` tag (the server-side tag filter is unreliable, measured
   2026-10-13; tags ride on every result, so filter client-side). Group by
   target artifact (one skill / one agent def / one theme per group). Dedup
   overlapping entries; their `document_id` (`friction-<slug>`) is the handle.
2. **Propose**: per group, draft the concrete change (exact edit or diff).
   Check the target is user-owned before drafting: skills in
   `~/Projects/agent/` (source) or `~/.config/opencode/skills/`
   (personal-global); agent defs in `~/.config/opencode/agents/*.md`.
   External skills under `~/.agents/skills/` are install targets: NEVER
   edit them; file upstream issues instead.

   Present the proposal in three grouped sections before any gate:
   **Content edits** (one table: target → change → cuts closed),
   **Config artifacts** (a separate table, always-gated), and
   **Kept open** (graduated tickets, deferred items, and fixes routed to
   normal work, each with the reason it stays open).
3. **Gate by tier, then apply**: applying is always gated (drafting and
   proposals are free; vocabulary: the @gate skill):
   - Process notes in `.scratch/` and docs → not a gate; apply autonomously.
   - Skill content (`~/Projects/agent`, personal-global skills) → **GATE
     sweep-apply-content (normal → apply the approved diff)**: stage the
     exact diff and get explicit OK before writing it.
   - **Any config artifact** (agent defs, `opencode.json*`, `AGENTS.md`,
     store configs (`*.toml`) → GATE sweep-apply-config (always → never
     skips; propose, get explicit OK, wait)**. No autonomous config edits,
     ever, even "obvious" ones.
   - Project source code → never through this loop; route to normal work.
4. Evidence: when a change rewrites a skill description, review its trigger
   branches against the body and run `skill-doctor`. Trigger accuracy is a
   manual judgment unless the user supplies a dedicated evaluation tool. Body
   and content edits need no formal evidence unless the user asks.
5. **Graduate big trials**: an idea needing real-world trial (new
   workflow, structural skill change) becomes a `.scratch/<date>_<slug>/`
   session ticket instead of a direct edit; adopt or reject from the Outcome
   block afterwards. For non-repo friction the session lives under
   `~/.local/share/fazuh-agent/.scratch/<date>_<slug>/`.
6. **Close the loop**: for each applied or rejected proposal, `retain` the
   entry again with the same `document_id`, same content, and a
   `status:resolved` tag (`update_mode: "upsert"`), appending the outcome to
   the content (`adopted: <what landed>` / `rejected: <why>`). Rejections
   must record the reason.
7. **Validate**: load the @skill-doctor skill and run it over every
   affected skill root; require a clean report (no broken links, stale refs,
   collisions, drift) before reporting done.

## Rules

- Capture is cheap and immediate; curation happens at sweep time.
- Never widen a narrow agent surface (docs-only, git-only, read-only) so it
  can file friction: attribution-through-report exists for that.
- Every adopted change names its evidence or names itself a judgment call;
  both are fine, silence is not.
