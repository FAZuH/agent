---
name: deep-research
description: Investigate a question against high-trust primary sources and capture the findings as a single cited Markdown file in the repo. Use when a decision waits on an external fact, docs or API facts need gathering, or reading legwork should be delegated — one API, one behaviour, one version claim. Read the upstream [`research`](https://github.com/mattpocock/skills/blob/main/skills/engineering/research/SKILL.md) skill's primary-source methodology, then delegate the run to the `research` subagent. It is the opencode-execution form of mattpocock's [`research`](https://github.com/mattpocock/skills/blob/main/skills/engineering/research/SKILL.md) skill; reach for it whenever you would otherwise reach for [@research](https://github.com/mattpocock/skills/blob/main/skills/engineering/research/SKILL.md).
---

Deep research delegated to the `research` **subagent**. Keep working while it reads; it reports back only the file path.

The subagent's job:

1. Investigate the question against **primary sources** — official docs, source code, specs, first-party APIs — not a secondary write-up of them. Follow every claim back to the source that owns it.
2. Write the findings to a single Markdown file, citing each claim's source.
3. Save it to `docs/research/` (create the dir if needed) — the canonical home for research findings; don't scatter files elsewhere.

## Invocation

Tell the subagent:
- The specific, narrow question — one API, one behaviour, one version claim. "Research X" is too broad and comes back shallow; scope is on the caller.
- That this is a skill-invoked run: the `research-plan` gate (class
  `subagent` — see the @gate skill) skips because the question is already
  decided. The subagent does not ask for a plan first.
- It writes exactly one Markdown file and returns only its path.

## After it returns

The file is a short-lived asset, not a decision. It feeds the thinking skills: quote it into a [@grilling](https://github.com/mattpocock/skills/blob/main/skills/productivity/grilling/SKILL.md) or [@grill-with-docs](https://github.com/mattpocock/skills/blob/main/skills/engineering/grill-with-docs/SKILL.md) session so the interview asks sharper questions, or point a [@to-spec](https://github.com/mattpocock/skills/blob/main/skills/engineering/to-spec/SKILL.md) at it. Research files record what was true on the day they were written — a stale one is worse than none, so archive or delete it once the decision it fed is made. Do not treat it as durable architecture context.

## Pitfalls to watch for

- The subagent is read-only except for the single findings file — it cannot nest another research run (no `task` tool). If the output comes back with the subagent having *spawned* more agents, that is the known bug; stop the duplicates.
- If the subagent reports it cannot write (no repo notes convention, permission denied), have it return its findings in chat instead rather than forcing a file.
