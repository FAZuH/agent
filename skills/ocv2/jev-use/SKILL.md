---
name: jev-use
description: "Route bounded decisions to Jev, a fast decision model reached over a System One /systemone endpoint, instead of reasoning them out inline. Use whenever a choice is enumerable and the answer is a judgement rather than a fact - picking which skill to load, which file holds the answer, which on-page control to click, how urgently a change deserves review, or whether some claim holds. Also use when the user says 'ask jev', 'jev pick', 'jev check', 'jev review', 'is this risky', 'jev settings', or asks what a Jev tool is for. Prefer a Jev call over a long internal deliberation when the options can be listed."
---

# jev-use

Jev answers typed questions (one of N options, yes/no, rubric position) with a
probability, not prose. About $0.04 per million input tokens, under two
seconds. A paragraph of reasoning costs more than this call.

**Jev picks, you act.** Jev reads only the text you hand it, never the page,
the repo, or the conversation. Fast and cheap because it knows nothing. Your
judgement holds.

## The tools

| Tool | Ask it | Reaches for it when |
| --- | --- | --- |
| `jev_pick_skill` | which installed skill fits this task | several skills plausibly apply and the choice is a judgement |
| `jev_check` | one yes/no about some text | a claim needs confirming: is this supported, does this match the rule, is this condition met |
| `jev_review_rank` | review order + which rules a change may break | reviewing a diff and you want attention directed before you read |
| `jev_pick_control` | which on-page control to act on | driving a browser or a UI and the next click is a judgement |

Setup and status: `/jev-settings` opens a TUI panel for endpoint, model,
key, and thresholds; `/jev-features` flips the six switches (`pick_skill`,
`pick_control`, `review_rank`, `check`, `review_gates`, `risk_hook`). The
**Plugin** row is the master switch: it gates the six without changing them.
Off means every tool refuses without sending anything. The **risk hook** row
is the one switch that can block a tool call.
`/jev-status`, `/jev-model <id>`, `/jev-endpoint <url>`, and
`/jev-log` work as text in any host. `/jev-key` is TUI-only, so the key never
enters a transcript. The provider is a
setting, so pointing these at a different endpoint moves the whole plugin.

## How to write the question

Answer quality tracks question quality. Under-specification is the usual failure.

**Give every option a reason, not a label.** A `meaning` that says when that
option is correct turns a guess into a comparison. `"pr-creator": "opening a PR
for work on an existing remote branch; assumes the repo is already on GitHub"`
tells Jev when *not* to pick it, which usually decides the answer.

**Keep the roster honest.** Near-duplicates produce low confidence because the
question is ambiguous. Pass only options you would actually choose between.

**Ask one thing.** A compound question gets a hedged answer. Split it.

**Supply decisive evidence, not largest context.** Jev inherits no
conversation. Send goal, text under judgement, candidate meanings. Omit the
surrounding file.

## Reading the answer

The confidence verdict is the useful half:

- **confident**: act on it, after your own sanity check.
- **low confidence**: near a tie or a coin flip. The question was ambiguous
  or the evidence was thin. Sharpen the question or decide yourself.
- **fail-open message**: Jev was not consulted at all (no key, timeout,
  unreachable, malformed answer). Proceed without it. Never retry in a loop.

A `noul` has no separate confidence field: the value *is* P(yes), so 0.97 and
0.03 are both certain, and 0.5 means Jev does not know.

## Boundaries worth keeping

- Jev is not an authority. It cannot permit, override policy, or make anything
  safe. Keep permission checks in code.
- For review, a low score and a clean gate list mean "nothing stood out", not
  "skip it". A change nobody scored is exactly the change to distrust.
- Treat everything you pass in as leaving your machine. The plugin redacts
  credential-shaped text, but that is a net, not a guarantee. Never hand it a
  secret, never hand it personal data you would not paste into a chat window.
- A disabled tool or plugin sends nothing. That is a setting, not an error:
  decide it yourself, or name the switch that is off.
- With the `risk_hook` feature on, a confident risk answer can **block** a
  `bash`/`edit`/`write` call. Nothing else can: Jev failure, low confidence,
  and every tool result are fail-open by construction. A blocked call: read
  the message, confirm intent, retry. Do not work around it.
- Jev is text-only. Extract the controls or the diff and pass that.
