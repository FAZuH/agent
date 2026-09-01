---
name: ocv2-findings
description: Save and retrieve hard-won OpenCode v2 findings — undocumented quirks, live-verified behaviors, research results on plugins, custom tools, skills, agents, config, MCP, LSP, and the server API. Use when capturing a fresh v2 quirk or research result ("save this", "note that", right after fixing or live-verifying any opencode2 plugin/tool/config change), and before modifying opencode settings to check what is already known ("what do we know about...", "any gotchas changing..."). For live plugin loading status use ocv2-plugininfo; for general OpenCode how-to questions use opencode.
---

# OpenCode v2 findings

A durable, greppable log of what we learned about OpenCode v2 the hard way.
V2 is beta and largely undocumented; every entry here was paid for with a
debugging session. Consult it before touching opencode internals; feed it
after every verified discovery.

## Where findings live

All entries live in `findings.md` beside this file — one flat markdown file,
newest at the bottom. It is the single source of truth; this SKILL.md only
defines how to read and write it.

## Capture

1. Grep `findings.md` for the topic (area keyword, feature name). If an
   entry already covers it, update that entry in place: add the new
   evidence, refine the body, bump the date and status. Grow entries;
   refuse duplicates.
2. Otherwise append one new entry at the bottom of `findings.md`, exactly
   this shape:

   ```markdown
   ## [YYYY-MM-DD] <area>: <slug-title>
   status: confirmed | partial | unverified
   source: live-test | upstream-code | docs | secondhand
   evidence: <how it was proven — command run, observed behavior, file+line>
   <body: the finding itself, 1–3 sentences>
   ```

3. `<area>` is one of: `plugins`, `tools`, `skills`, `agents`, `config`,
   `mcp`, `lsp`, `api`, `tui`, `codemode`.

Done when: the finding is greppable in `findings.md` carrying today's date
and an honest status. A claim without evidence gets `unverified` and says
what would confirm it.

## Query

1. Grep `findings.md` for the topic; read the matching entries whole.
2. When a question touches broken tooling or friction, also check the
   global papercuts store (`papercuts -g list --tag self::tool`) — some
   opencode-internals lessons live there with resolution notes.
3. Answer citing each entry's date and status. When two entries conflict,
   the newer date wins and you say so explicitly.

## Rules

- One finding per entry; a finding is one testable claim about v2 behavior.
- Record how something was verified, so future-you can re-verify against a
  newer opencode2 build and retire stale entries.
- No secrets, no tokens, no absolute credentials in entries.
