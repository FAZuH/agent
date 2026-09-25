# extension traits — adding methods to foreign types

Contents:

1. [The pattern](#1-the-pattern)
2. [Import hygiene](#2-import-hygiene)
3. [Collision risk](#3-collision-risk)
4. [Generic extensions](#4-generic-extensions)
5. [Rules](#5-rules)
6. [When not to apply](#6-when-not-to-apply)
7. [Review quick-checks](#7-review-quick-checks)

## 1. The pattern

A trait implemented for a type you do not own. The trait supplies the
methods; the impl attaches them:

```rust
pub trait StrExt {
    fn non_empty(&self) -> Option<&str>;
}

impl StrExt for str {
    fn non_empty(&self) -> Option<&str> {
        (!self.is_empty()).then_some(self)
    }
}

// "hello".non_empty() == Some("hello"), once StrExt is imported
```

This is the only way to extend `str`, `Vec`, `Iterator`, `Result`, and
every other upstream type. Canonical ecosystem example: `itertools`'
`Itertools` trait, which adds combinator methods to every `Iterator`.

## 2. Import hygiene

Extension methods are invisible until the trait is in scope:

```rust
use mycrate::StrExt;   // methods exist from here on
```

Two consequences:

- **Feature**: the upstream type is untouched; users opt in per-file,
  and no inherent-method namespace is polluted.
- **Footgun**: "method not found" errors when the import is missing.
  Mitigate by naming the trait descriptively (`Itertools`, not `Ext`)
  and re-exporting it next to the types it extends.

## 3. Collision risk

Two failure shapes to know:

- **Upstream adds a same-named inherent method**: inherent methods win
  silently — your trait method stops being called, with no error. The
  behavior of existing code changes under a minor upstream bump.
- **Upstream adds a same-named trait** that is also in scope: calls
  become ambiguous — a compile error (annoying, but at least loud).

Defense: prefix-worthy names (`iter_chunks` rather than `chunks`),
document the upstream-collision risk on the trait, and prefer
explicit paths (`<str as StrExt>::non_empty(s)`) in the rare hot spots
where silence would be dangerous.

## 4. Generic extensions

Extension traits pair well with blanket impls over std traits:

```rust
pub trait ResultExt<T, E> {
    /// Attach context to the error side, anyhow-style.
    fn context<C: fmt::Display>(self, ctx: C) -> Result<T, MyError>;
}

impl<T, E> ResultExt<T, E> for Result<T, E> { /* ... */ }
```

Now every `Result` in reach gains `.context(...)`. The same blanket
pattern powers `itertools` (`impl<I: Iterator> Itertools for I`) and
`futures`' `TryFutureExt`.

## 5. Rules

- Only for types you do **not** own. If you own the type, an inherent
  impl is simpler, more discoverable, and collision-proof.
- Small surface: every method must earn its place. An extension trait
  with forty methods is a dependency you impose on every reader.
- Extension traits cannot see private state — if the "extension"
  needs internals, it is not an extension; it belongs in the owning
  module.
- Keep implementations side-effect free or obviously named; a method
  on `str` that writes a file fails the principle of least surprise.
- Do not blanket-impl over broad std traits without checking the
  downstream surface users get (`impl<T: Display> MyExt for T` also
  lands on your own types in surprising ways).

## 6. When not to apply

- One caller — a free `fn non_empty(s: &str)` is shorter than a trait
  plus impl plus import (YAGNI).
- You own the type — inherent impl.
- The "extension" wants to override or shadow an upstream method —
  impossible by design; write a differently-named method instead.
- You are about to add it "for symmetry" with no current user
  (Speculative generality).

## 7. Review quick-checks

- Extension trait on a type in the same crate — should be inherent.
- Same-named methods as an upstream trait/type in scope — collision
  risk; rename.
- Extension trait reaching 10+ unrelated methods — split by concern or
  fold into the owning type (Single Responsibility Principle).
- Blanket impl over a wide std trait without a documented reason —
  check what it does to downstream coherence.
- Missing-import footguns — re-export the trait from the crate root.
