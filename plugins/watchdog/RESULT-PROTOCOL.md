# Watchdog review: judge result protocol

The result contract for the review chain's LLM stages (`src/chain.ts`). The
Supervisor and Parent stages share it; the Jev decision model's answer map
follows the same binding at its seam.

## The stage result

A stage reply must be exactly one JSON object and nothing else:

`{"results":[{"id":"<item id>","verdict":"allow|deny|abort|propagate","reason":"..."}]}`

One row per item id under review, no more and no fewer. Item ids are minted at
admission (`wd_<hash>.<seq>`) and bind the producing session, tool, action, and
canonical input, so a row can only answer a call that was actually asked.

The reply is all-or-nothing: any deviation invalidates the whole reply and no
part of it becomes a decision.

| Rejected when | Category |
| --- | --- |
| not one complete JSON object, or the rows are not objects | `malformed` |
| a row names an id that was never asked | `unknown-id` |
| a row repeats an id | `duplicate-id` |
| a verdict is not one of the four labels | `invalid-verdict` |
| a reviewed id has no row | `missing-id` |

`parseSupervisorReply` and `replyFailure` in `src/chain.ts` are the source of
truth for this table.

## Feedback repair

A rejected reply earns a bounded re-ask of the same judge with the same
unresolved batch: the unchanged base prompt plus one feedback block that names
the category and repeats the schema. The rejected reply's text is never echoed
back. Total asks for one round never exceed 1 + the repair bound; the bound is
`WATCHDOG_CHAIN_REPAIR_MAX`, and 0 disables repair. Defaults live in
`CHAIN_DEFAULTS` (`src/chain.ts`).

## Transport

Each ask gets up to `WATCHDOG_CHAIN_TRANSPORT_ATTEMPTS` tries. The delay before
a retry is `WATCHDOG_CHAIN_TRANSPORT_BACKOFF_MS` times the retries already made:
linear, never exponential. A throw, a dropped transport, or a failed review
filter proof all count as a failed try. Retries re-send the same prompt and
items; no reviewed tool and no host check runs again.

Exhaustion, at either layer, means the stage is unavailable for those items.
Unavailable never allows: the batcher settles each unresolved item
`unavailable`, the chain escalates it, and an unavailable Parent advances to the
Human, never to the Supervisor.

## Immutability and cancellation

An accepted per-item decision ends that stage's ownership: the batcher resolves
each item once, and a late or repeated reply cannot revise a resolved item, an
unanswered card, a released hold, or a completed decision. Release re-reads the
host rules, effective bans, and abort marks, and an abort that landed during a
pending stage or check outranks whatever the late reply says.

An abort cancels its subtree's queued reviews and settles in-flight ones
unresolved. Repair and retry rounds are ordinary in-flight asks under this rule:
their late answers arrive for entries that are already settled and decide
nothing.

## The Jev answer map

The decision model answers through the same binding: decisions naming ids that
are not under review authorize nothing, and an item missing from the answer map
settles `unavailable` and escalates. A thrown batch makes every item
unavailable. The live wiring's per-item fallback (`chainJev` in `src/index.ts`)
re-asks the identical question once per unresolved item: a fixed question, not a
conversational nudge, with no LLM repair loop, and its answers pass the same
expected-id filter.

## What never travels

Judge transcripts, reply text, and stored secrets never enter a feedback
prompt, an audit row, or a log line. Model identities never enter a feedback
prompt or an audit row; they do appear in Jev's own persistent call log, whose
`model` and `endpoint` fields are the allowed usage and cost trace. Audit rows
carry item ids, stages, verdicts, and fixed-category reasons. Jev failure logs
record `JevError.reason` (a fixed code), never the message. Restored ledger
entries are displayed sanitized; hostile keys and fields load nothing and show
nothing.
