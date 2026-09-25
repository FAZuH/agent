---
title: Structure and Format
impact: HIGH
tags: logging, json, structured-logging, schema, middleware
---

## Structure and Format

**Impact: HIGH**

Structured logging with consistent formats enables efficient querying and analysis. The right structure transforms logs from text files into queryable data.

### Use a Single Logger Throughout the Codebase

Use one logger instance configured at application startup and import it everywhere. This ensures consistent formatting, log levels, and output destinations across all modules. See `references/typescript.md` (Setup) for the Node/pino configuration.

**Benefits:**
- Consistent log format across all modules
- Environment context automatically included
- Single place to change log level, redaction rules, or destination
- No risk of misconfigured loggers in different files

**Avoid** creating a new logger per file or bypassing the logger with `console.log`/`print` (see the Setup section of `references/typescript.md` for the counter-example).

### Use Middleware for Consistent Wide Events

Implement wide event collection as middleware that wraps all request handlers. The middleware initializes the event, captures timing, handles emission in the finally block, and makes the event accessible to handlers for enrichment. See the Wide-Event Pattern in `references/typescript.md` (Hono middleware) and `references/python.md` (FastAPI middleware).

**Handlers just enrich with business context** — timing, status, environment, redaction, and emission all belong in the middleware, never in the handler. See `references/typescript.md` for the enrichment example.

### Use JSON Format

Use JSON as your logging format. JSON is universally supported, enables nested objects for complex context, works across all programming languages, and is easily parsed.

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

Use consistent field names across all services. If one service uses `user_id` and another uses `userId`, querying becomes painful. Naming consistency alone doesn't prevent type drift (one service emitting `user_id: "123"`, another `user_id: 123`) — see `rules/schema-governance.md` for enforcement mechanisms beyond convention.

```json
{
  "request_id": "req_abc",
  "user": { "id": "user_123" },
  "duration_ms": 268,
  "status_code": 200
}
```

### Log Levels: A Deliberate Simplification, Not a Universal Rule

This skill's default recommendation is two levels: `info` (normal operations, all wide events) and `error` (unexpected failures needing attention). The reasoning: traditional TRACE/DEBUG/INFO/WARN/ERROR/FATAL hierarchies create real ambiguity — engineers routinely disagree on whether a given condition is `warn` or `error`, and that inconsistency compounds across services. Collapsing to two levels also fits the wide-event pattern: one event per unit of work, not scattered debug lines through the handler.

This is genuinely an opinionated stance, not settled practice — know the tradeoff before adopting it:

- **The case for keeping `warn`**: degraded-but-not-failed states (a cache miss falling back to the DB, a circuit breaker opening, a retry that eventually succeeded) are useful to alert on *before* they become outages. Most alerting systems are built around `warn`-level rate thresholds. Major structured-logging libraries (pino, zap, structlog, tracing, logback) all default to the full multi-level hierarchy for this reason — they're general-purpose tools, not wide-event-specific ones.
- **If you stay with two levels**: don't lose the degraded-state signal — encode it as a boolean/enum field on the `info`-level wide event instead (`degraded_execution: true`, `cache_fallback: true`, `retry_count: 2`). This keeps it queryable and dashboard-able without adding a third level. It does mean your alerting has to be built on field values rather than log level, which is a real setup cost if your alerting stack expects `warn`-level log volume as a signal.

Pick based on what your alerting infrastructure actually consumes, not on which side has better rhetoric.

**loguru note:** loguru ships two extra levels beyond the usual hierarchy — `trace` (below `debug`) and `success` (above `info`). Under the two-level stance, `success` is a natural fit for the "semantically distinct state" guidance above (e.g. a long-running batch completing, an auth path that succeeded via a specific method), and `warning` can be reserved the same way for CAPTCHA/fallback-style states — but keep the *normal* per-unit-of-work event at `info` with the degraded/outcome signal as a field, not as a level. There is no need to `logger.remove()`/`logger.add()` to collapse levels; just pick which levels you actually emit at and keep the semantic signal in fields. See `references/python.md` (Porting to `loguru`).

### Never Log Unstructured Strings

Every log must be structured with queryable fields. `console.log('User logged in')` is useless for debugging at scale.

```json
{
  "order": { "id": "ord_123", "status": "created" },
  "payment": { "error": { "message": "card declined" } }
}
```
Now it's queryable: `WHERE order.status = 'created'`.

If you're tempted to write `console.log('something happened')`, ask: "What fields would make this queryable?" Then add those fields to your wide event instead.
