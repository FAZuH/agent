---
name: prompt-user
description: >-
  Anything the user must read or act on goes in a `prompt_user` tool call:
  numbered ❓ questions and 🏁 procedures, one divider. The Prompts view
  renders it; the reply does not repeat it. Triggers: asking the user,
  sign-off, recovering stored questions and answers with `prompt_list`.
---

# prompt-user

Anything the user must decide or run goes in a `prompt_user` tool call. The
tool stores it, opens it as a native question card on every client (TUI,
Desktop, mobile web), and lists it in the Prompts view: the sidebar section in
the TUI, the Prompts panel in Desktop. The reply carries the answer, not the
prompts. `/prompt-latest` reopens the latest unanswered card on any client.

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
- Calls are non-blocking by default: the tool returns immediately and the
  answer arrives as a new message. Set `block: true` only when the user
  explicitly asks you to wait for the answer in the same turn. It needs at
  least one question, and the tool result then carries the answer.
- Call `prompt_user` with only the kind you have. Empty fields are omitted.
- A simple question whose answer is prose: answer it, and call `prompt_user`
  only for what the user must act on.
- The user answers in the Prompts view; Enter steers the answer, Ctrl+Enter
  queues it, and an empty answer stays unanswered. The answer arrives
  as a new message unless a blocking call was explicitly requested; with
  `block` steer and queue do not apply. Do not ask which one they picked or
  repeat the answers in chat.

## Recover a stored prompt

Call `prompt_list` before asking again after an interruption or lost context.
It reads only the caller's session and changes no records or cards.

```json
{ "promptID": "stored-prompt-id", "status": "pending", "limit": 10, "offset": 0 }
```

All fields are optional. Omit filters to include every status. `status` accepts
`pending`, `answered`, `dismissed`, or `deferred`; `promptID` selects one record.
Results are newest first. `limit` defaults to 10 (maximum 50); pass the returned
`nextOffset` as `offset` until it is `null`. Offsets apply after filtering.
Pages contain at most 64,000 UTF-8 bytes. A record over 60,000 bytes returns
only its ID (up to 200 characters), status, and `contentOmitted: true`.
Omitted content is not evidence of an answer.

Normal records include stored questions, procedures, timestamps, status and
`answers` keyed by zero-based question index. `answered` means an answer was
submitted, not that every question has an answer. Use the actual answer text
for the matching question and scope. Pending, deferred, dismissed, missing,
empty, or omitted answers grant no approval; recommendations grant none.
Deferrals recorded before this tool was added appear pending because no
deferral timestamp was stored.

For a pending or deferred matching question, keep the existing prompt rather
than posting a duplicate; `/prompt-latest` can reopen its card. Dismissal is
not consent. An empty result means no matching retained record, not approval:
the store retains at most 50 prompts per session.

## Rules

- The call ends your turn for that ask. Do not repeat the prompts in the
  reply, and do not announce that they were saved.
- One pointed item per entry. A one-word question gets no tool call, just ask.
- Procedures first, questions last, in the order they appear in the view.
- Numbering runs across the call (`P1`, `P2`, `Q1`, `Q2`); the view numbers
  them for you.
- Never decide for the user. A question they must answer is not a choice you
  write into the reply.

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
