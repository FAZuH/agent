---
name: deep-research
description: Investigate one external fact against primary sources and record the findings as a single cited Markdown file under `docs/research/`. Use when a decision waits on a library, API, or version fact, or when reading legwork should be delegated to a subagent. The opencode-execution form of the upstream `research` skill; use it whenever you would otherwise use @research.
---

Deep research delegated to the `research-discovery` **subagent**. Keep working while it reads; it reports back only the file path.

The subagent's job:

1. Investigate the question against **primary sources** (official docs, source code, specs, first-party APIs), not a secondary write-up of them. Follow every claim back to the source that owns it.
2. Write the findings to a single Markdown file, citing each claim's source.
3. Save it to `docs/research/` (create the dir if needed), the canonical home for research findings; don't scatter files elsewhere.

## Invocation

Tell the subagent:
- The specific, narrow question: one API, one behaviour, one version claim. "Research X" is too broad and comes back shallow; scope is on the caller.
- That it should just start: there is no approval gate, so do not ask it for a plan first.
- It writes exactly one Markdown file and returns only its path.

## After it returns

The file is a short-lived asset, not a decision. It feeds the thinking skills: quote it into a @grilling or @grill-with-docs session so the interview asks sharper questions, or point a @to-spec at it. Research files record what was true on the day they were written, and a stale one is worse than none, so archive or delete it once the decision it fed is made. Do not treat it as durable architecture context.

## Pitfalls to watch for

- The subagent is read-only except for the single findings file, and it cannot nest another research run (no `task` tool). If the output comes back with the subagent having *spawned* more agents, that is the known bug; stop the duplicates.
- If the subagent reports it cannot write (no repo notes convention, permission denied), have it return its findings in chat instead rather than forcing a file.
