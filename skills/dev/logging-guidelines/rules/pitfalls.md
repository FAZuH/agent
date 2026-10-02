---
title: Common Pitfalls
impact: MEDIUM
tags: logging, anti-patterns, pitfalls
---

## Common Pitfalls

**Impact: MEDIUM**

Anti-patterns that undermine logging effectiveness.

### Pitfall 1: Too Many Log Lines Per Request

Multiple lines per request are noise without value. Unqueryable.

**Incorrect**: 6 `console.log` lines per request (Inline Pattern anti-pattern, `references/typescript.md`).

**Correct**: a single wide event with everything:

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

Traditional logging captures "known unknowns" you anticipated. Production bugs are "unknown unknowns" you never predicted. Rich wide events cover the unpredicted.

**Incorrect**: logging only anticipated issues (Inline Pattern anti-pattern, `references/typescript.md`):

- Bug: "Users on free trial can't see their articles"
- Your logs say: "Article created successfully" ✓
- But you have NO visibility into:
  - Which users are affected (free trial? all?)
  - What subscription plans see this issue
  - When it started

**Correct**: a wide event captures everything, including fields you didn't anticipate needing:

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
