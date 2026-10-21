---
name: agent-map
description: Pick the installed skill, agent, plugin, command, or CLI for a task, and search outside the install when nothing fits. Inventories everything install.sh deploys (all tags plus bonuses). Use when routing a task, deciding what to load, or asking "is there a tool for X".
---

# Agent Map

Routing only. What is installed, what it is for, and how to search when the
answer is "none of it". The roster below assumes a full install: `install.sh -b
--digest` plus every `tags.conf` tag.

## Pick for the task

1. **Read the skill list.** Every installed skill's name and description is in
   your loaded skill catalog. The narrowest matching skill wins; load it with
   the `skill` tool.
2. **The jev hook advises on every prompt.** When the `hook_skill_pick` feature is
   on, the fazuh.jev plugin asks Jev which skill fits and injects one advisory
   system line (`Jev routing: consider loading skill @…`). Weigh it, load the
   skill if it fits, ignore it when your own reading disagrees.
3. **Check plugins and commands first** — they need no skill load:
   - Mermaid: `mermaid-compile`, `mermaid-doctor` tools; `write_mermaid`,
     `edit_mermaid`, `render_mermaid` and the SVG twins for the authoring loop.
   - Jev: the `hook_skill_pick` picker hook (advises a skill per prompt) and the
     `hook_risk` gate on bash/edit/write, plus `/jev-status`, `/jev-model`,
     `/jev-endpoint`, `/jev-log`. No jev tools exist.
   - `/dispatch <task>` — background subagent, same session. `/aside <q>` —
     fork this session and ask in the fork.
   - `/finish` (end-session workflow), `/gate` (auto/interactive mode),
     `/status-report`, `/imagescan-*` (ten screenshot commands).
4. **Delegation is its own decision.** `@orchestrate` and `@workflows` own
   subagent routing and workflow selection; load them when the task is control,
   tracking, or multi-agent work rather than doing.
