---
name: post-task
description: Close a finished task, procedure, or investigation with a fixed report - Completed, Deviations, Hiccups, Failed / skipped, Next, and the open prompts (🏁 procedures, ❓ questions) at the bottom. Use at the end of any multi-step piece of work, whenever a procedure says to report, and whenever the user asks what happened, what broke, or what is left. Not for a mid-task status update or a one-line answer.
---

# post-task

The last message of a finished piece of work has one fixed shape. The reader
knows where to look without reading it twice.

Write it in plain English: @simple-english owns the reply rules, and every rule
there applies here. Answer the user's question first, then close with the
report. If the answer and the report repeat each other, the report is the
answer.

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

Each section is a list with one item per line. An empty section means `None`,
in one word. Never pad a section to look thorough, and never merge two sections
to save a line.

The `### Needs your decision` heading appears only when something sits under
it. Nothing to prompt means nothing after the sections: no heading, no `None`,
no "let me know".

The report is a final message to the user. It is not session state. Do not
write it to the session record.

## What goes in each section

| Section | Contains | Never contains |
|---|---|---|
| Completed | the artifacts: files, commits, deploys, results that a check returned | narration of how you worked, or a feature tour |
| Deviations | every entry from the deviation log, with what happened and why | anything you did not log as it happened |
| Hiccups | every friction entry, with where it went | a fix you did not make |
| Failed / skipped | each failure, its reason, and each step skipped because of it | a step you silently dropped |
| Next | the concrete follow-ups this run leaves open, or `None` | a generic "let me know" |
| Needs your decision | the prompts: 🏁 procedures for steps the user runs, ❓ questions for decisions only they make | choices you already made for the user, or a generic ask |

## Rules

- Log as you go, report at the end. A deviation reconstructed from memory at
  the end is a fabrication.
- Skip nothing silently. A step that failed or was skipped goes in
  Failed / skipped, with its reason.
- Hiccups is the backlog, not the narration. If friction was filed, name the
  entry. If it was not filed, that is itself a gap worth saying so.
- Facts, not feelings. A verification that did not run is `not verified`, not
  `done`.
