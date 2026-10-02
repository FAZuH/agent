---
name: prompt-user
description: The shape of everything the user must read or act on at the bottom of a message - numbered ❓ questions with a recommended answer, and 🏁 procedures with numbered steps, procedures first and one divider between the two kinds. Use whenever a message asks the user anything, needs their sign-off, or hands them steps to run - including the block that closes a post-task report - and whenever the user says "ask me", "what do you need from me", or comments on the ❓/➡️ or 🏁 blocks.
---

# prompt-user

The bottom of a message that needs something from the user. Two kinds:

- **Procedure** (`🏁 P1`): the user has to *do* something. Steps, numbered.
- **Question** (`❓ Q1`): the user has to *decide* something. Options in the body; the `➡️` line is your recommendation and the reason, so they can reply with one word.

## Placement

Bottom-most element: answer, report if any, then prompts. Nothing to prompt means no block at all.

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

- Procedures first, questions last. `---` separates the two kinds only.
- Numbering runs across the message (`P1`, `P2`, `Q1`, `Q2`) and restarts in the next one.
- One pointed item per block. A one-word question gets no block, just ask.
- Inside a post-task report, the report's format carries the prompts. See @post-task.
