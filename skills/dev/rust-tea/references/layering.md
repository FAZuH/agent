# layering — module layout and dependency direction

Where the five kinds of TEA code live, and which dependencies are legal.
Goal: the core stays pure, the renderer stays replaceable, and one
conceptual change touches one layer (Stable-dependencies principle,
Acyclic Dependencies Principle).

Contents:

1. [The three-layer map](#1-the-three-layer-map)
2. [What lives where](#2-what-lives-where)
3. [Dependency rules (violations are findings)](#3-dependency-rules-violations-are-findings)
4. [Crate vs module split](#4-crate-vs-module-split)
5. [Single source of truth placement](#5-single-source-of-truth-placement)
6. [Review quick-checks](#6-review-quick-checks)

## 1. The three-layer map

```
shell      bins + main() + host loop + renderer-bound view code
           (iced app, ratatui terminal, CLI arg parsing)
   │ depends on
adapters   EffectHandler impls, platform services, repos
   │ depends on
core       Model, Msg, Effect, Updateable/update, domain types,
           pure display logic
   ✗ depends on nothing app-external
```

Arrows point inward only. `core` must compile with no renderer, no async
runtime, and no IO crate on its dependency line.

## 2. What lives where

| Code | Layer | Notes |
|---|---|---|
| Domain types (`Bounds`, `Key`, `Mode`), config structs | core | serde fine; no IO |
| `Msg` enums (top-level + sub-model) | core | next to their models |
| `Effect` enums | core | data only |
| `update` (free fn or `Updateable` impls) | core | the only state writer |
| Pure display logic (filter, sort, format, `remaining_time`) | core | methods on models |
| Renderer-bound view fns / widgets | shell | pure `&Model` reads, but types are the framework's |
| Input translation (`KeyEvent` → `Msg`) | shell | pure mapping, table-testable |
| `EffectHandler` impls, sound/notify/repos | adapters | the only IO |
| Host loop, timers, terminal/window setup | shell | Facade |
| Port traits (`EffectHandler`, `SoundService`) | the layer that consumes them | `EffectHandler` is consumed by core → declared in core |

The view invariant ("pure, `&Model` only") holds in the shell too — the
view may live beside the renderer types, but it must not mutate or do IO.

## 3. Dependency rules (violations are findings)

- `core` importing from shell or adapters — **Layer violation**. Fix:
  invert through a port (Dependency Inversion Principle).
- Shell doing IO directly instead of returning `Effect`s — **Hidden
  dependency**. Fix: move it behind the `EffectHandler`.
- Adapters making policy decisions (choosing *which* config to save) —
  policy belongs in `update`; adapters only perform what was decided.
- Core re-exporting renderer types so two shells can share them — do not;
  share concepts by moving the domain type into core, keep renderer types
  in their shell.
- A cycle between two shells meeting anywhere except core — **Acyclic
  Dependencies Principle** violation; the only meeting point is core.

## 4. Crate vs module split

| Layout | Use when | Enforcement |
|---|---|---|
| Workspace with `crates/<app>-core` | multiple fronts (gui + daemon + cli), or core needs its own dependency set | compiler-enforced wall |
| `src/core/` module | single binary, small app | convention + code review (+ `pub(crate)` discipline) |

Start with the module split; promote to a crate when a second front or a
heavy dependency set appears. Promotion is mechanical if the direction
rules above held from the start.

## 5. Single source of truth placement

- One fact, one definition. Domain constants and types live in core;
  the config schema lives in core; registries that drive views live in
  the shell but are built from core types.
- If two layers need the same enum, it lives in core and both import it —
  never copy (Divergent change guard).
- Persisted values and their in-UI drafts mirror each other through one
  key type, so a draft can always be matched to its config field.

## 6. Review quick-checks

- Core's `Cargo.toml` lists no renderer, runtime, or IO dependency.
- `grep` core sources for shell module paths — none expected.
- `Effect` payloads contain no closures, futures, or handles.
- Every IO call site sits in `adapters/` or the shell host — zero in core.
- Every port trait sits in the layer that consumes it.
