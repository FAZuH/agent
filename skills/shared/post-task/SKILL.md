---
name: post-task
description: Close a finished task, procedure, or investigation with a fixed report - Completed, Deviations, Hiccups, Failed / skipped, Next, and the open questions in ❓/➡️ blocks at the bottom. Use at the end of any multi-step piece of work, whenever a procedure says to report, and whenever the user asks what happened, what broke, or what is left. Not for a mid-task status update or a one-line answer.
---

# post-task

The last message of a finished piece of work has one fixed shape. The reader
knows where to look without reading it twice.

The report is written in plain English. The @simple-english skill owns the
reply rules, and every rule there applies to this report.

Answer the user's question first. Then close with the report. If the answer and
the report repeat each other, the report is the answer.

## Format

End the final message with this block. Keep the section order as shown:

```markdown
<othermsg>

---

## Post Task

### Completed
1. item
2. item

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

❓ **Q1** - **<question title>**: <question body, might be multiple paragraphs, including multiple choices>

➡️ <your recommended answer>

---

❓ **Q2** - **<question title>**: <question body>

➡️ <your recommended answer>
```

Each section is a list with one item per line. An empty section means `None`,
in one word. Never pad a section to look thorough, and never merge two
sections to save a line.

The questions close the message: they are the bottom-most element, after every
section. Numbering runs `Q1`, `Q2`, … across the whole message and starts again
only in the next message. The `### Needs your decision` heading is there for
scanning and appears only when something sits under it — a run with no questions
puts nothing after the sections: no heading, no `None`, no "let me know".

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
| Needs your decision | the open choices only the user can make, as `❓`/`➡️` blocks | choices you already made for the user, or a generic ask |

## The questions

The `❓`/`➡️` blocks under `### Needs your decision` are one pointed question
each with its options, followed by your recommended answer and the reason. Write
one for a trade-off you deferred, a rejected option that turned out to matter, or
a fact no source settled. The shape is the one @global-instruction requires for
every message.

The recommendation is not decoration. It is what lets the user answer with one
word instead of writing your analysis back, so state it plainly and say why
rather than listing options and leaving the choice open.

---

## Post Task

### Completed
1. item

### Needs your decision
1. item

---

❓ **Q1** - **<question title>**: <question body>

➡️ <your recommended answer>

---

## Rules

- Log as you go, report at the end. A deviation reconstructed from memory at
  the end is a fabrication. Entries are written when the thing happens, to the
  session record if there is one, otherwise to the friction backlog.
- Skip nothing silently. If a step failed or was skipped, it goes in
  Failed / skipped with its reason. A report that reads as if everything
  worked, when something did not, is worse than no report.
- Hiccups is the backlog, not the narration. If friction was filed, name the
  entry. If it was not filed, that is itself a gap worth saying so.
- Facts, not feelings. What a check returned, not that it felt fine. A
  verification that did not run is `not verified`, not `done`.
