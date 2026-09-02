# patterns — skeleton stubs

Copy-paste skeletons to adapt. They compile together as one module set,
but there is deliberately no `main.rs` — wire the host to your renderer
via `examples/iced.md` or `examples/ratatui.md`.

Contents:

1. [Messages](#1-messages)
2. [Effects](#2-effects)
3. [Sub-model with `Updateable` (method form)](#3-sub-model-with-updateable-method-form)
4. [Top model with dispatch loop (composed)](#4-top-model-with-dispatch-loop-composed)
5. [Free-function update (function form)](#5-free-function-update-function-form)
6. [Ports and the adapter](#6-ports-and-the-adapter)
7. [Test double](#7-test-double)
8. [Field registry (data-driven views)](#8-field-registry-data-driven-views)
9. [Tick timer](#9-tick-timer)

## 1. Messages

```rust
// src/core/messages.rs — sub-model vocabularies
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum PomodoroMsg {
    Start(Instant),
    Tick(Instant),
    Pause(Instant),
    Resume(Instant),
    SkipSession,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum RouterMsg { GoTo(Page) }

// src/core/messages.rs — top-level vocabulary wraps sub-models
#[derive(Debug, Clone, PartialEq)]
pub enum Msg {
    Timer(PomodoroMsg),
    Router(RouterMsg),
    TaskResult(Result<TaskOutput, TaskError>), // effect results re-enter here
    Quit,
}
```

## 2. Effects

```rust
// src/core/effects.rs
#[derive(Debug, Clone)]
pub enum Effect {
    Quit,
    PlaySound(Alarm),
    StopSound,
    SendNotification(String),
    SaveConfig(Box<Config>),
    Session(SessionEffect),
}

#[derive(Debug, Clone)]
pub enum SessionEffect { Log { mode: Mode, seconds: u64 } }
```

## 3. Sub-model with `Updateable` (method form)

```rust
// src/core/traits.rs
pub trait Updateable<M, C> {
    /// Advance state by one message; return commands as data.
    fn update(&mut self, msg: M) -> Vec<C>;
}

// src/core/pomodoro.rs
pub struct Pomodoro {
    mode: Mode,
    started_at: Option<Instant>, // derive elapsed; never tick it down
}

impl Pomodoro {
    pub fn remaining_time(&self, now: Instant) -> Duration { /* ... */ }
    pub fn mode(&self) -> Mode { self.mode }

    fn start(&mut self, now: Instant) { self.mode = Mode::Focus; self.started_at = Some(now); }
}

#[derive(Debug, Clone)]
pub enum PomodoroCmd { Started(Mode), SessionEnd { mode: Mode, seconds: u64 } }

impl Updateable<PomodoroMsg, PomodoroCmd> for Pomodoro {
    fn update(&mut self, msg: PomodoroMsg) -> Vec<PomodoroCmd> {
        match msg {
            PomodoroMsg::Start(now) => { self.start(now); vec![PomodoroCmd::Started(self.mode)] }
            PomodoroMsg::Tick(now)
                if self.started_at.is_some()
                    && now - self.started_at.unwrap() >= FOCUS_LEN =>
            {
                let c = PomodoroCmd::SessionEnd { mode: self.mode, seconds: FOCUS_LEN.as_secs() };
                self.reset();
                vec![c]
            }
            PomodoroMsg::Pause(_) | PomodoroMsg::Resume(_) => { /* ... */ vec![] }
            PomodoroMsg::Tick(_) | PomodoroMsg::SkipSession => vec![],
        }
    }
}
```

## 4. Top model with dispatch loop (composed)

```rust
// src/core/app.rs
pub struct AppCore<E: EffectHandler> {
    timer: Pomodoro,
    router: Router,
    config: Config,
    config_snapshot: Config,   // dirty = comparison, not a flag
    effects: E,                // injected port
    quit: bool,
}

impl<E: EffectHandler> AppCore<E> {
    pub fn new(effects: E) -> Self { /* compose + snapshot */ }

    pub fn dispatch(&mut self, msg: Msg) {
        for effect in self.update(msg) {
            self.execute_effect(effect);
        }
    }

    pub fn execute_effect(&mut self, effect: Effect) {
        for msg in self.effects.execute(effect) {
            self.dispatch(msg);
        }
    }

    /// The only writer of state. Pure transition; returns effects as data.
    fn update(&mut self, msg: Msg) -> Vec<Effect> {
        match msg {
            Msg::Timer(m) => {
                let cmds = self.timer.update(m);
                cmds.into_iter().flat_map(|c| self.translate_timer(c)).collect()
            }
            Msg::Router(m) => { self.router.update(m); vec![] }
            Msg::TaskResult(Ok(out)) => self.handle_task_result(out),
            Msg::TaskResult(Err(e)) => vec![Effect::SendNotification(e.to_string())],
            Msg::Quit => { self.quit = true; vec![Effect::Quit] }
        }
    }

    /// Sub-model command -> top-level effect. Only the top level knows
    /// the full effect vocabulary.
    fn translate_timer(&mut self, cmd: PomodoroCmd) -> Vec<Effect> {
        match cmd {
            PomodoroCmd::Started(mode) => {
                self.router.go_to(Page::Focus);
                vec![Effect::Session(SessionEffect::Log { mode, seconds: 0 })]
            }
            PomodoroCmd::SessionEnd { mode, seconds } => {
                self.timer.advance();
                self.router.go_to(Page::Break);
                vec![Effect::PlaySound(Alarm::End), Effect::SendNotification(mode.label())]
            }
        }
    }

    pub fn is_quit(&self) -> bool { self.quit }
    pub fn timer(&self) -> &Pomodoro { &self.timer }
    pub fn is_config_dirty(&self) -> bool { self.config != self.config_snapshot }
}
```

## 5. Free-function update (function form)

Same contract, no trait. Use when the model is flat or the host requires
a function pointer:

```rust
// src/core/update.rs
pub fn update(model: &mut Model, msg: Msg) -> Vec<Effect> {
    match msg {
        Msg::NumDrag(key, v) => { model.set_draft(key, v); vec![] }
        Msg::Commit(key) => model.commit_draft(key).map_or_else(Vec::new, |e| vec![e]),
        Msg::Quit => { model.quit = true; vec![Effect::Quit] }
        // ...
    }
}

// Framework wrapper (iced needs a free fn returning its Task type):
fn iced_update(model: &mut Model, msg: Msg) -> Task<Msg> {
    let effects = update(model, msg);
    Task::batch(effects.into_iter().map(translate_to_task))
}
```

## 6. Ports and the adapter

```rust
// src/core/ports.rs — declared in the layer that consumes them
pub trait EffectHandler {
    fn execute(&mut self, effect: Effect) -> Vec<Msg>;
}
pub trait Runner {
    fn run(&mut self) -> Result<(), UiError>;
}

// src/adapters/effects.rs — the only place real IO happens
pub struct TuiEffects { sound: SoundFx, notify: NotifyHandle, path: PathBuf }

impl EffectHandler for TuiEffects {
    fn execute(&mut self, effect: Effect) -> Vec<Msg> {
        match effect {
            Effect::Quit => vec![],
            Effect::PlaySound(a) => { self.sound.play(&a); vec![] }
            Effect::StopSound => { self.sound.stop(); vec![] }
            Effect::SendNotification(t) => { self.notify.send(&t); vec![] }
            Effect::SaveConfig(c) => vec![Msg::TaskResult(save_config(&self.path, &c))],
            Effect::Session(s) => vec![Msg::TaskResult(log_session(&s))],
        }
    }
}
```

## 7. Test double

```rust
// tests/support.rs or src/core/test_support.rs
#[derive(Default)]
pub struct MockEffects { pub recorded: Vec<Effect> }

impl EffectHandler for MockEffects {
    fn execute(&mut self, effect: Effect) -> Vec<Msg> {
        self.recorded.push(effect);
        vec![]
    }
}

#[test]
fn session_end_advances_and_alarms() {
    let mut core = AppCore::new(MockEffects::default());
    let t0 = Instant::now();
    core.dispatch(Msg::Timer(PomodoroMsg::Start(t0)));
    core.dispatch(Msg::Timer(PomodoroMsg::Tick(t0 + FOCUS_LEN)));

    assert_eq!(core.timer().mode(), Mode::Break);
    assert!(core.effects.recorded.contains(&Effect::PlaySound(Alarm::End)));
}
```

## 8. Field registry (data-driven views)

One const table drives rendering, search, and tooltips — adding a setting
becomes one row plus its message variant (Open/Closed, DRY):

```rust
// src/ui/fields.rs — shell layer; render fn signature is framework-flavored
pub struct Field {
    pub section: Section,
    pub label: &'static str,
    pub tip: &'static str,
    pub render: fn(&Model) -> Element<'_, Msg>,   // ratatui: fn(&Model, &mut Frame, Rect)
}

pub const FIELDS: &[Field] = &[
    Field { section: Section::Audio, label: "Volume", tip: "Output volume", render: render_volume },
    Field { section: Section::Audio, label: "Output",  tip: "Sink selection", render: render_output },
    // one row per setting
];

pub fn settings_page(model: &Model) -> Element<'_, Msg> {
    /* iterate FIELDS, call (f.render)(model) */
}

pub fn search_fields(query: &str) -> Vec<&'static str> {
    FIELDS.iter().filter(|f| matches_query(f, query)).map(|f| f.label).collect()
}
```

Pair with draft state for editable numbers: `drafts: HashMap<Key, String>`
mirrors config while half-typed; commit validates and returns the save
effect, Esc clears the draft.

## 9. Tick timer

```rust
// iced — subscription (host layer)
Subscription::batch([
    iced::time::every(Duration::from_millis(250)).map(|_| Msg::Timer(PomodoroMsg::Tick(Instant::now()))),
])

// hand-rolled — poll with timeout doubles as the tick cadence
if event::poll(Duration::from_millis(250))? {
    /* handle input events */
} else {
    core.dispatch(Msg::Timer(PomodoroMsg::Tick(Instant::now())));
}
```

Tick interval = the smoothest display update you need (progress bars:
100–250 ms; countdown seconds: 250–500 ms). Ticks carry the instant so
the model stays deterministic (see `testing.md` §5).
