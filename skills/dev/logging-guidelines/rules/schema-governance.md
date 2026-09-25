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

### Value-Vocabulary Drift (enum-like strings)

Field-name and type consistency still leave **value drift**: the same semantic
outcome spelled differently across modules (`"failure"` vs `"error"` vs
`"auth_failed"`), which silently breaks `WHERE outcome = 'error'` queries and
alert thresholds. Standardize enum-like string fields — `outcome`, `reason`,
`status`, `auth_method` — by defining the allowed literals once and reusing
them:

- A shared `enum.Enum` (in Python/Java/C#/Rust) or `const` object / union type
  (in TS/JS) that all call sites import, so a new value is added in one place
  and a typo is a compile error, not a silent drift.
- For `str`-based enums (e.g. `class Outcome(str, Enum)`), keep `.value`
  stable and equal to the wire/serialized string, so introducing the enum never
  changes the bytes in the event.
- Reserve free-form strings (where a bounded `reason`/`detail` is legitimately
  open-ended) and note it explicitly so the fixed-vocabulary fields stay
  closed.

Like naming and type drift, this is enforced most cheaply by the shared
definition (compile/import time) plus a schema test that asserts only known
values appear.
