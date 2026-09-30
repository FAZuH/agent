---
name: post-task
description: Close a finished task, procedure, or investigation with a fixed five-part report - Completed, Deviations, Hiccups, Failed/skipped, Next. Use at the end of any multi-step piece of work, whenever a procedure says to report, and whenever the user asks what happened, what broke, or what is left. Not for a mid-task status update or a one-line answer.
---

# post-task

The last message of a finished piece of work has one fixed shape, so the reader
knows where to look without reading it twice.

In this fixed order, in your final message:

1. **Completed**: what the procedure produced.
2. **Deviations**: every logged deviation.
3. **Hiccups**: every logged hiccup.
4. **Failed / skipped**: failed steps, and steps skipped because of them,
   with reasons.
5. **Next**: what to do next: the concrete follow-ups this run leaves open,
   or `none`.

The run report is a final message to the user. It is not session state; do not
write it to the session record.

## What goes in each section

| Section | Contains | Never contains |
|---|---|---|
| **Completed** | the artifacts: files, commits, deploys, verified results | narration of how you worked, or a feature tour |
| **Deviations** | every entry from the deviation log, with what happened and why | anything you did not log as it happened |
| **Hiccups** | every friction entry, with where it went | a fix you did not make |
| **Failed / skipped** | each failure, its reason, and each step skipped because of it | a step you silently dropped |
| **Next** | the concrete follow-ups this run leaves open, or `none` | a generic "let me know" |

## Rules

- **Log as you go, report at the end.** A deviation reconstructed from memory at
  the end is a fabrication. Entries are written when the thing happens, to the
  session record if there is one, otherwise to the friction backlog.
- **`None` is a valid answer.** An empty section means `None`, in one word. Never
  pad a section to look thorough, and never merge two sections to save a line.
- **Skip nothing silently.** If a step failed or was skipped, it is in section 4
  with its reason. A report that reads as if everything worked, when something
  did not, is worse than no report.
- **Section 3 is the backlog, not the narration.** If friction was filed, name
  the entry. If it was not filed, that is itself a gap worth saying so.
- **Facts, not feelings.** What a check returned, not that it felt fine. A
  verification that did not run is `not verified`, not `done`.
- **The report is the last thing, not the only thing.** Answer the user's actual
  question first, then close with the report. If the answer and the report would
  repeat each other, the report is the answer.
