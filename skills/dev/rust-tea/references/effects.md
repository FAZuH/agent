# effects: declarative side effects and their host translation

Core returns effects as data; the host (or `EffectHandler`
adapter) executes them. Covers vocabulary design,
safe execution, async and blocking work, and results as
messages.

Contents:

1. [Effect vs framework Task](#1-effect-vs-framework-task)
2. [Designing the effect vocabulary](#2-designing-the-effect-vocabulary)
3. [Executing effects](#3-executing-effects)
4. [Blocking and async work](#4-blocking-and-async-work)
5. [Results are messages](#5-results-are-messages)
6. [Idempotency, coalescing, ordering](#6-idempotency-coalescing-ordering)
7. [Save and dirty patterns](#7-save-and-dirty-patterns)

## 1. Effect vs framework Task

| Setup | Effect shape | Executor |
|---|---|---|
| Hand-rolled core | `enum Effect` + `EffectHandler` port | your adapter |
| iced | `iced::Task<Message>` returned from `update` | the framework |
| Domain core inside a framework app | own `Effect` enum, translated to `Task` in the shell wrapper | framework, via translation |

Discipline is identical: *describe* work as data, never perform
it inline. With iced, `Task` constructors
(`Task::perform`, `Task::done`, `Task::batch`) are your vocabulary.

Pay the hybrid translation step only when the core must test
without the runtime.

## 2. Designing the effect vocabulary

- Data only: no closures, futures, or renderer handles. Payloads are
  owned values (`Box<Config>` when large).
- Coarse-grained: `SaveConfig(Config)`, not `WriteBytes(Path, Vec<u8>)`
  and the adapter decides *how*; the model decides *what* and *why*.
- Nested vocabularies nest as variants: `Effect::Session(SessionEffect)`,
  mirroring how messages nest.
- If two variants must always fire together *in a meaningful order*, that
  ordering is domain meaning. Model it as one variant (making Temporal
  coupling explicit) rather than hoping callers batch correctly.
- Effects may be batched: `update` returns `Vec<Effect>`; the host
  executes them in order.

## 3. Executing effects

```rust
pub trait EffectHandler {
    /// Execute one effect; return follow-up messages.
    fn execute(&mut self, effect: Effect) -> Vec<Msg>;
}
```

- The adapter maps one effect to the minimum real-world action. It must
  not make policy decisions. The model already decided.
- Fast effects (play a short sound, write a small file) may run
  synchronously on the UI thread.
- Slow effects must not run inside `execute` on the UI thread. See §4.
- `execute` returning messages keeps the loop total: effects → messages
  → update → effects, terminating when both come back empty.

## 4. Blocking and async work

**Hand-rolled TUI.** Keep the core synchronous. For slow work, spawn
(`std::thread::spawn` or your runtime) and deliver the outcome
through the host event source. Loop stays: poll input,
poll results, dispatch messages.

**iced.** The executor is async; use `Task::perform`:

```rust
// async-capable work
Task::perform(async move { daemon.call(req).await }, Message::DaemonReplied)

// blocking sync API (files, FFI, sockets): never block the UI thread
Task::perform(
    tokio::task::spawn_blocking(move || std::fs::write(path, data)),
    Message::ConfigWritten,
)
```

**Never:** block in `update`, poll in `update`, or do IO in `view`.
Blocking work inside the UI thread is the single most common TEA bug.

## 5. Results are messages

- `execute` returns `Vec<Msg>` (or the `Task` resolves to a `Msg`):
  success, failure, or empty. There is no side channel.
- Failure payloads carry enough context to render an error state:
  `Msg::ConfigSaved(Result<(), ConfigError>)`. The model turns that into
  a toast or error view state. The adapter never touches UI.
- Naming pattern: `<Thing><Past-participle>`: `ConfigSaved`,
  `DaemonReplied`, `SessionLogged`.

## 6. Idempotency, coalescing, ordering

- Input and ticks flood: coalesce in the *host*, which drains pending
  events before rendering, at most once per iteration.
- Effects hitting the same resource twice in one batch (`SaveConfig`
  twice): pick last-wins or queue, once, and document it on the adapter.
- Ordering inside a batch is the order `update` returned them. If order
  matters, build the `Vec` in that order in `update`: do not rely on
  adapter internals.
- Never sleep or retry inside `execute`; schedule follow-up work as a
  returned message or a host timer.

## 7. Save and dirty patterns

- Model keeps `config` and `config_snapshot` (taken at boot and after
  each successful save).
- Dirty check is a comparison, not a hand-maintained flag that can drift:

  ```rust
  pub fn is_config_dirty(&self) -> bool { self.config != self.config_snapshot }
  ```

- `update` decides when to save (on commit, on quit) and returns
  `Effect::SaveConfig(current)` only when dirty; the coalesce point stays
  pure and testable.
- When `Msg::ConfigSaved(Ok(..))` arrives, `update` refreshes the
  snapshot (pure field copy).
- Revert = clear drafts + restore snapshot; no reverse effects needed.
