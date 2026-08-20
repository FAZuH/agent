# Python: Wide Events with `structlog`

`structlog` plus the stdlib `contextvars` module is the closest Python equivalent to the "single logger + middleware" pattern used in the TypeScript reference (`references/typescript.md`). `contextvars` matters specifically because it's async-safe — a plain module-level dict would leak fields across concurrent requests under `asyncio`, which `contextvars` is designed to prevent.

## Setup

```python
import structlog

structlog.configure(
    processors=[
        structlog.contextvars.merge_contextvars,   # pulls in bound context vars
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso", utc=True),
        redact_sensitive,                           # see rules/security.md
        structlog.processors.JSONRenderer(),
    ],
    logger_factory=structlog.PrintLoggerFactory(),
    cache_logger_on_first_use=True,
)

logger = structlog.get_logger()
```

## The Wide-Event Pattern (FastAPI middleware)

`bind_contextvars` attaches fields that automatically flow into every subsequent `logger.info(...)` call within the same async context, without passing a `wideEvent` object through every function signature by hand.

```python
import time
import re
import uuid
from fastapi import FastAPI, Request

app = FastAPI()

def sanitize_log_field(value, max_length=1024):
    # Strip control characters (0x00-0x1F, 0x7F) before truncating
    stripped = re.sub(r"[\x00-\x1f\x7f]", "", value or "")
    return stripped[:max_length] + "…[truncated]" if len(stripped) > max_length else stripped

@app.middleware("http")
async def wide_event_middleware(request: Request, call_next):
    structlog.contextvars.clear_contextvars()  # don't leak the previous request's fields
    start = time.perf_counter()

    # Path and headers are outsider-authored text: sanitize before logging.
    structlog.contextvars.bind_contextvars(
        request_id=sanitize_log_field(request.headers.get("x-request-id")) or str(uuid.uuid4()),
        http_method=request.method,
        http_path=sanitize_log_field(request.url.path),
    )

    status_code = 500
    try:
        response = await call_next(request)
        status_code = response.status_code
        return response
    except Exception as exc:
        logger.exception("unhandled_exception", error_type=type(exc).__name__, error_message=sanitize_log_field(str(exc)))
        raise
    finally:
        duration_ms = round((time.perf_counter() - start) * 1000, 2)
        structlog.contextvars.bind_contextvars(status_code=status_code, duration_ms=duration_ms)
        log = logger.error if status_code >= 500 else logger.info
        log("request_completed")
```

**Handlers enrich, they don't construct:**

```python
@app.post("/checkout")
async def checkout(user: User = Depends(get_current_user)):
    structlog.contextvars.bind_contextvars(
        user={"id": user.id, "subscription": user.subscription},
    )
    order = await create_order(user)
    structlog.contextvars.bind_contextvars(order={"id": order.id})
    return order
```

## Redacting Sensitive Fields (see `rules/security.md`)

A processor runs on every event before rendering — this is the enforcement point, not scattered checks in handlers.

```python
SENSITIVE_KEYS = {"password", "token", "authorization", "api_key"}

def redact_sensitive(logger, method_name, event_dict):
    for key in SENSITIVE_KEYS:
        if key in event_dict:
            event_dict[key] = "[REDACTED]"
    return event_dict
```

## Testing (see `rules/testing.md`)

```python
from structlog.testing import LogCapture

def test_checkout_redacts_token(monkeypatch):
    cap = LogCapture()
    structlog.configure(processors=[redact_sensitive, cap])
    logger.info("login_attempt", token="sk_live_abc123")
    assert cap.entries[0]["token"] == "[REDACTED]"
```

## Porting to `loguru`

Many Python codebases already standardize on **`loguru`** (which has no direct
equivalent in this skill's list). Its `logger` is a process-wide singleton and
its `contextualize` is contextvars-based, so the structlog mechanics port
almost one-to-one — but two loguru specifics matter and are covered below.

### Concept mapping

| structlog | loguru |
|---|---|
| `bind_contextvars(...)` | `logger.contextualize(...)` (contextvars, async-safe; restored on exit) |
| `configure(processors=[...])` | a custom **sink** (or a `format=` callable — see the gotcha below) for the serialization boundary |
| `logger_factory=PrintLoggerFactory()` | `logger.add(path, ...)` for file/stream sinks |
| `structlog.testing.LogCapture` | `logger.add(list.append, format=lambda r: ...)` (capture records in memory) |
| processors (redaction, sanitize) | a `filter=`/sink/`format=`-stage function that mutates `record["extra"]` |

Env base fields (commit hash, version, environment) attach to every record via
`logger.configure(patcher=...)` — **not** `logger.patch(...)`, which is
per-instance and won't reach other modules' `from loguru import logger`.

### ⚠️ Gotcha: `format=` callables return TEMPLATES, not literal strings

This is the single most common loguru trap and it silently drops records.
`logger.add(..., format=my_callable)` treats the callable's **return value as a
template** parsed by `str.format_map` plus loguru's color-markup regex — it is
not written to output as-is:

- A return value containing literal JSON braces (`{"a": 1}`) raises `KeyError`.
- A return value containing `<...>`-shaped substrings (e.g. `<b>` in user
  content) raises `ValueError` and **drops the record**.

Two safe options:

1. **A custom sink** (recommended): `logger.add(sink)` where `sink` is a
   callable `def sink(message): ...` receiving a `LogRecord`-like `message`
   with `message.record`. Serialize `record["extra"]` + base fields to JSON
   there with `json.dumps` (never manual string concatenation). This is the
   cleanest boundary and the one `rules/security.md` assumes.
2. **An escaping `format=` adapter**: keep `json_format(record) -> str` as the
   pure boundary, and wrap it for the sink with a function that doubles `{`/`}`
   and emits `<`/`>` as `\u003c`/`\u003e` so nothing survives that the template
   parser can misinterpret. Round-trips exactly through `json.loads`, but is
   harder to reason about — prefer a custom sink.

Always emit JSON via `json.dumps`; never assemble a log line by concatenating
strings (see `rules/security.md`).

### Redaction at the boundary

Because loguru's serialization happens in the sink, put the redaction +
sanitize step in that same sink (or a `filter=`) so it runs on every record
before anything leaves the process — the enforcement point, not ad hoc `if`
checks in handlers. Reuse the key-based and URL-pattern redaction from
`rules/security.md`, applied recursively over `record["extra"]` (and the
message), stripping control chars and capping field length (CWE-117).

### Testing

Capture records in memory and assert on their structure:

```python
records = []
logger.add(lambda m: records.append(json.loads(json_format(m.record))))
logger.info("command_completed", exit_code=0, outcome="success")
assert records[-1]["exit_code"] == 0
```

Add a dedicated redaction test asserting `password`/`token`/webhook-URL values
never appear unredacted in captured output (see `rules/testing.md`).

### Open Question

Teams split on whether to use `structlog` directly everywhere, or wrap stdlib `logging` with `structlog.stdlib.ProcessorFormatter`. Pure `structlog` is simpler and faster; wrapping stdlib logging is usually necessary in practice anyway, because third-party dependencies (Uvicorn, Gunicorn, SQLAlchemy) log through stdlib `logging`, and you want their output in the same JSON schema rather than a second, differently-shaped log stream.
