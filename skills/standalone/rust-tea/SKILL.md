---
name: rust-tea
description: Renderer-agnostic The Elm Architecture (TEA / MVU) for Rust — Model state, Message enums, one pure Update, pure View, declarative Effects, and a Host that owns the event loop. Use this whenever the user mentions TEA, Elm architecture, MVU, model–message–update–view, state-machine UI, Rust GUI or TUI architecture, iced boot/update/view/subscription, ratatui/crossterm loops, or asks to scaffold, extend, or review a Rust UI app — even if they never say "TEA". Framework examples for iced and ratatui live in examples/.
---

# Rust TEA — The Elm Architecture in Rust

The Elm Architecture (TEA, also called MVU) structures a UI as a one-way
dataflow:

```
            ┌──────────────────────────────────────────┐
            │                 Host                     │
            │  (event loop, timers, effect execution)  │
            └──────┬───────────────────────▲───────────┘
     events/tick   │                       │  Effects (declarative)
                   ▼                       │
              ┌─────────┐   Update    ┌─────────┐
   user input │ Message ├────────────►│  Model  │
              └─────────┘ (&mut only) └────┬────┘
                                           │ & (read-only)
                                           ▼
                                      ┌─────────┐
                                      │  View   │
                                      └─────────┘
```

Events become `Message` values. `Update` is the only code that mutates the
`Model`, and it never performs side effects — it returns them as data
(`Effect`s). The `View` reads the model and renders. The `Host` owns the
loop, collects real-world events into messages, and executes effects.

These rules hold regardless of renderer — iced, ratatui/crossterm, egui,
Dioxus, Slint, or a hand-rolled loop. When reviewing or discussing this
architecture, use the vocabulary from the @oop skill; load @oop when 
writing findings.

## The six invariants

1. **Model** holds all application state. There is exactly one owner; no
   duplicate or cached copies of the same fact (Single source of truth).
2. **Message** is an exhaustive `enum`. Every way the world can change the
   model is one variant. No hidden mutation channels.
3. **Update** is the only writer of the model. It is a pure transition:
   same model + same message → same result. It returns effects as data.
4. **View** takes `&Model` (or `&self`) and renders. It never mutates,
   never does IO, and never decides policy.
5. **Effect** is a declarative description of side-effect work (save file,
   play sound, send request). The core returns effects; it never executes
   them.
6. **Host** owns the event loop, timers, input, and effect execution, etc. It
   is the only place that touches the renderer, the OS, and async runtimes.

If code breaks one of these, it is a finding, not a style preference.

## Which doc to load

| Need | Read |
|---|---|
| The core contract, message promotion, dispatch loop | `references/tea-core.md` |
| Layer/module layout, pure core, dependency direction | `references/layering.md` |
| Designing effects, running them, async and blocking work | `references/effects.md` |
| Testing a TEA app (test doubles, injection points) | `references/testing.md` |
| Basic skeletons (traits, enums, structs) | `references/patterns.md` |
| iced idioms | `examples/iced.md` |
| ratatui/crossterm idioms | `examples/ratatui.md` |

Read only what the task needs. `SKILL.md` + `tea-core.md` cover most work.

## Update shape: free function or trait method (guideline, not rule)

Both forms satisfy the invariants. Choose per host and model size — do not
force one style onto a codebase that already picked the other.

| Form | Shape | Prefer when |
|---|---|---|
| Free function | `fn update(model: &mut Model, msg: Msg) -> Vec<Effect>` | The host API demands it (iced passes function pointers), or the model is a single flat struct |
| Trait method | `impl Updateable<Msg, Effect> for Model { fn update(&mut self, msg: Msg) -> Vec<Effect> }` | The model composes sub-models and each slice should own its transition (Single Responsibility Principle per sub-model) |

A free function and a method can coexist: keep the transition as a method
on the model and satisfy a framework that wants a free function with a
one-line wrapper (`fn iced_update(m: &mut Model, msg: Msg) -> Task<Msg> {
m.update(msg) }`). The wrapper is an Adapter, not a violation.

Nested sub-models are also a guideline, not a requirement. Split the model
when one struct accumulates unrelated concerns (God object smell); keep it
flat while the concerns stay small (KISS). See `tea-core.md` for the
promotion pattern that stitches nested messages back into one top-level
enum.

## Scaffold checklist

Work top-down. Each step names the principle it protects.

