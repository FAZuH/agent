---
title: Cross-Service Correlation
impact: HIGH
tags: logging, correlation, tracing, opentelemetry, w3c-trace-context
---

## Cross-Service Correlation

**Impact: HIGH**

Every event needs a shared identifier to reconstruct a cross-service journey. This rule picks the scheme.

### Request ID vs. Trace Context

Custom `x-request-id` (used elsewhere in this skill) is one opaque string hop to hop. Limits: no standard format, no parent-child expression across async graphs, no interoperability across a polyglot mesh where teams invented their own header names.

**W3C Trace Context** is the vendor-neutral standard that replaces this:

- `traceparent`: a single header encoding protocol version, a 128-bit trace ID, a 64-bit parent span ID, and trace flags, e.g. `00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01`
- `tracestate`: vendor-specific key-value metadata that rides alongside without breaking propagation for other vendors

**OpenTelemetry (OTel)** builds on Trace Context and is the industry default for distributed tracing. OTel Logs gives structured events a standard shape: `LogRecord` with `trace_id`/`span_id`, timestamp, severity, `Attributes`/`Resource`. OTel semantic conventions (`http.request.method`, `service.name`, `user.id`) also solve part of `rules/schema-governance.md`: published field names instead of invented ones.

### What to Use When

- **OTel Collector or tracing backend** (Jaeger, Tempo, Honeycomb): `trace_id`/`span_id` from the active span, not custom `request_id`. Propagate `traceparent` across hops.
- **No tracing infrastructure**: custom `request_id` (`rules/wide-events.md`) is a reasonable zero-dependency fallback. Never block correlation on standing up OTel. Correlate first, migrate field names later.

### Wide-Event Logs vs. Direct OTLP Export

Genuine unresolved debate on where wide events go:

- **Stdout + JSON** (this skill's default): reliable, no network or SDK export-buffer dependency: stdout writes either happen or the process is dead. A forwarder (Vector, Fluent Bit) picks them up downstream.
- **Direct OTLP export**: structured `LogRecord` straight to a collector via gRPC/HTTP. No forwarder text-parsing, native types end to end. Needs a working SDK exporter and collector.

Default to stdout + JSON unless OTLP export already works end to end for traces/metrics; then wiring logs into the same pipeline is a natural next step, not a new dependency.

### References

- [OpenTelemetry Logs Specification](https://opentelemetry.io/docs/specs/otel/logs/)
- [OpenTelemetry Trace Context Compatibility for Logging](https://opentelemetry.io/docs/specs/otel/compatibility/logging_trace_context/)
- [OpenTelemetry Semantic Conventions: Traces](https://opentelemetry.io/docs/specs/semconv/general/trace/)
- [A Practitioner's Guide to Wide Events](https://jeremymorrell.dev/blog/a-practitioners-guide-to-wide-events/)
