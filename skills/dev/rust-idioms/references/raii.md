# RAII: guards, drop bombs, and cleanup that cannot be forgotten

Contents:

1. [RAII in Rust](#1-raii-in-rust)
2. [Guard types](#2-guard-types)
3. [Drop bombs](#3-drop-bombs)
4. [Drop rules](#4-drop-rules)
5. [Async hazard](#5-async-hazard)
6. [When not to apply](#6-when-not-to-apply)
7. [Review quick-checks](#7-review-quick-checks)

## 1. RAII in Rust

Resource Acquisition Is Initialization: lifetime bound
to a value; release happens in `Drop`. The compiler inserts the drop
at scope end, on early return, and on unwinding.

std is built on it: `MutexGuard` releases the lock, `File` closes the
descriptor, scoped `JoinHandle` joins. Copy this shape:

```rust
pub struct Transaction<'a> {
    conn: &'a mut Conn,
    done: bool,
}

impl<'a> Transaction<'a> {
    pub fn begin(conn: &'a mut Conn) -> Transaction<'a> {
        conn.exec("BEGIN");
        Transaction { conn, done: false }
    }

    /// Consumes self: after commit, the transaction no longer exists.
    pub fn commit(mut self) -> Result<(), DbError> {
        self.conn.exec("COMMIT")?;
        self.done = true;
        Ok(())
    }
}

impl Drop for Transaction<'_> {
    fn drop(&mut self) {
        if !self.done {
            self.conn.exec("ROLLBACK");   // early return, `?`, panic: all covered
        }
    }
}
```

Types enforce: cleanup runs on every path (`Drop`), no double-commit
(`commit` takes `self`), no use after commit (moved).

## 2. Guard types

A guard is a small RAII value for one scoped invariant:
permission changes, "currently rendering" flags, session scopes,
metric timers, test fixtures. Shape: acquire in the constructor,
release in `Drop`, expose only what the guarded region may do.

Pair with capability tokens (`typestate.md` §5) when the region
must *prove* it holds the resource:

```rust
pub struct RenderGuard<'a> { frame: &'a mut Frame, _priv: () }
impl<'a> RenderGuard<'a> {
    pub fn draw(&mut self, w: &Widget) { /* only path that can draw */ }
}
```

## 3. Drop bombs

Inverse: a guard that *panics, aborts, or logs loudly* when
dropped without defuse. It turns a forgotten step
into an immediate, located failure:

```rust
pub struct CriticalSection { armed: bool }

impl CriticalSection {
    pub fn enter() -> Self { CriticalSection { armed: true } }
    pub fn defuse(self) { self.armed = false; }   // the one clean exit
}

impl Drop for CriticalSection {
    fn drop(&mut self) {
        if self.armed {
            panic!("critical section dropped without defuse");
        }
    }
}
```

Use for genuine contract violations (a code path that must never be
taken). The `scopeguard` crate packages the ad-hoc version (`defer!`
and `guard` for one-off cleanup closures (verify current API).

## 4. Drop rules

- **`Drop` must not panic**: a panic during unwinding aborts the
  process. Cleanup bodies stay minimal and infallible; log rather than
  bubble.
- **No IO beyond cleanup** in `Drop`; surprising side effects in drop
  are a review finding even when correct.
- **Explicit `drop(x)`** for eager release, most important for locks
  (release before a long section) and for scope timing.
- **Do not encode logical outcomes in Drop.** Rollback-on-drop is
  cleanup; *commit* is a semantic action and stays explicit. If a
  caller can be surprised by "it did the thing when it fell out of
  scope", the semantics belong in a named method.

## 5. Async hazard

A guard held across `.await` stays held for the suspension: a
locked `MutexGuard` across await is the classic deadlock (plus a
`Send` problem with `std::sync::Mutex`). Review rule: any
non-`Send` guard alive across await is a finding. End guards
before the await, or use runtime primitives
(`tokio::sync::Mutex`: verify against your runtime).

## 6. When not to apply

- Cross-resource shutdown with ordering requirements (stop A, drain B,
  close C): reverse-creation drop order is too implicit; write an
  explicit `shutdown()` state machine.
- Cleanup the caller must *observe*: return errors from a named
  method; keep `Drop` as best-effort fallback.
- Anything in a hot path where the "resource" is a plain integer you
  read back later: a guard is ceremony, not safety (YAGNI).

## 7. Review quick-checks

- Manual `lock().unlock()` / `close()` / `release()` pairs: replace
  with a guard (Hidden dependency on caller discipline).
- `commit()` callable twice, or cleanup forgotten on one early-return
  path; consuming-self + `Drop` fixes both (Temporal coupling).
- Panic-capable `Drop` bodies: abort risk.
- Guards alive across `.await`: deadlock/`Send` hazard (§5).
- `Drop` performing logical outcomes the caller did not name: move to
  an explicit method.
