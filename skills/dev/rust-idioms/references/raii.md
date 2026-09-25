# RAII — guards, drop bombs, and cleanup that cannot be forgotten

Contents:

1. [RAII in Rust](#1-raii-in-rust)
2. [Guard types](#2-guard-types)
3. [Drop bombs](#3-drop-bombs)
4. [Drop rules](#4-drop-rules)
5. [Async hazard](#5-async-hazard)
6. [When not to apply](#6-when-not-to-apply)
7. [Review quick-checks](#7-review-quick-checks)

## 1. RAII in Rust

Resource Acquisition Is Initialization: a resource's lifetime is bound
to a value; releasing happens in `Drop`. The compiler inserts the drop
at scope end, on early return, and on unwinding — cleanup is not a
discipline, it is a semantics.

std is built on it: `MutexGuard` releases the lock, `File` closes the
descriptor, `JoinHandle` (scoped threads) joins. The pattern to copy:

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

    /// Consumes self — after commit, the transaction no longer exists.
    pub fn commit(mut self) -> Result<(), DbError> {
        self.conn.exec("COMMIT")?;
        self.done = true;
        Ok(())
    }
}

impl Drop for Transaction<'_> {
    fn drop(&mut self) {
        if !self.done {
            self.conn.exec("ROLLBACK");   // early return, `?`, panic — all covered
        }
    }
}
```

Three invariants fall out of the types: you cannot forget cleanup
(`Drop` runs on every path), you cannot double-commit (`commit` takes
`self` by value), and you cannot use the transaction after commit
(it was moved).

## 2. Guard types

A guard is a small RAII value whose whole job is one scoped invariant.
Beyond transactions: temporary permission changes, "currently rendering"
flags, session scopes, metric timers, test fixtures. The shape is
always: acquire in the constructor, release in `Drop`, expose whatever
the guarded region may legitimately do.

Pair guards with capability tokens (`typestate.md` §5) when the guarded
region must *prove* it holds the resource:

```rust
pub struct RenderGuard<'a> { frame: &'a mut Frame, _priv: () }
impl<'a> RenderGuard<'a> {
    pub fn draw(&mut self, w: &Widget) { /* only path that can draw */ }
}
```

## 3. Drop bombs

The inverse emphasis: a guard that *panics, aborts, or logs loudly* when
dropped without being defused. It turns "you forgot a required step"
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
taken). The `scopeguard` crate packages the ad-hoc version — `defer!`
and `guard` for one-off cleanup closures (verify current API).

## 4. Drop rules

- **`Drop` must not panic** — a panic during unwinding aborts the
  process. Cleanup bodies stay minimal and infallible; log rather than
  bubble.
- **No IO beyond cleanup** in `Drop`; surprising side effects in drop
  are a review finding even when correct.
- **Explicit `drop(x)`** for eager release — most important for locks
  (release before a long section) and for scope timing.
- **Do not encode logical outcomes in Drop.** Rollback-on-drop is
  cleanup; *commit* is a semantic action and stays explicit. If a
  caller can be surprised by "it did the thing when it fell out of
  scope", the semantics belong in a named method.

## 5. Async hazard

A guard held across `.await` stays held for the entire suspension — a
locked `MutexGuard` across await is the classic deadlock (and with
`std::sync::Mutex`, a `Send` bound problem too). Review rule: any
non-`Send` guard alive across an await point is a finding. Scope guards
to end before the await, or use runtime-appropriate primitives
(`tokio::sync::Mutex` — verify against your runtime).

## 6. When not to apply

- Cross-resource shutdown with ordering requirements (stop A, drain B,
  close C) — reverse-creation drop order is too implicit; write an
  explicit `shutdown()` state machine.
- Cleanup whose success/failure the caller must *observe* — a `Drop`
  that swallows errors hides failures; return them from a named method
  and keep `Drop` as best-effort fallback.
- Anything in a hot path where the "resource" is a plain integer you
  read back later — a guard is ceremony, not safety (YAGNI).

## 7. Review quick-checks

- Manual `lock().unlock()` / `close()` / `release()` pairs — replace
  with a guard (Hidden dependency on caller discipline).
- `commit()` callable twice, or cleanup forgotten on one early-return
  path — consuming-self + `Drop` fixes both (Temporal coupling).
- Panic-capable `Drop` bodies — abort risk.
- Guards alive across `.await` — deadlock/`Send` hazard (§5).
- `Drop` performing logical outcomes the caller did not name — move to
  an explicit method.
