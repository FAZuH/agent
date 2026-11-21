# Watchdog review

This context defines action review, containment, and recovery.

## Language

**Watchdog**:
The authority that coordinates action review and owns enforcement.
_Avoid_: Judge, reviewer as a synonym for the enforcement owner.

**Decision model (Jev)**:
The first review role, responsible for assessing action risk.
_Avoid_: Parent, Supervisor.

**Parent**:
The host-recorded direct parent that reviews a subagent's delegation with its inherited context.
_Avoid_: Supervisor, arbitrary ancestor.

**Supervisor**:
The independent review role used when Parent review does not apply.
_Avoid_: Parent, additional judge after Parent.

**Human**:
The person who supplies exact-action approval when required.
_Avoid_: Automated approver.

**Verdict**:
A review outcome of allow, deny, propagate, or abort.
_Avoid_: Enforcement action as a synonym for the source verdict.

**Allow**:
A verdict permitting the reviewed action within host rules and active restrictions.
_Avoid_: Blanket permission, override.

**Deny**:
A verdict rejecting the reviewed action.
_Avoid_: Propagate, abort as synonyms for the source verdict.

**Propagate**:
A verdict passing unresolved review to the next authority without granting permission.
_Avoid_: Allow, approval.

**Abort**:
A containment decision that stops affected work and durably restricts its continuation.
_Avoid_: Interrupt, deny as synonyms.

**Interrupt**:
A stop of current execution, without implying a durable restriction.
_Avoid_: Abort.

**Abort operation**:
An independent containment action with its own restrictions and release.
_Avoid_: Session state as a synonym for the operation.

**Abort scope**:
The selected session and its owned descendant subtree covered by an abort operation.
_Avoid_: Entire session tree, ancestors, unrelated siblings.

**Release**:
Explicit removal of one selected abort operation's restrictions.
_Avoid_: Resume, clear all bans.

**Review item**:
One proposed action requiring an individual verdict.
_Avoid_: Batch.

**Bounded speculation**:
Permission-compliant execution with at most a limited number of unresolved review items per producing session.
_Avoid_: Unrestricted execution, permission bypass.

**Admission budget**:
The producing session's allowance for unresolved review items across the full review chain.
_Avoid_: Batch size, per-stage allowance.

**Batch**:
A collection of review items gathered for review.
_Avoid_: Single verdict, admission budget.

**Effective ban**:
The restriction present when any active direct or ancestor-scoped abort covers a session.
_Avoid_: Most recent abort only, one replaceable ban.
