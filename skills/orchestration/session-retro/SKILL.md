---
name: session-retro
description: End-of-session retrospective where the agent proposes improvements to its own skills, agent definitions, and tooling (global and repo-local) plus new-skill candidates, and gates filing. Use when the user says "how did this session go" or "what did we learn", or when wrapping up a session and capturing lessons before finishing. Proposes friction entries but retains them only after explicit user approval; it never applies fixes (that is @friction-sweep).
---

# Session retro

Look back at the finished session and convert it into filed proposals
for your own skills, agent
definitions, tooling, and process. Proposals only; application
belongs to @friction-sweep.

Always follow the rules in the *Rules* section at the bottom.

## 1. Mine the session and its config

Walk back through the conversation, then the config it ran under, and
look for five things:

1. **Friction hit**: tool fights, dead ends, permission denials,
   silent workarounds, retries that should not have been needed.
2. **Repeated corrections**: instructions the user gave
   twice; conventions re-explained; wrong assumptions made.
3. **Skill/workflow gaps**: missing guidance, wrong skill routed, stale
   docs, a procedure step that did not survive contact with reality.
4. **Gold-standard wins**: something unusually good, worth
   encoding as standing practice.
5. **New-skill candidate**: improvised multi-step workflow (3+ steps) worth
   extracting as a new skill. High bar, do not force: reusable
   across sessions/repos, not covered by any existing skill in
   `available_skills`, with transcript evidence (what was done, trigger
   phrases, inputs/outputs). None meets the bar: state `No new-skill
   candidate.` and move on. That is a valid outcome.

Mine both config levels, so a finding lands on the surface that can actually
hold it:

- **Global**: `~/.config/opencode/{skills,agents,plugins}`, `opencode.json`.
- **Repo-local**: the repository's own agent configuration: `AGENTS.md` /
  `CLAUDE.md`, the repo's `agents/`, `skills/` and `plugins/`, its project
  `opencode.json`, `.opencode/`, and `docs/dev/*`.

A lesson that only holds in this repo belongs in its `AGENTS.md` or repo
skill; a general one belongs on a global surface. Re-read the repo-local files
before proposing: a fix already documented there is a no-op finding, and a
missing one is the cheapest proposal you can file.

## 2. Propose (do not file yet)

For each finding, **draft** one entry but do not `retain` yet. One entry =
one `retain` with the @global-instruction friction tags:

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
  `@friction-sweep` picks these up by the scope tag. Creation requires
  `writing-for-agents` and a separate implementation session after explicit
  user approval, never here.
- One finding per entry; overlapping findings get separate entries so the
  sweep can dedup.

## 3. Gate, ask before filing

**GATE friction-file (normal → retain all drafted proposals):** filing a
friction entry to Hindsight requires user approval (filing is cheap and reversible;
*applying* what was filed is a separate, still-gated decision owned by
@friction-sweep). (Vocabulary: the @gate skill.) Do not file immediately. Present the drafts and gate with
the user:

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
  upsert once the user approves application via @friction-sweep.
- Mark which entries look immediately actionable versus needing thought.
- When the user later says "apply friction <N>" or "fix <N>", map N back to
  that row's `document_id` before touching the store.
- If nothing was approved, state "No friction entries filed, proposals remain as discussion only."

## Rules

- Filing requires the step-3 user approval (GATE friction-file, a `normal` gate that skips only in auto mode; vocabulary: @gate). Never auto-create a new skill here: a `scope:new-skill` candidate needs a separate skill-authoring session with `writing-for-agents`.
- Never edit skills, agent definitions, or config from this skill. Applying an approved proposal belongs to @friction-sweep.
- One store, one bank: every entry carries the friction tags; scope decides
  what the sweep does with it, not where it lives.
- In a restricted/read-only agent (e.g. Plan mode): keep the deviation log
  in working notes, defer filing to a write-capable mode, and state the
  deferral in the report.

## Dependency graph

- step1
- step2 -> step1
- step3 -> step2
- step4 -> step3
