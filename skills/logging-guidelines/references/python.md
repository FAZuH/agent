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
import uuid
from fastapi import FastAPI, Request

app = FastAPI()

@app.middleware("http")
async def wide_event_middleware(request: Request, call_next):
    structlog.contextvars.clear_contextvars()  # don't leak the previous request's fields
    start = time.perf_counter()

    structlog.contextvars.bind_contextvars(
        request_id=request.headers.get("x-request-id", str(uuid.uuid4())),
        http_method=request.method,
        http_path=request.url.path,
    )

    status_code = 500
    try:
        response = await call_next(request)
        status_code = response.status_code
        return response
    except Exception as exc:
        logger.exception("unhandled_exception", error_type=type(exc).__name__)
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

## Open Question

Teams split on whether to use `structlog` directly everywhere, or wrap stdlib `logging` with `structlog.stdlib.ProcessorFormatter`. Pure `structlog` is simpler and faster; wrapping stdlib logging is usually necessary in practice anyway, because third-party dependencies (Uvicorn, Gunicorn, SQLAlchemy) log through stdlib `logging`, and you want their output in the same JSON schema rather than a second, differently-shaped log stream.
