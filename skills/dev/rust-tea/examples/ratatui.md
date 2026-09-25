# example — ratatui + crossterm (hand-rolled host)

How the TEA invariants land on a **hand-rolled ratatui loop** (checked
against ratatui 0.30 + crossterm 0.29 — verify your `Cargo.toml`).
Extracted from a real pomodoro TUI; the source map at the end points
into `~/Projects/tomo`. Idioms, not contract — `SKILL.md` invariants are
the contract.

Contents:

1. [Runner: the host owns the loop](#1-runner-the-host-owns-the-loop)
2. [Input translation](#2-input-translation)
3. [Dispatch shorthand](#3-dispatch-shorthand)
4. [The EffectHandler adapter](#4-the-effecthandler-adapter)
5. [Render discipline](#5-render-discipline)
6. [Composed sub-models (guideline)](#6-composed-sub-models-guideline)
7. [Source map](#7-source-map)

## 1. Runner: the host owns the loop

```rust
pub struct TuiRunner {
    core: AppCore<TuiEffects>,
    terminal: Terminal<CrosstermBackend<Stdout>>,
    events: EventStream,
    last_frame: Instant,
}

impl Runner for TuiRunner {
    fn run(&mut self) -> Result<(), UiError> {
        while !self.core.is_quit() {
            self.render_if_due()?;      // view — only when something happened
            self.handle_events()?;      // translate input -> Msg -> dispatch
            self.handle_timer()?;       // Msg::Tick(Instant::now())
        }
        self.restore_terminal()?;
        Ok(())
    }
}
```

- The runner is the only code that knows crossterm exists (Facade over
  the loop; Adapter at every boundary). Terminal setup/teardown (raw
  mode, alternate screen, panic hook) lives here — never in core.
- Poll-with-timeout doubles as the tick cadence: timeout fires →
  dispatch `Tick(Instant::now())` (see `patterns.md` §9).

## 2. Input translation

```rust
fn translate(&self, key: KeyEvent) -> Option<Msg> {
    if self.core.overlay_active() { return self.overlay_key(key); }  // short-circuit
    match self.core.router().active_page() {
        Page::Focus    => self.focus_key(key),
        Page::Settings => self.settings_key(key),
        // ...
    }
}
```

- A pure mapping `KeyEvent -> Option<Msg>` — table-test it without a
  terminal. The core never sees a `KeyEvent` (layer rule).
- Modal/overlay state short-circuits routing *before* page routing, so a
  modal keypress cannot leak into the page underneath.
- Mode-aware keys (per-page tables) beat one giant match with magic
  booleans (Primitive obsession).

## 3. Dispatch shorthand

```rust
macro_rules! dsp {
    ($self:ident, $($msg:expr),+) => { $($self.core.dispatch($msg);)+ };
}

// usage
dsp!(self, Msg::Timer(PomodoroMsg::Start(now)), Msg::Router(RouterMsg::GoTo(Page::Focus)));
```

Sugar only — the real mechanism is the dispatch loop on `AppCore`
(`tea-core.md` §6). Keep the macro trivial or skip it.

## 4. The EffectHandler adapter

```rust
pub struct TuiEffects { sound: SoundFx, notify: NotifyHandle, path: PathBuf }

impl EffectHandler for TuiEffects {
    fn execute(&mut self, effect: Effect) -> Vec<Msg> {
        match effect {
            Effect::Quit => vec![],
            Effect::PlaySound(a) => { self.sound.play(&a); vec![] }
            Effect::SendNotification(t) => { self.notify.send(&t); vec![] }
            Effect::SaveConfig(c) => vec![Msg::TaskResult(save_config(&self.path, &c))],
            // ...
        }
    }
}
```

- Fast effects run inline on the UI thread. Slow work spawns and reports
  back through a channel the loop polls (a custom event variant or mpsc
  drained next to input events) — the core stays synchronous.
- The adapter holds process-wide resources (audio handle, notifier,
  config path) that the core must not know about.

## 5. Render discipline

- Render when: an event was handled, a tick fired, or the dirty flag is
  set. Skip otherwise — idle TUIs should cost ~0% CPU.
- One view module per page (`view/focus.rs`, `view/settings.rs`), each
  exposing `fn render(core: &AppCore<TuiEffects>, frame: &mut Frame, area: Rect)`
  — pure reads through public getters, no widget-held state.
- Framing math (layout splits) lives in the view; placement *rules* that
  the daemon also needs live in core as pure functions.

## 6. Composed sub-models (guideline)

- `AppCore` composes `Pomodoro` / `Config` / `Router`; each implements
  `Updateable` and gets its own message enum; the top level wraps them
  (`Msg::Timer(PomodoroMsg)`).
- Sub-model commands are promoted by `translate_*` methods on `AppCore`
  (`tea-core.md` §3). Optional pattern — a flat model + free-function
  update is equally valid (see the choice table in `SKILL.md`).
- A `Router` sub-model owning "which page is active" keeps key routing,
  page rendering, and navigation transitions cohesive instead of
  scattered across the runner (Single Responsibility Principle).

## 7. Source map (`~/Projects/tomo`)

| Concern | Where |
|---|---|
| `Runner` / `EffectHandler` / `Updateable` traits | `src/ui/traits.rs:5` |
| `Msg` hierarchy | `src/ui/core.rs:16` |
| `Effect` enum | `src/ui/core.rs:61` |
| `AppCore` struct | `src/ui/core.rs:80` |
| dispatch / execute_effect loop | `src/ui/core.rs:136` |
| update impl | `src/ui/core.rs:210` |
| `translate_pomodoro_cmd` (command promotion) | `src/ui/core.rs:393` |
| `MockEffects` test double | `src/ui/core.rs:526` |
| `Router` sub-model | `src/ui/router.rs:29` |
| Pomodoro sub-model update | `src/ui/update/pomo.rs:35` |
| `ConfigMsg` with strum props (registry pattern) | `src/ui/update/config.rs:24` |
| `TuiRunner` struct + run loop + `dsp!` | `src/ui/tui/runner.rs:24` |
| input handling (mode-aware, overlay short-circuit) | `src/ui/tui/runner.rs:162` |
| timer handling | `src/ui/tui/runner.rs:248` |
| `TuiEffects` adapter | `src/ui/tui/effect.rs:10` |
| Pomodoro domain model (derived `remaining_time`) | `src/model/pomodoro.rs:7` |
