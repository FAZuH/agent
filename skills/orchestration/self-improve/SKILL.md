---
name: self-improve
description: >-
  Run the agent self-improvement loop: mine the session, propose and gate
  friction entries, validate with skill-doctor, then sweep the backlog and
  apply approved improvements. Use when the user says "self-improve", "a
  retro/doctor check", "what is in the improvement backlog", "how did this
  session go", "what did we learn", "capturing lessons before finishing",
  "sweep the backlog", "apply the friction entries", "improve your
  skills/agents", "anything to improve", or wants to act on a filed
  agent-behavior lesson.
---

# Self-improve

Run the collect + validate check, then offer the sweep. This skill collects
proposals and validates them; the friction loop below applies what the user
approves.

> **Load @following-procedures skill first.** It owns procedure narration,
> deviation logging, post-run report.

Follow the *Rules* section below.

1. **Collect, gated.** Mine the session (§1), draft the proposals (§2), gate
   them (§3), file the approved subset (§4).
2. **Validate, @skill-doctor.** Load the @skill-doctor skill and follow its
   Procedure §1 from the skill's base dir:

   ```bash
   cd ~/.config/opencode/skills/skill-doctor
   mkdir -p ${XDG_DATA_HOME:-$HOME/.local/share}/skill-doctor \
     && python3 scripts/build_graph.py | tee -a ${XDG_DATA_HOME:-$HOME/.local/share}/skill-doctor/findings.jsonl
   ```

   Report the run-summary line (`skills, agents, edges, broken, collisions,
   drift`). A `broken` or `drift` finding is a follow-up; the Rules section
   says why this skill does not fix it.
3. **Offer the sweep, do not run it.** **GATE offer-sweep (normal → do
   not run the sweep; note its availability in the report):** running the
   friction loop is additional work offered, never auto-run. In auto mode
   this gate skips, so just report the backlog line instead of asking. If
   §4 filed any friction entries, or @skill-doctor reported
   `broken`/`drift`, or a `recall` (query "friction open backlog") surfaces
   `type:friction` + `status:open` + `scope:` entries, tell the user:

   > Self-improvement backlog ready: `N` friction entries filed this session, `M`
   > open total, doctor `broken X / drift Y`. Run the friction loop now? [y/N]

   Do not run the friction loop without an explicit "yes". If the user says
   no, leave the backlog for a later sweep.

## 1. Mine the session and its config

Walk back through the conversation, then the config it ran under, and look for
five things:

1. **Friction hit**: tool fights, dead ends, permission denials, silent
   workarounds, retries that should not have been needed.
2. **Repeated corrections**: instructions the user gave twice; conventions
   re-explained; wrong assumptions made.
3. **Skill/workflow gaps**: missing guidance, wrong skill routed, stale docs,
   a procedure step that did not survive contact with reality.
4. **Gold-standard wins**: something unusually good, worth encoding as
   standing practice.
5. **New-skill candidate**: improvised multi-step workflow (3+ steps) worth
   extracting as a new skill. High bar, do not force: reusable across
   sessions/repos, not covered by any existing skill in `available_skills`,
   with transcript evidence (what was done, trigger phrases, inputs/outputs).
   None qualifies: state `No new-skill candidate.` and move on. That is a
   valid outcome.

Mine both config levels, so a finding lands on the surface that can hold it:

- **Global**: `~/.config/opencode/{skills,agents,plugins}`, `opencode.json`.
- **Repo-local**: the repository's own agent configuration: `AGENTS.md` /
  `CLAUDE.md`, the repo's `agents/`, `skills/` and `plugins/`, its project
  `opencode.json`, `.opencode/`, and `docs/dev/*`.

A lesson that only holds in this repo belongs in its `AGENTS.md` or repo
skill; a general one belongs on a global surface. Re-read the repo-local files
before proposing: a fix already documented there is a no-op finding, and a
missing one is the cheapest proposal you can file.

## 2. Propose (do not file yet)

For each finding, **draft** one entry but do not `retain` yet: one entry = one
`retain` with the @global-instruction friction tags:

- Content: `<friction observed > proposed fix>`, one or two sentences.
- `document_id: "friction-<short-slug>"` (stable; the resolve handle).
- Tags: `type:friction`, `severity:minor|major|blocker`, `status:open`,
  `machine:<hostname>`; scope tag by fix location:
  `scope:skill|agent-def|tool|process|new-skill` when the fix outlives one
  repo, `project:<repo>` when it lands in this repo only.
- The text must carry a proposal seed: what was tried, what got in the way,
  what would fix it. A bare complaint fails the bar.
- For `scope:new-skill` candidates the text must carry: working name,
  trigger (when it should fire), what the skill would do end-to-end, and
  evidence (transcript excerpt + steps). Format:
  `new-skill <working-name>: <trigger when> > <what it would do> > evidence: <excerpt>`.
  The friction loop picks these up by the scope tag. Creation requires
  `writing-for-agents` and a separate implementation session after explicit
  user approval, never here.
- One finding per entry; overlapping findings get separate entries so the
  sweep can dedup.

## 3. Gate, ask before filing

**GATE friction-file (normal → retain all drafted proposals):** filing to
Hindsight requires user approval (filing is cheap and reversible; *applying*
what was filed is a separate, still-gated decision owned by the friction
loop). (Vocabulary: the @gate skill.) Do not file immediately. Present the
drafts and gate with the user:

