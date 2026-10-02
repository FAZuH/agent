---
name: rust-idioms
description: >-
  Type-driven design patterns for Rust: newtypes and smart constructors,
  typestate, capability tokens, extension and sealed traits, RAII guards,
  error design (thiserror/anyhow, error-as-data, panic policy), and generics
  vs dyn vs enum dispatch. Use when designing Rust types or an API, or
  reviewing Rust code, even without saying "idioms". Lead each finding with
  the most specific @oop term.
---

# Rust idioms: encode the domain in types

One invariant drives every pattern here:

> **Invalid values cannot be constructed; valid values cannot be misused.**

Push constraints into the type system. `&str` promises nothing; `&Email` promises boundary validation.

Cost: authoring time and API surface. Every pattern has "When not to apply". The failure is applying where the domain has no real constraint (Speculative generality, YAGNI), not missing the pattern.

When reviewing, lead with the most specific `oop` term (Primitive obsession, Leaky abstraction, Temporal coupling, Anemic domain model, Shotgun surgery), then the fixing idiom.

`rust-tea` (UI architecture, Model/Msg/Update/View/Effect/Host) uses these
idioms internally: message enums are closed vocabularies, ports are
capabilities, effect payloads are error-as-data.

## Decision table

| Smell or need | Idiom | Reference |
|---|---|---|
| Raw `String`/`bool`/`u64` carrying domain meaning (Primitive obsession) | newtype + smart constructor | `references/newtype.md` |
| The same validation repeated at call sites | parse once at the boundary, thread the parsed type | `references/newtype.md` |
| Function should accept anything convertible to its input | acceptance traits (`Into`/`AsRef` params) | `references/newtype.md` |
| Illegal state transitions are possible (Temporal coupling) | typestate or enum state | `references/typestate.md` |
| Authority must be *held*, not merely *accessible* | capability tokens | `references/typestate.md` |
| Add a method to a type you don't own | extension trait | `references/extension-traits.md` |
| Downstream must not be able to implement this trait | sealed trait (or an enum) | `references/sealed-traits.md` |
| The compiler should drive a refactor | exhaustive enums as closed vocabularies | `references/sealed-traits.md` |
| A resource must be released or rolled back on every path | RAII guard / drop bomb | `references/raii.md` |
| Error types sprawl, context is lost, or errors are strings | thiserror/anyhow split, error-as-data | `references/errors.md` |
| Panics used as error handling, or unclear when `unwrap` is legal | panic-only-on-unrecoverable-state policy | `references/errors.md` |
| Choosing between generics, `dyn Trait`, and enums for polymorphism | dispatch decision table | `references/dispatch.md` |

## When not to apply

| Idiom | Skip when |
|---|---|
| Newtype | One-off internal helper, prototyping, a type with a single use site (YAGNI) |
| Typestate | Trivial transitions, runtime-determined state, state kept in collections: an enum + `match` is simpler |
| Extension trait | You own the type (use an inherent impl), or one caller would do |
| Sealed trait / enum | The point of the trait *is* downstream extension: document it instead |
| Capability tokens | Access control is not actually a requirement (Speculative generality) |
| Custom error taxonomy | Small app with one failure story: `anyhow` everywhere is fine |
| Generics/`dyn` | One implementation exists and a second is hypothetical: write the concrete type |

Read only what the task needs. `SKILL.md` plus the decision table cover most
reviews; load the named reference for the pattern at hand.

Crates (`thiserror`, `anyhow`, `nutype`,
`secrecy`, `scopeguard`, `enum_dispatch`) are accelerators. Verify against
docs before recommending; the *patterns* are std-level and do not
age.
