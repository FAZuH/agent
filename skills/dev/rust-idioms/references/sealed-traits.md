# sealed traits — closed vocabularies and evolvable APIs

Contents:

1. [Why seal](#1-why-seal)
2. [The pattern](#2-the-pattern)
3. [Trait vs enum vs sealed trait](#3-trait-vs-enum-vs-sealed-trait)
4. [Exhaustive matching as a refactor tool](#4-exhaustive-matching-as-a-refactor-tool)
5. [`#[non_exhaustive]` vs sealing](#5-non_exhaustive-vs-sealing)
6. [When not to apply](#6-when-not-to-apply)
7. [Review quick-checks](#7-review-quick-checks)

## 1. Why seal

A public, unsealed trait is a promise: *anyone may implement this,
forever*. That promise constrains you — adding a method without a
default is a breaking change for every downstream impl, and internal
dispatch cannot assume anything about unknown implementors.

Seal the trait when the set of implementations is *yours*: you want
downstream to use the trait, but not to add to it.

## 2. The pattern

A supertrait in a private module. Downstream can name and use the
public trait, but cannot name the supertrait, so cannot implement it:

```rust
mod sealed {
    pub trait Sealed {}          // public name, private module
}

/// A value that can render itself. Sealed: we dispatch on it internally.
pub trait Value: sealed::Sealed {
    fn render(&self) -> String;
}

// crate-internal impls — the only ones that will ever exist
impl Value for Temperature { fn render(&self) -> String { /* ... */ } }
impl Value for Pressure   { fn render(&self) -> String { /* ... */ } }
```

Downstream code can write `fn show(v: &dyn Value)`, call `v.render()`,
and store `Box<dyn Value>` — but `impl Value for MyThing` fails to
compile because `MyThing` cannot implement the private `Sealed`.

The `#[sealed]` crate (attribute-based, verify current) generates the
same shape with less boilerplate.

## 3. Trait vs enum vs sealed trait

| Situation | Pick |
|---|---|
| Downstream must add implementations (plugin trait) | open trait — do **not** seal |
| Closed set of implementations, open set of *users* | sealed trait |
| Closed set of implementations and values, need matching | enum |
| Heterogeneous values across crates that must share an API | sealed trait over crate types, or enum |

If the implementations are all in your crate and you never gain
anything from downstream impls, an enum is often simpler than a sealed
trait — a sealed trait earns its keep when implementations need
different fields or carry data the enum would have to unify.

## 4. Exhaustive matching as a refactor tool

Enums and sealed-and-matched traits share one superpower: **the
compiler is your refactor checklist**. Add a variant (or a new internal
impl) and every non-wildcard `match` site becomes a compile error
listing exactly where to update logic.

Wildcard arms (`_ => ...`) discard this. Use them deliberately — for
truly ignorable cases — never to silence the compiler during a change.
A wildcard arm in a domain enum is usually a missing invariant.

This is the same engine `rust-tea` leans on: adding a `Msg` variant
breaks every `update` match until it is handled.

## 5. `#[non_exhaustive]` vs sealing

Orthogonal tools that are easy to confuse:

| Tool | Controls | Effect downstream |
|---|---|---|
| `#[non_exhaustive]` (on your enum/struct/variant) | **matching / construction** | downstream must write wildcard arms and cannot exhaustively construct; you may add variants in minor releases |
| sealed supertrait | **implementation** | downstream cannot `impl` the trait at all |

Both exist to keep "closed vocabulary" promises about *future* versions
(semver hygiene). An enum that is both matched internally and
constructed downstream needs both.

## 6. When not to apply

- The trait exists *for* downstream extension — a plugin or driver
  trait sealed out of caution defeats its purpose; document expected
  invariants instead.
- Two internal impls and no dispatch — a generic or concrete type is
  simpler (YAGNI).
- You seal "because it might break" but provide zero internal dispatch
  — the seal buys nothing today (Speculative generality).

## 7. Review quick-checks

- Public trait with an internal `match`/downcast dispatch over
  implementations — must be sealed (Leaky abstraction: uncontrolled
  impls leak into your dispatch).
- Enum matched with a wildcard arm in domain logic — reconsider; the
  compiler-driven checklist is being discarded.
- `#[non_exhaustive]` used where *implementation* control was meant —
  it does not seal.
- Sealed trait whose only impls could be enum variants — prefer the
  enum (simplicity).
