# TypeScript/Node: Wide Events with `pino` (Hono style)

The idiomatic Node stack this skill assumes is **pino** for the single logger and **Hono** for HTTP middleware. Pino's `redact` option gives you logger-level redaction without scattering checks through handlers, and Hono's `c.set`/`c.get` context makes a request-scoped wide-event object easy to thread through handlers. The pattern ports to Express/Fastify/other frameworks — only the middleware plumbing differs.

## Setup

Create one logger instance at startup (see `rules/structure.md`) and import it everywhere. Environment base fields and redaction rules live here, in one place.

```typescript
// lib/logger.ts - Single logger configuration
import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    level: (label) => ({ level: label }),
  },
  base: {
    // Environment context added to ALL logs automatically
    service: process.env.SERVICE_NAME,
    version: process.env.SERVICE_VERSION,
    commit_hash: process.env.COMMIT_SHA,
    region: process.env.AWS_REGION,
    environment: process.env.NODE_ENV,
  },
  // Redact known-sensitive paths at the logger level, not scattered
  // through business code (see rules/security.md).
  redact: ['req.headers.authorization', 'user.email', '*.password', '*.token'],
});

// Usage everywhere else - just import
// services/checkout.ts
import { logger } from '../lib/logger';

logger.info({ event: 'checkout_completed', orderId });
```

**Avoid** creating new loggers per file or bypassing the logger:

```typescript
// DON'T create new loggers in each file
const logger = new Logger(); // Each file creates its own
console.log('some event');   // Bypasses the logger entirely
```

## The Wide-Event Pattern (Hono middleware)

The middleware initializes the event, captures timing, emits it in a `finally` block, and exposes the event to handlers for enrichment (see `rules/wide-events.md`, `rules/structure.md`).

```typescript
// middleware/wideEvent.ts
import { logger } from '../lib/logger';

// Capture environment once at startup
const envContext = {
  service: process.env.SERVICE_NAME,
  version: process.env.SERVICE_VERSION,
  commit_hash: process.env.COMMIT_SHA,
  region: process.env.AWS_REGION,
  environment: process.env.NODE_ENV,
  instance_id: process.env.HOSTNAME,
};

export function wideEventMiddleware() {
  return async (c: Context, next: Next) => {
    const startTime = Date.now();

    // Initialize event with standard fields + environment
    // Path and user-agent are outsider-authored text: sanitize before logging.
    const wideEvent: Record<string, unknown> = {
      request_id: c.get('requestId') || crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      method: c.req.method,
      path: sanitizeLogField(c.req.path),
      user_agent: sanitizeLogField(c.req.header('user-agent') || ''),
      ...envContext,  // Environment automatically included
    };

    // Make event accessible to handlers for enrichment
    c.set('wideEvent', wideEvent);

    try {
      await next();
      wideEvent.status_code = c.res.status;
      wideEvent.outcome = c.res.status < 400 ? 'success' : 'error';
    } catch (error) {
      wideEvent.status_code = 500;
      wideEvent.outcome = 'error';
      wideEvent.error = {
        type: error.name,
        message: sanitizeLogField(error.message || String(error)),
      };
      throw error;
    } finally {
      wideEvent.duration_ms = Date.now() - startTime;
      logger.info(wideEvent);  // Uses the single logger (redaction applied here)
    }
  };
}

// Apply middleware globally
app.use('*', wideEventMiddleware());
```

**Handlers just enrich with business context:**

```typescript
app.post('/checkout', async (c) => {
  const wideEvent = c.get('wideEvent');
  const user = c.get('user');

  // Add business context - environment already included by middleware
  wideEvent.user = { id: user.id, subscription: user.subscription };

  const cart = await getCart(user.id);
  wideEvent.cart = { id: cart.id, total: cart.total };

  const order = await createOrder(cart);
  wideEvent.order = { id: order.id };

  return c.json(order, 201);
});
// Middleware handles: timing, status, environment, redaction, emission
// Handler handles: business context only
```

### Inline Pattern (no middleware — scripts, CLIs, ad hoc handlers)

When there's no middleware layer, build the event through the request lifecycle and emit it once in a `finally` block:

```typescript
app.post('/articles', async (c) => {
  const startTime = Date.now();
  const wideEvent: Record<string, unknown> = {
    method: 'POST',
    path: '/articles',
    service: 'articles',
    requestId: c.get('requestId'),
  };

  try {
    const body = await c.req.json();
    const user = await getUser(c.get('userId'));
    wideEvent.user = {
      id: user.id,
      subscription: user.subscription,
      trial: user.trial,
    };

    const article = await database.saveArticle({ ...body, ownerId: user.id });
    wideEvent.article = {
      id: article.id,
      title: article.title,
      published: article.published,
    };

    await cache.set(article.id, article);
    wideEvent.cache = { operation: 'write', key: article.id };

    wideEvent.status_code = 201;
    wideEvent.outcome = 'success';
    return c.json({ article }, 201);
  } catch (error) {
    wideEvent.status_code = 500;
    wideEvent.outcome = 'error';
    wideEvent.error = { message: sanitizeLogField(error.message || String(error)), type: error.name };
    throw error;
  } finally {
    wideEvent.duration_ms = Date.now() - startTime;
    wideEvent.timestamp = new Date().toISOString();
    logger.info(wideEvent);
  }
});
// Single event with all context - queryable by any field
```

