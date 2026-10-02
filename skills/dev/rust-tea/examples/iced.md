# example: iced

How TEA lands on **iced** (checked against iced 0.14;
verify your `Cargo.toml`). From a real iced + layershell
settings app; the source map at the end points
into `~/Projects/hyprlay`. Idioms, not contract:
`SKILL.md` invariants are the contract.

Contents:

1. [Application skeleton](#1-application-skeleton)
2. [Update: free function + Task](#2-update-free-function--task)
3. [Blocking IO off the UI thread](#3-blocking-io-off-the-ui-thread)
4. [Subscriptions](#4-subscriptions)
5. [View: data-driven field registry](#5-view-data-driven-field-registry)
6. [Ephemeral drafts vs persisted config](#6-ephemeral-drafts-vs-persisted-config)
7. [Single source of truth in a domain crate](#7-single-source-of-truth-in-a-domain-crate)
8. [Multi-window / multi-surface apps](#8-multi-window--multi-surface-apps)
9. [Method-shaped alternative](#9-method-shaped-alternative)
10. [Source map](#10-source-map)

## 1. Application skeleton

```rust
fn main() -> iced::Result {
    iced::application(boot, update, view)
        .subscription(subscribe)
        .run()
}

fn boot() -> (Model, Task<Message>) {
    let model = Model::new(control.clone());
    let hydrate = Task::batch([
        Task::perform(load_config(), Message::ConfigLoaded),
        Task::perform(query_daemon(), Message::DaemonState),
    ]);
    (model, hydrate)
}
```

- Four free functions are iced's contract; `Model` still owns all
  state; all six invariants hold.
- `boot` batches async hydration; results arrive as messages. Model
  starts default/`Loading` and reacts; no "hydrate first" ordering
  rule (Temporal coupling removed).

## 2. Update: free function + Task

```rust
fn update(model: &mut Model, message: Message) -> Task<Message> {
    match message {
        Message::Toggle => { model.toggle(); Task::none() }
        Message::NumDrag(key, value) => { model.set_draft(key, value); Task::none() }
        Message::Commit(key) => {
            let effects = model.commit_draft(key);   // policy decided in the model
            apply(model, effects)                    // one place: Effect -> Task
        }
        // ...
    }
}
```

- Keep `match` a dispatcher; move bodies into `Model` methods. A
  600-line update is a God object.
- Translate effects to `Task` in one `apply`/`translate` function:
  `update` stays policy, `Task` stays plumbing.
- Multiple follow-ups: `Task::batch([...])`.

## 3. Blocking IO off the UI thread

```rust
Task::perform(
    tokio::task::spawn_blocking(move || daemon_socket.call(req)),
    Message::DaemonReplied,
)
```

iced's executor is async: blocking calls in `update` stall
the UI. Route sync APIs through `spawn_blocking` in
`Task::perform`. Injected `Arc<dyn DaemonControl>` port (passed to
`Model::new`) keeps the socket out of GUI code (Dependency
Inversion Principle).

## 4. Subscriptions

```rust
fn subscribe(_model: &Model) -> Subscription<Message> {
    Subscription::batch([
        iced::time::every(Duration::from_millis(250))
            .map(|_| Message::Timer(PomodoroMsg::Tick(Instant::now()))),
        keyboard_subscription(),
    ])
}
```

Subscriptions are pub/sub message sources (time, keyboard, window
events), batched into one. They live in the shell; core sees only
the resulting messages.

## 5. View: data-driven field registry

```rust
pub struct Field {
    pub section: Section,
    pub label: &'static str,
    pub tip: &'static str,
    pub render: fn(&Model) -> Element<'_, Message>,
}

pub const FIELDS: &[Field] = &[ /* one row per setting */ ];
```

- `view` iterates `FIELDS`; search filters the same table.
  New setting = one row + one message
  variant + one update arm (Open/Closed, DRY).
- Interactive widgets close over message constructors:
  `slider(0..=100, v, move |x| Message::NumDrag(key, x))`.
- A 20-block hand-written settings view with near-identical sections is
  the smell this table replaces.

## 6. Ephemeral drafts vs persisted config

- `num_drafts: HashMap<Key, String>` holds half-typed text; `config`
  holds committed values. Two concerns, two fields
  (Separation of concerns).
- Commit on Enter (validate → update config → return save effect),
  discard on Esc, dirty = `config != config_snapshot`.
- One lookup rule per widget type (numbers read drafts, everything else
  reads config): never render ad hoc from both.

## 7. Single source of truth in a domain crate

`Bounds`, `Key`, `Mode` live in the domain crate
(`crates/<app>-core`); GUI, daemon, and tray derive from it. Two
frontends computing one fact differently is Divergent change:
move the fact into core.

## 8. Multi-window / multi-surface apps

- One top-level `Model`; per-surface messages ride variant
  wrappers (`Message::Overlay(OverlayMsg)`); per-surface state lives as
  sub-models.
- Daemon side is its own model with its own loop, same
  invariants, different host. Shared vocabulary (commands, outcomes)
  lives in the domain crate.

## 9. Method-shaped alternative

For method cohesion, keep transitions as methods and satisfy
iced with a one-line wrapper (Adapter, not a violation):

```rust
impl Model {
    fn handle(&mut self, message: Message) -> Task<Message> { /* ... */ }
}

fn update(model: &mut Model, message: Message) -> Task<Message> {
    model.handle(message)
}
```

## 10. Source map (`~/Projects/hyprlay`)

| Concern | Where |
|---|---|
| `Message` enum (25 variants) | `src/gui/mod.rs:92` |
| `Model` with drafts + injected control port | `src/gui/mod.rs:157` |
| `application(boot, update, view)` | `src/gui/mod.rs:200` |
| subscription / tick | `src/gui/mod.rs:303` |
| update free fn (`spawn_blocking` inside `Task::perform`) | `src/gui/mod.rs:356` |
| `Field` registry + `FIELDS` | `src/gui/fields.rs:119` |
| settings page driven by `FIELDS` | `src/gui/fields.rs:535` |
| number draft row | `src/gui/fields.rs:698` |
| view free fn | `src/gui/mod.rs:959` |
| daemon-side `CommandOutcome` (effect translation) | `src/daemon/mod.rs:148` |
| daemon-side model methods | `src/daemon/overlay/state.rs:73` |
| pure domain crate | `crates/hyprlay-core` |
