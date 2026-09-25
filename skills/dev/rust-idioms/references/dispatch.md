# dispatch design — generics vs dyn Trait vs enum

Contents:

1. [The three tools](#1-the-three-tools)
2. [Decision table](#2-decision-table)
3. [Object safety (dyn compatibility)](#3-object-safety-dyn-compatibility)
4. [Enum dispatch](#4-enum-dispatch)
5. [Costs, honestly](#5-costs-honestly)
6. [When not to apply](#6-when-not-to-apply)
7. [Review quick-checks](#7-review-quick-checks)

## 1. The three tools

| Tool | Dispatch | Implementors | Shape |
|---|---|---|---|
| Generics (`fn f<T: Store>(s: T)`) | static (monomorphized) | open, decided at compile time | one compiled copy per concrete type |
| `dyn Trait` (`&dyn Store`) | dynamic (vtable) | open, decided at runtime | one copy, indirect calls |
| `enum` (`enum AnyStore { S3(S3Store), Fs(FsStore) }`) | static (`match`) | closed — only the crate's variants | one copy, exhaustive |

All three express "some behavior, multiple implementations". The
decision is about *who may add implementations* and *when the set is
known* — not about speed first.

## 2. Decision table

| Situation | Pick |
|---|---|
| Implementations chosen per call site, known at compile time | generics |
| Heterogeneous collection (`Vec<Box<dyn Handler>>`) or runtime-chosen | `dyn Trait` |
| Closed set of implementations you match internally | enum (or sealed trait — see `sealed-traits.md`) |
| Downstream must add implementations | generics or `dyn` — never sealed/enum |
| Trait must be used as a trait object | keep it object-safe (§3) |
| One implementation exists, second is hypothetical | concrete type — refactor when the second arrives (YAGNI) |
| Values must be serialized, compared, or exhaustively matched | enum |

A useful pairing: **generics on the way in, `dyn` on the way out**
(`fn build(cfg: &Config) -> Box<dyn Store>`) — flexible internals,
one monomorphized entry point. The reverse (dyn in, concrete out) is
rarely what you want.

## 3. Object safety (dyn compatibility)

A trait is object-safe only if it can be used as `dyn Trait`:

- No generic methods (`fn fetch<T>(&self, t: T)` — the vtable cannot
  name all `T`).
- No `Self`-by-value returns/params (`fn clone_box(&self) -> Self`).
- No associated functions without a receiver as callable methods.
- No `Self: Sized` bounds *on the trait* (methods may opt out with
  `where Self: Sized` — that *preserves* object safety by removing
  them from the vtable).

Fixes, in order: add `where Self: Sized` to the offending method; move
the method to a separate extension trait; or rework to return
`Box<dyn ...>` instead of `Self`.

## 4. Enum dispatch

When the implementation set is closed, an enum beats both alternatives
on simplicity:

```rust
pub enum AnyStore {
    S3(S3Store),
    Fs(FsStore),
}

impl AnyStore {
    pub fn get(&self, key: &Key) -> Result<Bytes, StoreError> {
        match self {
            AnyStore::S3(s) => s.get(key),
            AnyStore::Fs(s) => s.get(key),
        }
    }
}
```

Properties: no vtable, no monomorphization explosion, serializable,
exhaustive matches keep the compiler in the refactor loop
(`sealed-traits.md` §4). The cost — every new backend edits this
`match` — is exactly the point when the set is closed. The
`enum_dispatch` crate generates this shape from a trait definition
(verify current).

A trait *behind* the enum still pays off internally: the enum arms stay
one-liners and per-impl logic lives with its type.

## 5. Costs, honestly

- Generics: fastest calls, but monomorphization costs compile time and
  binary size, and generic types infect signatures (`Arc<Mutex<Store>>`
  becomes `Arc<Mutex<T: Store>>` everywhere).
- `dyn`: one indirection per call, no inlining, no `Send`/`Sync` unless
  stated — usually negligible; decide on *flexibility* first and
  measure before paying generics' ergonomics for speed.
- enum: cheapest runtime, most rigid API — correct when closed.

In hot loops doing real work (I/O, parsing), dispatch choice rarely
registers on a profile. Measure; do not pre-optimize the vtable.

## 6. When not to apply

- Generic parameter with a single concrete caller — inline the type
  (Speculative generality).
- `T: Into<String>`-style bounds scattered "for flexibility" — accept
  what you need (see `newtype.md` §3) or take `&str`.
- A trait with one impl "so tests can mock it" — mocking wants an
  injected port (`rust-tea`'s `EffectHandler`), which can still be
  concrete-with-a-trait-bound only where injected.
- Dyn-ifying a closed internal set — use the enum.

## 7. Review quick-checks

- Open trait dispatched over internally (downcast/match on impls) —
  should be sealed or an enum (Leaky abstraction).
- Trait with one production impl and no injection point — YAGNI.
- Object-unsafe trait forcing `Box<dyn>` workarounds — §3 fixes.
- Generics propagated through ten layers for one call site — narrow
  the bound to where it is used.
- Enum dispatch arms all one-line delegations — fine; arms with
  branching logic mean behavior leaked out of the impls.
