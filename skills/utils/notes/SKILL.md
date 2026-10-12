---
name: notes
description: Read and maintain durable notes for tools, CLIs, APIs, scheduled agents, and OpenCode behavior. Use when a task depends on prior host knowledge, a digest or automation has standing instructions, a tool has quirks to remember, or a skill points to an OpenCode v2 finding. The note file defines its own update rules.
---

# Notes

One Markdown file per tool or system in
`{{USER_HOME}}/.config/fazuh-agent/notes/`. Read the matching note before
changing that system. Create one when the task produces reusable knowledge.

## OpenCode v2 findings

OpenCode v2 findings live in Hindsight bank `coding-agent::faz-lab`, tagged `topic:opencode-v2` (migrated from the retired `ocv2-findings.md` note). `recall` them via the hindsight MCP; never keep a second copy in a note.

## Write a note

1. Search the notes directory for the tool or system name.
2. Read the matching file and its update rules.
3. Update the matching claim in place, never duplicate it.
4. No matching claim: append one. Use the note's format when it defines one. Otherwise use:

   ```markdown
   # <tool or system>

   ## How to update this note

   Keep one testable claim per entry. Search before adding an entry. Update a
   matching entry in place and append new entries at the bottom. Do not store
   credentials or tokens.

   ## YYYY-MM-DD <short title>

   State one durable claim in one or two sentences. Include the exact command,
   file path, or behavior needed to use or verify it. Do not add generic advice.
   ```

5. Keep secrets out of notes. Refer to the secret by purpose, not by value.
6. After editing, re-read the note and confirm the claim is findable by
   tool or feature name.
