---
name: plan-confirm
description: Present a large confirmation list grouped as accepted / rejected / undecided with one line per item. Use when a plan, audit, or proposal has enough items to need confirming and the user picks which groups proceed.
---

# Plan Confirm

When presenting many items that need a verdict, use exactly three groups.
One line per item. No prose paragraphs, no per-item essays.

- ✅ **Accepted**: will do. One line: what + key detail (command, path, caveat).
- ❌ **Rejected**: will not do. One line: what + one-word why (dead, dup, conflicts).
- ⬛ **Undecided**: needs input. One line: what + the blocking question.

Rules:

- Answers to known questions go above the list, capped at four short lines.
- Verify what you can (file exists, command output) before listing, never ask.
- Persist verdicts to the session record (spec, checkpoint, ticket) the same turn they land.
- A group marked accepted in a previous turn is executed, not re-presented.
