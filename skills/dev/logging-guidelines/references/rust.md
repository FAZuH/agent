# Rust: Wide Events with `tracing`

Rust has no request-scoped logger object. `tracing` accumulates context on **spans**, not a shared struct. A span plays the `wideEvent` role (`references/typescript.md`): field accumulation over a unit of work, emitted as one record.

Unit of work is never only HTTP: queue message, cron tick, daemon iteration, CLI invocation, request. Pattern identical (`rules/non-http.md`); only root-span creation moves.

## Setup

```rust
// Cargo.toml: tracing, tracing-subscriber (with the "json" feature).
// Optional: tracing-appender for file sinks, tracing-opentelemetry for OTel export.

use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;

/// Stdout JSON: the simplest setup; no worker guard required.
pub fn init_telemetry_stdout() {
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::fmt::layer()
                .json()
                // The event's own fields land at the top level of each JSON line
                // instead of nested under "fields". Span-recorded fields always
                // render under "span"/"spans" either way; see the note below.
                .flatten_event(true),
        )
        .init();
}
```

**Where the wide event lands:** the formatter emits `{timestamp, level, target, fields, span, spans}`: root-span fields ride nested under `"span"`, the root-to-leaf list under `"spans"`. No flag merges span fields flat the way pino reads; point ingest at `span.<field>` (Vector, Loki, ELK flatten trivially), or implement a custom `FormatEvent` for one flat object per unit of work.

