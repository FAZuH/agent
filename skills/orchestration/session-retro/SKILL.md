---
name: session-retro
description: End-of-session retrospective where the agent proposes improvements to its own skills, agent definitions, and tooling — global and repo-local (project AGENTS.md, repo agents/plugins) — and proposes new skills when warranted, and gates filing. Use when the user asks for a retro/retrospective, "how did this session go", "what did we learn", "propose improvements", or when wrapping up a session and capturing lessons before finishing. Proposes papercuts but files them only after explicit user approval — it does NOT auto-file and does NOT apply fixes (that is @papercut-sweep) and does NOT touch repo-local code sanding.
---

# Session retro

Look back at the finished (or finishing) session and convert what happened
into concrete, filed proposals for improving your own skills, agent
definitions, tooling, and process. This skill only proposes; application
belongs to @papercut-sweep.

Always follow the rules in the *Rules* section at the bottom.

## When

- At session wrap-up — typically just before @finish or after the last
  commit lands.
- Any time the user calls for a retro mid-session.
- Especially valuable right before `/compact` or session end, while
  context is still fresh.

## 1. Mine the session and its config

Walk back through the conversation, then through the config it ran under, and
look for five things:

1. **Friction hit** — tool fights, dead ends, permission denials,
   workarounds used silently, retries that should not have been needed.
2. **Repeated corrections** — instructions or prompts the user had to give
   twice; conventions that had to be re-explained; wrong assumptions made.
3. **Skill/workflow gaps** — missing guidance, wrong skill routed, stale
   docs, a procedure step that did not survive contact with reality.
4. **Gold-standard wins** — something that went unusually well and is worth
   encoding as standing practice, not just luck.
5. **New-skill candidate** — improvised multi-step workflow (3+ steps) worth
   extracting as a new skill. High bar, do not force: it must be reusable
   across sessions/repos, not covered by any existing skill in
   `available_skills`, with transcript evidence (what was done, trigger
   phrases, inputs/outputs). If none meets the bar, state `No new-skill
   candidate.` and move on — that is a valid outcome.

Mine both config levels, so a finding lands on the surface that can actually
hold it:

- **Global**: `~/.config/opencode/{skills,agents,plugins}`, `opencode.json`.
- **Repo-local**: the repository's own agent configuration — `AGENTS.md` /
  `CLAUDE.md`, the repo's `agents/`, `skills/` and `plugins/`, its project
  `opencode.json`, `.opencode/`, and `docs/dev/*`.

A lesson that only holds in this repo belongs in its `AGENTS.md` or repo
skill; a general one belongs on a global surface. Re-read the repo-local files
before proposing — a fix already documented there is a no-op finding, and a
missing one is the cheapest proposal you can file.

## 2. Propose (do not file yet)

For each finding, **draft** one entry but do not call `papercuts` yet:

- For global scope (a global skill, agent def, plugin or `opencode.json`): `papercuts -g add --tag self::<namespace> "<friction observed > proposed fix>"`
- For repo/project scope (the fix lands in this repo — its `AGENTS.md`, `agents/`, `plugins/` or code): `papercuts add --tag self::<namespace> "<friction observed > proposed fix>"` — no `-g`

Use `-g` only for global scope.

- Namespaces: `self::skill`, `self::agent-def`, `self::tool`,
  `self::process`, `self::new-skill`. Add free-form tags when a theme helps sweeps group.
- The text must carry a proposal seed: what was tried, what got in the way,
  what would fix it. A bare complaint fails the bar.
- For `self::new-skill` candidates the text must carry: working name,
  trigger (when it should fire), what the skill would do end-to-end, and
  evidence (transcript excerpt + steps). Format:
  `new-skill <working-name>: <trigger when> > <what it would do> > evidence: <excerpt>`.
  `@papercut-sweep` picks these up by the `self::` prefix. Creation requires
  `writing-for-agents` and a separate implementation session after explicit
  user approval, never here.
- One finding per entry; overlapping findings get separate entries so the
  sweep can dedup.

## 3. Gate — ask before filing

**GATE papercut-file (normal → file all drafted proposals):** filing a
papercut to a store requires user approval (filing is cheap and reversible;
*applying* what was filed is a separate, still-gated decision owned by
@papercut-sweep). (Vocabulary: the @gate skill.) Do not file immediately. Present the drafts and gate with
the user:

1. Render a compact **proposal** table (no `id` yet — nothing filed):

   | # | tag | scope | proposal | actionable now? |

   `#` is a stable 1..N in filing order. `scope` is `global` (`-g`) or `local`.

2. Call `default.question` to gate. Ask which proposals to file. Include
   options for "File all", "Pick individually" (multi-select of #s), and "File
   none". Example:

   ```
   default.question [{
     header: "File papercuts?",
     question: "Found N proposals. Which should be filed to papercuts?",
     options: [
       {label: "File all", description: "File every proposal above"},
       {label: "Pick individually", description: "Choose #s to file"},
       {label: "File none", description: "Keep as discussion only, file nothing"}
     ]
   }]
   ```

   If the user picks "Pick individually", follow up with a multi-select
   question listing each # + proposal summary.

3. Only after an explicit answer, file the approved subset and nothing else.
   If the user says "none" or does not approve, file nothing and report that.

## 4. File only approved and present

For each approved proposal, run the corresponding `papercuts` command and
collect its `id`. Then report a compact **filed** table:

| # | id | tag | proposal | actionable now? |

- `#` is the same number from the proposal table — keep it stable.
- Keep the `id` column: it is the store handle used for
  `papercuts resolve` once the user approves application via @papercut-sweep.
- Mark which entries look immediately actionable versus needing thought.
- When the user later says "apply papercut <N>" or "fix <N>", map N back to
  that row's `id` from this table before touching the store.
- If nothing was approved, state "No papercuts filed — proposals remain as discussion only."

## Boundary

- **Propose and gate.** The GATE papercut-file tag above binds: never file a
  papercut without explicit user approval in this session, and never edit
  skills, agent defs, or config from this skill. Never auto-create a new
  skill here. If the user wants to pursue a `self::new-skill` candidate after
  filing, start a separate skill-authoring session with `writing-for-agents`.
  If the user wants immediate application after filing, hand off explicitly
  to @papercut-sweep.
- **Scope decides store.** Global scope → global store (`-g`); repo/project scope → local store (no `-g`). Do not use `-g` for repo-local fixes.

## Rules

- Filing requires the step-3 user approval (GATE papercut-file, `normal`
  gate — skips only in auto mode; vocabulary: @gate).
- In a restricted/read-only agent (e.g. Plan mode): keep the deviation log
  in working notes, defer filing to a write-capable mode, and state the
  deferral in the report.

## Dependency graph

- step1
- step2 -> step1
- step3 -> step2
- step4 -> step3
