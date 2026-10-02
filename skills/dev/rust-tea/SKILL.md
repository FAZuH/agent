---
name: rust-tea
description: >-
  The Elm Architecture (TEA/MVU) for Rust, renderer-agnostic: Model state,
  exhaustive Message enums, one pure Update, pure View, declarative Effects,
  and a Host owning the event loop. Use whenever the user mentions TEA, Elm
  architecture, MVU, model-message-update-view, state-machine UI, Rust GUI
  or TUI architecture, iced, ratatui/crossterm, or asks to scaffold, extend,
  or review a Rust UI app, even without saying "TEA".
---

# Rust TEA: The Elm Architecture in Rust

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

Events become `Message`s. `Update` alone mutates `Model`, never with side effects: it returns `Effect`s as data. `View` reads and renders. `Host` owns the loop, collects events into messages, executes effects.

Renderer-agnostic: iced, ratatui/crossterm, egui,
Dioxus, Slint, hand-rolled. Review in @oop vocabulary; load @oop for findings.

## The six invariants

1. **Model** holds all application state. One owner; no duplicate or cached copies (Single source of truth).
2. **Message** is an exhaustive `enum`. Every world-to-model change is one variant. No hidden mutation channels.
3. **Update** is the only model writer. Pure transition:
   same model + same message → same result. Returns effects as data.
4. **View** takes `&Model` (or `&self`) and renders. Never mutates,
   never does IO, never decides policy.
5. **Effect** is a declarative side-effect description (save file,
   play sound, send request). The core returns effects; never executes them.
6. **Host** owns the event loop, timers, input, effect execution. Only place touching renderer, OS, async runtimes.

Break one: a finding, not a style preference.

## Which doc to load

| Need | Read |
|---|---|
| The core contract, skeleton stubs, message promotion, dispatch loop | `references/patterns.md` |
| Layer/module layout, pure core, dependency direction | `references/layering.md` |
| Designing effects, running them, async and blocking work | `references/effects.md` |
| Testing a TEA app (test doubles, injection points) | `references/testing.md` |
| iced idioms | `examples/iced.md` |
| ratatui/crossterm idioms | `examples/ratatui.md` |

Read only what the task needs. `SKILL.md` plus `patterns.md` cover most work.

## Update shape: free function or trait method (guideline, not rule)

Both forms satisfy the invariants. Choose per host and model size; never force one style onto a codebase that picked the other.

| Form | Shape | Prefer when |
|---|---|---|
| Free function | `fn update(model: &mut Model, msg: Msg) -> Vec<Effect>` | The host API demands it (iced passes function pointers), or the model is a single flat struct |
| Trait method | `impl Updateable<Msg, Effect> for Model { fn update(&mut self, msg: Msg) -> Vec<Effect> }` | The model composes sub-models and each slice should own its transition (Single Responsibility Principle per sub-model) |

A free function and a method can coexist: keep the transition as a method
on the model and satisfy a framework that wants a free function with a
one-line wrapper (`fn iced_update(m: &mut Model, msg: Msg) -> Task<Msg> {
m.update(msg) }`). The wrapper is an Adapter, not a violation.

Nested sub-models are a guideline, not a requirement. Split on God object smell; stay flat while small (KISS). Promotion pattern stitching nested messages into one top-level enum: `patterns.md`.

## Scaffold checklist

Work top-down. Each step names the principle it protects.

1. **Pure core first.** `crates/<app>-core/` (several
   binaries) or `src/core/` (single binary). Domain types, config,
   message vocabulary. No renderer, async runtime, or
   IO crate. Stable-dependencies: everything depends toward the core, never away.
2. **Define the message vocabulary.** One `enum Msg` per sub-model plus a
   top-level wrapper (`Msg::Timer(PomodoroMsg)`).
   Exhaustive variants, no booleans-in-payloads where a variant does (Primitive obsession).
3. **Define the effect vocabulary.** One `enum Effect` for every
   side effect (`PlaySound(Alarm)`, `SaveConfig`,
   `SendNotification`). Data only: no closures, no futures.
4. **Define the ports.** `trait EffectHandler { fn execute(&mut self,
   effect: Effect) -> Vec<Msg>; }` and, for hand-rolled hosts, `trait
   Runner { fn run(&mut self) -> Result<(), AppError>; }`. Core
   generic over `EffectHandler` (Dependency Injection; test-double injection point).
5. **Build the model.** Top-level struct composing sub-models (or one flat
   struct). Fields private; state changes only through `update` or model
   methods (Encapsulation). Inject the effect handler here.
6. **Implement update, view, host.** `update` free function or trait
   method (table above). `view(&self)` pure. Host owns loop + input +
   effect dispatch; each `Effect` becomes real work, returned
   messages feed back into `update` (dispatch loop: `patterns.md`).
7. **Test the core.** Unit-test `update` and model methods through the
   public API with a no-op effect handler. See `testing.md`.

## Add a feature

One conceptual change touches one place per layer (Open/Closed
Principle: extend by adding, never edit unrelated code):

1. Add a `Msg` variant carrying the intent's data.
2. Handle it in the owning model's `update`: mutate state, return
   `Effect`s.
3. Translate new sub-model commands at the top level (`translate_*`
   method) into top-level `Effect`s if the sub-model cannot know them.
4. Handle the `Effect` in the `EffectHandler` adapter; return result
   messages (`ConfigSaved`, `TaskResult`) for follow-up.
5. Render any new state in `view`.

If step 2 or 4 edits many modules for one concept, stop:
Shotgun surgery. Fix the vocabulary first (usually a missing
message or effect variant).

## Review checklist

Lead each finding with the most specific @oop term.

- **God object**: one model or `update` with unrelated concerns.
  Fix: split into sub-models with own message types.
- **Anemic domain model**: data-bag model; a service mutates it.
  Fix: transitions become model methods.
- **Leaky abstraction**: UI importing persistence, audio,
  platform crates directly. Fix: route through `Effect` + port.
- **Hidden dependency**: update or view constructing IO (files,
  threads). Fix: inject the port; return an `Effect`.
- **Layer violation**: core importing renderer/runtime types. Fix:
  invert the dependency (Dependency Inversion Principle).
- **Divergent change**: one setting needs config
  struct + message enum + view + validation edits. Fix: single registry
  (const table or attributed enum) all four derive from.
- **Temporal coupling**: caller must `hydrate` before `apply`. Fix:
  encode ordering in host boot or model API.
- **Speculative generality**: ports, traits, generics with no second
  implementation. Fix: delete until need appears (YAGNI).
- **Command–Query Separation**: method mutating and returning derived
  state. Fix: split, or return a diff/outcome value.

`examples/iced.md` (iced 0.14: `application(boot, update, view)`,
`Task`/`Subscription`, field registry driving view + search) and
`examples/ratatui.md` (ratatui 0.30 + crossterm: hand-rolled loop, composed
sub-models behind `Updateable`, `EffectHandler` adapter, terminal
redraw discipline) hold idioms from two real TEA
codebases. Inspiration, not contract: the six invariants are
the contract.
