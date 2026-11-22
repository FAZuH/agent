# ADR 0003: Watchdog review chain, bounded speculation, and operation-scoped recovery

- Status: accepted (2026-11-21)
- Scope: Watchdog review, admission, enforcement, and recovery
- Supersedes: [ADR 0002: Jev supervisor for held permission checks](0002-jev-supervisor-for-held-asks.md)

## Context

ADR 0002 resolves held permission checks through Supervisor review.
Its mixed history and read-only project evidence do not satisfy the separate
context requirements for risk review and Parent delegation review.
Its immediate propagation of malformed results also prevents bounded repair
of individual missing or invalid decisions.
Its deny-to-Human consequence does not contain rejected work that already started.

Watchdog needs one enforcement owner across root and subagent work.
Nonblocking review needs bounded admission because later decisions cannot undo
completed effects. Recovery needs independent abort operations because releasing
an ancestor's restriction must not erase a child's separate abort.

## Decision

Role definitions: [glossary](../../GLOSSARY.md#language).

1. Watchdog owns enforcement. The chain is Jev, one large language model
   (LLM) stage, then Human. Use the host-recorded direct Parent for subagents
   and Supervisor for root sessions. Parent and Supervisor are alternatives.
   Parent propagation or unavailability advances to Human, never Supervisor.
   Only propagate advances a verdict to the next stage.
   Allow, deny, and abort are terminal outcomes for the review item.
   Disabled or inapplicable nodes skip without allow.
   Reported unavailability escalates unresolved items without authorization.
   Unresolved chain exhaustion never grants permission.

2. Use `session.generate` for transient LLM review with text JSON per-item
   results and Watchdog-owned validation feedback. Create no native fork,
   new judge session, or Parent conversation messages.
   Judge tool execution is not supported or required.
   Usage and cost traces are allowed.

3. Supersede ADR 0002's mixed-history and read-only project-evidence contracts.
   Jev and Supervisor receive minimal selected genuine user prompts plus
   the exact current task, proposed tool name, and arguments.
   Exclude historical assistant messages, tool calls, tool outputs, file
   expansions, and chain-of-thought content from filtered history.
   Parent receives full inherited projected direct-parent context plus current
   task and items. Projected context is the host-assembled conversation context.
   Parent's inherited evidence is the explicit exception to historical filtering.
   Add no evidence-tool reads or resource-path heuristics.
   Mark context limits explicitly. If exact action inputs cannot fit, escalate
   as unavailable rather than silently judging a truncated action.

4. Replace immediate propagation of malformed LLM results with configurable
   bounded feedback repair for unresolved items. Use bounded transport retry
   with backoff. Stable item IDs bind results to exact proposed actions.
   Validate duplicate, unknown, missing, conflicting, and malformed results
   without accidental authorization. Accepted decisions remain immutable.
   Bound exhaustion reports unavailability and escalates unresolved items.
   No retry or feedback repair reruns the original tools.
   Jev validates a complete expected-ID answer map without conversational repair.

5. Select blocking or bounded nonblocking timing for the whole chain,
   independently of node enablement. Blocking calls remain held until authorized,
   including while microbatched. Nonblocking speculation remains host-permitted.
   Count unresolved items per producing session, not batches.
   One call retains one admission-budget slot through all stages, including Human.
   Sibling budgets remain separate. Jev and the LLM stage each have a batch
   maximum and collection interval. Flush partial batches at allowance exhaustion
   to prevent deadlock. Admission waiting is not an abort or durable ban.
   It does not interrupt already-running allowed work.
   Human pending waits indefinitely without timeout and retains its slot.
   Restore unresolved ownership and pending Human review across restart.

6. Host denies, human-only gates, and effective bans remain absolute.
   Review targets every host-mediated native, plugin, and subagent tool.
   There is no trusted read-only or path-based bypass.
   Recheck host rules, action identity, and effective bans at execution.
   Human approval applies only to the exact action.
   Replace ADR 0002's deny-to-Human consequence with containment:
   cancel only the denied call if it remains queued and unstarted.
   If it already started, abort its session and owned descendants.
   Record the source deny separately from the resulting containment action.
   Serialize execution-state and enforcement transitions to prevent race bypasses.

7. Abort interrupts the selected session and its owned descendants and applies
   a durable nonexpiring ban. Preserve ancestors and unrelated siblings.
   Guard admission, revoke approvals, and cancel outstanding subtree reviews.
   Cancel owned tools and background jobs where supported.
   Report unsupported or failed cancellation as incomplete containment.
   Prevent automatic retry, replacement, and respawn of aborted logical work.
   Ordinary messages, elapsed time, restart, and late replies never release it.

8. Each abort operation retains independent restrictions.
   Effective blocked state is the logical OR of active direct and
   ancestor-scoped abort coverage. Release clears only the selected operation.
   Child release cannot override an ancestor operation, and ancestor release
   cannot clear a child's independent abort.
   Restore operation identity, scope, and overlap across restart.
   Release alone resumes nothing and restores no old approval.
   Optional `Release and continue` sends one prompt to the selected session
   only if effectively unblocked. It never resumes every descendant or restarts
   cancelled jobs. New actions still encounter host rules and active bans.

9. Attempt one logical redacted webhook receipt per abort operation with
   bounded retry, deduplication identity, and explicit delivery status.
   Delivery failure never blocks containment.
   Queue an informational direct-parent notice without wake or resume.
   Suppress or cancel unsafe delivery if the parent is being aborted.
   Keep minimal redacted audit summaries, not judge transcripts or fork history.

10. Give Watchdog its own top-level control, review, and recovery page with
    independent enablement. Preserve unrelated Jev tools and hooks and remove
    stale duplicate Watchdog controls from their page.
    Shared Jev library reuse does not merge feature identity or force a runtime
    dependency on unrelated Jev tools.
    Migrate settings and state without losses or secret exposure.
    Keep secret settings write-only.

11. Keep the new behavior off until explicitly enabled and real capabilities
    pass verification. Verify busy-parent generation, context filtering,
    isolation, cancellation, tool coverage, exact Human reply isolation, and
    no-wake parent notices. Unsupported surfaces are explicit gating failures.
    Never silently substitute a fork or another transport.
    Cache reuse is only an optimization.
    Numerical defaults, model selection, exact schemas, and full judge prose
    remain implementation choices constrained by this decision.

## Consequences

- Separate Parent and Supervisor context policies preserve delegation context
  without adding historical tool or assistant content to filtered risk review.
- Bounded repair can recover incomplete results before Human escalation, but
  adds validation state and retry accounting.
- Bounded speculation limits unresolved work, not past effects.
  An absent Human eventually fills the admission budget without timeout or abort.
- Independent abort operations require durable scope and overlap accounting.
  Releasing one operation can leave a session effectively blocked.
- Unsupported cancellation can leave work running.
  Receipts must distinguish observed containment from incomplete containment.
- Capability failures can prevent enablement.
  This accepted target decision does not certify current implementation coverage.
- Minimal audit summaries limit reconstruction of judge reasoning.
  Watchdog remains a workflow guardrail, not a sandbox against equal-credential actors.
- ADR 0002 remains unchanged as a historical record.
  Its superseded contracts do not govern the new behavior.
