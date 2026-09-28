---
description: "Display a status report of the current session: progress, issues, tracked items, and remaining tasks. Then wait for user instructions."
---

Produce a concise status report of the current session. Gather information from these sources in order:

## 1. Check active goal

Run `get_goal` to see the current objective, status, elapsed time, and completion evidence.

## 2. Check goal history

Run `get_goal_history` to see recent checkpoints and lifecycle history.

## 3. Summarize current state

From your own context (this conversation), fill the report format in step 4. Use
the `todowrite` tool to read the current todo list for the remaining items.

## 4. Report to user

Present the report in a clean format:

```
/status-report

Objective: <current goal or task>
Elapsed: <time since goal started>

### Progress
- <item>
- <item>

### Issues / Blocks
- <item or "None">

### Todo remaining
- <item>
- <item>

### Next up
<what would be done next>
```

## 5. Wait

After presenting the report, do NOT continue working on any task. Tell the user you're waiting for their decision or further instructions. Stop and wait.
