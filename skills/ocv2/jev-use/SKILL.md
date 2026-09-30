---
name: jev-use
description: "Route bounded decisions to Jev, a fast decision model reached over a System One /systemone endpoint, instead of reasoning them out inline. Use whenever a choice is enumerable and the answer is a judgement rather than a fact - picking which skill to load, which file holds the answer, which on-page control to click, how urgently a change deserves review, or whether some claim holds. Also use when the user says 'ask jev', 'jev pick', 'jev check', 'jev review', 'is this risky', 'jev settings', or asks what a Jev tool is for. Prefer a Jev call over a long internal deliberation when the options can be listed."
---

# jev-use

Jev answers typed questions — one of N options, a yes/no, or a position on a
rubric — and returns a probability instead of prose. It costs about $0.04 per
million input tokens and answers in under two seconds, so a decision that would
otherwise cost a paragraph of reasoning is nearly free.

The division of labour matters: **Jev picks, you act.** A Jev answer is a
second opinion from something that cannot see the page, the repo, or the
conversation. It reads only the text you hand it. So it is fast and cheap
precisely because it knows nothing, which means your judgement is still the one
that has to hold up.

## The tools

| Tool | Ask it | Reaches for it when |
| --- | --- | --- |
| `jev_pick_skill` | which installed skill fits this task | several skills plausibly apply and the choice is a judgement |
| `jev_check` | one yes/no about some text | a claim needs confirming: is this supported, does this match the rule, is this condition met |
| `jev_review_rank` | review order + which rules a change may break | reviewing a diff and you want attention directed before you read |
| `jev_pick_control` | which on-page control to act on | driving a browser or a UI and the next click is a judgement |

Setup and status: `/jev-settings` opens a TUI panel for the endpoint, model,
key, and thresholds; `/jev-features` flips the six feature switches (`pick_skill`,
`pick_control`, `review_rank`, `check`, `review_gates`, `risk_hook`). Both stay
open — arrows move, enter changes one value, esc closes. `/jev-status`,
`/jev-model <id>`, `/jev-endpoint <url>`, `/jev-on`, `/jev-gate on|off`,
`/jev-feature <name> on|off`, and `/jev-log` do the same things as text and work
in any host. `/jev-key` is TUI-only, so the key never enters a transcript. The
provider is a
setting, so pointing these at a different endpoint moves the whole plugin.

## How to write the question

The quality of the answer is bounded by the quality of the question, and the
question is usually the part you are under-specifying.

**Give every option a reason, not a label.** A `meaning` that says when that
option is correct turns a guess into a comparison. `"pr-creator" — "opening a PR
for work on an existing remote branch; assumes the repo is already on GitHub"`
tells Jev when *not* to pick it, which is usually what decides the answer.

**Keep the roster honest.** If two options are near-duplicates, expect a
low-confidence answer, because the question really is ambiguous. Narrow the
list to the ones you would actually choose between rather than passing a
catalogue and hoping.

**Ask one thing.** A compound question gets a hedged answer, because it is
several questions wearing one hat. Split it.

**Supply the decisive evidence, not the largest context.** Jev does not inherit
your conversation. It needs the goal, the specific text under judgement, and
what each candidate means. It does not need the surrounding file.

## Reading the answer

Every tool returns a confidence verdict, and it is the more useful half:

- **confident** — the answer is worth acting on, after your own sanity check.
- **low confidence** — Jev is near a tie or near a coin flip. This is the
  interesting case, not a failure. It usually means the question was ambiguous
  or the evidence was thin. Either sharpen the question or decide it yourself.
- **fail-open message** — Jev was not consulted at all (no key, timeout,
  unreachable, malformed answer). Proceed without it. Never retry in a loop.

A `noul` has no separate confidence field: the value *is* P(yes), so 0.97 and
0.03 are both certain, and 0.5 means Jev does not know.

## What it costs

Roughly $0.00002 for a small pick, $0.00005 for a review. A four-item review is
under a tenth of a cent. `jegrep` (installed by `install.sh -b`, used through
this plugin's loopback shim) is about $0.003 per search, which is the expensive
one because it reads file contents.

So the cost is not the reason to hesitate before asking. The reason to hesitate
is that **the answer is only as good as the text you sent**, and you just paid
to send text to a service that cannot see what you see.

## Boundaries worth keeping

- Jev is not an authority. It cannot grant permission, override a policy, or
  make something safe. Real permission checks stay in code.
- For review, a low score and a clean gate list mean "nothing stood out", not
  "skip it". A change nobody scored is exactly the change to distrust.
- Treat everything you pass in as leaving your machine. The plugin redacts
  credential-shaped text, but that is a net, not a guarantee — do not hand it a
  secret on purpose, and do not hand it personal data you would not paste into
  a chat window.
- If a tool's feature switch is off, it says so and sends nothing. That is a
  setting, not an error: decide it yourself, or tell the user the switch is off.
- With `/jev-on`, a confident risk answer can **block** a `bash`/`edit`/`write`
  call. Nothing else can: a Jev failure, a low-confidence answer, and every tool
  result are fail-open by construction. If a call is blocked, read the message,
  confirm the action is intended, and retry — do not work around it.
- Jev is text-only. It cannot see a screenshot, a rendered page, or a file. You
  extract the controls or the diff and pass that.
