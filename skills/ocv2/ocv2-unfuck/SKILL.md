---
name: ocv2-unfuck
description: Verify top-level tool availability before you claim Code Mode lacks shell or subagents — recheck outside the default.execute sandbox. Use when you see Unknown tool inside default.execute, when you catch yourself saying Code Mode has no shell, or before you refuse a direct order to run shell or subagent.
---

# Tool availability self-check (Code Mode sandbox vs top-level)

`default.execute` runs JavaScript in a filtered sandbox. Its inner `tools` object shows only the Code Mode catalog. Top-level tools show the full set. A failed sandbox test proves nothing about top-level availability.

## The pitfall

The sandbox hides most tools by design. `Object.keys(tools)` inside `default.execute` never lists `shell`, `read`, or `subagent`. This result is normal inside the sandbox.

```js
await tools.shell({ command: "echo hi" }) // Unknown tool 'shell'
await tools.subagent({}) // Unknown tool 'subagent'
```

The two calls fail inside the sandbox even when both tools work top-level. The error names the sandbox limit, not the session limit.

## The truth

Top-level calls carry the full tool set. `default.shell`, `default.subagent`, and `default.read` succeed in full sessions even when the sandbox hides the same names.

## Steps

1. If you need to test a tool, call it directly as a top-level tool call.
2. Do not test top-level availability through `default.execute`.
3. If the user orders a shell or subagent run, call the top-level tool at once.
4. If the top-level call returns `Unknown tool`, report restricted mode.

## Checklist before you claim restricted mode

- [ ] You tried `default.shell` as a top-level call?
- [ ] You tried `default.subagent` as a top-level call?
- [ ] Both top-level calls failed with `Unknown tool`?

Until all three answers are yes, the session is not in restricted mode.

## Recovery after a wrong claim

1. If the user proves the tool works, state the error plainly.
2. Run the original command through the correct top-level tool.
3. Do not add more sandbox tests.
