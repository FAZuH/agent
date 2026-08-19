---
title: Common Pitfalls
impact: MEDIUM
tags: logging, anti-patterns, pitfalls
---

## Common Pitfalls

**Impact: MEDIUM**

Avoid these anti-patterns that undermine your logging effectiveness.

### Pitfall 1: Too Many Log Lines Per Request

Emitting multiple log lines per request creates noise without value. These scattered logs cannot be efficiently queried.

**Incorrect** — 6 `console.log` lines per request (see the anti-pattern at the top of the Inline Pattern section in `references/typescript.md`).

**Correct** — a single wide event with everything:

```json
{
  "method": "POST",
  "path": "/checkout",
  "user": { "id": "user_123", "email": "u@example.com" },
  "cart": { "item_count": 3, "total": 4599 },
  "payment": { "status": "succeeded", "order_id": "ord_123" },
  "status_code": 200,
  "duration_ms": 1247
}
```

### Pitfall 2: Not Designing for Unknown Unknowns

Traditional logging captures "known unknowns" - issues you anticipated. But production bugs are often "unknown unknowns" - issues you never predicted. Wide events with rich context enable investigating issues you didn't anticipate.

**Incorrect** — logging only for anticipated issues (see the Inline Pattern anti-pattern in `references/typescript.md`):

- Bug: "Users on free trial can't see their articles"
- Your logs say: "Article created successfully" ✓
- But you have NO visibility into:
  - Which users are affected (free trial? all?)
  - What subscription plans see this issue
  - When it started

**Correct** — a wide event captures everything, including fields you didn't anticipate needing:

```json
{
  "user": { "id": "user_456", "subscription": "free_trial", "trial_expiration": "2024-09-30" },
  "article": { "id": "article_123", "published": false }
}
```

Now you can query: `WHERE article.published = false GROUP BY user.subscription` → Result: 95% of unpublished articles are from trial users!

### Pitfall 3: Missing Request Correlation

Without request IDs propagated across services, you cannot trace a request's journey.

**Incorrect:**

```jsonl
{ "message": "Order created", "order_id": "ord_123" }
{ "message": "Inventory reserved", "items": 3 }
```

No way to connect these two events.

**Correct:**

```jsonl
{ "request_id": "req_abc", "message": "Order created", "order_id": "ord_123" }
{ "request_id": "req_abc", "message": "Inventory reserved", "items": 3 }
```

`WHERE request_id = 'req_abc'` now shows the full flow.
