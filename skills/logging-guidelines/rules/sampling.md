---
title: Sampling for Cost Control
impact: HIGH (once event volume is a real cost constraint)
tags: logging, sampling, cost, observability
---

## Sampling for Cost Control

**Impact: HIGH once volume is a real constraint — skip this rule if it isn't**

`rules/context.md` recommends 20-100 fields per event. That's the right call for debuggability, and it's also directly proportional to ingestion, storage, and query cost at your observability backend. This rule only matters once that cost is actually a problem — i.e. once request volume × field count is large enough that either the bill or query latency is the thing you're optimizing, not the debugging quality. Below that point, sampling adds complexity to solve a cost problem you don't have yet; don't add it pre-emptively.

### Head-Based vs. Tail-Based Sampling

| Dimension | Head-based | Tail-based |
|---|---|---|
| Decision point | In-process, at request start | A buffering proxy, at request/trace end |
| Context available at decision time | Initial headers only | Full event — status, latency, all fields |
| Error/outlier retention | Probabilistic — can drop the exact request you needed | Deterministic — errors can be retained at 100% |
| Infrastructure cost | None | A stateful proxy (buffers in-flight events) |

Head-based sampling decides before the outcome is known, so it can just as easily drop the one failing request you needed as an unremarkable successful one. Tail-based sampling defers the decision to request completion, so it can guarantee error/outlier retention — at the cost of running a buffering proxy (e.g. the OpenTelemetry Collector's tail sampling processor, or Honeycomb's Refinery).

### The Practical Rule

- **Always retain 100% of**: 5xx responses, uncaught exceptions, and requests past your latency threshold (e.g. p99).
- **Downsample**: high-volume, unremarkable 2xx traffic. A reasonable default is dynamic/frequency-based sampling — track a key signature (route + status + tier) and sample rarer combinations at a higher rate than routine repeated traffic, rather than a single flat sample rate for everything.
- **Record the sample rate on retained events** (e.g. `sample_rate: 1000` meaning "1 in 1000 kept"), so queries can multiply back up to accurate totals instead of silently undercounting volume.

### Where This Runs

Tail-based sampling requires a decision point *after* the event is fully built, which is naturally where your wide-event middleware (`rules/structure.md`) already sits — either sample in-process right before the `logger.info(wideEvent)` call (simplest, no extra infrastructure, but can't coordinate across service instances), or hand off to a dedicated sampling proxy sitting between your services and your log/trace backend (adds infrastructure, but centralizes the sampling decision and lets you tune it without redeploying services).

### References

- [Honeycomb Refinery — tail-based sampling proxy](https://github.com/honeycombio/refinery)
- [Honeycomb — Tuning Refinery Dynamic Sampling](https://www.honeycomb.io/blog/tuning-refinery-dynamic-sampling)
