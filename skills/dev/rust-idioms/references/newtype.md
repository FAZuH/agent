# newtype — smart constructors and parse, don't validate

Contents:

1. [The pattern](#1-the-pattern)
2. [Parse, don't validate](#2-parse-dont-validate)
3. [Acceptance traits (fold-in)](#3-acceptance-traits-fold-in)
4. [Ecosystem accelerators](#4-ecosystem-accelerators)
5. [When not to apply](#5-when-not-to-apply)
6. [Review quick-checks](#6-review-quick-checks)

## 1. The pattern

A tuple struct with a private field, plus a fallible constructor. The
field is private, so no invalid instance can exist outside the defining
module (Encapsulation):

```rust
pub struct Email(String);

#[derive(Debug, thiserror::Error)]
#[error("invalid email: {0}")]
pub struct EmailError(String);

impl Email {
    /// Validate once, here. Everywhere else, the type is the proof.
    pub fn parse(raw: &str) -> Result<Self, EmailError> {
        if raw.contains('@') && !raw.is_empty() {
            Ok(Email(raw.to_owned()))
        } else {
            Err(EmailError(raw.to_owned()))
        }
    }

    pub fn as_str(&self) -> &str { &self.0 }
}

impl FromStr for Email {
    type Err = EmailError;
    fn from_str(s: &str) -> Result<Self, Self::Err> { Email::parse(s) }
}
// now: "user@example.com".parse::<Email>() works too
```

Rules:

- Constructor is named for what it does (`parse`, `new`, `try_from`-style)
  and returns `Result` — never a silently-lossy `From<String>`.
- Offer explicit accessors (`as_str`), not `Deref`. `Deref` re-exposes the
  inner type's full API and quietly un-does the invariant (the API
  guidelines reserve `Deref` for smart pointers).
- Implement `From<Email> for String` for the *safe* outward direction
  (a valid email is always a string; the reverse is not true).
- `#[repr(transparent)]` when FFI or size guarantees matter — the
  newtype is zero-cost at runtime.

A two-value domain is an enum, not two `bool` parameters. `bool` params
at call sites (`send(&msg, true, false)`) are unreadable and
un-extensible — name the states:

```rust
pub enum Delivery { Sync, Async }
pub fn send(msg: &Msg, via: Delivery) -> Result<Receipt, SendError>
```

## 2. Parse, don't validate

Credit: Alexis King's essay of the same name. The rule: **parse at the
boundary, never validate on the way through.**

The anti-pattern — validation without a type change throws information
away, so every downstream caller must re-check or trust:

```rust
fn send(input: &str) -> Result<Receipt, SendError> {
    let email = validate_email(input)?;   // returns () — proof is lost
    // ... every line below still "knows" only that input is a &str
    let _ = email;
    deliver(input)
}
```

The fix — the check *changes the type*, so the proof travels with the
value and downstream code needs no checks:

```rust
fn main() -> Result<(), AppError> {
    let email = Email::parse(cli.value_of("email"))?;  // boundary: parse
    send(email)?;                                      // interior: trust
    Ok(())
}

fn send(email: Email) -> Result<Receipt, SendError> { /* no checks */ }
```

Where the boundary lives: `main`/CLI parsing, HTTP route handlers,
config loading, socket message decode. Everything interior receives
already-parsed types. If you find `validate_*` functions returning
`bool` or `Result<()>` whose proof is discarded, that is the finding —
make them constructors.

## 3. Acceptance traits (fold-in)

Two symmetric rules:

- **Store the most specific type** (the newtype).
- **Accept the most general type that converts into it**, so callers
  never convert for you:

```rust
pub fn load_config(path: impl AsRef<Path>) -> Result<Config, ConfigError>

pub fn log_in(name: impl Into<UserName>) -> Session   // raw or typed both work
```

Conventions:

- `impl AsRef<str>` / `AsRef<Path>` for borrowed read-only inputs
  (`&str`, `&String`, `&Path`, `PathBuf` all pass).
- `impl Into<T>` when you will own or store the value.
- `impl FromStr` on the newtype so `"x".parse::<T>()` works; `TryFrom`
  for conversions between your own types.
- Do not stack both `T` and `impl Into<T>` overloads — one acceptance
  trait per parameter.

This is the inbound mirror of the newtype's outbound `From`.

## 4. Ecosystem accelerators

- `nutype` — derives smart constructors from declarative sanitizers and
  validators; use when a codebase accumulates many small newtypes
  (verify current API).
- `secrecy` — `SecretString` type that redacts `Debug` output; the
  newtype pattern applied to *sensitivity*: secrets are typed so they
  cannot be logged accidentally.

Both replace boilerplate, not thinking — the invariant design is still
yours.

## 5. When not to apply

- Internal one-off helpers and prototypes — a checked `&str` parameter
  is fine until a second caller appears (YAGNI).
- Types with exactly one use site and one construction path already
  (the module *is* the invariant).
- Data that crosses no trust boundary and feeds straight into
  serialization (an internal cache key is a `String` until it isn't).

## 6. Review quick-checks

- Public API parameters of raw `String`/`u64`/`bool` that carry domain
  meaning — Primitive obsession.
- `validate_*` functions whose proof is discarded (returns `bool` or
  `Result<(), _>`) — replace with constructors (Parse, don't validate).
- The same check implemented in more than one place — parse at the
  boundary instead.
- `Deref` on a newtype — invariant leak; prefer explicit accessors.
- `bool` parameters at call sites — two-state enum.
