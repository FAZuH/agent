---
title: Non-HTTP Work Units
impact: MEDIUM
tags: logging, background-jobs, queues, cron, cli, daemons
---

## Non-HTTP Work Units

**Impact: MEDIUM**

Every example elsewhere in this skill is shaped around an HTTP request/response cycle. The underlying principle — one context-rich event per unit of work, emitted once at completion — generalizes past HTTP; only the definition of "unit of work" and the fields you attach change.

| Work unit | Execution boundary | Suggested fields |
|---|---|---|
| Queue/message consumer | One message processed | `messaging.system`, `messaging.destination`, `messaging.message_id`, `retry_count` |
| Cron/scheduled job | One scheduled run | `job_name`, `schedule`, `records_processed`, `records_failed`, `duration_ms` |
| Long-running daemon | One significant operation/cycle | whatever the daemon's actual unit of work is — a reconciliation pass, a sync cycle, a rule evaluation |
| CLI tool | One command invocation | `command`, `flags`, `exit_code`, `duration_ms` |

### Queue Consumers

Extract the trace context (`traceparent`, or a propagated `request_id` — see `rules/correlation.md`) from message metadata if the producer set it, so the event chains back to whatever created the message. Bind queue-specific metadata (consumer group, attempt count, time spent waiting in the queue) alongside business fields, and emit one event per message on ack or reject — not per processing step inside the handler. See the Non-HTTP Work Units section of `references/typescript.md` for the queue-consumer implementation.

### Cron Jobs and CLI Tools

Treat the whole invocation as the unit of work. For CLI tools, this typically means one event emitted right before the process exits (still via a `finally`-equivalent, e.g. wrapped in a top-level try/finally around `main()`), capturing flags, exit code, and duration.

**The logged exit code must match the real process exit status.** The common
mistake is a wrapper that catches an exception (or `KeyboardInterrupt`) to emit
its completion event and then **swallows** it — the event records
`exit_code=130`/`outcome="interrupted"` while the process actually exits `0`,
which makes the logs a lie and breaks any alerting keyed on exit status. After
emitting the completion event, **re-raise** the caught exception (or set the
real exit code) so the process exits with the status the event claims. If a
deeper handler also catches to set the exit code, make sure it does not
double-log the same exception as a second error record — let the wide-event
wrapper own the structured error, and let the outer handler only translate it
to an exit code.

### The Long-Running Batch Exception

A single wide event covering a batch job that processes millions of records over several hours creates an operational blind spot: nothing is observable until the job finishes, and a crash mid-run produces no signal at all. Use a hybrid approach instead — emit periodic checkpoint events (e.g. every 10,000 records or every 5 minutes, whichever comes first) with running totals, then a final summary event on completion. The checkpoint events are what actually give you mid-run visibility; the summary event is what you query after the fact.
