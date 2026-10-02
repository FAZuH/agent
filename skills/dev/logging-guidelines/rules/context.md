---
title: Context, Cardinality, and Dimensionality
impact: CRITICAL
tags: logging, context, cardinality, dimensionality
---

## Context, Cardinality, and Dimensionality

**Impact: CRITICAL**

Events must be context-rich: high cardinality plus high dimensionality. Answers questions unanticipated at write time (unknown unknowns).

> Before adding a field, check `rules/security.md`. Anything identifying a person beyond an opaque ID, or any credential/token/session value, gets redacted, masked, or hashed before entering the event, never added first and cleaned later.

### High Cardinality

High cardinality: millions or billions of unique values (user IDs, request IDs, transaction IDs). Must query any specific value; without it, no per-user debugging.

### High Dimensionality

High dimensionality: many fields (20-100+). More dimensions, more questions answered without redeploying.

```json
{
  "timestamp": "2024-09-08T06:14:05.680Z",
  "duration_ms": 268,

  "method": "POST",
  "path": "/checkout",
  "requestId": "req_abc123",

  "service": "checkout-service",
  "version": "2.4.1",
  "region": "us-east-1",
  "commit_hash": "690de31f",

  "user": {
    "id": "user_456",
    "subscription": "premium",
    "account_age_days": 847,
    "lifetime_value_cents": 284700
  },

  "cart": {
    "id": "cart_xyz",
    "item_count": 3,
    "total_cents": 15999,
    "coupon_applied": "SAVE20"
  },

  "payment": {
    "method": "card",
    "provider": "stripe",
    "latency_ms": 189
  },

  "feature_flags": {
    "new_checkout_flow": true
  },

  "status_code": 200,
  "outcome": "success"
}
```

### Always Include Business Context

Include business context, not just technical details: tier, cart value, flags, account age. Prioritizes issues, shows business impact.

```json
{
  "requestId": "req_123",
  "method": "POST",
  "path": "/checkout",
  "status_code": 500,

  "user": {
    "id": "user_456",
    "subscription": "enterprise",
    "account_age_days": 1247,
    "lifetime_value_cents": 4850000
  },

  "cart": {
    "total_cents": 249900,
    "contains_annual_plan": true
  },

  "feature_flags": {
    "new_payment_flow": true
  },

  "error": {
    "type": "PaymentError",
    "code": "card_declined"
  }
}
```

Now you KNOW this is critical: an enterprise customer ($48.5k LTV) trying to make a $2.5k purchase, with `new_payment_flow` enabled.

Transforms "something broke" into "this $48,500 customer can't complete a $2,499 order." No field is PII beyond opaque `user.id`: the target shape.

### Always Include Environment Characteristics

Include environment and deployment info in every event: correlates issues with deploys and regions.

**Environment fields to include:**

```json
{
  "commit_hash": "690de31f",
  "deployment_id": "deploy_xyz",
  "deploy_time": "2024-09-08T06:00:00Z",
  "service": "checkout-service",
  "version": "2.4.1",
  "region": "us-east-1",
  "availability_zone": "us-east-1a",
  "instance_id": "i-0abc123",
  "container_id": "c-789",
  "node_version": "v20.11.0",
  "environment": "production",
  "stage": "prod"
}
```

See the Environment Characteristics section of `references/typescript.md` for reading these from `process.env` at startup.

**Why it matters:** `commit_hash` pins the code version; `deployment_id` correlates errors with deploys; `region`/`availability_zone` isolate regional failures; `instance_id` debugs single instances; `version` tracks across releases; `environment` separates prod from staging.

Add once at startup; middleware includes it in every event.