1. **Pure core first.** Create `crates/<app>-core/` (shared by several
   binaries) or `src/core/` (single binary). It holds domain types, config,
   and message vocabulary. It depends on no renderer, no async runtime, no
   IO crate. This is the Stable-dependencies principle: everything else
   depends toward the core, never away from it.
2. **Define the message vocabulary.** One `enum Msg` per sub-model plus a
   top-level `enum Msg` that wraps them (`Msg::Timer(PomodoroMsg)`).
   Exhaustive variants, no booleans-in-payloads where a variant would do
   (Primitive obsession).
3. **Define the effect vocabulary.** One `enum Effect` describing every
   side effect the app can perform (`PlaySound(Alarm)`, `SaveConfig`,
   `SendNotification`). Data only — no closures, no futures.
4. **Define the ports.** `trait EffectHandler { fn execute(&mut self,
   effect: Effect) -> Vec<Msg>; }` and, for hand-rolled hosts, `trait
   Runner { fn run(&mut self) -> Result<(), AppError>; }`. The core is
   generic over `EffectHandler` (Dependency Injection; injection point for
   test doubles).
5. **Build the model.** Top-level struct composing sub-models (or one flat
   struct). Fields private; state changes only through `update` or model
   methods (Encapsulation). Inject the effect handler here.
6. **Implement update, view, host.** `update` as free function or trait
   method (see table above). `view(&self)` pure. Host owns loop + input +
   effect dispatch; it translates each `Effect` into real work and feeds
   returned messages back into `update` (dispatch loop in `tea-core.md`).
7. **Test the core.** Unit-test `update` and model methods through the
   public API with a no-op effect handler. See `testing.md`.

## Add a feature

One conceptual change touches exactly one place per layer (Open/Closed
Principle — extend by adding, do not edit unrelated code):

1. Add a `Msg` variant carrying the intent's data.
2. Handle it in the owning model's `update` — mutate state, return
   `Effect`s.
3. Translate new sub-model commands at the top level (`translate_*`
   method) into top-level `Effect`s if the sub-model cannot know them.
4. Handle the `Effect` in the `EffectHandler` adapter; return result
   messages (`ConfigSaved`, `TaskResult`) for follow-up.
5. Render any new state in `view`.

If step 2 or 4 forces edits across many modules for one concept, stop —
that is Shotgun surgery. Fix the vocabulary first (usually a missing
message variant or a missing effect).

## Review checklist

Lead each finding with the most specific @oop term.

- **God object** — one model or one `update` holding unrelated concerns.
  Fix: split into sub-models with their own message types.
- **Anemic domain model** — model is a data bag; a service mutates it.
  Fix: move transitions onto the model as methods.
- **Leaky abstraction** — UI code importing persistence, audio, or
  platform crates directly. Fix: route through an `Effect` and a port.
- **Hidden dependency** — update or view constructs its own IO (opening
  files, spawning threads). Fix: inject the port; return an `Effect`.
- **Layer violation** — core importing renderer/runtime types. Fix: invert
  the dependency (Dependency Inversion Principle).
- **Divergent change** — adding one setting requires edits in config
  struct, message enum, view, and validation. Fix: a single registry
  (const table or enum with attributes) that all four derive from.
- **Temporal coupling** — caller must call `hydrate` before `apply`. Fix:
  encode ordering in the host's boot sequence or the model's API.
- **Speculative generality** — ports, traits, or generics with no current
  second implementation. Fix: delete until a real need appears (YAGNI).
- **Command–Query Separation** — a method both mutates and returns derived
  state. Fix: split, or make the mutation return a diff/outcome value.

## Guardrails

| Smell | Where the fix lives |
|---|---|
| Blocking IO inside `update` or `view` | `references/effects.md` |
| Effects that capture closures or futures | `references/effects.md` |
| Model state duplicated between host and core | `references/layering.md` |
| Untestable update (needs real files/sockets) | `references/testing.md` |
| Message enum with `&str` payloads doing double duty | `references/tea-core.md` |

## Examples

`examples/` holds framework-specific idioms extracted from two real Rust
TEA codebases. They are inspiration, not contracts — the invariants above
are the contract.

- `examples/iced.md` — iced 0.14: `application(boot, update, view)`,
  `Task`/`Subscription`, a field registry driving view + search.
- `examples/ratatui.md` — ratatui 0.30 + crossterm: hand-rolled loop,
  composed sub-models behind an `Updateable` trait, `EffectHandler`
  adapter, terminal redraw discipline.
