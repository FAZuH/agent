---
title: Schema Governance and Drift Prevention
impact: MEDIUM
tags: logging, schema, type-drift, validation, ci
---

## Schema Governance and Drift Prevention

**Impact: MEDIUM**

`rules/structure.md` says to keep field names consistent across services. That's necessary but not sufficient — naming consistency alone doesn't stop **type drift**: Service A emits `user_id: "10042"` (string), Service B emits `user_id: 10042` (integer). Downstream columnar stores (ClickHouse, BigQuery, Snowflake) enforce a fixed column type per field, so this kind of drift causes ingestion failures, forced schema migrations, or silently corrupted queries (`WHERE user_id = 10042` missing the string rows).

### Enforcement Mechanisms

| Mechanism | Enforced at | Runtime cost | Failure mode |
|---|---|---|---|
| Shared type definitions (protobuf, shared TS/Rust types) | Compile time | None | Build fails |
| In-process validation (Zod, Pydantic) | Request execution | Low-moderate | Caught exception, event dropped or coerced |
| CI schema/contract tests | Pull request | None in production | CI fails, PR blocked |

**Pick based on team size and how distributed the services are**, not on which is theoretically "best":

- **Solo or small team, few services**: a shared types package/module imported by every service is the highest-leverage option — it's free at runtime and catches drift before merge, and there's no separate schema registry to maintain.
- **Multiple teams, independently deployed services**: compile-time sharing alone doesn't scale (you can't force every team to import your types), so this is where in-process validation and CI contract tests against a centrally owned schema definition earn their cost.

### Strict Validation vs. Graceful Degradation

There's a real tension between data-platform teams (who want strict runtime rejection of malformed events to protect warehouse schema integrity) and application teams (who don't want telemetry silently dropped during a production incident because of a validation failure). If you have to pick a default: **coerce and flag, don't drop.** Convert a type mismatch to a safe string representation and add a `schema_violation: true` field rather than discarding the event outright — you keep the operational signal and can still alert on the violation rate separately.
