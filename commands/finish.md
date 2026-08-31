---
description: Commit changes, summarize session, and suggest next steps. Pass an argument beginning with "auto" to skip the commit prompt, or pass text as extra instructions.
---

Opencode "/finish" command was invoked.

Load and follow the `finish` skill — it defines the full end-of-session workflow (update relevant docs, plan commit grouping and propose commit messages, summarize the session, suggest next steps). Execute its steps in order.

Arguments:
<finish_command_arguments>
$1
</finish_command_arguments>

Interpret the user argument as follows:
- Not provided: commit interactively, no extra instructions
- Argument beginning with `auto`: auto-commit. Remove the leading `auto` token and treat any remaining text as extra instructions for all steps below.
- Any other text: treat it as extra instructions for all steps below, commit interactively

The commit permission is granted by the argument, not by this command running. The permission is active when the argument begins with `auto`. If the argument is anything else — including no argument — there is NO commit permission: you may never run `git add` or `git commit` on your own, no matter what. You must always propose the message and wait for the user's explicit confirmation first.

The permission also does not persist. It ends the moment this command finishes, and it does not pass to any other request in this conversation. When this command is not running, always propose the message and wait for explicit confirmation. Never assume the permission exists. When in doubt, do not commit; propose and wait.

Follow the skill's steps in order:

## 1. Update relevant docs

Follow the skill's step 1 exactly — discover and update the relevant docs, or say nothing needs a change and skip.

## 2. Commit changes

Follow the skill's step 2 exactly: inspect git read-only, identify the files changed this session, split the changes into one commit per logical group, and propose one `type(scope): description` message per group. You must NOT run `git add` or `git commit` on your own unless the argument begins with `auto` (see the permission rules above).

- If auto-commit mode is active (argument begins with `auto`), infer the best message for each group. Commit each group without asking, passing the remaining argument text as extra instructions.
- If interactive mode is active (argument does not begin with `auto`, including no argument), there is no commit permission. Propose one message for each group. Then stop and wait for the next message from the user. Do not run `git add` or `git commit` for that group until the user confirms it. If the user wants a change, propose the new message and wait again. Do not run any other group until the current one is resolved. Do not proceed to step 3 until the current group is resolved.

## 3. Summarize the session

Follow the skill's step 3 exactly.

## 4. Suggest next steps

Follow the skill's step 4 exactly.
