---
name: prompt-user
description: The shape of everything the user must read or act on at the bottom of a message - numbered ❓ questions with a recommended answer, and 🏁 procedures with numbered steps, procedures first and one divider between the two kinds. Use whenever a message asks the user anything, needs their sign-off, or hands them steps to run - including the block that closes a post-task report - and whenever the user says "ask me", "what do you need from me", or comments on the ❓/➡️ or 🏁 blocks.
---

# prompt-user

The bottom of a message that needs something from the user has one fixed shape.
The reader knows where to look without reading it twice. Two kinds:

- **Procedure** (`🏁 P1`) — the user has to *do* something: run a command,
  click through a dashboard, restart a service. Steps, numbered.
- **Question** (`❓ Q1`) — the user has to *decide* something. The options go
  in the question body; the `➡️` line is your recommended answer and the
  reason. The recommendation is what lets them reply with one word instead of
  writing your analysis back.

## Placement

Always the bottom-most element: the answer first, the report if there is one,
then the prompts, so the last thing on screen is what needs answering or doing.
Nothing to prompt means nothing there: no heading, no `None`, no "let me know".

## Shape

```markdown
🏁 **P1** - **<procedure title>**: <short procedure description>
1. <first step of the procedure>
2. <second step>

🏁 **P2** - **<procedure title>**: <short description>
1. <first step of the procedure>
2. <second step>

---

❓ **Q1** - **<question title>**: <question body, might be multiple paragraphs, including multiple choices>

➡️ <your recommended answer>

❓ **Q2** - **<question title>**: <question body>

➡️ <your recommended answer>
```

## Rules

- Procedures first, questions last. The `---` divider separates the two kinds
  only: never between two procedures, never between two questions.
- Numbering runs `P1`, `P2`, … and `Q1`, `Q2`, … across the message and
  restarts in the next one.
- One pointed item per block: one procedure with its steps, one question with
  its options. A question that fits in one word gets no block — just ask.
- When the message ends in a post-task report, the report's own format carries
  the prompts — see @post-task.
