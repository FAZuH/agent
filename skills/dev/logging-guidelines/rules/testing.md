---
title: Testing Log Output
impact: MEDIUM
tags: logging, testing, ci, snapshot-testing
---

## Testing Log Output

**Impact: MEDIUM**

Unchecked contracts drift silently, surfacing only when an alert stops firing. A wide-event schema is a contract: dashboards, alerts, and correlation logic depend on exact names and types.

### Capture Logs in Memory During Tests

Never assert against stdout. Log to an in-memory sink in tests; assert on captured structure. Node/pino helper: `references/typescript.md` Testing.

```python
# Python/structlog: structlog.testing.LogCapture
import structlog
from structlog.testing import LogCapture

def test_checkout_logs_expected_fields():
    cap = LogCapture()
    structlog.configure(processors=[cap])
    run_checkout(...)
    assert cap.entries[0]["status_code"] == 200
    assert "user" in cap.entries[0]
```

```rust
// Rust/tracing: in-memory MakeWriter + per-test scoped subscriber
// See references/rust.md ("Testing") for the full recipe.
```

### Two Things Worth Testing

1. **Schema/snapshot tests**: compare captured shape against an approved snapshot. Silently dropped or renamed fields (e.g. `user.id` → `userId`) fail instead of quietly breaking dashboards. Treat like a breaking API shape change.
2. **Redaction tests**: CI-scan captured output for patterns that must never appear unredacted (`Bearer `, `sk_live_`, secret prefixes, email regex). The actual backstop for `rules/security.md`: the rule holds only as far as this test catches violations.

### When This Is Overkill

Field names churning with no downstream consumer (no dashboard, alert, or service depending on exact shape): snapshots generate noisy diffs, not real regression catches. Start with the redaction test: stable pass/fail regardless of schema churn. Add snapshots once the shape stabilizes enough that a break matters.
