---
title: Wide Events / Canonical Log Lines
impact: CRITICAL
tags: logging, wide-events, canonical-log-lines
---

## Wide Events / Canonical Log Lines

**Impact: CRITICAL**

Per request, emit **one context-rich event per service**. Never scatter 10-20 lines through the handler; consolidate into one event at the end.

### The Pattern

Build through the lifecycle, emit once at completion in a `finally` block. Fires with full context even on failure.

**Incorrect**: 6 scattered `console.log` lines (Inline Pattern anti-pattern, `references/typescript.md`). Unqueryable: "all article creates by free trial users" has no answer.

**Correct**: one assembled event in `finally` (Inline Pattern, `references/typescript.md`). Queryable by any field.

### Connect Events with Request ID

Every event carries a propagated identifier: the only way to reconstruct a cross-service journey. Prefer W3C Trace Context / OpenTelemetry `trace_id`/`span_id` where tracing exists; see `rules/correlation.md`. Otherwise `x-request-id`; generate-and-propagate pattern: `references/typescript.md` Correlation.

### Emit in Finally Block

Always emit in a `finally` block or equivalent: full context on success or failure.

### Known Limitations

One event per unit of work does not fit everywhere:

- **Long-lived streaming connections** (WebSockets, SSE, gRPC streams): waiting for close means zero mid-stream visibility, total loss on mid-stream crash. Emit periodic checkpoints instead.
- **High-fan-out parallel sub-operations**: packing every sub-task into one event means oversized payloads and lost per-task timing. Pair with distributed tracing (child spans): wide event summarizes, trace gives the timeline.
- **Payload bloat**: unbounded enrichment produces 100KB+ JSON records: GC pressure plus ingestion cost. Bound field values (see `rules/security.md` truncation).
- **Loss of intermediate timeline**: one completion event summarizes; it never shows where time went inside the request. That needs spans/traces, not a wider event.

None argue against wide events. Pair them with distributed tracing; never treat them as the whole observability strategy.

Reference: [Stripe Blog - Canonical Log Lines](https://stripe.com/blog/canonical-log-lines), [A Practitioner's Guide to Wide Events](https://jeremymorrell.dev/blog/a-practitioners-guide-to-wide-events/)