5. **Nothing fits?** Go to [Search outward](#search-outward).

## Installed inventory

### Repo skills (`~/.config/opencode/skills`)

**Orchestration** — control, delegate, track, finish agent work:
`orchestrate`, `workflows` (routing table and procedures), `forkflow` (warm
session forks), `session` (spec, context packet, checkpoints in `.scratch/`),
`finish`, `scratch-finish`, `self-improve` (retro and sweep), `long-horizon`
(overnight runs), `offload` (remote machines), `worktree` (branch work),
`pr-to-close`.

**Workflow** — repeatable procedures:
`branch-flow` (main/release lines), `commit` (grouping and messages),
`changelog`, `pr-creator`, `pr-watchmerge`, `issue-closeout`,
`setup-dev-docs`, `deep-research` (one cited findings file),
`learn` (multi-session teaching), `visualize` (one verified visual artifact).

**Dev** — engineering guidelines:
`test-guidelines`, `gui-test-guidelines`, `rust-idioms`, `rust-tea`,
`oop`, `improve-architecture-oop`, `design-tradeoffs`, `logging-guidelines`,
`secrets-argv`, `app-paths`, `commit-scopes`, `readme`, `terse`.

**Utils** — machine and tool helpers:
`pdf-read`, `pdf-write`, `notes` (durable tool notes), `plan-confirm`,
`scheduled-task` (octask/systemd timers), `scheduled-agent` (unattended runs),
`omarchy-plugin-install`.

**Meta** — the agent system itself:
`agent-map` (this skill), `update-fazuh-agent` (pull and redeploy),
`external-skills` (manage upstream skills), `skill-doctor` (skill-graph
drift), `review-agent` (two-axis review).

**Shared** — loaded only when referenced: `global-instruction`,
`post-task`, `prompt-user`, `presenting-latex`, `following-procedures`,
`gate`, `scratch`.

**OpenCode v2**: `opencode-guideline` (the HTTP API, compaction, models,
sessions, plugin authoring, plugin loading).

### External skills (`~/.agents/skills`)

Upstream-owned; install and update through `@external-skills`, never hand-edit.

- **Matt Pocock engineering**: `ask-matt` (which skill fits), `grilling`,
  `grill-me`, `grill-with-docs` (stress-test a plan), `code-review`, `tdd`,
  `implement`, `implement-spec`, `to-spec`, `to-tickets`, `to-questionnaire`,
  `triage`, `wayfinder` (huge-work maps), `handoff`, `retro`, `teach`,
  `wait-what` (re-pitch), `show-me` (visual explanation), `prototype`,
  `improve-codebase-architecture`, `setup-matt-pocock-skills`,
  `domain-modeling`, `codebase-design`.
- **Matt Pocock productivity**: `writing-for-agents`, `pr`, `handoff`,
  `writing-defect-reports`, `keeping-git-repos-clean`,
  `guarding-destructive-operations`, `resolving-merge-conflicts`,
  `concurrent-branches`, `managing-python-releases`, `reproducing-ci-locally`,
  `running-github-actions-efficiently`, `shipping-across-surfaces`,
  `shipping-build-artifacts`, `verifying-external-behavior`,
  `diagnosing-bugs`, `diagnose-crash`, `building-python-mcp-servers`,
  `ci-pipeline-synthesizer`, `find-skills`, `research`.
- **Anti-slop suite** (mandatory-adjacent): `antislop`, `antislop-code`,
  `antislop-copywriting`, `antislop-human`, `antislop-layoutmobile`,
  `antislop-ui`.
- **Docker**: `docker-agent-config`, `docker-agent-deploy`, `docker-agent-run`,
  `docker-build-strategies`, `docker-compose-patterns`,
  `docker-destructive-guardrails`, `docker-project-foundations`,
  `docker-sandboxes-env`, `docker-sandboxes-kits`,
  `docker-sandboxes-lifecycle`, `docker-sandboxes-network-credentials`.
- **Media** (bonus): `ffmpeg-skill` (edit video/audio with ffmpeg),
  `fframes-video` (programmed motion graphics), `manim-composer` (video
  planning), `manimce-best-practices`, `manimgl-best-practices`,
  `mermaid-skill` (mmdc/Kroki diagrams).
- **Other**: `reverse-engineer-anything` (REA, bonus — binaries, managed code,
  browser targets), `security-audit` (bonus), `hindsight-docs` (memory-bank
  docs), `bgrun` (background systemd jobs), `simple-english`,
  `gpui-kit`, `gpui-kit-design-guides` (Rust desktop UI),
  `omarchy` (desktop config), `wizard` (human-in-loop setup),
  `update-pins`, `fazuh-*` machine overlays where present.

### Agents (subagents)

- **primary**: `orchestrator`, `chat`, `autocommit`, `tutor` — conversation,
  delegation, unattended commits, teaching.
- **build**: `implement` — implementation and verification.
- **review**: `review` (standards+spec), `malware-check`, `pii-check`.
- **research**: `research-discovery` (codebase pointers),
  `research-synthesis` (web brief).
- **vision**: `mermaid-maker`, `svg-maker`.
- **document**: `document` — ADRs, runbooks, README, changelog.

Route with the `subagent` tool or `@orchestrate`; subagents report blockers
instead of silently changing scope.

### Plugins

- **mermaid**: compile `.mmd` to PNG/SVG/PDF; validate+render every diagram in
  a file.
- **viz**: the write/edit/render authoring loop for Mermaid and SVG.
- **jev**: automatic Jev decisions — skill-picker hook (advises a skill per
  prompt; criteria optimized once per skill via `/jev-optimize-skills`), risk
  hook (gates bash/edit/write, the only blocking path);
  settings in `jev-state.json`, logs in `jev-calls.jsonl`.
- **dispatch**: `/dispatch` background subagent.
- **aside**: `/aside` fork-and-ask.

### Commands

`/finish`, `/gate`, `/status-report`, `/imagescan-{answer,code,diagram,
handwriting,latex,math,obsidian,ocr,summarize,translate}`.

### CLIs

`bgrun` (background jobs), `octask` (schedules),
`opencode2` (v2 HTTP API), `npx skills` (skill ecosystem), `jegrep` (semantic
grep, needs the jev shim), `imagescan`, `pdf-build`, `skill-graph`,
`mail-digest`/`phone-digest` (opt-in digests), `himalaya-gen-config`.

Optional tools each degrade one skill, never the install: `ffmpeg`
(ffmpeg-skill), `mmdc` (mermaid/visualize/pdf-write), `pandoc`/`pdflatex`/
`xelatex` (pdf-write), `pdftotext`/`pdftoppm`/`pdfinfo` (pdf-read/write),
`rga` (pdf-read), `uv` (pdf-read), `clamscan` (malware-check), `bun` (jev,
pluginhealth), `rsvg-convert` (visualize), `gh` (every PR/issue skill),
`jq` (ocv2, forkflow).

## Search outward

When the inventory above does not cover the task:

1. **`@find-skills`** — the ecosystem search skill. It runs
   `npx skills find <query>`, checks the [skills.sh](https://skills.sh)
   leaderboard, and verifies quality before recommending: prefer 1K+ installs,
   reputable owners (`vercel-labs`, `anthropics`, `microsoft`), 100+ repo
   stars. Install with `npx skills add <owner/repo@skill> -g -y`, or let
   `@external-skills` manage it.
2. **Web** — the `websearch` tool for current facts, `webfetch` to read a URL.
   For a question that needs cited synthesis, spawn the `researcher` or
   `research-synthesis` subagent; for one narrow external fact with a recorded
   answer, `@deep-research`.
3. **None found is a valid answer** — do the task with general capability, or
   author a skill with `npx skills init` (structure per
   `@writing-for-agents`; register it via `@external-skills` or this repo's
   `skills/` tree).

Do not add an MCP server or a dependency for what one of the above covers in a
few lines; reach for new machinery only when the gap is permanent and
recurring.
