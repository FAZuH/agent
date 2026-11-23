# ADR 0004: Chain activation as persisted state, and ask routing as a setting

- Status: accepted (2026-11-23)
- Scope: Watchdog review activation and host-ask routing
- Amends: [ADR 0003: Watchdog review chain, bounded speculation, and operation-scoped recovery](0003-watchdog-review-chain-and-recovery.md)

## Context

ADR 0003 decision 11 keeps the chain off until explicitly enabled, but the only
enablement was the `WATCHDOG_CHAIN` environment variable read once at plugin
setup. Ticket #18's page could report the chain and never arm it, so an operator
toggle needed a relaunch, and a page that writes state the runtime never reads
misreports what enforcement does.

ADR 0003 decision 1 defines the chain as Jev, one LLM stage, then Human, and
decision 6 makes a host deny or human-only gate absolute. The shipped chain skipped
every stage for an item the host already answered with an ask, sending it straight
to the Human card. That skip was undocumented, so a subagent's high-risk call
reached the human with no model review at all, contradicting the documented order
even though the outcome was still gated.

Two measured host facts constrain the routing decision. A host interrupt of a
transient generation returns `interrupted: false`, so a started generation cannot
be cancelled. The host delegates its own asks to the plugin's verdict, and one
plugin allow clears that ask for that call.

## Decision

1. Activation is persisted state with the environment as an override. The
   operator switch is the Watchdog page's `watchdog.chain` boolean. `WATCHDOG_CHAIN`
   wins over it when the variable is defined: `1` means on and any other value
   means off. The `chain-gate.json` capability file remains the second condition;
   the switch off means the gate file is not read. `chainStatus` in `src/index.ts`
   is the single reading of both conditions.

2. The chain wrapper registers on every plugin setup and reads the switch per
   call, so a page toggle takes effect on the next call with no relaunch. While
   the switch is off the wrapper is inert: no audit row, no host check, no hold,
   no decision, no card, and no form subscription. The form feed, the review
   filter, and the review dependencies attach lazily at the first non-off
   judgment, or eagerly at setup when the switch is already on. An attach failure
   is reported as the fail-closed posture it is, and stays reported after a later
   lazy attach fails.

3. Host-ask routing is the persisted `watchdog.askMode` setting with
   `WATCHDOG_CHAIN_ASK_MODE` as its override. `judged` is the default.
   `immediate` preserves the pre-#21 skip: the stages run nowhere and the Human
   card decides. `judged` runs the same stages a normal item gets, and no
   automated stage may authorize a host ask: a stage allow is recorded as a row
   and withheld, and the Human card decides. No later automated stage runs after
   a withheld allow. The release guard in `src/chain.ts` enforces this for an ask
   that is already known and for one that appears only at release; the card is
   the only authorization path for a host ask.

4. Denial containment is documented as shipped. A deny verdict cancels only the
   denied call, and only while it is queued and unstarted. A call that already
   started is contained by the abort verdict, which aborts the session tree and
   applies its durable ban. The `started` shape of `containDeny` stays tested
   library code with no production caller, because the host cannot cancel a
   started generation and cannot be relied on to report an interrupt it did not
   make.

5. A pending human review stays visible and reopenable. `ChainHandle.reviews()`
   lists every ledger entry at the `human` stage, and `watchdogStatus` projects
   it as `pending.reviews`: short session id, item id, tool, action, stage, age,
   and `interrupted`. Live rows and durable ledger rows are merged by `key|id`
   and the live row wins. `reopenPendingReview({itemID})` re-posts the card a
   live review still holds under the same form id, so the waiter registered for
   it answers as before; reopening authorizes nothing, and the item still
   resolves only through the human answer. A row a restart reported renders
   `interrupted` and cannot be answered. `/permission-latest` reopens the newest
   live review of the calling session and answers with one plain line. The list
   never activates the chain, reads the gate while the switch is off, or
   authorizes a call.

## Consequences

- A page toggle changes enforcement on the next call, and the page can never
  claim an activation the runtime does not perform.
- The environment keeps precedence for headless runs and tests, including the
  ability to hold the chain off against persisted state.
- A host ask always ends at the Human card. In `judged` the stages add rows and
  context but no authorization; in `immediate` the card is the only record.
- The switch off subscribes to nothing, so an off chain holds no form feed and
  cannot resolve a card it never opened.
- Deny remains a pre-execution refusal. Started work is only ever contained by
  abort, and containment claims stay separate from the deny that produced them.
- A dismissed card no longer strands a session: the page lists what is still
  waiting and reopens the same card, while the human answer stays the only
  authority. A restart's reviews stay visible as interrupted instead of
  disappearing, and nothing in the list can be answered after the fact.
