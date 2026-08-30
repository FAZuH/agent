---
title: Cross-Service Correlation
impact: HIGH
tags: logging, correlation, tracing, opentelemetry, w3c-trace-context
---

## Cross-Service Correlation

**Impact: HIGH**

`rules/wide-events.md` establishes that every event needs a shared identifier to reconstruct a request's journey across services. This rule covers which identifier scheme to use.

### Request ID vs. Trace Context

A custom `x-request-id` header (as used elsewhere in this skill) is a single opaque string passed hop to hop. It works, but has real limits: no standard format, no way to express parent-child relationships across an async call graph, and no interoperability guarantee across a polyglot service mesh where different teams invented their own header name.

**W3C Trace Context** is the vendor-neutral standard that replaces this:

- `traceparent` — a single header encoding protocol version, a 128-bit trace ID, a 64-bit parent span ID, and trace flags, e.g. `00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01`
- `tracestate` — vendor-specific key-value metadata that rides alongside without breaking propagation for other vendors

**OpenTelemetry (OTel)** builds on Trace Context and is the current industry default for distributed tracing. Rather than replacing wide-event logging, OTel's Logs specification gives structured events a standard shape: a `LogRecord` carrying `trace_id`/`span_id`, timestamp, severity, and structured `Attributes`/`Resource` fields. Adopting OTel semantic conventions for attribute names (`http.request.method`, `service.name`, `user.id`) also solves part of the schema-consistency problem in `rules/schema-governance.md` — you're not inventing field names, you're using ones with a published spec.

### What to Use When

- **If you already run an OpenTelemetry Collector or a tracing backend** (Jaeger, Tempo, Honeycomb, etc.): use `trace_id`/`span_id` from the active span as your correlation fields instead of a custom `request_id`. Propagate `traceparent` across service hops.
- **If you have no tracing infrastructure at all**: a custom `request_id` (as in `rules/wide-events.md`) is a reasonable, zero-dependency fallback. Don't block on standing up OTel just to get basic correlation — get correlation working first, migrate the field name later if you adopt tracing.

### Wide-Event Logs vs. Direct OTLP Export

There's a genuine, unresolved debate on where wide events should go:

- **Stdout + JSON** (what this skill defaults to): reliable because it doesn't depend on network connectivity or an SDK's export buffer — a write to stdout either happens or the process is already dead. A log forwarder (Vector, Fluent Bit) picks it up downstream.
- **Direct OTLP export**: sends the structured `LogRecord` straight to a collector via gRPC/HTTP, skipping text-parsing overhead in a forwarder and preserving native types end-to-end. Requires a working SDK exporter and collector.

Default to stdout + JSON for reliability unless you already have OTLP export working end-to-end for traces/metrics, in which case wiring logs into the same pipeline is a natural next step rather than a new dependency.

### References

- [OpenTelemetry Logs Specification](https://opentelemetry.io/docs/specs/otel/logs/)
- [OpenTelemetry Trace Context Compatibility for Logging](https://opentelemetry.io/docs/specs/otel/compatibility/logging_trace_context/)
- [OpenTelemetry Semantic Conventions — Traces](https://opentelemetry.io/docs/specs/semconv/general/trace/)
- [A Practitioner's Guide to Wide Events](https://jeremymorrell.dev/blog/a-practitioners-guide-to-wide-events/)
