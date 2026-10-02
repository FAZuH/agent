---
title: Structure and Format
impact: HIGH
tags: logging, json, structured-logging, schema, middleware
---

## Structure and Format

**Impact: HIGH**

Structure turns logs from text files into queryable data.

### Use a Single Logger Throughout the Codebase

One logger instance, configured at startup, imported everywhere. Consistent format, levels, destinations. Node/pino config: `references/typescript.md` Setup.

**Benefits:**
- Consistent log format across all modules
- Single place to change log level, redaction rules, or destination

**Avoid** new loggers per file or `console.log`/`print` bypasses (counter-example: `references/typescript.md` Setup).

### Use Middleware for Consistent Wide Events

Wrap all handlers in middleware: init, timing, finally-block emission, enrichment access. Hono: `references/typescript.md`; FastAPI: `references/python.md`.

**Handlers just enrich with business context**: timing, status, environment, redaction, emission stay in middleware. Enrichment example: `references/typescript.md`.

### Use JSON Format

Log JSON. Universally supported, nested, portable, parseable.

```json
{
  "timestamp": "2024-09-08T06:14:05.680Z",
  "service": "articles",
  "requestId": "req_abc123",
  "message": "Article created",
  "user": { "id": "user_123", "subscription": "premium" },
  "article": { "id": "article_456", "title": "My Post" },
  "duration_ms": 268,
  "status_code": 201
}
```

### Maintain Consistent Schema

Consistent field names across services: `user_id` vs `userId` breaks queries. Names alone never stop type drift (`"123"` vs `123`): enforcement: `rules/schema-governance.md`.

```json
{
  "request_id": "req_abc",
  "user": { "id": "user_123" },
  "duration_ms": 268,
  "status_code": 200
}
```

### Log Levels: A Deliberate Simplification, Not a Universal Rule

Default: two levels, `info` (normal operations, all wide events) and `error` (unexpected failures needing attention). Rationale: TRACE/DEBUG/INFO/WARN/ERROR/FATAL hierarchies breed `warn`-vs-`error` disagreement, compounding across services. Two levels fit one-event-per-unit-of-work: no scattered debug lines.

Opinionated, not settled. Tradeoffs:

- **Keeping `warn`**: degraded-but-not-failed states (cache-miss fallback, open circuit breaker, retried-then-succeeded) alert *before* outages. Alerting stacks expect `warn`-rate thresholds. General-purpose libraries (pino, zap, structlog, tracing, logback) default to full hierarchies for this reason.
- **Two levels**: encode degraded states as fields on the `info` event (`degraded_execution: true`, `cache_fallback: true`, `retry_count: 2`). Queryable and dashboardable without a third level. Cost: alerting on field values instead of level volume, real setup work if the stack expects `warn`.

Pick by what alerting consumes, not by rhetoric.

**loguru note:** extra levels `trace` (below `debug`) and `success` (above `info`). `success` fits semantically distinct states (batch completed, specific auth path); `warning` fits CAPTCHA/fallback states. Keep the normal per-unit event at `info` with outcome as a field, not a level. Never `logger.remove()`/`logger.add()` to collapse levels; pick emitted levels, keep semantics in fields. See `references/python.md` (Porting to `loguru`).

### Never Log Unstructured Strings

Every log is structured with queryable fields. `console.log('User logged in')` is useless at scale.

```json
{
  "order": { "id": "ord_123", "status": "created" },
  "payment": { "error": { "message": "card declined" } }
}
```
Now it's queryable: `WHERE order.status = 'created'`.

Tempted by `console.log('something happened')`: ask which fields make it queryable, then add them to the wide event.
