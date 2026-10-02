---
title: Schema Governance and Drift Prevention
impact: MEDIUM
tags: logging, schema, type-drift, validation, ci
---

## Schema Governance and Drift Prevention

**Impact: MEDIUM**

`rules/structure.md` demands consistent field names. Necessary, insufficient. Names never stop **type drift**: Service A emits `user_id: "10042"` (string), Service B emits `user_id: 10042` (integer). Columnar stores (ClickHouse, BigQuery, Snowflake) enforce fixed column types, so drift means ingestion failures, forced migrations, or silently corrupted queries (`WHERE user_id = 10042` missing string rows).

### Enforcement Mechanisms

| Mechanism | Enforced at | Runtime cost | Failure mode |
|---|---|---|---|
| Shared type definitions (protobuf, shared TS/Rust types) | Compile time | None | Build fails |
| In-process validation (Zod, Pydantic) | Request execution | Low-moderate | Caught exception, event dropped or coerced |
| CI schema/contract tests | Pull request | None in production | CI fails, PR blocked |

**Pick by team size and service distribution**, not theoretical "best":

- **Solo or small team, few services**: shared types package/module imported by every service. Free at runtime, catches drift before merge, no registry to maintain.
- **Multiple teams, independently deployed**: compile-time sharing never scales (no forcing every team to import your types). In-process validation and CI contract tests against a centrally owned schema earn their cost here.

### Strict Validation vs. Graceful Degradation

Data-platform teams want strict runtime rejection of malformed events (warehouse schema integrity); application teams never want telemetry dropped mid-incident on a validation failure. Default: **coerce and flag, never drop.** Convert mismatches to safe strings plus `schema_violation: true`: keeps the operational signal, alerts on violation rate separately.

### Value-Vocabulary Drift (enum-like strings)

Name and type consistency still leave **value drift**: one semantic
outcome spelled many ways (`"failure"` vs `"error"` vs
`"auth_failed"`), silently breaking `WHERE outcome = 'error'` queries and
alert thresholds. Standardize enum-like strings (`outcome`, `reason`,
`status`, `auth_method`) once, reuse everywhere:

- Shared `enum.Enum` (Python/Java/C#/Rust) or `const` object / union type
  (TS/JS) imported by all call sites: new values land in one place,
  typos become compile errors, not silent drift.
- `str`-based enums (e.g. `class Outcome(str, Enum)`): keep `.value`
  stable and equal to the wire string, so introducing the enum never
  changes event bytes.
- Free-form strings only where a bounded `reason`/`detail` is legitimately
  open-ended, noted explicitly, so fixed-vocabulary fields stay closed.

Cheapest enforcement, like naming and type drift: the shared
definition (compile/import time) plus a schema test asserting only known
values appear.
