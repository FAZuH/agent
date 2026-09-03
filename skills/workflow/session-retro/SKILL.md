---
name: session-retro
description: End-of-session retrospective where the agent proposes improvements to its own skills, agent definitions, and tooling and proposes new skills when warranted, and gates filing. Use when the user asks for a retro/retrospective, "how did this session go", "what did we learn", "propose improvements", or when wrapping up a session and capturing lessons before finishing. Proposes papercuts but files them only after explicit user approval — it does NOT auto-file and does NOT apply fixes (that is @papercut-sweep) and does NOT touch repo-local code sanding.
---

# Session retro

Look back at the finished (or finishing) session and convert what happened
into concrete, filed proposals for improving your own skills, agent
definitions, tooling, and process. This skill only proposes; application
belongs to @papercut-sweep.

## When

- At session wrap-up — typically just before @finish or after the last
  commit lands.
- Any time the user calls for a retro mid-session.
- Especially valuable right before `/compact` or session end, while
  context is still fresh.

## Mine the session

Walk back through the conversation and look for five things:

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

## Propose (do not file yet)

For each finding, **draft** one entry but do not call `papercuts` yet:

- For global scope (global skills/tools/agents): `papercuts -g add --tag self::<namespace> "<friction observed > proposed fix>"`
- For repo/project scope (fix lives inside the current repo): `papercuts add --tag self::<namespace> "<friction observed > proposed fix>"` — no `-g`

Use `-g` only for global scope.

- Namespaces: `self::skill`, `self::agent-def`, `self::tool`,
  `self::process`, `self::new-skill`. Add free-form tags when a theme helps sweeps group.
- The text must carry a proposal seed: what was tried, what got in the way,
  what would fix it. A bare complaint fails the bar.
- For `self::new-skill` candidates the text must carry: working name,
  trigger (when it should fire), what the skill would do end-to-end, and
  evidence (transcript excerpt + steps). Format:
  `new-skill <working-name>: <trigger when> > <what it would do> > evidence: <excerpt>`.
  `@papercut-sweep` picks these up by the `self::` prefix; creation itself
  belongs to @opencode-skill-creator after explicit user approval, never here.
- One finding per entry; overlapping findings get separate entries so the
  sweep can dedup.

## Gate — ask before filing

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

## File only approved and present

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
  skill here — if the user wants to pursue a `self::new-skill` candidate
  after filing, hand off explicitly to @opencode-skill-creator. If the user wants immediate
  application after filing, hand off explicitly to @papercut-sweep.
- **Scope decides store.** Global scope → global store (`-g`); repo/project scope → local store (no `-g`). Do not use `-g` for repo-local fixes.