Filter verbosity with `EnvFilter` (`tracing_subscriber::EnvFilter::from_default_env()`) as usual, but `EnvFilter` filters by level/target only. Not a sampler; see [Sampling](#sampling-see-rules_samplingmd) below.

### Writing to a file: hold the `WorkerGuard` for the process lifetime

`tracing_appender::non_blocking` writes through a background thread with a bounded buffer. The returned `WorkerGuard` flushes on drop, so it stays alive until process exit. Early drop (binding as `_`, storing in a startup-dying config struct) silently discards buffered lines at shutdown: data loss with no error at the drop site.

No `std::mem::forget`. The contract is a named binding in `main`:

```rust
/// JSON to a daily-rotating file. Returns a guard that MUST live for the
/// whole process lifetime.
pub fn init_telemetry_file(log_dir: &str) -> tracing_appender::non_blocking::WorkerGuard {
    let file = tracing_appender::rolling::daily(log_dir, "app.log");
    let (writer, guard) = tracing_appender::non_blocking(file);

    tracing_subscriber::registry()
        .with(
            tracing_subscriber::fmt::layer()
                .json()
                .flatten_event(true)
                .with_writer(writer),
        )
        .init();

    guard
}

fn main() {
    let _worker_guard = init_telemetry_file("/var/log/myapp"); // lives to the end of main
    // ... start the service
}
```

Stdout-only setups have no buffer and need no guard.

## Environment Base Fields (see `rules/context.md`)

No pino-style `base` object. **Span field sets fix at creation**; events inherit ancestor-span fields only. Environment fields ride the *unit-of-work root span*, seeded at creation (middleware for HTTP, consumer loop for queues, `main` for CLIs). Centralize once:

```rust
use std::sync::OnceLock;

pub struct EnvBase {
    pub service: &'static str,
    pub version: &'static str,
    pub commit_hash: &'static str,
    pub instance_id: String,
}

static ENV_BASE: OnceLock<EnvBase> = OnceLock::new();

pub fn env_base() -> &'static EnvBase {
    ENV_BASE.get_or_init(|| EnvBase {
        service: env!("CARGO_PKG_NAME"),
        version: env!("CARGO_PKG_VERSION"),
        // Injected by CI or a build script:
        //   println!("cargo:rustc-env=COMMIT_SHA={sha}");
        commit_hash: option_env!("COMMIT_SHA").unwrap_or("unknown"),
        instance_id: std::env::var("INSTANCE_ID")
            .or_else(|_| std::env::var("HOSTNAME"))
            .unwrap_or_else(|_| "unknown".into()),
    })
}
```

Every root-span example below seeds these four. No root-span ownership (e.g. library wrapping a third-party server): fallback is a custom `Layer` injecting fields at span open. More machinery; prefer owning the root span.

## Sanitizing Untrusted Strings (see `rules/security.md`)

Headers, paths, query strings, queue payloads, exception messages are outsider-authored free text. Strip control chars, cap length before any span field. JSON escapes output; it neither neutralizes ANSI escapes nor bounds volume (CWE-117):

```rust
/// Apply to any user-controlled string before recording it on a span.
pub fn sanitize_log_field(input: &str, max_len: usize) -> String {
    const MARKER: &str = "…[truncated]";
    let stripped: String = input.chars().filter(|c| !c.is_control()).collect();
    if stripped.chars().count() <= max_len {
        return stripped;
    }
    let mut out: String = stripped.chars().take(max_len).collect();
    out.push_str(MARKER);
    out
}
```

Two safe-side differences from TypeScript `sanitizeLogField` (`references/typescript.md`): `char::is_control()` also strips C1 (0x80–0x9F), and truncation counts `char`s, not bytes: byte slicing panics inside a multibyte codepoint.

## The Wide-Event Pattern: One Root Span per Unit of Work

Whatever the unit of work, one shape:

1. **One root `info_span!`**, declaring *every* field ever filled. Field sets fix at creation: undeclared fields can never record later. Unknown-later fields start as `tracing::field::Empty`, plus environment base fields.
2. **Record as known** via `Span::current()`.
3. **Exactly one `info!`/`error!` at completion**, success or failure. Rust has no `finally`; put one emit on the shared exit path: run the work, then log once on the result.

Queue consumer (mirrors the Node version in `references/typescript.md`):

```rust
use tracing::{error, field::Empty, info, info_span, Instrument, Span};

async fn process_message(msg: QueueMessage) {
    let base = env_base();

    let span = info_span!(
        "queue_message",
        messaging.system = "sqs",
        messaging.message_id = %sanitize_log_field(&msg.id, 128),
        retry_count = msg.attempts,
        // filled in as they become known:
        order.id = Empty,
        outcome = Empty,
        error.type = Empty,
        duration_ms = Empty,
        // environment base fields:
        service.name = base.service,
        service.version = base.version,
        service.commit_hash = base.commit_hash,
        service.instance_id = %base.instance_id,
    );

    async move {
        let started = std::time::Instant::now();
        let result = handle_order_event(&msg.body).await; // -> Result<String, ProcessError>
        let span = Span::current();
        span.record("duration_ms", started.elapsed().as_millis() as u64);

        // Exactly one terminal event, whichever way the work exits:
        match result {
            Ok(order_id) => {
                span.record("order.id", order_id.as_str());
                span.record("outcome", "success");
                info!(event = "queue_message", "message processed");
            }
            Err(ref err) => {
                span.record("outcome", "error");
                span.record("error.type", err.type_label());
                error!(event = "queue_message", "message processing failed");
            }
        }
    }
    .instrument(span) // everything inside attaches to the root span
    .await;
}
```

`.instrument(span)` attaches the future (terminal event plus recorded fields) to the root; `Span::current()` retrieves it inside. CLI: `main` is `process_message`: root span around the parsed command, one emit at the end.

### Enriching from handlers and helpers

Business code runs *inside* the root span and enriches it; never creates it:

```rust
async fn handle_checkout(payload: CheckoutPayload) -> Result<(), CheckoutError> {
    let span = Span::current(); // root span created by the wrapper/middleware

    let user = get_user(&payload.user_id).await?;
    span.record("user.id", user.id.as_str());

    let cart = get_cart(&user.id).await?;
    span.record("cart.total_cents", cart.total_cents);

    if cart.total_cents < 0 {
        span.record("outcome", "error");
        return Err(CheckoutError::InvalidCart); // wrapper emits the terminal event
    }

    span.record("outcome", "success");
    Ok(())
}
```

Reserve `#[instrument]` for nested operations worth timing: **child spans** supply the step timeline one wide event deliberately lacks (`rules/wide-events.md` Known Limitations). `skip(...)` stays the strongest redaction: skipped args never enter any span.

```rust
#[instrument(skip(password, auth_token))] // skipped args never enter ANY span
async fn login(username: &str, password: &str, auth_token: &str) -> Result<Session, AuthError> {
    // password and auth_token are never recorded, by construction
}
```

## HTTP Instantiation: axum Middleware (see `rules/wide-events.md`)

axum (0.8): middleware via `middleware::from_fn`. Workflow step 2: init, timing, status capture, single emit; handlers only enrich:

```rust
use axum::{
    extract::Request,
    middleware::{self, Next},
    response::Response,
    routing::post,
    Router,
};
use tracing::{error, field::Empty, info, info_span, Instrument, Span};

async fn track_request(req: Request, next: Next) -> Response {
    let started = std::time::Instant::now();
    let method = req.method().to_string();
    // Path and headers are outsider-authored text: sanitize before recording.
    let path = sanitize_log_field(req.uri().path(), 512);
    let user_agent = req
        .headers()
        .get("user-agent")
        .and_then(|v| v.to_str().ok())
        .map(|ua| sanitize_log_field(ua, 256));
    let base = env_base();

    let span = info_span!(
        "http_request",
        http.method = %method,
        http.route = %path,
        http.status_code = Empty,
        outcome = Empty,
        duration_ms = Empty,
        request_id = Empty, // record from traceparent / x-request-id; see Correlation
        user_agent = user_agent,
        service.name = base.service,
        service.version = base.version,
        service.commit_hash = base.commit_hash,
        service.instance_id = %base.instance_id,
    );

    async move {
        let resp = next.run(req).await;

        let span = Span::current();
        span.record("http.status_code", resp.status().as_u16());
        span.record("duration_ms", started.elapsed().as_millis() as u64);

        // Exactly one event per request, whichever way the handler exits:
        if resp.status().is_server_error() {
            span.record("outcome", "error");
            error!(event = "http_request", "request failed");
        } else {
            span.record("outcome", "success");
            info!(event = "http_request", "request completed");
        }
        resp
    }
    .instrument(span)
    .await
}

let app = Router::new()
    .route("/api/v1/checkout", post(handle_checkout))
    .layer(middleware::from_fn(track_request));
```

One request produces exactly one JSON line, accumulated context under `"span"`:

```json
{
  "timestamp": "2026-08-26T03:37:47.906029Z",
  "level": "INFO",
  "target": "myapp",
  "fields": { "event": "http_request", "message": "request completed" },
  "span": {
    "name": "http_request",
    "http.method": "POST",
    "http.route": "/api/v1/checkout",
    "http.status_code": 200,
    "outcome": "success",
    "duration_ms": 12,
    "user_agent": "Mozilla/5.0 …",
    "service.version": "2.4.1",
    "service.commit_hash": "690de31f",
    "service.instance_id": "i-0abc123"
  },
  "spans": [{ "name": "http_request", "…": "…" }]
}
```

Other frameworks (actix-web, poise for Discord bots, warp): same shape. Root span before dispatch, `.instrument(...)` the future, record and emit after resolve.

## Redacting Sensitive Fields (see `rules/security.md`)

`skip(...)` is primary: skipped values never enter span fields, stronger than after-the-fact redaction.

```rust
#[instrument(skip(password, auth_token))]
async fn login(username: &str, password: &str, auth_token: &str) -> Result<Session, AuthError> {
    // password and auth_token are never recorded, by construction
}
```

Partial masking instead of full omission: wrap in a newtype with custom `Debug`:

```rust
struct MaskedKey<'a>(&'a str);

impl std::fmt::Debug for MaskedKey<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        if self.0.len() < 8 {
            write!(f, "***")
        } else {
            write!(f, "{}...{}", &self.0[..7], &self.0[self.0.len() - 4..])
        }
    }
}
```

Correlatable identifiers without raw values: HMAC them (`hmac` + `sha2` crates), the way `references/typescript.md` does with `node:crypto`.

## Sampling (see `rules/sampling.md`)

Negative first: **`EnvFilter` is not a sampler.** Level/target only: verbosity, never retention. Cost control needs another mechanism:

- **Wide-event-native head sampling (no extra infra):** decide in the wrapper before the terminal emit: always retain errors and slow units, downsample healthy ones, record the denominator on retained events for multiply-back queries. In-process counters never coordinate across instances (same caveat as `rules/sampling.md`).

```rust
use std::sync::atomic::{AtomicU64, Ordering};

static HEALTHY_COUNT: AtomicU64 = AtomicU64::new(0);
const SLOW_MS: u64 = 1_000;
const KEEP_EVERY: u64 = 10; // 1-in-10 for healthy traffic

/// Some(sample_rate) when the event should be emitted; None to drop.
fn sample_rate_for(status: u16, duration_ms: u64) -> Option<u64> {
    if status >= 500 || duration_ms >= SLOW_MS {
        return Some(1); // errors and outliers: always retained
    }
    (HEALTHY_COUNT.fetch_add(1, Ordering::Relaxed) % KEEP_EVERY == 0).then_some(KEEP_EVERY)
}
```

Replace the middleware's unconditional emit block with:

```rust
if let Some(rate) = sample_rate_for(resp.status().as_u16(), ms) {
    span.record("sample_rate", rate);
    if resp.status().is_server_error() {
        error!(event = "http_request", "request failed");
    } else {
        info!(event = "http_request", "request completed");
    }
}
```

- **With `tracing-opentelemetry`:** OTel layer sampler for consistent head decisions: `ParentBased(Box::new(TraceIdRatioBased::new(0.1)))` keeps 10% of traces, decided per trace ID so all services agree. Head-based can drop the failing request you needed; tradeoff table: `rules/sampling.md`.
- **Tail-based sampling** (guaranteed error retention) stays external: OpenTelemetry Collector `tail_sampling` processor or Honeycomb Refinery between services and backend. No in-process decision is honest.

## Testing (see `rules/testing.md`)

Capture with an in-memory `MakeWriter`, assert on parsed JSON, never stdout:

```rust
use std::sync::{Arc, Mutex};

#[derive(Clone, Default)]
struct CaptureWriter(Arc<Mutex<Vec<u8>>>);

impl CaptureWriter {
    fn lines(&self) -> Vec<String> {
        let bytes = self.0.lock().unwrap().clone();
        String::from_utf8_lossy(&bytes)
            .lines()
            .map(str::to_owned)
            .collect()
    }
}

impl<'a> tracing_subscriber::fmt::MakeWriter<'a> for CaptureWriter {
    type Writer = CaptureSink;
    fn make_writer(&'a self) -> Self::Writer {
        CaptureSink(self.0.clone())
    }
}

struct CaptureSink(Arc<Mutex<Vec<u8>>>);

impl std::io::Write for CaptureSink {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(buf);
        Ok(buf.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}
```

**Collision footgun:** `set_global_default` (what `.init()` calls) **panics when a global subscriber exists**: and `cargo test` runs every test in one process. Two tests calling `.init()`: the second panics (or with `try_init`, silently takes the first test's config everywhere), and parallel tests interleave writes into one shared writer. Scope the dispatcher per test:

```rust
#[test]
fn checkout_wide_event_has_expected_fields() {
    let capture = CaptureWriter::default();
    let subscriber = tracing_subscriber::registry()
        .with(tracing_subscriber::fmt::layer().json().with_writer(capture.clone()));

    // Scoped to this closure/thread: no global state touched, so tests can
    // run in parallel in one process without colliding.
    tracing::subscriber::with_default(subscriber, || {
        let span = tracing::info_span!("checkout", outcome = tracing::field::Empty);
        let _entered = span.enter();
        span.record("outcome", "success");
        tracing::info!(event = "checkout_completed", "done");
    });

    let events: Vec<serde_json::Value> = capture
        .lines()
        .into_iter()
        .map(|line| serde_json::from_str(&line).expect("each captured line is valid JSON"))
        .collect();

    // Schema assertion: span-recorded fields arrive nested under "span":
    let event = events
        .iter()
        .find(|e| e["fields"]["event"] == "checkout_completed")
        .expect("terminal event was emitted");
    assert_eq!(event["span"]["outcome"], "success");

    // Redaction scan: no secret-shaped substring anywhere in the output:
    let raw = format!("{events:?}");
    assert!(!raw.contains("sk_live_"));
}
```

`with_default` is thread-local: holds under `#[tokio::test]` (default current-thread runtime runs on the test thread), but spawned threads inside the closure never inherit it: multi-threaded-runtime tests need per-task instrumentation or one shared-fixture global default.

Rust counterpart to the pino in-memory stream (`references/typescript.md` Testing); snapshot-vs-redaction guidance: `rules/testing.md`.

## Correlation (see `rules/correlation.md`)

`tracing-opentelemetry` bridges spans to OTel `trace_id`/`span_id`: preferable to hand-rolled `request_id`, since span propagation is already `tracing`'s mechanism. Correlation comes free once the OTel layer wires in. Without OTel: extract `x-request-id` (or `traceparent`) at the edge, record on the root span, propagate outbound.

## Open Question

Split: JSON to stdout (above) vs spans straight through `tracing-opentelemetry` to a collector. Stdout: zero infra dependency. Direct export: traces, not flat lines, but needs a collector. Same stdout-vs-OTLP tradeoff as `rules/correlation.md`: pick by existing collector infra, never by default.
