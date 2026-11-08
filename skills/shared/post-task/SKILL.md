---
name: post-task
description: >-
  Close a finished task, procedure, or investigation with one `post_task`
  tool call: Completed, Deviations, Hiccups, Failed/skipped, Next.
  The Reports view renders it; the reply stays short. Triggers: end of
  multi-step work, what happened, what broke. Not a status update.
---

# post-task

A finished task ends with one `post_task` tool call. The tool stores the
report and the Reports view renders it: the sidebar section in the TUI, the
side panel in the desktop app. The reply carries the answer, not the report.

Plain English throughout: @simple-english owns the reply rules. Answer first,
then call the tool.

## When it is mandatory

**Mandatory when you end a task.** Any multi-step job, procedure, migration, or
investigation ends with this call. No exceptions, and no padding it out when
the run was clean: omit empty fields, but make the call.

**Not for:**

- A simple question. If the reply is a few sentences of prose, answer it and stop.
  No report, no tool call. The user asked a question, not for a debrief.
- A mid-task update, while the work is still running.
- A single command that ran fine.

The test: would a reader who missed the whole session need this to know what
changed and what is left? If yes, call. If the answer already sits in your
last two paragraphs, skip the report and put anything they must act on in
`prompt_user`.

## Call

```json
{
  "description": "short slot label, max 35 chars",
  "completed": ["what shipped, as an artifact"],
  "deviations": ["what differed from the plan, and why"],
  "hiccups": [{ "problem": "what broke", "cause": "why it broke", "fix": "what resolved it" }],
  "failed": ["what failed or was skipped, and why"],
  "next": ["the concrete follow-up this run leaves open"],
  "next": ["the concrete follow-up this run leaves open"]
}
```

- `description` is required and at most 35 characters: the label the Reports
  slot shows. Count it; do not let it truncate.
- Call `post_task` with only the other fields that have content.
- A later change to one section: call `report_update` with that field and the
  report id the tool result named. It patches in place; do not write a second
  report that repeats the unchanged sections.
- Anything the user must decide or run is a separate `prompt_user` call,
  after the report. The Prompts section owns it; the report does not.
- Call it before the final sentence. Do not write the report to disk, to a
  file, or into the reply.

## What goes in each field

| Field | Contains | Never contains |
|---|---|---|
| `description` | a short slot label, max 35 characters | a sentence, a copy of the first item |
| `completed` | the artifacts: files, commits, deploys, results that a check returned | narration of how you worked, or a feature tour |
| `deviations` | every entry from the deviation log, with what happened and why | anything you did not log as it happened |
| `hiccups` | every friction entry: what broke, why, how it was resolved | a fix you did not make |
| `failed` | each failure, its reason, and each step skipped because of it | a step you silently dropped |
| `next` | the concrete follow-ups this run leaves open | a generic "let me know" |

## Rules

- The call is the report. Do not print the report, or a copy of it, in the reply.
- Do not announce that the report was saved; the tool result already says so.
  Answer the user and stop.
- Log as you go. A deviation reconstructed at the end is a fabrication.
- Skip nothing silently. A step that failed or was skipped goes in `failed`,
  with its reason.
- A `hiccup`'s `cause` is a cause, not a symptom. "ssh failed" is a symptom;
  "the node's gitconfig rewrites https to ssh and it has no key" is a cause.
- Facts, not feelings. A verification that did not run is `not verified`, not
  `done`.

## Fallback

Only when `post_task` is unavailable (an older host, or a session without the
plugin), print this block at the end of the reply instead:

```markdown
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

### Needs your decision

<the prompts, in the @prompt-user shape>
```

Only the printed fallback keeps this block inside the report; with the tools
available, call `prompt_user` separately.

Omit an empty section entirely.
