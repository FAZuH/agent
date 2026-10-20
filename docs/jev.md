# Jev

The `fazuh.jev` plugin asks [Jev](https://typesafe.ai), TypeSafe's System One
decision model, questions whose answers are judgements rather than facts. It
answers with probabilities and never with an action.

It is one plugin with three hooks, a TUI settings panel, and three feature
switches. Setup and the full command list are in
[Plugins](plugins.md#jev-fazuhjev); this page is the operating reference: what
it guarantees, what it costs, and how to point it somewhere else.

## The hooks

The plugin registers no tools. Its value is automatic:

**`hook_skill_pick`** (off by default): every time the user prompts, asks Jev which
installed skill best covers the request. The candidate list is the host's own
skill registry — name plus a choice criterion per skill — read in-process when
the host exposes `ctx.skill.list`, falling back to a scan of the same
directories the host scans. A confident pick is injected into the next context
build as one system line:

```
Jev routing: consider loading skill @<name> (P=0.62). Advisory — if your own reading disagrees, decide yourself.
```

The model still loads the skill itself; the hook only advises. One Jev call per
prompt, cached across the agentic loop's turns so a ten-turn conversation
spends ten calls, not fifty. The call is awaited with `hook_skill_pick.timeout`
(default 5000ms): a pick that arrives after the first context build is useless
for turn one. A timeout, an unreachable provider, or a low-confidence answer
injects nothing. Subagent sessions are skipped — they inherit the parent's
skills already. The provider's choice limit is 255 options; the roster is
capped at `hook_skill_pick.maxCandidates` (default 150) below it.

A confident pick names the winner plus every runner-up at or above
`hook_skill_pick.alsoAbove` (default 0.25 — the same floor the TypeSafe triage
example uses for its second-team copy), capped at `hook_skill_pick.maxPicks`
(default -1, uncapped; 1 restores single-pick behavior):

```
Jev routing: consider loading skills @commit (P=0.88) and @changelog (P=0.31). Advisory — …
```

A low-confidence winner injects nothing at all: runners-up never rescue a
rejected pick, because pluralizing a shrug does not make it decisive.

With ~160 installed skills the top choice dilutes, so the floor
(`minProbability: 0.75`) sits below the measured P=0.89 of a decisive
truncated-criteria pick, and the margin gate (`minMargin: 0.2`) rejects
near-ties underneath it.

### The optimizer cache

Sending every full description on every prompt costs ~9k input tokens. Each
skill's description is rewritten once, by the host LLM, into a terse choice
criterion — when the skill is the right pick *and* when it is not, max ~40
words — and cached in the local data file (`jev-data.json`, see Files) under
`skillCriteria`:

```json
{ "<skill-id>": { "origHash": "<sha256 of the original description, 16 hex>", "terse": "…", "v": 1 } }
```

The cache key is the description hash, not the file: body edits that leave the
description alone never invalidate; a description edit (or a new skill) misses
and falls back to the description's first sentence until optimized. Criteria
are stripped of the optimizer's old `Pick for/when …` preamble on read, so
stored entries clean themselves without a re-run. Corrupt,
foreign-version, empty, or overlong entries are dropped on load, so a bad
optimizer run can never poison the roster.

- **Auto warm-up** (`hook_skill_pick.autoOptimize`, default true): when a pick
  runs and the installed skill id set differs from the set the optimizer last
  saw, the optimizer fires once in the background. The current prompt uses the
  fallback; the cache is warm for the next one, and only a run that wrote
  criteria marks the set seen, so a failure retries on the next process
  instead of being assumed warm. Description-only staleness and steady state
  never trigger it — that is what `/jev-optimize-skills` is for. Set to false
  to disable the silent warm-up entirely.
- **`/jev-optimize-skills`**: optimize every stale skill now (awaited, reports
  done/failed); `/jev-optimize-skills <id>` refreshes one skill. Works on every
  host including desktop, because it is a command, not a TUI panel.
- The optimizer runs through the host LLM (`ctx.generate.text`, the same
  channel that writes titles and compaction summaries), capability-probed at
  runtime. The payload is `{ prompt, model }`, and the model is resolved in
  order: the `hook_skill_pick.optimizeModel` setting, then the model the
  calling session already runs on, then the host default. Naming no model at
  all is not an option, because that hands the choice to the host default: a
  default the provider rejects (an nvidia entry answering 404, once measured)
  fails every run and latches the optimizer off. The session's own model is
  the safer second choice, since the session is demonstrably running on it. A
  failed run logs the provider and the model it used. On a host without
  `generate.text`, auto warm-up logs once per process and stays off; the
  manual command reports the same.
- **Failure latch**: three consecutive failures (host error, no JSON, or a
  response that yields no criteria) turn the *auto* path off for the rest of
  the process with one log line, so a broken host cannot fill the log or spend
  a call on every prompt. The manual command bypasses the latch; a success
  clears it.

**`hook_tool_risk`** (off by default): every tool call the host checks for
permission, within the configured actions, is sent to Jev. One question, four
answers, and the host's own effect is changed to match:

| Answer | Effect | What else happens |
| --- | --- | --- |
| `accept` | `allow` | the prompt never appears, even when the host wanted to ask |
| `propagate` | `ask` | the user gets the ordinary prompt |
| `deny` | `deny` | the agent reads the reason as the tool error |
| `alert` | `deny` | the session is interrupted and the user is notified |

The hook sits in the host's permission evaluation, so a configured `deny`
never reaches it: the host's own block stands, and this hook only speaks
about the calls the host would otherwise let through or ask about.

A weak answer is never acted on: the call keeps the host's effect. The answer
has to clear `hook_tool_risk.minProbability` and `hook_tool_risk.minMargin`.
A repeated call reuses the first verdict (`hook_tool_risk.cache`), so a
command that runs ten times costs one call.

**`hook_tool_standard`** (off by default): the rules file. Every rule that
matches the call is scored — one question per rule, one call for all of them —
and a rule scoring at or above its threshold is violated. A violated `block`
rule denies the call; a violated `propagate` rule asks the user. Every rule
keeps its score, violated or not: a score never removes a row.

The rules file is YAML, and YAML reads JSON, so one loader takes both. A
`.json` file works as well as a `.yaml` one.

```yaml
rules:
  - id: no-exfil
    match: { action: shell, resource: "curl *" }   # action and resource are optional
    text: "The command uploads local data to a remote host."
    threshold: 0.7      # optional, overrides defaultThreshold
    effect: block       # optional, overrides defaultEffect
```

`match` is the filter. `action` is a permission action (`shell`, `edit`,
`read`, `glob`, `grep`, `skill`, `subagent`, `webfetch`, `websearch`,
`external_directory`, `execute`, `<server>_<tool>`) or the tool name that
raises it (`bash` means `shell`, `write` and `patch` mean `edit`). `resource`
is a whole-value wildcard: `*` is any run of characters, `?` is exactly one,
and a pattern ending in ` *` also matches the bare value, so `git status *`
matches `git status` and `git status --short`.

`text` is the question the model is asked. A `{file:<path>}` marker in it is
replaced with that file's contents, so a rule can quote the policy it
enforces:

```yaml
  - id: house-style
    match: { action: edit }
    text: "The change breaks the rules in {file:docs/style.md}"
```

The path is absolute or relative to the session's project directory, and the
injected text is capped at `hook_tool_standard.fileMaxChars`. A file that
cannot be read skips its rule: a missing reference must never block a call.

A rule file that cannot be parsed is loud in `/jev-log` and changes nothing.

**Auto-accept mode.** The client answers its own permission requests in that
mode, so an `ask` never reaches a human. `propagate` therefore has two
meanings, and `yoloPropagate` (a global setting) picks one:

- `block-notify` (default): the call is blocked, recorded, and the user is
  told which command lets it through. The agent is told to wait.
- `no-op`: the effect is set to `ask` and the client answers it. The verdict
  has no effect at all in that mode.

The mode is read from OpenCode's own client setting,
`~/.config/opencode/cli.json` → `session.permissions`. A file that cannot be
read means auto-accept, because that is the direction that keeps a human in
the loop.

**Approving a blocked call.** A blocked call is recorded with a token — six
hex characters, the identity of the call, so the same retry is recognized and
a modified command is a different call. The user approves it with
`/jev-approve` (TUI): the command lists what is blocked, the selection grants
the token, and the next matching call runs once, with no model call and no
tokens spent. A grant allows one call, not a policy, and a blocked call stops
being approvable after `approveTtl` seconds.

The picker is not filtered by the session on screen: a blocked call often ran
in a subagent session that the window never shows, and the grant is keyed to
the call's identity anyway, so approving it from anywhere spends it right.

The approve picker lives in the TUI because it needs a dialog, and one name
has one owner: there is no server-side `/jev-approve`. A headless session has
no picker, so the deny message and the log name the token and the grant file
it goes in.

**The alert.** An `alert` verdict blocks the call, stops the session, and
tells the user twice: the TUI toast, and a webhook when
`hook_tool_risk.alertWebhook` names one. The webhook carries the call in a
code block, because one long line of shell is unreadable:

```
# Jev Alert (hook_tool_risk)
```
```
shell: ssh host 'opencode2 api post ...'
```

Both hooks are wired to fire on prompt admission (`session.hook("prompt")`)
and context build (`session.hook("context")`). The prompt hook is the least
documented of the session hooks, so registration is capability-probed: if the
host rejects the name, the context hook alone detects unseen user prompts and
picks up the slack, at the cost of spending inside the request path. What the
host did or did not accept is in `/jev-log`.

## The safety contract

These are the rules the code enforces, not aspirations:

- **Jev decides, the host acts.** The model answers a question, the plugin
  changes the effect of a permission check, and the host applies it. Nothing
  Jev says can execute, mutate, or approve anything on its own.
- **Every hook fails open.** On a missing key, a timeout, a bad HTTP status, a
  malformed body, a broken rules file, or a low-confidence answer, the call
  keeps the host's own effect. There is no path where a Jev problem stops the
  agent.
- **Only a confident answer changes anything.** A verdict below
  `hook_tool_risk.minProbability`, or within `hook_tool_risk.minMargin` of the
  runner-up, is not acted on. A rule below its threshold, or below
  `hook_tool_standard.minProbability`, is not violated.
- **Two switches can block, and only those two.** `hook_tool_risk` blocks on a
  `deny` or an `alert`; `hook_tool_standard` blocks on a violated rule whose
  effect is `block`. Both are off by default.
- **The key is never echoed, logged, or read back.** `/jev-key` writes it at
  mode 0600 and prints only the path. There is no command that takes a key as an
  argument, because anything after a slash command lands in the transcript.
- **Everything sent is redacted first.** Credential-shaped text (private keys,
  bearer tokens, `api_key = …` assignments) is stripped before the request
  leaves the machine, on every call, including the `jegrep` shim. It is a net,
  not a guarantee: do not hand it a secret on purpose.
- **The call log is 0600.** It records the exact redacted payload, the answers,
  and the token count, in the same directory as the key.

## Setup

Everything here is a setting rather than a constant. `protocol`, `endpoint`, and
`model` are the three that differ per provider: the wire model id and the
endpoint path have no portable default.

| Setting | Default | Change it with |
| --- | --- | --- |
| `protocol` | `systemone` | toggle in `/jev-settings` |
| `endpoint` | **empty; you set this first** | `/jev-endpoint <url>`, or `/jev-settings` |
| `model` | **empty; you set this first** | `/jev-model <id>`, or `/jev-settings` |
| `keyEnv` | `JEV_API_KEY` | `/jev-settings` |
| `keyFile` | `~/.config/fazuh-agent/secrets/jev_api_key` | `/jev-settings` |
| `think` | `false` | toggle in `/jev-settings` |
| `enabled` | `true` | `/jev-features` |
| `toast` | `false` | toggle in `/jev-settings`; master switch for the per-call TUI toasts |
| `yoloPropagate` | `block-notify` | what a `propagate` verdict does while the client auto-accepts: `block-notify` or `no-op` |
| `sidebar` | `true` | the sidebar section with the recent hook calls |
| `sidebarCount` | `5` | how many recent calls the sidebar shows (1-20) |
| `sidebarSubject` | `false` | whether each sidebar line also carries a clipped subject |
| `approveTtl` | `600` | seconds a blocked call stays approvable; `0` keeps it forever |
| `logMax` | `500` | `/jev-settings`; call-log line cap, pruned to the tail |

Per-feature settings live under `config` in the state file. Each feature
carries its own numbers; there are no global thresholds. A field you never
touched keeps its default, and an old file's global `minProbability` /
`minMargin` / `gateProbability` seed the matching per-feature fields on first
load, so tuned thresholds survive the upgrade.
| Feature | Field | Default | Meaning |
| --- | --- | --- | --- |
| `hook_skill_pick` | `timeout` | `5000` | ms before the hook gives up and injects nothing |
| `hook_skill_pick` | `minProbability` | `0.75` | a pick below this top probability is low confidence → no injection |
| `hook_skill_pick` | `minMargin` | `0.2` | a pick below this gap to the runner-up is low confidence → no injection |
| `hook_skill_pick` | `maxCandidates` | `150` | most skills offered to Jev (provider limit: 255) |
| `hook_skill_pick` | `maxPicks` | `-1` | most skills the advisory names (-1 = every qualifier, 1 = winner only) |
| `hook_skill_pick` | `alsoAbove` | `0.25` | runners-up at or above this join the winner |
| `hook_skill_pick` | `autoOptimize` | `true` | warm the optimizer cache when the installed skill set changes |
| `hook_skill_pick` | `optimizeModel` | `""` | optimizer model as `providerID/modelID`; empty = the session's own model, then the host default |
| `hook_skill_pick` | `toast` | `true` | announce each of this feature's calls as a TUI toast (the global `toast` must also be on) |
| `hook_tool_risk` | `timeout` | `3000` | ms before the call gives up; the call then keeps the host's effect. `0` waits for the provider, unbounded |
| `hook_tool_risk` | `minProbability` | `0.5` | the verdict's own label must reach this. Four labels split the probability mass, so `0.75` would almost never clear it |
| `hook_tool_risk` | `minMargin` | `0.15` | the gap to the runner-up a verdict must clear |
| `hook_tool_risk` | `actions` | `shell,edit` | the permission actions judged. Tool names work too: `write` and `patch` mean `edit`, `bash` means `shell`. `*` means every action |
| `hook_tool_risk` | `cache` | `true` | reuse the verdict for the same call in the same session |
| `hook_tool_risk` | `alertWebhook` | `""` | POST the alert to a Discord webhook; empty turns it off. The TUI toast is the other channel |
| `hook_tool_risk` | `toast` | `true` | announce each of this feature's calls as a TUI toast (the global `toast` must also be on) |
| `hook_tool_risk` | `toastOutcomes` | `deny,alert` | what a call has to end in for this feature to announce it: `allow`, `ask`, `deny`, `alert`, or `all` |
| `hook_tool_standard` | `rulesFile` | `~/.config/fazuh-agent/jev-rules.yaml` | the rules file. YAML, and YAML reads JSON, so a `.json` file works too |
| `hook_tool_standard` | `defaultEffect` | `block` | what a violated rule does: `block` or `propagate` |
| `hook_tool_standard` | `defaultThreshold` | `0.7` | the bar a rule score must reach |
| `hook_tool_standard` | `minProbability` | `0.7` | the confidence floor; a rule never fires below it |
| `hook_tool_standard` | `timeout` | `5000` | ms before the call gives up; the rules then change nothing. `0` waits for the provider, unbounded |
| `hook_tool_standard` | `actions` | `shell,edit` | the permission actions examined |
| `hook_tool_standard` | `fileMaxChars` | `8000` | characters a `{file:…}` reference may add to a rule |
| `hook_tool_standard` | `toast` | `true` | announce each of this feature's calls as a TUI toast (the global `toast` must also be on) |
| `hook_tool_standard` | `toastOutcomes` | `deny` | what a call has to end in for this feature to announce it: `allow`, `ask`, `deny`, `all` |

A state file written before the feature rename (`pick_skill`/`risk_hook`, and
then `hook_risk`) is migrated on load: the switch carries over, and so do the
settings whose meaning did not change. The old probability floors do not: the
old hook judged one binary question, the new one judges a four-way verdict,
so the same number would mean something else. `gateProbability` becomes
`hook_tool_risk.minProbability`, the bar for acting on an answer.

Endpoint and model ship empty on purpose. Both are provider-specific and neither
has a portable default, so the plugin carries nobody's billing details and
refuses every call with a message naming the setting to set. Any provider that
speaks the System One `/systemone` shape works.

## Two wire protocols

`protocol` picks how the questions travel.

**`systemone`**: the default. Posts `{ model, state, questions }` and reads an
`answers` object back. Needs a key. The reply envelope varies by deployment: a
native provider returns `answers` at top level, while a gateway in front may nest
it as `{ result: { answers, usage }, success }` — the client accepts both and
reads token usage from whichever level carries it.

**`chat`**: for a provider that speaks an Ollama-style `/api/chat`. The client
turns the same questions into one prompt and parses the reply back into the same
answers, so the validation and the confidence maths are unchanged. Needs no key,
and none is sent even if one is configured.

Four things a small chat model gets wrong, all handled in the parser, and all
found by running it rather than assuming:

| What it does | What the parser does |
| --- | --- |
| Invents its own answer keys (asked for `verdict` it answers `1`) | matches by key when the keys line up, by position when they do not, and fails when the count does not match |
| Echoes the question id into the `type` field | states the exact answer object next to each question, not in a preamble |
| Copies a placeholder like `"<winning label>"` verbatim | names the real labels in the shape, so it fills numbers in rather than copying |
| Omits a score's `legend` | synthesizes it from the question's own criteria, which is what the legend is |

`think` controls whether a chat model reasons before answering. It ships off
because a thinking model spent **51s** a call where the same model without it
spent **3–13s**.

A chat model's answers are graded but less certain than a hosted one's, so a
`minProbability` tuned for a hosted provider reports low confidence more often.
That is the threshold working honestly, not a fault, though a provider change
may want the threshold looked at.

The key is resolved at call time, first match wins: each env var in `keyEnv` in
order, then `keyFile`. `/jev-status` shows which one is in use, never the value.

`/jev-settings`, `/jev-features`, and `/jev-key` are **TUI-only**. The desktop
app loads no TUI module, so those three names do not exist there. The text
commands (`/jev-status`, `/jev-model`, `/jev-endpoint`, `/jev-log`) work
anywhere.

The model id is the **provider's own wire string**, not the namespaced id the host
shows in `/model`. A provider's catalogue list may omit the model entirely, so the
wire id often has to come from that provider's model page rather than from
any list the provider exposes.

## Commands

| Command | Where | What it does |
| --- | --- | --- |
| `/jev-features` | TUI | the panel: `Plugin`, then the three hook switches |
| `/jev-settings` | TUI | endpoint, model, key, key source, per-feature config, toasts, the YOLO branch, the approval lifetime |
| `/jev-key` | TUI | paste a key, written at 0600 |
| `/jev-approve [prefix]` | TUI | pick a blocked call and let the next matching one through once |
| `/jev-status` | either | endpoint, model, key source, plugin state, per-feature config, spend |
| `/jev-model <id>` | either | set the wire model id |
| `/jev-endpoint <url>` | either | set the endpoint |
| `/jev-optimize-skills` | either | optimize all stale skill criteria now; `<id>` refreshes one |
| `/jev-log` | either | recent calls: what was sent, what came back, what it cost |

`/jev-features` has a **Plugin** row at the top. It is the master switch: on or
off, and it does not change the two below it. Off means no hook runs and nothing
is sent. The two keep their values, so you can configure with the plugin
disabled and get your setup back when you re-enable it.

The panel closes when you change a row, because the only dialog primitive a
plugin can reach resolves on selection. [Issue #3](https://github.com/FAZuH/agent/issues/3)
tracks left/right to change a row in place, and records the measured reason the
documented non-closing API does not exist.

## The sidebar section

The plugin adds a `Jev` section to the TUI sidebar: the recent hook calls,
one terse line each — the hook, the verdict and the confidence.

```
Jev
risk accept 0.77
risk deny 0.87
pick commit 0.88
```

A row that decided nothing (a cached verdict, a rule that could not be read)
is not shown: the section is a history of decisions, not of the plugin's
inner life. `sidebarCount` caps the lines, `sidebarSubject` adds the subject
on a second line, and `sidebar` turns the section off.

A slot claim must return a real element. A bare string is an orphan text
node, and the host's tree walk treats that as a crash. The element runtime
comes from the host — a plugin imports `@opentui/solid/jsx-runtime` and
nothing is vendored.

## Call toasts

`toast` in `/jev-settings` turns on a TUI toast per Jev call. Each feature's own
`toast` field decides whether its calls are announced, and the global switch
gates all of them, so both must be on. Default is off globally, on per feature:
turn the master on and every hook announces until you opt one out.

Each feature's `toastOutcomes` then decides *which* of its calls are worth
announcing: the call has to end in one of the listed outcomes. The default
keeps the routine calls quiet — `deny,alert` for the risk hook, `deny` for the
rules hook — and `all` announces everything. A skip is never announced:
nothing was decided, so there is nothing to say. A failure always is.

One toast per call, built from the call log: a `<feature>: <verdict>
(<confidence>)` title over the facts that are left — the tool call it judged,
and, when the call was blocked, what stopped it and how to let it through:

```
hook_tool_risk: deny (0.87)

* blocked: denied (P=0.87)
* approve: /jev-approve a3f9c1
* shell: rm -rf ./build
```

A noul reads `yes` or `no` under the rule's name — `no-exfil=yes (0.87)` —
because the number is what the threshold is compared against and the label
alone hides it. A weak answer appends `(low)`. The subject is clipped to 120
characters and, like everything else in the log, redacted. A skip or a failure
replaces the bullets with that one line. The server draws no UI and the TUI
module is the only place a toast exists, so the TUI polls the log the server
already writes (every 2s) instead of a second channel. A TUI host is required:
the desktop app never toasts.

## How confidence works

Per feature, from that feature's own config:

- **`minProbability`**: a `choice` whose top probability below this, or a
  `noul` whose certainty (distance from a coin flip) below this, is low
  confidence. The skill hook injects nothing; a tool verdict changes nothing.
- **`minMargin`**: a `choice` whose gap to the runner-up below this is low
  confidence. A near-duplicate decoy is what this catches.
- **`defaultThreshold`** (`hook_tool_standard`): the bar a rule's score has to
  clear to count as violated. A rule may raise or lower it for itself.

`confidence` and the top `probability` on a `choice` are separate fields from the
provider and must not share a threshold.

Low confidence is never acted on. The hooks label it and hand the decision back;
the risk gate will not block on it.

## Cost

Provider-specific. `/jev-status` shows the running total for whichever provider
is configured, and `/jev-log` shows it per call. A feature switched off never
sends a request, so it costs nothing, and the `chat` protocol is free
whatever the provider.

Latency is provider- and protocol-specific: a hosted `systemone` call runs
0.6–2.0s, a local `chat` call runs 3–13s with thinking off and far longer with it
on. The skill hook's timeout (default 1s) means a slow provider simply yields no
advice for that prompt — the conversation does not wait longer than the timeout.

## Pointing it at another provider

Set the endpoint and the wire model id, and put the key somewhere the resolution
order will find it. Nothing else is provider-specific: the code names no
provider, and `DEFAULTS` only describes one working deployment.

If you get `401` or `403`, the key, the model id, or the account's plan for that
model is the problem, and the error message names which setting to check. `404`
usually means the endpoint is not the provider's decisions path.

## The jegrep shim

`jegrep` is the semantic-grep binary for the file-explorer use case. Its
`--endpoint local` posts to `JEGREP_ENDPOINT_URL` and deliberately sends no
`Authorization` header, so it cannot reach a provider that needs a bearer token.
`plugins/jev/src/shim.ts` is a loopback proxy that adds the header and forwards:

```bash
bun plugins/jev/src/shim.ts
JEGREP_ENDPOINT_URL=http://127.0.0.1:8756/ jegrep "which agent handles mail" --endpoint local
```

It reads endpoint, model, and key from the same state file as the plugin, so
repointing the plugin moves the shim with it. It is started by hand; nothing
supervises it.

## Where things live

Three XDG homes, three syncabilities: config syncs between machines, data is
expensive to rebuild so it stays local, the log is local history. Env
overrides: `JEV_CONFIG_DIR`, `JEV_DATA_HOME`, `JEV_STATE_HOME`,
`JEV_SECRET_DIR`. An old layout under `~/.config/fazuh-agent/data/` splits
into these on first load after the upgrade.

| Path | What |
| --- | --- |
| `~/.config/fazuh-agent/data/jev-state.json` | every setting (machine-local), 0600 |
| `~/.local/share/fazuh-agent/jev-data.json` | `skillCriteria` cache + `rosterHash` (local), 0600 |
| `~/.local/state/fazuh-agent/jev-calls.jsonl` | one line per call: payload, answers, cost (local); capped at `logMax` lines, pruned to the tail |
| `~/.local/state/fazuh-agent/jev-approvals.json` | the blocked calls waiting for a human, one entry per token (local, written by the server) |
| `~/.local/state/fazuh-agent/jev-grants.json` | the approved tokens (local, written by the TUI, spent by the server) |
| `~/.local/state/fazuh-agent/jev-tui.log` | TUI diagnostics, written on every panel open |
| `~/.config/fazuh-agent/secrets/jev_api_key` | the key, 0600 |
| `plugins/jev/src/jev.ts` | the client, redaction, and answer validator |
| `plugins/jev/src/state.ts` | the three homes, key resolution, the call log |
| `plugins/jev/src/index.ts` | the three hooks, the optimizer, and the text commands |
| `plugins/jev/src/rules.ts` | the rules file: the loader, the matcher, the `{file:…}` expansion |
| `plugins/jev/src/approve.ts` | the blocked calls, the tokens, and the grants |
| `plugins/jev/src/tui.ts` | the two panels, the key dialog, and the approve picker |

## Tests

```bash
bun test plugins/jev/src/jev.test.ts
```

No network: hand-built answer objects, so the checks are the shape rules and the
confidence maths, plus the feature-switch and config-migration state machine.
The suite redirects the data directory to a temp one, so it never rewrites your
real settings.

## Troubleshooting

**The skill hook says nothing in `/jev-log`.** Either the `hook_skill_pick` feature
is off, or the prompt hook was rejected by the host and the fallback path has
not seen a new prompt yet. `/jev-log` records the rejection when it happens.

**The skill hook advises nothing and spends nothing.** Check `/jev-status`: the
master switch, then the feature, then `config.hook_skill_pick.timeout`. A provider
slower than the timeout always yields no advice — raise the timeout or accept
the silence.

**A hook fails silently.** That is fail-open working. The reason is in
`/jev-log`: a missing key, a timeout, an HTTP status, or a malformed answer.

**`optimizer failed: Expected object` fills the log.** Fixed: the optimizer now
sends the payload object the host schema wants (`{ prompt, model }`) instead of
a bare string — the old shape was rejected by the host's payload validation
before any JSON reached the parser. Three consecutive failures now also latch
the auto path off for the process.

**A panel does not open.** Read `~/.local/state/fazuh-agent/jev-tui.log`. It logs
the TUI API shape and any error on every panel open. That log exists because this
failure was once silent.

**The documented plugin TUI API does not match reality.** `tui.d.ts` lists
`ui.DialogSelect`, `ui.DialogPrompt`, and `dialog.replace`. Measured on
v2.0.20, `ctx.ui` has `dialog, toast, format, router, panel, tabs, model, slot`
and `dialog` has `show, set, clear, alert, confirm, prompt, select`. Trust the
log, not the type definitions.

## See also

- [Plugins](plugins.md#jev-fazuhjev): the inventory entry
- [Port notes](dev/jev-port-notes.md): how this was built, what was verified
  live, and what is still unproven