1. Render a compact **proposal** table (nothing filed yet):

   | # | scope | proposal | actionable now? |

   `#` is a stable 1..N in filing order. `scope` is the `scope:`/`project:`
   tag the entry will carry.

2. Call `default.question` to gate. Ask which proposals to file. Include
   options for "File all", "Pick individually" (multi-select of #s), and "File
   none". Example:

   ```
   default.question [{
     header: "File friction entries?",
     question: "Found N proposals. Which should be retained to Hindsight?",
     options: [
       {label: "File all", description: "File every proposal above"},
       {label: "Pick individually", description: "Choose #s to file"},
       {label: "File none", description: "Keep as discussion only, file nothing"}
     ]
   }]
   ```

   If the user picks "Pick individually", follow up with a multi-select
   question listing each # + proposal summary.

3. Only after an explicit answer, retain the approved subset and nothing else.
   If the user says "none" or does not approve, file nothing and report that.

## 4. File only approved and present

For each approved proposal, `retain` it with its tags and `document_id` (the
operation is async: poll `get_operation` to confirm before reporting filed).
Then report a compact **filed** table:

| # | document_id | scope | proposal | actionable now? |

- `#` is the same number from the proposal table, keep it stable.
- Keep the `document_id` column: the store handle for the `status:resolved`
  upsert once the user approves application via the friction loop.
- Mark which entries look immediately actionable versus needing thought.
- When the user later says "apply friction <N>" or "fix <N>", map N back to
  that row's `document_id` before touching the store.
- If nothing was approved, state "No friction entries filed, proposals remain
  as discussion only."

## The friction loop

A feedback loop where the agent learns from its own friction: capture problems
while working, then convert them into improvements to skills, agent
definitions, tooling, and process. Proposals arrive from §1 to §4 or direct
capture (the @global-instruction friction contract); this section curates and
applies them.

One store: Hindsight, tag-filtered (`type:friction`, `status:open`). A single
bank serves every project and node; entries carry `machine:`/`project:` tags
instead of living in per-repo files.

### Capture rules

- **Who files:** anyone. Bash-capable subagents file directly. Narrow-surface
  agents (document, finish, review, viewers) report friction in their output;
  the orchestrator files it with attribution. File and continue; never stop
  work to log.
- **Scope tag** (required for sweep candidates): `scope:skill`,
  `scope:agent-def`, `scope:tool`, `scope:process`, `scope:new-skill`. Repo
  friction gets `project:<repo>` instead and is fixed in normal work, not here.
- **Quality bar:** the entry carries a proposal seed, not a bare complaint
  (§2).

### The loop

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
   External skills under `~/.agents/skills/` are install targets: NEVER edit
   them; file upstream issues instead.

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
5. **Graduate big trials**: an idea needing real-world trial (new workflow,
   structural skill change) becomes a `.scratch/<date>_<slug>/` session
   ticket instead of a direct edit; adopt or reject from the Outcome block
   afterwards. For non-repo friction the session lives under
   `~/.local/share/fazuh-agent/.scratch/<date>_<slug>/`.
6. **Close the loop**: for each applied or rejected proposal, `retain` the
   entry again with the same `document_id`, same content, and a
   `status:resolved` tag (`update_mode: "upsert"`), appending the outcome to
   the content (`adopted: <what landed>` / `rejected: <why>`). Rejections
   must record the reason.
7. **Validate**: load the @skill-doctor skill and run it over every affected
   skill root; require a clean report (no broken links, stale refs,
   collisions, drift) before reporting done.

## Rules

- Never edit skills, agent definitions, or config here; never apply fixes.
  Application belongs to the friction loop. New skills need a separate
  `writing-for-agents` workflow after explicit approval.
- Filing requires the step-3 user approval (GATE friction-file, a `normal`
  gate that skips only in auto mode; vocabulary: @gate). Never auto-create a
  new skill here: a `scope:new-skill` candidate needs a separate
  skill-authoring session with `writing-for-agents`.
- Both gates (`friction-file` in §3, `offer-sweep` in step 3) are `normal`
  gates: explicit user approval required; they skip only in auto mode
  (vocabulary: @gate).
- In a restricted/read-only agent (e.g. Plan mode): keep the deviation log
  in working notes, run diagnostics without persistence (skip the `tee -a`
  append), defer filing to a write-capable mode, and state all of it in the
  run report.
- One store, one bank: every entry carries the friction tags; scope decides
  what the sweep does with it, not where it lives.
- Capture is cheap and immediate; curation happens at sweep time.
- Never widen a narrow agent surface (docs-only, git-only, read-only) so it can
  file friction: attribution-through-report exists for that.
- Every adopted change names its evidence or names itself a judgment call;
  both are fine, silence is not.
- Not for repo-local code sanding (fix it in normal work) or for fixing the
  user's project source.
- Proposes friction entries but retains them only after explicit user
  approval; it never applies fixes without a separate, still-gated decision.

## Dependency graph

- step1
- step2 -> step1
- step3 -> step2
- step4 -> step3
- validate -> step1, step4
- offer-sweep -> validate, step4
- sweep -> offer-sweep
