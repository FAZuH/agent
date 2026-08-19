# Rust: Wide Events with `tracing`

Rust's idiomatic structured-logging story isn't a request-scoped logger object — it's `tracing`, which accumulates context on **spans** rather than mutating a shared struct. A span roughly plays the role that the `wideEvent` object plays in the TypeScript reference (`references/typescript.md`): a place to accumulate fields over the lifetime of a unit of work, emitted as one structured record.

## Setup

```rust
// Cargo.toml: tracing, tracing-subscriber (with "json" feature), tracing-opentelemetry (optional)

use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;

fn init_telemetry() {
    tracing_subscriber::registry()
        .with(tracing_subscriber::fmt::layer().json())
        .init();
}
```

## The Wide-Event Pattern via `#[instrument]`

Declare the fields you know up front in the `#[instrument]` attribute (use `tracing::field::Empty` for ones you'll fill in later), then `record` them as they become known during execution. Emit the outcome as a single `info!`/`error!` at the end — this is the equivalent of the `finally` block emission used in the TS examples.

```rust
use tracing::{error, info, instrument, Span};

#[instrument(
    name = "http_request",
    skip(payload), // never let a raw request body enter the span fields
    fields(
        http.method = "POST",
        http.route = "/api/v1/checkout",
        http.status_code = tracing::field::Empty,
        user.id = tracing::field::Empty,
        cart.total_cents = tracing::field::Empty,
    )
)]
async fn handle_checkout(payload: CheckoutPayload) -> Result<(), CheckoutError> {
    let span = Span::current();

    let user = get_user(&payload.user_id).await?;
    span.record("user.id", user.id.as_str());

    let cart = get_cart(&user.id).await?;
    span.record("cart.total_cents", cart.total_cents);

    if cart.total_cents < 0 {
        span.record("http.status_code", 400);
        error!(event = "checkout_validation_failed", "invalid cart total");
        return Err(CheckoutError::InvalidCart);
    }

    span.record("http.status_code", 200);
    info!(event = "checkout_completed", "checkout processed successfully");
    Ok(())
}
```

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

## Correlation (see `rules/correlation.md`)

`tracing-opentelemetry` bridges `tracing` spans directly to OTel `trace_id`/`span_id`, which is generally preferable to hand-rolling a `request_id` field in Rust specifically, since span-based context propagation is already how `tracing` works internally — you get correlation "for free" once the OTel layer is wired in, rather than threading a request ID through every function signature.

## Open Question

Rust projects genuinely split on whether to emit JSON to stdout (as above) or skip stdout entirely and export spans straight through `tracing-opentelemetry` to a collector. Stdout JSON has zero infrastructure dependency; direct export gets you traces (not just flat log lines) but needs a working collector. Same tradeoff as the general stdout-vs-OTLP question in `rules/correlation.md` — pick based on whether you already have collector infrastructure, not by default.
