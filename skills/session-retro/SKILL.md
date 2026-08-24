---
name: session-retro
description: End-of-session retrospective where the agent proposes improvements to its own skills, agent definitions, and tooling. Use when the user asks for a retro/retrospective, "how did this session go", "what did we learn", "propose improvements", or when wrapping up a session and capturing lessons before finishing. Files proposals into the global papercuts store — it does NOT apply fixes (that is `papercut-sweep`) and does NOT touch repo-local code sanding (plain `papercuts add`).
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

For each finding, file one entry in the global store:

```bash
papercuts -g add --tag self::<namespace> "<friction observed > proposed fix>"
```

- Namespaces: `self::skill`, `self::agent-def`, `self::tool`,
  `self::process`. Add free-form tags when a theme helps sweeps group.
- The text must carry a proposal seed: what was tried, what got in the way,
  what would fix it. A bare complaint fails the bar.
- One finding per entry; overlapping findings get separate entries so the
  sweep can dedup.

## Present

Report a compact table of what was filed:

| id | tag | proposal | actionable now? |

Mark which entries look immediately actionable versus needing thought.

## Boundary

- **Propose only.** Never edit skills, agent defs, or config from this
  skill. If the user wants immediate application, hand off explicitly to
  `papercut-sweep`.
- **Global store only.** Friction whose fix lives inside the current repo
  goes through plain `papercuts add`, not here.
