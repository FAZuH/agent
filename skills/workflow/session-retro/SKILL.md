---
name: session-retro
description: End-of-session retrospective where the agent proposes improvements to its own skills, agent definitions, and tooling. Use when the user asks for a retro/retrospective, "how did this session go", "what did we learn", "propose improvements", or when wrapping up a session and capturing lessons before finishing. Files proposals into the papercuts store — it does NOT apply fixes (that is `papercut-sweep`) and does NOT touch repo-local code sanding.
---

# Session retro

Look back at the finished (or finishing) session and convert what happened
into concrete, filed proposals for improving your own skills, agent
definitions, tooling, and process. This skill only proposes; application
belongs to `papercut-sweep`.

## When

- At session wrap-up — typically just before `/finish` or after the last
  commit lands.
- Any time the user calls for a retro mid-session.
- Especially valuable right before `/compact` or session end, while
  context is still fresh.

## Mine the session

Walk back through the conversation and look for four things:

1. **Friction hit** — tool fights, dead ends, permission denials,
   workarounds used silently, retries that should not have been needed.
2. **Repeated corrections** — instructions or prompts the user had to give
   twice; conventions that had to be re-explained; wrong assumptions made.
3. **Skill/workflow gaps** — missing guidance, wrong skill routed, stale
   docs, a procedure step that did not survive contact with reality.
4. **Gold-standard wins** — something that went unusually well and is worth
   encoding as standing practice, not just luck.

## File proposals

For each finding, file one entry:

- For global scope (global skills/tools/agents): `papercuts -g add --tag self::<namespace> "<friction observed > proposed fix>"`
- For repo/project scope (fix lives inside the current repo): `papercuts add --tag self::<namespace> "<friction observed > proposed fix>"` — no `-g`

Use `-g` only for global scope.

- Namespaces: `self::skill`, `self::agent-def`, `self::tool`,
  `self::process`. Add free-form tags when a theme helps sweeps group.
- The text must carry a proposal seed: what was tried, what got in the way,
  what would fix it. A bare complaint fails the bar.
- One finding per entry; overlapping findings get separate entries so the
  sweep can dedup.

## Present

Report a compact table of what was filed. The first column is a plain
incrementing number (1, 2, 3, …) — the user refers to findings by these
numbers ("apply papercut 1-3", "fix number 2"), so keep them stable within
the retro report:

| # | id | tag | proposal | actionable now? |

- `#` starts at 1 and increments per row, in the order filed.
- Keep the `id` column: it is the store handle used for
  `papercuts resolve` once the user approves application.
- Mark which entries look immediately actionable versus needing thought.
- When the user later says "apply papercut <N>" or "fix <N>", map N back to
  that row's `id` from this table before touching the store.

## Boundary

- **Propose only.** Never edit skills, agent defs, or config from this
  skill. If the user wants immediate application, hand off explicitly to
  `papercut-sweep`.
- **Scope decides store.** Global scope → global store (`-g`); repo/project scope → local store (no `-g`). Do not use `-g` for repo-local fixes.
