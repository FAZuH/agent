---
name: post-task
description: Close a finished task, procedure, or investigation with a fixed report - Completed, Deviations, Hiccups, Failed / skipped, Next, and the open prompts (🏁 procedures, ❓ questions) at the bottom. Use at the end of any multi-step piece of work, whenever a procedure says to report, and whenever the user asks what happened, what broke, or what is left. Not for a mid-task status update, and not for a simple question that a few sentences answer.
---

# post-task

The last message of a finished piece of work has one fixed shape.

Plain English throughout: @simple-english owns the reply rules. Answer first,
then report. If the two repeat each other, the report is the answer.

## When it is mandatory

**Mandatory when you end a task.** Any multi-step job, procedure, migration, or
investigation ends with this report. No exceptions, and no padding it out when
the run was clean — an empty section is omitted, but the report itself is not.

**Not for:**

- A simple question. If the reply is a few sentences of prose, answer it and stop.
  No report. No emoji headers. The user asked a question, not for a debrief.
- A mid-task update, while the work is still running.
- A single command that ran fine.

The test: would a reader who missed the whole session need this to know what
changed and what is left? If yes, report. If the answer already sits in your
last two paragraphs, skip the report and use @prompt-user if there is anything
to ask.

## Format

End the final message with this block. Keep the section order as shown:

```markdown
<othermsg>

---

## 📋 Post Task

### ✅ Completed
1. item

### 🔀 Deviations
1. item

### 🐛 Hiccups
| Problem | Cause | Fix |
|---|---|---|
| what broke | why it really broke | what resolved it |

### ❌ Failed / skipped
1. item

### ➡️ Next
1. item

---

### Needs your decision

<the prompts, in the @prompt-user shape>
```

Omit an empty section entirely: no heading, no `None`. Same for
`### Needs your decision`: nothing to prompt means nothing after the sections.
Never pad a section to look thorough, and never merge two sections to save a line.

The report is a final message to the user. It is not session state. Do not
write it to the session record.

## What goes in each section

| Section | Contains | Never contains |
|---|---|---|
| ✅ Completed | the artifacts: files, commits, deploys, results that a check returned | narration of how you worked, or a feature tour |
| 🔀 Deviations | every entry from the deviation log, with what happened and why | anything you did not log as it happened |
| 🐛 Hiccups | every friction entry as a row: what broke, why, how it was resolved | a fix you did not make |
| ❌ Failed / skipped | each failure, its reason, and each step skipped because of it | a step you silently dropped |
| ➡️ Next | the concrete follow-ups this run leaves open | a generic "let me know" |
| Needs your decision | the prompts: 🏁 procedures for steps the user runs, ❓ questions for decisions only they make | choices you already made for the user, or a generic ask |

## Rules

- Log as you go. A deviation reconstructed at the end is a fabrication.
- Skip nothing silently. A step that failed or was skipped goes in
  ❌ Failed / skipped, with its reason.
- 🐛 names filed friction and where it went. If it was not filed, say so.
- A row in 🐛 states a cause, not a symptom. "ssh failed" is a symptom;
  "the node's gitconfig rewrites https to ssh and it has no key" is a cause.
- Facts, not feelings. A verification that did not run is `not verified`, not
  `done`.