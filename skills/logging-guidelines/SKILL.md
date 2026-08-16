---
name: logging-guidelines
description: >
  Implements structured logging using wide events (canonical log lines) with high-cardinality context.
  Designs canonical log line schemas, configures single-logger patterns, builds wide event middleware,
  and adds business and environment context to log output.
  Use when writing logging code, reviewing log statements, designing a logging strategy,
  setting up log infrastructure, adding observability, structuring logs for analytics,
  or replacing scattered console.log calls with queryable structured events.
  Not for application-level error handling or monitoring/alerting configuration.
license: MIT
metadata:
  author: boristane
  version: "1.0.0"
  category: observability
---

# Logging Guidelines at @skills/logging-guidelines/

## Output Format

Produces structured JSON log events containing request context, business context, environment metadata, and timing — one wide event per request per service.

## Workflow

1. **Configure single logger** — Create one logger instance at startup with environment base fields (`rules/structure.md`)
2. **Add wide event middleware** — Wrap all request handlers to initialise, time, and emit wide events (`rules/wide-events.md`)
3. **Enrich with business context** — In each handler, add user, cart, feature flag, and domain-specific fields (`rules/context.md`)
4. **Include environment characteristics** — Attach commit hash, service version, region, and instance ID (`rules/context.md`)
5. **Validate** — Confirm each request produces exactly one structured JSON event with high cardinality fields; check against pitfalls (`rules/pitfalls.md`)

## Core Principles

### 1. Wide Events (CRITICAL)

Emit **one context-rich event per request per service** in a `finally` block. Avoid scattering multiple `console.log()` calls per request — consolidate into a single structured event.

```typescript
const wideEvent: Record<string, unknown> = {
  method: 'POST',
  path: '/checkout',
  requestId: c.get('requestId'),
  timestamp: new Date().toISOString(),
};

try {
  const user = await getUser(c.get('userId'));
  wideEvent.user = { id: user.id, subscription: user.subscription };

  const cart = await getCart(user.id);
  wideEvent.cart = { total_cents: cart.total, item_count: cart.items.length };

  wideEvent.status_code = 200;
  wideEvent.outcome = 'success';
  return c.json({ success: true });
} catch (error) {
  wideEvent.status_code = 500;
  wideEvent.outcome = 'error';
  wideEvent.error = { message: error.message, type: error.name };
  throw error;
} finally {
  wideEvent.duration_ms = Date.now() - startTime;
  logger.info(wideEvent);
}
```

### 2. High Cardinality & Dimensionality (CRITICAL)

Include fields with high cardinality (user IDs, request IDs — millions of unique values) and high dimensionality (20+ fields per event). This enables querying by specific users and answering questions you haven't anticipated yet.

### 3. Business Context (CRITICAL)

Always include business context: user subscription tier, cart value, feature flags, account age. Avoid logging only technical details without user/business data — the goal is "a premium customer couldn't complete a $2,499 purchase" not just "checkout failed."

### 4. Environment Characteristics (CRITICAL)

Include environment and deployment info in every event: commit hash, service version, region, instance ID. Without these fields, you cannot correlate issues with deployments or identify region-specific problems.

### 5. Single Logger (HIGH)

Use one logger instance configured at startup and import it everywhere. Avoid creating separate logger instances per file or bypassing the logger with `console.log`.

### 6. Middleware Pattern (HIGH)

Use middleware to handle wide event infrastructure (timing, status, environment, emission). Handlers should only add business context.

### 7. Structure & Consistency (HIGH)

- Use JSON format consistently — never log unstructured strings like `console.log('something happened')`
- Maintain consistent field names across services (e.g. always `user_id`, not sometimes `userId`)
- Simplify to two log levels: `info` and `error`

## References

- [Logging Sucks](https://loggingsucks.com)
- [Observability Wide Events 101](https://boristane.com/blog/observability-wide-events-101/)
- [Stripe - Canonical Log Lines](https://stripe.com/blog/canonical-log-lines)