The anti-pattern this replaces is scattering `console.log` lines through the handler — 6 disconnected lines with scattered context that can't answer "show me all article creates by free trial users."

## Environment Characteristics (see `rules/context.md`)

Attach deployment and infrastructure context. Prefer putting it in the logger's `base` config (see Setup) or the middleware's `envContext`; this is what the full field set looks like:

```typescript
const wideEvent = {
  // ... request and business context

  // Environment characteristics
  env: {
    // Deployment info
    commit_hash: process.env.COMMIT_SHA || process.env.GIT_COMMIT,
    version: process.env.SERVICE_VERSION || process.env.npm_package_version,
    deployment_id: process.env.DEPLOYMENT_ID,
    deploy_time: process.env.DEPLOY_TIMESTAMP,

    // Infrastructure
    service: process.env.SERVICE_NAME,
    region: process.env.AWS_REGION || process.env.REGION,
    availability_zone: process.env.AWS_AVAILABILITY_ZONE,
    instance_id: process.env.INSTANCE_ID || process.env.HOSTNAME,
    container_id: process.env.CONTAINER_ID,

    // Runtime
    node_version: process.version,
    runtime: process.env.AWS_EXECUTION_ENV || 'node',
    memory_limit_mb: process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE,

    // Environment type
    environment: process.env.NODE_ENV || process.env.ENVIRONMENT,
    stage: process.env.STAGE,
  },
};
```

## Non-HTTP Work Units (see `rules/non-http.md`)

Same one-event-per-unit-of-work principle for queue consumers. Emit once per message on ack/reject — not per processing step inside the handler:

```typescript
async function processMessage(message: QueueMessage) {
  const startTime = Date.now();
  const wideEvent: Record<string, unknown> = {
    messaging_system: 'sqs',
    messaging_message_id: sanitizeLogField(message.id),
    retry_count: message.attempts,
    request_id: sanitizeLogField(message.headers['x-request-id']) ?? crypto.randomUUID(),
  };

  try {
    const result = await handleOrderEvent(message.body);
    wideEvent.outcome = 'success';
    wideEvent.order = { id: result.orderId };
  } catch (error) {
    wideEvent.outcome = 'error';
    wideEvent.error = { type: error.name, message: error.message };
    throw error;
  } finally {
    wideEvent.duration_ms = Date.now() - startTime;
    logger.info(wideEvent);
  }
}
```

## Correlation (see `rules/correlation.md`)

Prefer W3C Trace Context / OTel `trace_id`/`span_id` where tracing infrastructure exists. Without it, propagate a request ID across service hops as a fallback:

```typescript
// Service A - generate and propagate
const requestId = c.get('requestId') || crypto.randomUUID();
wideEvent.requestId = requestId;

await fetch('http://downstream-service/endpoint', {
  headers: { 'x-request-id': requestId },
  body: JSON.stringify(data),
});

// Service B - extract and use
const requestId = c.req.header('x-request-id');
wideEvent.requestId = requestId;  // Same ID links events together
```

## Redacting Sensitive Fields (see `rules/security.md`)

Three techniques, from cheapest to most preserving of debug value:

**Masking / truncation:**

```typescript
function maskApiKey(key: string): string {
  if (key.length < 8) return '***';
  return `${key.slice(0, 7)}...${key.slice(-4)}`; // sk_live_51...a8f9
}
```

**Salted keyed hashing** — for values you need to correlate across events without storing the raw value:

```typescript
import { createHmac } from 'node:crypto';

function hashIdentifier(value: string): string {
  return createHmac('sha256', process.env.LOG_HASH_KEY!).update(value).digest('hex');
}
```

**Logger-level redaction** — pino redacts known-sensitive paths at serialization time, not at each call site:

```typescript
export const logger = pino({
  redact: ['req.headers.authorization', 'user.email', '*.password', '*.token'],
});
```

## Log Injection Sanitization (see `rules/security.md`)

Apply to any user-controlled string before it enters a wide event:

```typescript
function sanitizeLogField(input: string, maxLength = 1024): string {
  // Strip control characters (0x00-0x1F, 0x7F) before truncating
  const stripped = input.replace(/[\x00-\x1F\x7F]/g, '');
  return stripped.length > maxLength ? stripped.slice(0, maxLength) + '…[truncated]' : stripped;
}
```

Always serialize via a real JSON encoder (`JSON.stringify`) — never build a log line with manual string concatenation.

## Testing (see `rules/testing.md`)

Configure the logger to write to an in-memory sink during tests and assert on the captured structure — don't assert against stdout:

```typescript
// Node/pino — write to an in-memory stream instead of stdout
import { pino } from 'pino';

function createTestLogger() {
  const events: Record<string, unknown>[] = [];
  const logger = pino({}, { write: (line) => events.push(JSON.parse(line)) });
  return { logger, events };
}
```

## Open Question

Node has no built-in async-context equivalent to Python's `contextvars` or Rust's span-based `tracing`. Teams split on whether to thread the `wideEvent` object through every function signature (explicit, no magic, but verbose) or to rely on `AsyncLocalStorage` so handlers can attach fields without passing the object around (cleaner handler code, but hidden coupling and a real footgun if an `await` boundary or a pooled worker breaks context). The middleware example above uses explicit context passing because it's the least surprising; `AsyncLocalStorage` earns its keep once handler signatures are too deep to keep threading the object.
