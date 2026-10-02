---
name: post-task
description: Close a finished task, procedure, or investigation with a fixed report - Completed, Deviations, Hiccups, Failed / skipped, Next, and the open prompts (🏁 procedures, ❓ questions) at the bottom. Use at the end of any multi-step piece of work, whenever a procedure says to report, and whenever the user asks what happened, what broke, or what is left. Not for a mid-task status update or a one-line answer.
---

# post-task

The last message of a finished piece of work has one fixed shape.

Plain English throughout: @simple-english owns the reply rules. Answer first,
then report. If the two repeat each other, the report is the answer.

## Format

End the final message with this block. Keep the section order as shown:

```markdown
<othermsg>

---

## Post Task

### Completed
1. item

### Deviations
1. item

### Hiccups
1. item

### Failed / skipped
1. item

### Next
1. item

---

### Needs your decision

<the prompts, in the @prompt-user shape>
```

Each section is a list with one item per line. Omit an empty section
entirely: no heading, no `None`. Same for `### Needs your decision`:
nothing to prompt means nothing after the sections. Never pad a section to
look thorough, and never merge two sections to save a line.

The report is a final message to the user. It is not session state. Do not
write it to the session record.

## What goes in each section

| Section | Contains | Never contains |
|---|---|---|
| Completed | the artifacts: files, commits, deploys, results that a check returned | narration of how you worked, or a feature tour |
| Deviations | every entry from the deviation log, with what happened and why | anything you did not log as it happened |
| Hiccups | every friction entry, with where it went | a fix you did not make |
| Failed / skipped | each failure, its reason, and each step skipped because of it | a step you silently dropped |
| Next | the concrete follow-ups this run leaves open | a generic "let me know" |
| Needs your decision | the prompts: 🏁 procedures for steps the user runs, ❓ questions for decisions only they make | choices you already made for the user, or a generic ask |

## Rules

- Log as you go. A deviation reconstructed at the end is a fabrication.
- Skip nothing silently. A step that failed or was skipped goes in
  Failed / skipped, with its reason.
- Hiccups names filed friction. If it was not filed, say so.
- Facts, not feelings. A verification that did not run is `not verified`, not
  `done`.
