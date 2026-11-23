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

## Ask routing

`askMode` selects what the chain does with a call the host already answers with
an ask. `judged` (the default) runs the Jev, Parent, or Supervisor stage first
and then the Human card. No automated stage authorizes a host ask on its own: a
stage allow is recorded and withheld, and the card decides. `immediate` sends
the ask straight to the Human card and runs no stage. The release guard in
`src/chain.ts` enforces both directions, including an ask that appears only at
release.

## Pending human reviews

A review waiting for its human stays visible. `ChainHandle.reviews()`
(`src/chain.ts`) lists every ledger entry at the `human` stage, and
`watchdogStatus` projects them as `pending.reviews`: short session id, item id,
tool, action, stage, age, and `interrupted`. A row carries display fields and an
age only; no argument, prompt, or model text is reachable from the ledger or the
runtime.

The list has two sources, merged by `key|id` with the live row winning: the live
runtime (the audit form of the session, an age from the admission time) and the
durable ledger (the hashed session key, shortened, because the ledger stores
only hashes). A ledger row with no live runtime behind it was reported
interrupted by a restart: it renders `interrupted`, its call did not survive the
process that held it, and it offers no reopen. An unreadable ledger leaves the
live rows in place and is reported unreadable, never as an empty list.

`reopenPendingReview({itemID})` re-posts the card a live review still holds,
under the same form id, so the waiter already registered for it answers exactly
as before. Reopening authorizes nothing: the item still resolves only through
the human answer, deny and abort included. A review a restart reported is
refused as `interrupted`; one that already resolved is refused as `not-pending`.

`/permission-latest` reopens the newest live review of the calling session
(newest admission time, ties to the later entry) and answers with one line.
Nothing live answers `No pending human review to reopen.`; a session whose only
reviews a restart reported is told those calls did not survive.

## Denial and containment

A deny verdict cancels only the denied call, and only while that call is still
queued and unstarted (`containDeny(..., { shape: "queued" })` in `src/index.ts`).
A call that already started cannot be retracted by a deny: the containment path
for started work is the abort verdict, which aborts the session tree and applies
its durable ban. `containDeny` also accepts a `started` shape, but no production
caller selects it. It is tested library code; the chain reports started work
through abort, never by claiming a deny undid it.

## What never travels

Judge transcripts, reply text, and stored secrets never enter a feedback
prompt, an audit row, or a log line. Model identities never enter a feedback
prompt or an audit row; they do appear in Jev's own persistent call log, whose
`model` and `endpoint` fields are the allowed usage and cost trace. Audit rows
carry item ids, stages, verdicts, and fixed-category reasons. Jev failure logs
record `JevError.reason` (a fixed code), never the message. Restored ledger
entries are displayed sanitized; hostile keys and fields load nothing and show
nothing.

## The call log and its families

`jev-calls.jsonl` holds every hook's rows. `/jev-log` reads families, not the
whole file (`JEV_LOG_HOOKS` and `CHAIN_LOG_HOOKS` in
`src/feature-families.ts`):

| Argument | Hooks |
| --- | --- |
| none | `hook_skill_pick`, `hook_tool_risk`, `hook_tool_standard` |
| `chain` | `hook_watchdog_chain` |
| `all` | every hook, unfiltered |

The Jev family is the model-call hooks; the chain family is audit rows (stage
verdicts, admissions, denials). The chain's judge calls do reach the Jev
library: its Jev stage calls `ask()` in `lib/jev/jev.ts` (`chainJev` in
`src/index.ts`) and stays out of the log only because that call passes
`log: false`; its Supervisor and Parent stages call `session.generate`.
`hook_supervisor`, `hook_session_ban`, and `hook_abort_receipts` write audit
rows and belong to neither family, as do rows logged under a command's own name
(`jev-model`, `rpc`); all of them appear only under `all`. The alert webhook
logs under `hook_tool_risk`, so its status rows count as Jev-family rows. The
chain and supervisor audit rows render with their own fields and no cost tail.
The supervisor's rejected-answer row (`lib/jev/jev.ts:570`) logs unconditionally
with `inputTokens`, so the default view can hide one token-bearing supervisor
row. The audit line prints `event`, `stage`, `verdict`, `protection`, and the
page's summary; it does not print `hook_session_ban`'s `site` field, and
`hook_abort_receipts` rows appear only under `all`. An unknown argument answers
with the three accepted values. The page's call log is unchanged: it still
filters the rows it received by hook and outcome.

## Rollout limits and defaults

The chain ships off. Activation needs both the review switch and a
`chain-gate.json` carrying `{"gate":"passed"}` in the Jev state directory, and
the only writer that file has is `src/capability-gate.ts`. The switch is the
Watchdog page's persisted `watchdog.chain` setting; `WATCHDOG_CHAIN` wins over it
when it is defined (`1` on, any other value off). The wrapper registers on every
plugin setup and reads the switch per call, so a page toggle takes effect on the
next call with no relaunch. While the switch is off the wrapper is inert: no
audit row, no host check, no hold, no decision, no card, and nothing subscribes
to the form feed. The measured
capability report (ticket #10, CAPABILITY-REPORT.md) keeps the gate `blocked`:
eight required capabilities, and every one failed, unverified, partial, or
sourced from anything but a real-host run records as a gating limitation.

Approved defaults (`CHAIN_DEFAULTS` in `src/chain.ts`, env names in
`src/watchdog-config.ts`; an unset or unusable value falls back to the default):

| Setting | Default | Environment override |
| --- | --- | --- |
| sessionCap | 4 | `WATCHDOG_CHAIN_CAP` |
| jevBatch | `{max:1, ms:0}` | `WATCHDOG_CHAIN_JEV_BATCH_MAX`, `WATCHDOG_CHAIN_JEV_BATCH_MS` |
| supervisorBatch | `{max:1, ms:0}` | `WATCHDOG_CHAIN_BATCH_MAX`, `WATCHDOG_CHAIN_BATCH_MS` |
| repair.max | 1 | `WATCHDOG_CHAIN_REPAIR_MAX` |
| transport | `{attempts:2, backoffMs:250}` | `WATCHDOG_CHAIN_TRANSPORT_ATTEMPTS`, `WATCHDOG_CHAIN_TRANSPORT_BACKOFF_MS` |
| timing | `blocking` | `WATCHDOG_CHAIN_TIMING` |
| nodes | all four on | `WATCHDOG_CHAIN_NODES` |
| askMode | `judged` | `WATCHDOG_CHAIN_ASK_MODE` |
| chain switch | off | `WATCHDOG_CHAIN` (defined wins: `1` on, anything else off) |
| humanOnly | empty allowlist | `WATCHDOG_CHAIN_HUMAN_ONLY` (environment-only) |

A batch window clamps to at least one item and a non-negative interval
(`bound` in `src/chain.ts`). Fixed caps no setting raises:
`SUPERVISOR_PROMPT_MAX` 24000 characters, `HUMAN_BRIEF_MAX` 1500 characters,
`DESCENDANT_SCAN_MS` 5000 for one descendant listing (past it the scan is
unavailable and containment is incomplete, never unbounded).

Abort receipts (`hook_abort_receipts`) stay off by default; enabled, the
default webhook is empty so nothing is sent, `maxAttempts` 3,
`retryDelayMs` 2000.

Values seen only in probes and test fixtures, such as batch windows in
seconds or caps above four, are experiment bookkeeping, never approved
defaults: no synthetic probe tunes a shipped number. A
`WATCHDOG_CHAIN_TIMING=nonblocking` selection stays gated (C3: a started
transient generation cannot be cancelled), so the call is held for
authorization and the selection is reported, never passed.
