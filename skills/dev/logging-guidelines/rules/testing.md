---
title: Testing Log Output
impact: MEDIUM
tags: logging, testing, ci, snapshot-testing
---

## Testing Log Output

**Impact: MEDIUM**

Nothing else in this skill is enforced unless it's actually checked. A wide-event schema functions as a contract — dashboards, alerts, and other services' correlation logic all depend on specific fields existing with specific names and types — and contracts that aren't tested drift silently, usually discovered only when an alert stops firing.

### Capture Logs in Memory During Tests

Don't assert against stdout. Configure the logger to write to an in-memory sink during test runs and assert on the captured structure. See `references/typescript.md` (Testing) for the Node/pino in-memory stream helper.

```python
# Python/structlog — structlog.testing.LogCapture
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
// Rust/tracing — in-memory MakeWriter + per-test scoped subscriber
// See references/rust.md ("Testing") for the full recipe.
```

### Two Things Worth Testing

1. **Schema/snapshot tests** — compare the captured event shape against an approved snapshot. A code change that silently drops or renames a field (e.g. `user.id` → `userId`) fails the test instead of quietly breaking a downstream dashboard. Treat this the same as you'd treat a breaking API response-shape change.
2. **Redaction tests** — a CI scan of captured log output against a set of patterns (`Bearer `, `sk_live_`, common secret prefixes, an email regex) that should never appear unredacted. This is the actual backstop for `rules/security.md` — the rule is only as good as the test that would catch a violation.

### When This Is Overkill

If field names change often and no downstream consumer (dashboard, alert, other service) actually depends on the exact shape yet, snapshot tests will mostly generate noisy diffs to update rather than catching real regressions. Start with the redaction test — that one has a clear, stable pass/fail condition regardless of how much the schema itself is still evolving — and add schema snapshot tests once the shape has stabilized enough that a break is actually meaningful.
