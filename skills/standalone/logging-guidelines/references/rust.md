# Rust: Wide Events with `tracing`

Rust's idiomatic structured-logging story isn't a request-scoped logger object — it's `tracing`, which accumulates context on **spans** rather than mutating a shared struct. A span roughly plays the role that the `wideEvent` object plays in the TypeScript reference (`references/typescript.md`): a place to accumulate fields over the lifetime of a unit of work, emitted as one structured record.

The unit of work doesn't have to be an HTTP request. A queue message, a cron tick, a daemon loop iteration, a CLI invocation, a request — the pattern is identical (`rules/non-http.md`); only the place where the root span gets created changes.

## Setup

```rust
// Cargo.toml: tracing, tracing-subscriber (with the "json" feature).
// Optional: tracing-appender for file sinks, tracing-opentelemetry for OTel export.

use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;

/// Stdout JSON — the simplest setup; no worker guard required.
pub fn init_telemetry_stdout() {
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::fmt::layer()
                .json()
                // The event's own fields land at the top level of each JSON line
                // instead of nested under "fields". Span-recorded fields always
                // render under "span"/"spans" either way — see the note below.
                .flatten_event(true),
        )
        .init();
}
```

**Where the wide event actually lands in each line:** the formatter emits `{timestamp, level, target, fields, span, spans}` — the root span's accumulated fields ride along nested under `"span"`, with the full root-to-leaf list under `"spans"`. There is no built-in flag that merges span fields into one flat record the way pino's output reads; point your ingest pipeline at `span.<field>` (Vector, Loki, and ELK all flatten trivially), or implement a custom `FormatEvent` if you truly need one flat object per unit of work.

