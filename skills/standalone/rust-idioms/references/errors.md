# error design — thiserror, anyhow, and error-as-data

Contents:

1. [The split](#1-the-split)
2. [Library errors: typed and matchable](#2-library-errors-typed-and-matchable)
3. [Application errors: context chains](#3-application-errors-context-chains)
4. [Error-as-data (fold-in)](#4-error-as-data-fold-in)
5. [Panics — only on unrecoverable state](#5-panics--only-on-unrecoverable-state)
6. [Wording](#6-wording)
7. [Rules](#7-rules)
8. [When not to apply](#8-when-not-to-apply)
9. [Review quick-checks](#9-review-quick-checks)

## 1. The split

| | Library | Application (binary) |
|---|---|---|
| Type | `thiserror`-derived enums | `anyhow::Error` |
| Consumers | callers who `match` and act | logs, exit codes, toasts |
| Design goal | stable, matchable variants | human-readable context chain |
| Contains | domain data per variant | source chain + context strings |

Libraries cannot know which failures their callers care about, so every
distinct *actionable* failure gets its own typed variant. Applications
usually just report, so one dynamic error type with a context chain is
cheaper and more readable. The boundary: convert typed library errors
into the app error type where the app's module boundary ends.

## 2. Library errors: typed and matchable

```rust
use thiserror::Error;

#[derive(Debug, Error)]
pub enum ConfigError {
    /// A named field failed validation — carries data, not prose.
    #[error("invalid value for `{field}`: {reason}")]
    InvalidValue { field: &'static str, reason: String },

    /// Wrap and expose the underlying source chain.
    #[error("config file is not valid TOML")]
    Parse(#[from] toml::de::Error),

    #[error("config file {path} not found")]
    NotFound { path: PathBuf },
}
```

Conventions:

- One enum per subsystem (`ConfigError`, `StoreError`), not one god
  enum per crate — callers match on the subsystem they touch.
- Variants carry **structured data** (`field`, `retry_after`, `path`);
  `Display` renders prose only at the edge.
- `#[from]` for automatic `?` conversion; `#[source]`/`#[error(...,
  source)]` to preserve the chain; `#[error(transparent)]` to pass an
  inner error through untouched.
- Adding a variant is semver-breaking for exhaustive matchers — same
  vocabulary considerations as `sealed-traits.md` §4.

## 3. Application errors: context chains

```rust
use anyhow::{Context, Result};

fn load_user_config() -> Result<Config> {
    let raw = std::fs::read_to_string(config_path())
        .context("failed to read user config")?;
    toml::from_str(&raw).context("user config is not valid TOML")
}
```

- `.context()` adds a layer to the chain; the top of the chain is the
  *what*, the source is the *why*. Print with `{:?}` (anyhow renders
  the full chain) or iterate `error.chain()`.
- Context strings are lowercase fragments, no trailing punctuation,
  describing the *failed action*, not the emotion — full wording rules
  in §6.
- `anyhow::bail!` / `.with_context(|| ...)` for lazy formatting.

## 4. Error-as-data (fold-in)

When control flow must *act* on a failure — retry, skip, degrade,
surface a specific message — the error must remain structured all the
way to the decider:

```rust
pub enum StoreError {
    RateLimited { retry_after: Duration },
    NotFound { key: Key },
    Unavailable,
}

// decider side:
match store.put(&entry) {
    Err(StoreError::RateLimited { retry_after }) => schedule_retry(retry_after),
    Err(StoreError::NotFound { key }) => vec![Effect::Repair(key)],
    Err(StoreError::Unavailable) => vec![Effect::ShowToast("storage offline")],
    Ok(()) => vec![],
}
```

Collapsing this to `Err(anyhow!("rate limited"))` at the library edge
destroys the decision — the decider is back to string matching
(Primitive obsession). Rule: **errors that cross a decision boundary
are data; errors that cross a reporting boundary are context chains.**

This is the shape `rust-tea` effect results use: `Msg::TaskResult(`
`Result<TaskOutput, TaskError>)` re-enters `update`, where the model —
the only policy owner — decides what a failure means.

## 5. Panics — only on unrecoverable state

A panic is a bug report, not an error channel. Panic only when an
internal invariant is broken and continuing would corrupt state or
silently produce wrong output. Everything else — I/O, network, user
input, parsing — is a `Result`.

| Situation | Response |
|---|---|
| Expected failure (I/O, input, network, parse) | `Result` / `Option` |
| Broken internal invariant (impossible state reached) | `expect("invariant: …")` |
| Truly unreachable arm of a match you fully own | `unreachable!("reason")` |
| Throwaway prototype or scratch tool | `unwrap`; delete before it ships |

Rules:

- `expect("invariant: <what held>")` over bare `unwrap` — the message
  names the invariant, not the emotion.
- Never panic on data that crossed a trust boundary (user input,
  network, file contents) — corrupt or hostile input becomes a remote
  DoS. Validate instead; return a typed variant.
- Libraries never panic on caller mistakes; offer `checked_*`/`try_*`
  or return an error. A panic that *is* the contract (e.g. indexing)
  is documented with a `# Panics` doc section.
- Binaries may panic at startup edges (malformed config), but
  `fn main() -> Result` is still preferred — it prints a context
  chain, not a stack trace.
- `unreachable!()` only behind exhaustiveness you own (a private
  enum); on public or third-party types, return a variant instead.
- A panic mid-operation is not transactional — use RAII guards
  (`raii.md`); `Drop` must not panic.
- `catch_unwind` is for thread/FFI boundaries, never to "handle" a
  bug — it converts a crash into corruption. Choosing
  `panic = "abort"` is a deployment decision per binary, not an
  error strategy.

Related: a wrong-state method that panics means the typestate failed
(`typestate.md`); drop bombs panic deliberately as a guard
(`raii.md`).

## 6. Wording

Error strings follow std-library conventions:

- Lowercase, no trailing period: `"failed to read file"`.
- Actions in past tense (`"failed to connect to database"`); states
  as noun phrases (`"missing required field: name"`, `"empty input"`).
  No imperatives (`"try again"`) and no `Error:` prefix — the `Err`
  type already says it.
- Include the relevant value, briefly: `"invalid port: {port}"`.
- Don't repeat context the caller adds: inner `"file not found"`,
  outer `.context("failed to load config")` joins the chain.

## 7. Rules

- No `unwrap`/`expect` on recoverable paths in library code; reserve
  them for invariant violations with a message explaining the
  invariant.
- Never `eprintln!`/log *and* return the error — pick one side of the
  boundary; double-reporting hides the real first reporter.
- No `String`-typed error variants on decision boundaries (§4).
- `Box<dyn Error>` only at true dynamic boundaries (FFI, plugins); it
  erases matching.
- Derive `Debug` (and consider `PartialEq` on payloads) — tests and
  `assert_eq!` on errors need them.
- Panic only on unrecoverable state (§5); wording rules in §6.

## 8. When not to apply

- Small binaries with one failure story — `anyhow` end-to-end is the
  correct amount of design.
- A 14-variant taxonomy for a CLI that prints and exits — Speculative
  generality; split when a second consumer appears.
- `thiserror` in a tiny internal module whose errors never escape the
  crate — `anyhow` internally, typed only at the public boundary.

## 9. Review quick-checks

- Library returning `anyhow::Error` (or `String` errors) — callers
  cannot act on failures without string matching (Leaky abstraction).
- App code matching on error *display strings* — Primitive obsession;
  type the variants.
- `#[error(...)]` prose duplicated into variant payloads — one source
  of truth (DRY).
- Missing `#[source]`/`#[from]` where a cause exists — broken chain.
- `unwrap` in library paths that handle external input — panic as
  error handling.
- `catch_unwind` around ordinary bugs — a crash converted into
  corruption.
- One crate-wide god error enum — split per subsystem.
