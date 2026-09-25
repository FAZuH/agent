---
title: Wide Events / Canonical Log Lines
impact: CRITICAL
tags: logging, wide-events, canonical-log-lines
---

## Wide Events / Canonical Log Lines

**Impact: CRITICAL**

Wide events (also called canonical log lines) are the foundation of effective logging. For each request, emit **a single context-rich event per service**. Instead of scattering 10-20 log lines throughout your request handler, consolidate everything into one comprehensive event emitted at the end of the request.

### The Pattern

Build the event throughout the request lifecycle, then emit once at completion in a `finally` block. This ensures the event is always emitted with complete context, even during failures.

**Incorrect** — scattering 6 `console.log` lines through the handler (see the anti-pattern at the top of the Inline Pattern section in `references/typescript.md`). You cannot query "show me all article creates by free trial users" from scattered logs.

**Correct** — a single context-rich event assembled through the request lifecycle and emitted in a `finally` block (see the Inline Pattern in `references/typescript.md`). Queryable by any field.

### Connect Events with Request ID

Every wide event must include a unique identifier that is propagated across all service hops. This is the only way to reconstruct the full journey of a request through a distributed system. Prefer W3C Trace Context / OpenTelemetry `trace_id`/`span_id` over an ad hoc header where you have tracing infrastructure available — see `rules/correlation.md`. A custom `x-request-id` is an acceptable fallback when you don't; see the Correlation section of `references/typescript.md` for the generate-and-propagate pattern.

### Emit in Finally Block

Always emit wide events in a `finally` block or equivalent. This ensures the event is emitted with complete context regardless of success or failure.

### Known Limitations

The "one event per unit of work" pattern doesn't fit every situation cleanly:

- **Long-lived streaming connections** (WebSockets, SSE, gRPC streams) — waiting for connection close to emit means zero visibility while the stream is open, and total loss if the process crashes mid-stream. Emit periodic checkpoint events instead of one terminal event.
- **High-fan-out parallel sub-operations** — packing every parallel sub-task's fields into one request-level event produces oversized, hard-to-read payloads and loses per-task timing. Pair wide events with distributed tracing (child spans) for this case; the wide event gives the summary, the trace gives the timeline.
- **Payload bloat** — uncontrolled context enrichment can produce 100KB+ JSON records, which increases GC pressure in the application and inflates ingestion cost downstream. Keep field values bounded (see `rules/security.md` on truncating free-text fields).
- **Loss of intermediate timeline** — a single event at completion gives you the summary, not a step-by-step timeline of where time was spent inside the request. If you need that, you need spans/traces, not just a wider event.

None of these are arguments against wide events — they're arguments for pairing wide events with distributed tracing rather than treating wide events as a complete observability strategy on their own.

Reference: [Stripe Blog - Canonical Log Lines](https://stripe.com/blog/canonical-log-lines), [A Practitioner's Guide to Wide Events](https://jeremymorrell.dev/blog/a-practitioners-guide-to-wide-events/)
