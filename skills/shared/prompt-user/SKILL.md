---
name: prompt-user
description: >-
  Anything the user must read or act on goes in a `prompt_user` tool call:
  numbered ❓ questions and 🏁 procedures, one divider. The Reports view
  renders it; the reply does not repeat it. Triggers: asking the user,
  sign-off, closing a post-task report.
---

# prompt-user

Anything the user must decide or run goes in a `prompt_user` tool call. The
tool stores it and the Reports view renders it: the sidebar section in the
TUI, the side panel in the desktop app. The reply carries the answer, not the
prompts.

Two kinds:

- **Procedure** (`🏁 P1`): the user has to *do* something. Steps, numbered.
- **Question** (`❓ Q1`): the user has to *decide* something. Options in the
  body; `recommendation` is your pick and the reason, so they can reply with
  one word.

## Call

```json
{
  "description": "short slot label, max 35 chars",
  "procedures": [
    { "title": "procedure title", "description": "one line", "steps": ["first step", "second step"] }
  ],
  "questions": [
    { "title": "question title", "body": "the options and context", "recommendation": "your pick and why" }
  ]
}
```

- `description` is required and at most 35 characters: the label the Prompts
  slot shows.
- Call `prompt_user` with only the kind you have. Empty fields are omitted.
- Inside a finished task, call `prompt_user` right after `post_task`. The
  report carries no prompts; this section owns them.
- A simple question whose answer is prose: answer it, and call `prompt_user`
  only for what the user must act on.
- The user answers in the Reports view; Enter steers the answer, Ctrl+Enter
  queues it, and an empty answer takes the recommendation. Either way the
  answer reaches this session. Do not ask which one they picked or repeat the
  answers in chat.

## Rules

- The call is the block. Do not repeat the prompts in the reply, and do not
  announce that they were saved.
- One pointed item per entry. A one-word question gets no block, just ask.
- Procedures first, questions last, in the order they appear in the view.
- Numbering runs across the call (`P1`, `P2`, `Q1`, `Q2`); the view numbers
  them for you.
- Never decide for the user. A `question` they must answer is not a `next`
  item, and not a choice you write into the reply.

## Fallback

Only when `prompt_user` is unavailable (an older host, or a session without
the plugin), print this block at the bottom of the reply instead:

```markdown
🏁 **P1** - **<procedure title>**: <short procedure description>
1. <first step of the procedure>
2. <second step>

---

❓ **Q1** - **<question title>**: <question body, might be multiple paragraphs, including multiple choices>

➡️ <your recommended answer>
```

Procedures first, questions last. `---` separates the two kinds only.
