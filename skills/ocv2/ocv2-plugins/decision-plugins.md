# Decision plugins

The branch of [`ocv2-plugins`](SKILL.md) for a plugin that **calls something
external**, **holds settings**, or **can stop the host**. The contract, the TUI
surface, and verification live in the main file; this one is the design
discipline that only this kind of plugin needs.

The governing idea: an outside system gets to *inform* the host, never to
*govern* it. Every rule below is a way of keeping that true without relying on
anyone remembering.

## Fail open by construction

Fail-open is not a habit. Make it a property of the shape, so a future edit
cannot quietly break it.

- **One error class may stop the host.** If a plugin is allowed to block
  anything, give that one outcome its own error class and rethrow only that.
  Every other error (transport, shape, and your own bugs) falls through to a
  handler that logs and returns. A `catch` that rethrows "unexpected" errors is
  fail-*closed* wearing a fail-open hat.
- **Wrap the whole I/O.** `fetch` in a try/catch and the very next
  `await response.text()` outside it is enough: a body that dies after headers
  rejects with a `TypeError`, not your error class, and the hook blocks the
  host on a network hiccup. Every await that can reject belongs inside the
  boundary.
- **Check every failure branch explicitly**, not by type: a missing key, a
  timeout, a bad status, a malformed body, an answer missing a field, an answer
  whose confidence is too low to act on.
- **Say what happened in the reply.** "Jev was not consulted (timeout after
  30s). Proceed without it." is actionable. A stack trace is not, and neither is
  silence.

## Never let a score exclude

If the plugin ranks or scores, it returns **every item it was given, ordered**.
No score, no threshold, and no failed sub-call may remove a row. A low score
means "nothing stood out", not "skip it", and the item nobody scored is exactly
the one to distrust.

Make it structural: sort the array you were handed and render all of it. A
`.filter()` anywhere in that path is the bug, and the invariant is worth a test
that asserts the count matches the input count.

## One switch, one stored boolean

A master switch that is **computed** from other settings is a different thing
wearing the same name, and it misleads: it reads as a state you set rather than
a state you derived.

- The master is a real stored boolean. It **gates** the plugin and leaves every
  subordinate setting untouched, so a user can configure while disabled and get
  their setup back.
- Subordinate switches show their **own** stored value, not the gated one.
  Otherwise a disabled plugin displays as "everything off" and looks broken.
- A switch that is off **refuses before sending**, so it costs nothing and there
  is no round trip to explain.
- Keep one name per switch. Three names for one setting is worse than one, and a
  second name that reports instead of editing reads as broken.

Fold a subordinate gate into the one accessor every call site already uses, and
the master switch works everywhere with no per-tool wiring:

```ts
featureStored(key)   // raw, for display
featureOn(key)       // master && stored, for enforcement at every call site
```

## Settings

- Every provider-, host-, or environment-specific value is a **setting** read
  fresh per call. Constants belong in `DEFAULTS`, described as one working
  deployment, and the code names no provider. A setting costs a line; a
  hardcoded value costs a rewrite.
- **Resolution order**: env vars in a configured list, then a file. Report which
  one matched; never the value.
- **Fill every known key on load.** A partial or old settings file must not
  change behaviour silently, and an unknown key must not invent a switch:
  build the map from the known list and ignore the rest.
- **Return a fresh object from the loader.** Returning a module-level default by
  reference lets a setter rewrite the defaults in memory, and the bug only
  shows on a machine with no settings file yet.

## Secrets

- Never write a secret into a file the repository tracks, and never accept one
  as a command argument: anything after a slash command lands in the
  transcript. A dialog is the write path; the text route reports the path and
  the command to fill it.
- Store it 0600, and `chmod` after writing: a `mode` on `writeFileSync` applies
  only at creation, so a pre-existing file keeps its old permissions.
- **Redact before send, on every path.** Credential-shaped text (private key
  blocks, bearer tokens, `api_key = …` assignments) stripped recursively.
  A shim or proxy that forwards a body is a send path too, and the one most
  likely to carry file contents.
- **Anything holding a payload is 0600**: the call log, the trace log, the
  state file. Redacted is not secret-free.
- The log should record what was sent, what came back, and the cost. It is the
  only way to answer "what did it actually send me" after the fact.

## State on disk

```
data/<plugin>-state.json    settings          0600
data/<plugin>-calls.jsonl   one line per call 0600
data/<plugin>-tui.log       UI diagnostics
```

Append-only logs want a size cap eventually; an unbounded log of payloads is a
slow leak, not an emergency.

## Test the gates, not the plumbing

- **Give the data directory an env override** and point the suite at a temp one.
  A suite that writes the live config is worse than no suite: it silently
  changes the user's settings, and the damage looks like a bug in the plugin.
  This happened here, twice, and both times it looked like a logic bug.
- **A stub `ctx` is a real test surface.** It exercises `setup`, tool
  `execute`, hook dispatch, command registration, and dialog lifecycle, and it
  runs in milliseconds.
- **Extract the decision as a pure exported function** and test it directly:
  "does this answer block?", "does the master gate this feature?". The wiring
  around a decision is where the bugs live, and the decision is what must be
  provable.
- Test the properties, not the shape: every item returned, master gates without
  touching subordinates, an invalid number keeps the old value instead of
  writing a NaN that JSON turns into null.
- Keep stubs honest. A stub that encodes your assumption is a test of the
  assumption. When a stub passes and the real host fails, the stub is wrong:
  log the real shape and fix the stub.

## Keep the record honest

Notes and docs are part of the deliverable, and a build record goes stale the
moment the port lands:

- Date every live observation and name its provider, plan tier, and cost, so a
  later reader knows what has expired.
- Keep an explicit "not verified" list and let it grow. A short list on a long
  session is a sign it was not maintained.
- Correct a claim the moment the code contradicts it. A record that says a thing
  is verified when it was inferred will be believed later.
