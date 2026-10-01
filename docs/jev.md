# Jev

The `fazuh.jev` plugin asks [Jev](https://typesafe.ai), TypeSafe's System One
decision model, questions whose answers are judgements rather than facts: which
skill to load, which on-page control to click, how much review a change deserves,
whether a claim holds. It answers with probabilities, never with an action.

It is one plugin with four tools, a TUI settings panel, and six feature
switches. Setup and the full command list are in
[Plugins](plugins.md#jev-fazuhjev); this page is the operating reference — what
it guarantees, what it costs, and how to point it somewhere else.

## The safety contract

These are the rules the code enforces, not aspirations:

- **Jev never acts.** Every tool returns a decision and stops. Nothing it says
  can execute, mutate, or approve anything.
- **Every tool fails open.** On a missing key, a timeout, a bad HTTP status, a
  malformed body, or a low-confidence answer, the tool says Jev was not
  consulted and tells you to decide for yourself. There is no path where a Jev
  problem stops the agent.
- **A low review score never excludes code.** `jev_review_rank` sorts every item
  it was given and returns all of them. A score of zero, a clean rule list, and a
  failed rule call are all prose in the output, never a filter.
- **One switch can block anything, and only that one.** With the `risk_hook`
  feature on, a `bash`, `edit`, `write`, or `apply_patch` call is sent to Jev and
  logged. It is blocked only when the answer is *both* confident *and* at or
  above `gateProbability` — so a Jev failure, a coin-flip answer, and a weak
  answer all pass through. The hook is off by default, because a blocked call
  has no interactive prompt.
- **The key is never echoed, logged, or read back.** `/jev-key` writes it at
  mode 0600 and prints only the path. There is no command that takes a key as an
  argument, because anything after a slash command lands in the transcript.
- **Everything sent is redacted first.** Credential-shaped text — private keys,
  bearer tokens, `api_key = …` assignments — is stripped before the request
  leaves the machine, on every call, including the `jegrep` shim. It is a net,
  not a guarantee: do not hand it a secret on purpose.
- **The call log is 0600.** It records the exact redacted payload, the answers,
  and the token count, in the same directory as the key.

## Setup

Three things, all settings rather than constants, because the wire model id and
the endpoint path differ per provider and neither has a portable default.

| Setting | Default | Change it with |
| --- | --- | --- |
| `protocol` | `systemone` | toggle in `/jev-settings` |
| `endpoint` | **empty — you set this first** | `/jev-endpoint <url>`, or `/jev-settings` |
| `model` | **empty — you set this first** | `/jev-model <id>`, or `/jev-settings` |
| `keyEnv` | `JEV_API_KEY` | `/jev-settings` |
| `keyFile` | `~/.config/fazuh-agent/secrets/jev_api_key` | `/jev-settings` |
| `think` | `false` | toggle in `/jev-settings` |
| `enabled` | `true` | `/jev-features` |
| `minProbability` | `0.8` | `/jev-settings` |
| `minMargin` | `0.15` | `/jev-settings` |
| `gateProbability` | `0.7` | `/jev-settings` |

Endpoint and model ship empty on purpose. Both are provider-specific and neither
has a portable default, so the plugin carries nobody's billing details and
refuses every call with a message naming the setting to set. Any provider that
speaks the System One `/systemone` shape works.

## Two wire protocols

`protocol` picks how the questions travel.

**`systemone`** — the default. Posts `{ model, state, questions }` and reads an
`answers` object back. Needs a key.

**`chat`** — for a provider that speaks an Ollama-style `/api/chat`. The same
questions become one prompt, and the reply is parsed back into the same answers,
so the validation and the confidence maths are unchanged. Needs no key, and none
is sent even if one is configured.

Three things a small chat model gets wrong, all handled in the parser, and all
found by running it rather than assuming:

| What it does | What the parser does |
| --- | --- |
| Invents its own answer keys — asked for `verdict` it answers `1` | matches by key when the keys line up, by position when they do not, and fails when the count does not match |
| Echoes the question id into the `type` field | states the exact answer object next to each question, not in a preamble |
| Copies a placeholder like `"<winning label>"` verbatim | names the real labels in the shape, so it fills numbers in rather than copying |
| Omits a score's `legend` | synthesizes it from the question's own criteria, which is what the legend is |

`think` controls whether a chat model reasons before answering. It ships off
because a thinking model spent **51s** a call where the same model without it
spent **3–13s**.

A chat model's answers are graded but less certain than a hosted one's, so a
`minProbability` tuned for a hosted provider reports low confidence more often.
That is the threshold working honestly, not a fault — but a provider change may
want the threshold looked at.

The key is resolved at call time, first match wins: each env var in `keyEnv` in
order, then `keyFile`. `/jev-status` shows which one is in use, never the value.

`/jev-settings` and `/jev-features` and `/jev-key` are **TUI-only**. The desktop
app loads no TUI module, so those three names do not exist there. The text
commands — `/jev-status`, `/jev-model`, `/jev-endpoint`, `/jev-log` — work
anywhere.

The model id is the **provider's own wire string**, not the namespaced id the host
shows in `/model`. A provider's catalogue list may omit the model entirely, so
the wire id often has to come from that provider's model page rather than from
any list you can query.

## Commands

| Command | Where | What it does |
| --- | --- | --- |
| `/jev-features` | TUI | the panel: `Plugin`, then the six feature switches |
| `/jev-settings` | TUI | endpoint, model, key, key source, thresholds |
| `/jev-key` | TUI | paste a key, written at 0600 |
| `/jev-status` | either | endpoint, model, key source, plugin state, spend |
| `/jev-model <id>` | either | set the wire model id |
| `/jev-endpoint <url>` | either | set the endpoint |
| `/jev-log` | either | recent calls: what was sent, what came back, what it cost |

`/jev-features` has a **Plugin** row at the top. It is the master switch: on or
off, and it does not change the six below it. Off means every tool refuses and
no tool call is sent. The six keep their values, so you can configure with the
plugin disabled and get your setup back when you re-enable it.

The panel closes when you change a row, because the only dialog primitive a
plugin can reach resolves on selection. Left/right to change a row in place is
tracked in [issue #3](https://github.com/FAZuH/agent/issues/3), together with the
measured reason the documented non-closing API does not exist.

## The tools

**`jev_pick_skill`** — which installed skill to load. Give it the request and the
candidates as `name` plus the one-line description each `SKILL.md` already
carries; you do not need their bodies. It returns one id and a probability.

**`jev_pick_control`** — which on-page control matches a goal. Text only. Extract
the controls yourself and pass them; Jev cannot see a page or a screenshot.

**`jev_review_rank`** — review priority per changed file. Pass a goal, and per
item a path, what the file is for, and the change. It returns an ordering plus
warnings for rules the change may break. **Every item comes back.** A `score`
answer is fractional, so the output names the band between two adjacent rubric
levels rather than a level index.

**`jev_check`** — one yes/no question about a piece of text, returning P(yes).
Ask one thing per call; a compound question gets a coin-flip answer. There is no
separate confidence field for a `noul`: a value near 0.5 means Jev does not know.

## How confidence works

Three different quantities, and conflating them is the easy mistake:

- **`minProbability`** — a `choice` whose top probability is below this is
  reported as low confidence.
- **`minMargin`** — a `choice` whose gap to the runner-up is below this is
  reported as low confidence. A near-duplicate decoy is what this catches.
- **`gateProbability`** — the risk hook's block threshold and the review
  tool's warning threshold. One number, two uses, because they are the same
  judgement at different scales.

`confidence` and the top `probability` on a `choice` are separate fields from the
provider and must not share a threshold.

Low confidence is never acted on. The tools label it and hand the decision back
to you; the hook will not block on it.

## Cost

Provider-specific. `/jev-status` shows the running total for whichever provider
is configured, and `/jev-log` shows it per call. A feature switched off refuses
before the request, so it costs nothing, and the `chat` protocol is free
whatever the provider.

Latency is provider- and protocol-specific: a hosted `systemone` call runs
0.6–2.0s, a local `chat` call runs 3–13s with thinking off and far longer with it
on. Every call is a POST, so it happens while you wait.

## Pointing it at another provider

Set the endpoint and the wire model id, and put the key somewhere the resolution
order will find it. Nothing else is provider-specific: the code names no
provider, and `DEFAULTS` only describes one working deployment.

If you get `401` or `403`, the key, the model id, or the account's plan for that
model is the problem — the error message names which setting to check. `404`
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

| Path | What |
| --- | --- |
| `~/.config/fazuh-agent/data/jev-state.json` | every setting, 0600 |
| `~/.config/fazuh-agent/data/jev-calls.jsonl` | one line per call: payload, answers, cost, 0600 |
| `~/.config/fazuh-agent/data/jev-tui.log` | TUI diagnostics, written on every panel open |
| `~/.config/fazuh-agent/secrets/jev_api_key` | the key, 0600 |
| `plugins/jev/src/jev.ts` | the client, redaction, and answer validator |
| `plugins/jev/src/state.ts` | settings, key resolution, the call log |
| `plugins/jev/src/tui.ts` | the two panels and the key dialog |

## Tests

```bash
bun test plugins/jev/src/jev.test.ts
```

No network: hand-built answer objects, so the checks are the shape rules and the
confidence maths. The suite redirects the data directory to a temp one, so it
never rewrites your real settings.

## Troubleshooting

**A tool says "is turned off".** Either the master `Plugin` switch is off, or
that one feature is. `/jev-features` shows which. Nothing was sent, so nothing
was spent.

**A tool says "Jev was not consulted".** That is fail-open working. The reason is
in the message: a missing key, a timeout, an HTTP status, or a malformed answer.

**A panel does not open.** Read `~/.config/fazuh-agent/data/jev-tui.log`. It logs
the TUI API shape and any error on every panel open. That log exists because this
failure was once silent.

**The documented plugin TUI API does not match reality.** `tui.d.ts` lists
`ui.DialogSelect`, `ui.DialogPrompt`, and `dialog.replace`. Measured on
v2.0.20, `ctx.ui` has `dialog, toast, format, router, panel, tabs, model, slot`
and `dialog` has `show, set, clear, alert, confirm, prompt, select`. Trust the
log, not the type definitions.

## See also

- [Plugins](plugins.md#jev-fazuhjev) — the inventory entry
- [Port notes](dev/jev-port-notes.md) — how this was built, what was verified
  live, and what is still unproven
- [@jev-use](../skills/ocv2/jev-use/SKILL.md) — the skill that tells an agent
  when to reach for it
