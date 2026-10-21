# Decision plugins

The [`plugins`](plugins.md) branch for a plugin that **calls something
external**, **holds settings**, or **can stop the host**. Contract, TUI,
verification live in the main file; this is the extra discipline this kind
needs.

Governing idea: an outside system *informs* the host, never *governs* it.
Every rule below holds that structurally, not by memory.

## Fail open by construction

Fail-open is a shape property, not a habit. Future edits must not quietly break it.

- **One error class may stop the host.** Give that outcome its own error class
  and rethrow only it. All other errors (transport, shape, your own bugs) log
  and return. A `catch` rethrowing "unexpected" is fail-*closed* wearing a
  fail-open hat.
- **Wrap the whole I/O.** `fetch` in try/catch with `await response.text()`
  outside still blocks: a body dying after headers rejects with a `TypeError`,
  not your error class, and the hook stops the host on a hiccup. Every
  rejectable await belongs inside the boundary.
- **Check every failure branch explicitly**, not by type: a missing key, a
  timeout, a bad status, a malformed body, an answer missing a field, an answer
  whose confidence is too low to act on.
- **Say what happened in the reply.** "Jev was not consulted (timeout after
  30s). Proceed without it." is actionable. A stack trace is not, and neither is
  silence.

## Never let a score exclude

If the plugin ranks or scores, it returns **every item it was given, ordered**.
No score, threshold, or failed sub-call removes a row. A low score
means "nothing stood out", not "skip it", and the item nobody scored is exactly
the one to distrust.

Make it structural: sort the array you were handed and render all of it. A
`.filter()` in that path is the bug; test that output count matches input count.

## One switch, one stored boolean

A **computed** master is a different thing under the same name: it reads as set
state, not derived state.

- The master is a real stored boolean. It **gates** the plugin and leaves every
  subordinate untouched, so configuration while disabled survives.
- Subordinate switches show their **own** stored value, not the gated one.
  Otherwise a disabled plugin displays as "everything off" and looks broken.
- A switch that is off **refuses before sending**, so it costs nothing and there
  is no round trip to explain.
- Keep one name per switch. Three names for one setting is worse than one, and a
  second name that reports instead of editing reads as broken.

Fold the subordinate gate into the one accessor every call site uses; the
master then works everywhere with no per-tool wiring:

```ts
featureStored(key)   // raw, for display
featureOn(key)       // master && stored, for enforcement at every call site
```

## Settings

- Every provider-, host-, or environment-specific value is a **setting** read
  fresh per call. Constants belong in `DEFAULTS`, described as one working
  deployment, and the code names no provider.
- **Resolution order**: env vars in a configured list, then a file. Report which
  one matched; never the value.
- **Fill every known key on load.** A partial or old file must not
  silently change behaviour, and an unknown key must not invent a switch:
  build the map from the known list and ignore the rest.
- **Return a fresh object from the loader.** Returning a module-level default by
  reference lets a setter rewrite defaults in memory; the bug shows only
  on a machine with no settings file yet.

## Secrets

- Never write a secret into a tracked file, never accept one
  as a command argument: anything after a slash command lands in the
  transcript. A dialog is the write path; the text route reports the path and
  the command to fill it.
- Store it 0600, and `chmod` after writing: `mode` on `writeFileSync` applies
  only at creation, so a pre-existing file keeps old permissions.
- **Redact before send, on every path.** Credential-shaped text (private key
  blocks, bearer tokens, `api_key = …` assignments) stripped recursively.
  A shim or proxy forwarding a body is a send path too, and the likeliest
  to carry file contents.
- **Anything holding a payload is 0600**: the call log, the trace log, the
  state file. Redacted is not secret-free.
- Log what was sent, what came back, and the cost. It answers "what did it
  actually send me" after the fact.

## State on disk

```
data/<plugin>-state.json    settings          0600
data/<plugin>-calls.jsonl   one line per call 0600
data/<plugin>-tui.log       UI diagnostics
```

Cap append-only logs eventually; unbounded payload logs leak slowly.

## Test the gates, not the plumbing

- **Give the data directory an env override** and point the suite at a temp one.
  A suite writing the live config is worse than no suite: it silently
  changes user settings, and the damage reads as a plugin bug.
  This happened here, twice, both times reading as logic bugs.
- **A stub `ctx` is a real test surface.** It exercises `setup`, tool
  `execute`, hook dispatch, command registration, and dialog lifecycle, in
  milliseconds.
- **Extract the decision as a pure exported function** and test it directly:
  "does this answer block?", "does the master gate this feature?".
- Test properties, not shape: every item returned, master gates without
  touching subordinates, invalid number keeps the old value instead of
  writing a NaN that JSON turns into null.
- Keep stubs honest. A stub encoding your assumption tests the
  assumption. When stub passes and host fails, the stub is wrong:
  log the real shape and fix the stub.

## Keep the record honest

Notes and docs ship with the build, and a build record goes stale the
moment the port lands:

- Date every live observation with provider, plan tier, and cost, so later
  readers know what expired.
- Keep an explicit "not verified" list and let it grow. A short list on a long
  session means it was not maintained.
- Correct a claim the moment code contradicts it. A record claiming a thing
  verified when it was inferred will be believed later.
