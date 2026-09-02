---
name: rust-idioms
description: Type-driven design patterns for Rust — newtype and smart constructors (parse, don't validate), acceptance traits, typestate, capability tokens, extension traits, sealed traits and closed vocabularies, RAII guards and drop bombs, error type design (thiserror/anyhow), and dispatch design (generics vs dyn vs enum). Use whenever the user mentions any of these patterns, asks to design Rust types or a Rust API, or wants a Rust code review — even if they never say "idioms". Findings should lead with the most specific term from the oop skill.
---

# Rust idioms — encode the domain in types

One invariant drives every pattern here:

> **Invalid values cannot be constructed; valid values cannot be misused.**

Push constraints out of documentation and discipline and into the type
system. A function signature that accepts `&str` promises nothing; a
signature that accepts `&Email` promises the value was validated — once,
at the boundary, by the compiler's help.

The cost is authoring time and API surface. Every pattern below has a
"When not to apply" section — the failure mode is not missing the
pattern, it is applying it where the domain has no real constraint
(Speculative generality, YAGNI).

When reviewing, lead each finding with the most specific term from the
`oop` skill — Primitive obsession, Leaky abstraction, Temporal coupling,
Anemic domain model, Shotgun surgery — then name the idiom that fixes it.

## Relationship to the other skills

| Skill | Scope |
|---|---|
| `oop` | Findings vocabulary (language-agnostic) |
| **`rust-idioms`** | Type-level design patterns (this skill) |
| `rust-tea` | UI architecture (Model/Msg/Update/View/Effect/Host) |

`rust-tea` uses these idioms internally: message enums are closed
vocabularies, ports are capabilities, effect payloads are error-as-data.

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
| Choosing between generics, `dyn Trait`, and enums for polymorphism | dispatch decision table | `references/dispatch.md` |

## When not to apply

| Idiom | Skip when |
|---|---|
| Newtype | One-off internal helper, prototyping, a type with a single use site (YAGNI) |
| Typestate | Trivial transitions, runtime-determined state, state kept in collections — an enum + `match` is simpler |
| Extension trait | You own the type (use an inherent impl), or one caller would do |
| Sealed trait / enum | The point of the trait *is* downstream extension — document it instead |
| Capability tokens | Access control is not actually a requirement (Speculative generality) |
| Custom error taxonomy | Small app with one failure story — `anyhow` everywhere is fine |
| Generics/`dyn` | One implementation exists and a second is hypothetical — write the concrete type |

## Which doc to load

| Need | Read |
|---|---|
| Newtype, smart constructors, parse-don't-validate, acceptance traits | `references/newtype.md` |
| Typestate, builders, enum-state comparison, capability tokens | `references/typestate.md` |
| Extension traits, import hygiene, upstream-collision risk | `references/extension-traits.md` |
| Sealed traits, closed vocabularies, `#[non_exhaustive]` | `references/sealed-traits.md` |
| RAII guards, drop bombs, Drop rules | `references/raii.md` |
| thiserror vs anyhow, source chains, error-as-data | `references/errors.md` |
| Generics vs `dyn` vs enum dispatch, object safety | `references/dispatch.md` |

Read only what the task needs. `SKILL.md` + the decision table cover most
reviews; load the specific reference for the pattern being written.

Crates are mentioned as accelerators (`thiserror`, `anyhow`, `nutype`,
`secrecy`, `scopeguard`, `enum_dispatch`) — verify their current state
against docs before recommending; the *patterns* are std-level and do not
age.