Filter verbosity with `EnvFilter` (`tracing_subscriber::EnvFilter::from_default_env()`) as usual — but note that `EnvFilter` filters by level/target only. It is not a sampling mechanism; see [Sampling](#sampling-see-rules_samplingmd) below.

### Writing to a file: hold the `WorkerGuard` for the process lifetime

`tracing_appender::non_blocking` writes through a background thread with a bounded buffer. The `WorkerGuard` it returns is what flushes that buffer on drop — so it must stay alive until process exit. Dropping it early (binding it as `_`, storing it in a config struct that dies at startup) silently discards every line still buffered at shutdown — a production data-loss trap with no error at the drop site.

You don't need `std::mem::forget`. The contract is a plain named binding in `main`:

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

A pino-style logger takes a `base` object attached once at construction. `tracing` has no equivalent: **a span's field set is fixed when the span is created**, and events inherit only what their ancestor spans carry. So environment base fields ride the *unit-of-work root span*, seeded wherever that span is created — middleware for HTTP, the consumer loop for queues, `main` for CLIs. Centralize the values once:

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

Every root-span example below seeds these four fields. If you can't own root-span creation (e.g. a library wrapping a third-party server), the fallback is a custom `Layer` that injects the fields into spans as they open — more machinery; prefer owning the root span.

## Sanitizing Untrusted Strings (see `rules/security.md`)

Header values, paths, query strings, queue payloads, and exception messages are outsider-authored free text. Strip control characters and cap length before any of them enters a span field — the JSON serializer escapes output, but it neither neutralizes ANSI escape sequences nor bounds event volume (CWE-117):

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

Two details that differ from the TypeScript `sanitizeLogField` in `references/typescript.md`, both on the safe side: `char::is_control()` also strips C1 range characters (0x80–0x9F), and truncation counts `char`s, not bytes — byte slicing panics when it lands inside a multibyte codepoint.

## The Wide-Event Pattern: One Root Span per Unit of Work

Whatever the unit of work is, the shape is the same:

1. **Create one root `info_span!`** for the unit of work, declaring *every* field you will ever fill in — field sets are fixed at creation, so a field you didn't declare cannot be recorded later. Declare unknown-later fields as `tracing::field::Empty`, and spread the environment base fields in.
2. **Record fields as they become known** via `Span::current()`.
3. **Emit exactly one `info!`/`error!` at completion**, success or failure. Rust has no `finally`; structure the body so a single emit sits on the shared exit path — run the work, then log once based on the result.

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

`.instrument(span)` moves the span onto the future so the terminal event — and everything the work records — attaches to the root; `Span::current()` inside retrieves it. For a CLI, `main` plays the role of `process_message`: create the root span around the argument-parsed command, emit once at the end.

### Enriching from handlers and helpers

Business code runs *inside* the root span and enriches it — it does not create it:

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

Reserve `#[instrument]` for nested operations worth timing individually — those become **child spans**, which supply the step-by-step timeline a single wide event deliberately doesn't (`rules/wide-events.md`, Known Limitations). Its `skip(...)` remains the strongest redaction tool: skipped arguments never enter any span.

```rust
#[instrument(skip(password, auth_token))] // skipped args never enter ANY span
async fn login(username: &str, password: &str, auth_token: &str) -> Result<Session, AuthError> {
    // password and auth_token are never recorded, by construction
}
```

## HTTP Instantiation: axum Middleware (see `rules/wide-events.md`)

For an axum (0.8) service, the wrapper is middleware via `middleware::from_fn` — this is workflow step 2's middleware doing init, timing, status capture, and the single emit, so handlers only enrich (as in the previous section):

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
    // Path and headers are outsider-authored text — sanitize before recording.
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

One request then produces exactly one JSON line, with the accumulated context under `"span"`:

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

Other frameworks (actix-web, poise for Discord bots, warp) follow the same shape: create the root span before dispatch, `.instrument(...)` the handler future, record and emit after it resolves.

## Redacting Sensitive Fields (see `rules/security.md`)

`skip(...)` in `#[instrument]` is the primary tool — anything skipped never enters the span's recorded fields at all, which is stronger than redacting after the fact.

```rust
#[instrument(skip(password, auth_token))]
async fn login(username: &str, password: &str, auth_token: &str) -> Result<Session, AuthError> {
    // password and auth_token are never recorded, by construction
}
```

For values that need partial masking rather than full omission, wrap them in a newtype with a custom `Debug`:

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

For identifiers you need to correlate across events without storing raw values, HMAC them (`hmac` + `sha2` crates) the way `references/typescript.md` does with `node:crypto`.

## Sampling (see `rules/sampling.md`)

First, the negative statement: **`EnvFilter` is not a sampler.** It filters by level and target — turning it up and down controls verbosity, not event retention. Cost-control sampling needs a different mechanism:

- **Wide-event-native head sampling (no extra infra):** decide in the wrapper right before the terminal emit — always retain errors and slow units of work, downsample healthy ones, and record the denominator on retained events so queries can multiply back up. In-process counters don't coordinate across instances (same caveat as `rules/sampling.md`).

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

- **With `tracing-opentelemetry`:** configure the OTel layer's sampler for consistent head-based decisions — `ParentBased(Box::new(TraceIdRatioBased::new(0.1)))` keeps 10% of traces, decided per trace ID so all services agree. Head-based means it can drop the failing request you needed; that's the tradeoff table in `rules/sampling.md`.
- **Tail-based sampling** (guaranteed error retention) stays external — an OpenTelemetry Collector with the `tail_sampling` processor or Honeycomb Refinery between services and backend. Nothing in-process can make that decision honestly.

## Testing (see `rules/testing.md`)

Capture events with an in-memory `MakeWriter` and assert on parsed JSON — never against stdout:

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

**The collision footgun:** `set_global_default` (what `.init()` calls) **panics if a global subscriber is already set** — and `cargo test` runs every test in one process. Two tests each calling `.init()` means the second panics (or, with `try_init`, silently fails and leaks the first test's config everywhere), and parallel tests interleave writes into one shared writer. Scope the dispatcher per test instead:

```rust
#[test]
fn checkout_wide_event_has_expected_fields() {
    let capture = CaptureWriter::default();
    let subscriber = tracing_subscriber::registry()
        .with(tracing_subscriber::fmt::layer().json().with_writer(capture.clone()));

    // Scoped to this closure/thread — no global state touched, so tests can
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

    // Schema assertion — span-recorded fields arrive nested under "span":
    let event = events
        .iter()
        .find(|e| e["fields"]["event"] == "checkout_completed")
        .expect("terminal event was emitted");
    assert_eq!(event["span"]["outcome"], "success");

    // Redaction scan — no secret-shaped substring anywhere in the output:
    let raw = format!("{events:?}");
    assert!(!raw.contains("sk_live_"));
}
```

`with_default` is thread-local: it holds under `#[tokio::test]` (the default current-thread runtime runs on the test thread), but threads spawned inside the closure won't inherit it — multi-threaded-runtime tests need per-task instrumentation or a single global default set once in a shared fixture.

This is the Rust counterpart to the pino in-memory stream in `references/typescript.md` (Testing); the snapshot-vs-redaction guidance on what's worth testing lives in `rules/testing.md`.

## Correlation (see `rules/correlation.md`)

`tracing-opentelemetry` bridges `tracing` spans directly to OTel `trace_id`/`span_id`, which is generally preferable to hand-rolling a `request_id` field in Rust specifically, since span-based context propagation is already how `tracing` works internally — you get correlation "for free" once the OTel layer is wired in, rather than threading a request ID through every function signature. Without OTel infrastructure, extract `x-request-id` (or `traceparent`) at the edge, record it on the root span's `request_id` field, and propagate it on outbound calls.

## Open Question

Rust projects genuinely split on whether to emit JSON to stdout (as above) or skip stdout entirely and export spans straight through `tracing-opentelemetry` to a collector. Stdout JSON has zero infrastructure dependency; direct export gets you traces (not just flat log lines) but needs a working collector. Same tradeoff as the general stdout-vs-OTLP question in `rules/correlation.md` — pick based on whether you already have collector infrastructure, not by default.
