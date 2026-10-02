---
title: Sampling for Cost Control
impact: HIGH (once event volume is a real cost constraint)
tags: logging, sampling, cost, observability
---

## Sampling for Cost Control

**Impact: HIGH once volume is a real constraint. Skip this rule if it isn't**

`rules/context.md` recommends 20-100 fields per event. Right for debuggability, and proportional to ingestion, storage, and query cost. This rule matters only once that cost bites: request volume × field count large enough that the bill or query latency is the optimization target, not debugging quality. Below that, sampling adds complexity for a cost problem you lack; never add pre-emptively.

### Head-Based vs. Tail-Based Sampling

| Dimension | Head-based | Tail-based |
|---|---|---|
| Decision point | In-process, at request start | A buffering proxy, at request/trace end |
| Context available at decision time | Initial headers only | Full event: status, latency, all fields |
| Error/outlier retention | Probabilistic: can drop the exact request you needed | Deterministic: errors can be retained at 100% |
| Infrastructure cost | None | A stateful proxy (buffers in-flight events) |

Head-based decides before the outcome is known: drops the one failing request as readily as an unremarkable success. Tail-based defers to completion, guaranteeing error/outlier retention, at the cost of a buffering proxy (e.g. OTel Collector tail sampling processor, Honeycomb Refinery).

### The Practical Rule

- **Always retain 100% of**: 5xx, uncaught exceptions, past-latency-threshold requests (e.g. p99).
- **Downsample**: high-volume unremarkable 2xx. Default: dynamic/frequency-based: track a key signature (route + status + tier), sample rarer combinations higher than routine traffic, never one flat rate for everything.
- **Record sample rate on retained events** (e.g. `sample_rate: 1000` means "1 in 1000 kept"), so queries multiply back to accurate totals instead of silently undercounting.

### Where This Runs

Tail-based sampling decides *after* the event is fully built: naturally the wide-event middleware (`rules/structure.md`). Either sample in-process before `logger.info(wideEvent)` (simplest, no infra, no cross-instance coordination), or hand off to a sampling proxy between services and backend (infra cost, centralized decision, tune without redeploying).

### References

- [Honeycomb Refinery: tail-based sampling proxy](https://github.com/honeycombio/refinery)
- [Honeycomb: Tuning Refinery Dynamic Sampling](https://www.honeycomb.io/blog/tuning-refinery-dynamic-sampling)
