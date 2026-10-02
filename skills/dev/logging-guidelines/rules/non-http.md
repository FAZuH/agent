---
title: Non-HTTP Work Units
impact: MEDIUM
tags: logging, background-jobs, queues, cron, cli, daemons
---

## Non-HTTP Work Units

**Impact: MEDIUM**

Every example elsewhere is HTTP-shaped. The principle (one rich event per unit of work, emitted once at completion) generalizes past HTTP; only the unit definition and attached fields change.

| Work unit | Execution boundary | Suggested fields |
|---|---|---|
| Queue/message consumer | One message processed | `messaging.system`, `messaging.destination`, `messaging.message_id`, `retry_count` |
| Cron/scheduled job | One scheduled run | `job_name`, `schedule`, `records_processed`, `records_failed`, `duration_ms` |
| Long-running daemon | One significant operation/cycle | whatever the daemon's actual unit of work is: a reconciliation pass, a sync cycle, a rule evaluation |
| CLI tool | One command invocation | `command`, `flags`, `exit_code`, `duration_ms` |

### Queue Consumers

Extract trace context (`traceparent`, or propagated `request_id`: see `rules/correlation.md`) from message metadata when the producer set it, so the event chains back to its creator. Bind queue metadata (consumer group, attempt count, queue wait time) plus business fields; emit one event per message on ack/reject, never per internal step. Implementation: `references/typescript.md` Non-HTTP Work Units.

### Cron Jobs and CLI Tools

Treat the whole invocation as the unit. For CLIs, one event right before exit (top-level try/finally around `main()`), capturing flags, exit code, duration.

**Logged exit code must match the real exit status.** The classic
mistake: a wrapper catching an exception (or `KeyboardInterrupt`) to emit
completion, then **swallowing** it. The event claims
`exit_code=130`/`outcome="interrupted"` while the process exits `0`:
logs lie, exit-status alerting breaks. After
emitting, **re-raise** (or set the real exit code). Deeper handlers setting the exit code must not
double-log the same exception as a second error; the wide-event
wrapper owns the structured error, the outer handler only translates to
an exit code.

### The Long-Running Batch Exception

One wide event over a multi-hour, million-record batch means blindness until the finish, and silence on mid-run crash. Hybrid instead: checkpoint events (e.g. every 10,000 records or 5 minutes, whichever first) with running totals, plus a final summary. Checkpoints give mid-run visibility; the summary serves post-hoc queries.
