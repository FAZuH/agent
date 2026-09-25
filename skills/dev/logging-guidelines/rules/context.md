---
title: Context, Cardinality, and Dimensionality
impact: CRITICAL
tags: logging, context, cardinality, dimensionality
---

## Context, Cardinality, and Dimensionality

**Impact: CRITICAL**

Wide events must be context-rich with high cardinality and high dimensionality. This enables you to answer questions you haven't anticipated yet - the "unknown unknowns" that traditional logging misses.

> Before adding a field, check `rules/security.md`. Anything that identifies a person beyond an opaque ID, or any credential/token/session value, must be redacted, masked, or hashed before it goes into the event below — not added first and cleaned up later.

### High Cardinality

High cardinality means a field can have millions or billions of unique values. User IDs, request IDs, and transaction IDs are high cardinality fields. Your logging must support querying against any specific value of these fields. Without high cardinality support, you cannot debug issues for specific users.

### High Dimensionality

High dimensionality means your events have many fields (20-100+). More dimensions mean more questions you can answer without redeploying code.

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

Include business-specific context, not just technical details. User subscription tier, cart value, feature flags, account age - this context helps prioritize issues and understand business impact.

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

Business context transforms debugging from "something broke" to "this $48,500 customer can't complete a $2,499 order." Note that none of the fields above are PII beyond an opaque `user.id` — that's the target shape: rich business context without raw personal identifiers.

### Always Include Environment Characteristics

Include environment and deployment information in every wide event. This context is essential for correlating issues with deployments, identifying region-specific problems, and understanding the runtime environment.

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

See the Environment Characteristics section of `references/typescript.md` for how to read these from `process.env` at startup.

**Why environment context matters:**

- **commit_hash**: Instantly identify which code version caused an issue
- **deployment_id**: Correlate errors with specific deployments
- **region/availability_zone**: Identify region-specific failures
- **instance_id**: Debug issues affecting specific instances
- **version**: Track issues across service versions
- **environment**: Distinguish production from staging issues

This environment context should be added once at service startup and automatically included in every wide event via middleware.
