---
name: notes
description: Read and maintain durable notes for tools, CLIs, APIs, scheduled agents, and OpenCode behavior. Use when a task depends on prior host knowledge, a digest or automation has standing instructions, a tool has quirks to remember, or a skill points to an OpenCode v2 finding. The note file defines its own update rules.
---

# Notes

Keep durable, machine-specific knowledge in `{{USER_HOME}}/.config/fazuh-agent/notes/`. Use one Markdown file per tool or system. Read the matching note before changing that system. If no note exists, create one when the task produces knowledge that will help later.

## OpenCode v2 findings

The OpenCode v2 note is `{{USER_HOME}}/.config/fazuh-agent/notes/ocv2-findings.md`. A skill that needs an OpenCode v2 finding calls this skill and reads that note. It does not keep a second copy of the findings.

## Write a note

1. Search the notes directory for the tool or system name.
2. Read the matching file and its update rules.
3. Update the existing claim when the new information changes it. Do not create a duplicate entry.
4. Append a new entry when the note has no matching claim. Use the note's format when it defines one. Otherwise use:

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
6. After editing, read the note again and confirm that the next agent can find
   the claim with a search for the tool or feature name.

## Host-specific rules

A note can define its own `How to update this note` section. Follow that section
when it exists. The common rules above apply to entries that do not define a
different format.
