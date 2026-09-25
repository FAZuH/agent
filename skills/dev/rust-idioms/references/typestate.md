# typestate — states in the type system, and capability tokens

Contents:

1. [The pattern](#1-the-pattern)
2. [Rules and limits](#2-rules-and-limits)
3. [Typestate vs enum state](#3-typestate-vs-enum-state)
4. [Builders as mild typestate](#4-builders-as-mild-typestate)
5. [Capability tokens (fold-in)](#5-capability-tokens-fold-in)
6. [When not to apply](#6-when-not-to-apply)
7. [Review quick-checks](#7-review-quick-checks)

## 1. The pattern

Encode an object's lifecycle states as zero-sized type parameters.
Methods exist only on the states where they are legal, and transition
methods consume `self` — ownership is the engine. Once moved, the old
state cannot be used again:

```rust
use std::marker::PhantomData;

pub struct Disconnected;
pub struct Connected;
pub struct Authenticated;

pub struct Connection<State> {
    socket: TcpStream,
    _state: PhantomData<State>,
}

impl Connection<Disconnected> {
    pub fn connect(addr: SocketAddr) -> io::Result<Connection<Connected>> {
        Ok(Connection { socket: TcpStream::connect(addr)?, _state: PhantomData })
    }
}

impl Connection<Connected> {
    pub fn authenticate(self, cred: &Credentials)
        -> Result<Connection<Authenticated>, AuthError>
    {
        // ... handshake over self.socket
    }
}

impl Connection<Authenticated> {
    pub fn query(&mut self, q: &Query) -> Result<Rows, DbError> { /* ... */ }
}
```

With this API, `Connection::query` on a fresh connection is a *compile
error*, not a runtime one. `connect(conn)` twice is impossible — the
first transition moved the value. Temporal coupling ("authenticate
before you query") is enforced by the type system instead of a runtime
panic or a doc comment.

Shared behavior across states lives on a generic impl:

```rust
impl<State> Connection<State> {
    pub fn local_addr(&self) -> io::Result<SocketAddr> { self.socket.local_addr() }
}
```

## 2. Rules and limits

- **State payload changes** (each state carries different data): wrap
  shared fields in an `Inner` struct behind the marker, or split into
  `Connected(Connection<Connected>)`-style wrappers holding their own
  data. Do not force every state into one field set.
- **No partial recovery**: a consuming transition takes the whole value.
  Keep long-lived shared data behind `Arc`/`Inner` before transitioning,
  not re-borrowed afterwards.
- **Combinatorics**: 5 states × several data-carrying transitions gets
  heavy. If you are fighting the borrow checker more than modelling the
  domain, the state machine wants an enum instead (§3).

## 3. Typestate vs enum state

| Situation | Pick |
|---|---|
| State decided at runtime (network, user input) and stored in structs/collections | `enum State` + `match` |
| Many instances, state swapped in place | `enum State` |
| Compile-time-known pipeline (build → serve → shutdown) | typestate |
| Protocol handshakes with distinct per-state method sets | typestate |
| Configured once, then used one way | typestate (or plain methods) |

Rule of thumb: typestate models *linear* lifecycles known at compile
time; enums model *branching* runtime state. A two-state toggle never
needs either — an enum with two variants is already the whole story.

## 4. Builders as mild typestate

A builder enforces "required fields set before `build()`" two ways:

- Runtime: `build()` returns `Result` listing missing fields
  (`derive_builder`, `bon` — verify current APIs).
- Typestate: `Builder<NoTimeout>` exposes `.timeout()` →
  `Builder<HasTimeout>`; `build()` exists only on complete states.

Reach for the typestate builder when misconfiguration is a real bug
class; runtime builders for everything else.

## 5. Capability tokens (fold-in)

A capability is proof of authority, *held* by the caller as a value.
Zero-sized, unconstructable from outside, revocable by being dropped:

```rust
pub struct SessionToken { _priv: () }   // _priv: () blocks external construction

impl Vault {
    pub fn unlock(&self, key: &Key) -> Option<SessionToken> { /* verify */ }

    /// Requires proof you unlocked the vault.
    pub fn read(&self, session: &SessionToken, path: &Path) -> io::Result<Bytes> { /* ... */ }
}
```

Properties:

- **Held, not accessible**: holding a `&Vault` proves nothing; holding a
  `SessionToken` proves you unlocked it. Who-calls-what becomes a type
  fact, not a review convention.
- Zero-sized — no runtime cost.
- The `_priv: ()` field is the struct-level cousin of trait sealing
  (see `sealed-traits.md`): outsiders can hold `&SessionToken` returned
  by your API but can never forge one.
- Drop = revoke; combine with lifetimes (`Session<'vault>`) to bind a
  capability's validity to a borrow of the resource.

In `rust-tea` terms: a port like `EffectHandler` is a capability granted
to the core — the core can *use* effects only because the host handed
it the handler.

## 6. When not to apply

- Trivial transitions (open/closed, on/off) — an enum field is simpler
  and inspectable.
- State stored in collections or decided by IO at runtime — enum state.
- Prototypes and scripts — the ceremony exceeds the risk.
- More than ~4–5 states with data-heavy transitions — the type-level
  bookkeeping outweighs the safety (Speculative generality).

## 7. Review quick-checks

- Methods that panic or return "wrong state" errors — the state should
  be unrepresentable, not checked (Temporal coupling).
- `is_connected()` guards before every call on the same object — move
  the check into the type (typestate) or make the state an enum variant.
- State stored as `String`/`u32` tags with manual consistency —
  Primitive obsession; enum or typestate.
- Authority granted by "caller convention" (public method anyone may
  call) where a token would encode who may call it.
