# testing — what TEA makes easy and how to keep it easy

TEA's shape is a testing gift: `update` is a pure function of
(model, message), effects are data, and every outside capability is an
injected port. Test the core headlessly — CI never needs a renderer.

Contents:

1. [What to test](#1-what-to-test)
2. [Injection points](#2-injection-points)
3. [Test doubles](#3-test-doubles)
4. [Test through the public API](#4-test-through-the-public-api)
5. [Time and ticks](#5-time-and-ticks)
6. [Testing views](#6-testing-views)
7. [What not to test](#7-what-not-to-test)

## 1. What to test

Priority order (highest value per effort first):

1. **Update transitions** — message in → state changed + effects out.
   This is the app's actual behavior.
2. **Domain model methods** — state machines, computed getters
   (`remaining_time`, `is_config_dirty`).
3. **Effect translation** — sub-model command → top-level `Effect`.
4. **Input translation tables** — `KeyEvent` → `Msg` mappings (pure, in
   the shell; still table-testable without a terminal).
5. **Views** — mostly covered by type-checking plus tests for any derived
   logic (§6). Full render tests are optional and framework-bound.

## 2. Injection points

- The core is generic over `E: EffectHandler`; tests construct it with a
  double. Construction lives in one place (`AppCore::new`), so a test
  core is three lines.
- Other capabilities (sound, notify, repos) are port traits; doubles
  implement them the same way.

```rust
let mut core = AppCore::new(MockEffects::default());
core.dispatch(Msg::Timer(PomodoroMsg::Start(t0)));
```

If a test needs the real filesystem or a live socket to reach the model,
the injection point is missing — that is the finding, not a reason to add
test fixtures.

## 3. Test doubles

- **Recorder** — records effects, returns `vec![]`. Primary double:

  ```rust
  #[derive(Default)]
  pub struct MockEffects { pub recorded: Vec<Effect> }

  impl EffectHandler for MockEffects {
      fn execute(&mut self, effect: Effect) -> Vec<Msg> {
          self.recorded.push(effect);
          vec![]
      }
  }
  ```

- **Silent stubs** for sound/notify — implement the trait, do nothing.
- **In-memory repos** — `HashMap`-backed.
- To simulate an effect *result*, have the double return the follow-up
  message: `fn execute(...) -> vec![Msg::ConfigSaved(Ok(()))]`.
- One hand-written double per port. Do not build a mocking framework for
  two ports (Speculative generality).

## 4. Test through the public API

- Drive via `dispatch(Msg)` (or the public `update` free function) and
  assert via public getters — the same doors production uses.
- Do not reach into private fields, and do not add `#[cfg(test)]` setters
  — that breaks Encapsulation and couples tests to implementation instead
  of behavior.
- Test names state behavior: `pausing_stops_the_clock`,
  `commit_draft_persists_only_when_dirty`.

```rust
#[test]
fn session_end_advances_and_alarms() {
    let mut core = AppCore::new(MockEffects::default());
    core.dispatch(Msg::Timer(PomodoroMsg::Start(t0)));
    core.dispatch(Msg::Timer(PomodoroMsg::Tick(t0 + FOCUS_LEN)));

    assert_eq!(core.timer().mode(), Mode::Break);
    assert!(core.recorded_effects().contains(&Effect::PlaySound(Alarm::End)));
}
```

## 5. Time and ticks

- The model derives elapsed/remaining time from an anchor instant stored
  on the model (`started_at: Option<Instant>`); a `Tick` message just
  says "the time is now T".
- `Instant` is std and pure — fine in core. No wall-clock reads inside
  `update`; the host stamps real time into messages, tests pass chosen
  instants. This removes both nondeterminism and Temporal coupling.
- Long spans do not need many ticks: jump straight to the interesting
  instant (`t0 + FOCUS_LEN`).

## 6. Testing views

- Prefer testing the model-derived facts a view would display
  (`core.router().active_page()`, `format!("{}", pomodoro.remaining_time())`).
- If a view contains real logic (filtering, sorting, grouping), extract
  it as a pure function or method into core and test it there; the view
  becomes a thin renderer over tested data.
- Widget trees themselves: rely on type-checking plus manual/visual
  checks. Full render-snapshot tests are framework-bound and optional —
  do not reach for them first.

## 7. What not to test

- One-line trait impls and pure wiring (the compiler covers them).
- Message enum exhaustiveness — adding a variant already breaks every
  `match` at compile time.
- The host loop's sleep/poll mechanics — keep them trivial and test the
  translation tables instead.
- Framework lifecycle (iced's scheduler, ratatui's backend) — that is the
  framework's test suite, not yours.
