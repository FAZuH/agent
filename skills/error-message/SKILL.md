---
name: error-message
description: >-
  Write or review error message strings (wording and grammar rules). Use when
  writing error strings, error types, anyhow/eyre contexts, thiserror variants,
  error message wording, or when reviewing/rewriting error messages to follow
  std-library conventions. Triggers on error messages, error strings, error
  wording, "failed to X" phrasing, and error formatting rules.
---

# Error Messages

Wording and grammar rules for error message strings. These match std library
conventions and the anyhow/eyre/thiserror ecosystem.

## Rules

1. **Lowercase, no trailing period.** `"failed to read file"` not `"Failed to read file."` — matches std convention, and chained messages don't end up with a period mid-sentence.

2. **State what failed, in past tense or as a noun phrase — not an imperative/instruction.**
   - Good: `"failed to parse config"`, `"invalid port number"`, `"connection timed out"`
   - Bad: `"please check your config"`, `"try again"`, `"you must provide a port"`

3. **No "Error:" prefix.** The type/context already signals it's an error (via `Err`, via `.context()`, via `anyhow::Error` Display). Redundant.

4. **Be specific about the *what*, not the *how you feel about it*.** No "oops", "something went wrong", "uh oh". State the actual failure.

5. **Include the relevant value when useful, but keep it short.** `format!("invalid port: {port}")` not `format!("The port number you provided, {port}, is not valid and cannot be used.")`

6. **Use "failed to X" for actions, plain noun phrases for states.**
   - Action failed: `"failed to connect to database"`
   - Invalid state: `"missing required field: name"`, `"empty input"`

7. **Don't repeat context the caller will add.** If the low-level function's error will get wrapped with `.context("loading config")`, the inner error shouldn't also say "config" redundantly — e.g. inner: `"file not found"`, outer via wrap: `"failed to load config: file not found"`.

8. **No punctuation-heavy phrasing (colons, semicolons) inside the message itself** — reserve `:` for the wrap_err chain joining messages together; let the library (anyhow/eyre/thiserror Display) do that formatting.

## Application

- When writing an error message, apply all rules above to the final string.
- When reviewing code, check each error string against these rules and call out violations with the rule number.
- When wrapping errors, apply rule 7: keep inner messages minimal and put the task context in the wrap message.
