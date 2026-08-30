---
name: gui-test-guidelines
description: >-
  Comprehensive GUI/UI test automation guidelines covering foundational
  validity, selector strategy, synchronization/determinism, test architecture
  patterns (Page Object, Screenplay, Component Object Model), test doubles,
  visual regression testing, accessibility testing, named anti-patterns, test
  data management, flakiness triage, and native/desktop GUI testing (including
  Rust GUI frameworks). Use this skill whenever the user asks to write,
  review, critique, or discuss GUI tests, UI tests, or E2E tests — including
  Playwright, Selenium, Cypress, WebDriver, Appium, WinAppDriver, Testing
  Library, visual regression / screenshot testing, accessibility testing
  (axe-core, WCAG), page objects, the Screenplay pattern, flaky UI tests, test
  selectors/locators, or testing native desktop GUIs (Tauri, Dioxus, Iced,
  egui, or other non-browser toolkits). Also trigger for "testing trophy",
  "testing pyramid", "testing diamond", "self-healing selectors", or any GUI
  testing terminology. Do NOT just write GUI tests blindly — consult these
  guidelines first and explicitly reference them in your response.
---

# GUI Testing Guidelines

This skill contains authoritative GUI/UI test automation guidelines, companion to the `test-guidelines` skill (which governs unit tests). When invoked, you MUST:

1. **Reference these guidelines explicitly** in your response (e.g., "Per the GUI testing guidelines, this couples the test to implementation detail...")
2. **Apply them to whatever GUI testing task the user has** — writing new tests, reviewing existing ones, choosing an architecture, or triaging flakiness
3. **Quote relevant rules** rather than just summarizing

## 1. Foundational Validity

**A GUI test must have a deterministic, bounded mechanism to fail when the application misbehaves.** If no plausible defect could make it fail, it is dead weight. Dead weight takes three forms:

- **Assertion-free navigation ("smoke") scripts**: clicks and fills happen, nothing is asserted. Fails only on a hard crash — misses functional regressions, silent data loss, visual corruption entirely.
- **Un-diffed visual snapshots**: screenshots captured and stored but never compared against a baseline.
- **Decoupled/tautological assertions**: asserting against a local test-context variable or driver return status instead of the live DOM/accessibility tree (e.g. asserting a boolean flipped rather than asserting the UI actually shows the new state).

### Testing business logic through the UI is a boundary violation

Domain logic (calculations, invariants, state-machine transitions, authorization rules) belongs in unit tests. Presentation logic (rendering state, translating gestures into commands, layout/routing) belongs in GUI tests. Use the failure-mode heuristic to tell them apart: if the underlying algorithm changes but the visual output is unaffected, it's domain logic — unit-test it. If the algorithm is untouched but the visual state fails to update, it's presentation logic — that's what justifies a UI test. Validating 50 edge cases of a discount algorithm by driving a checkout form means 50 full browser sessions with startup, rendering, and network overhead; the same 50 cases against the domain layer run in milliseconds with zero flake.

### Assert on observable state, not implementation

| Assert on (user-observable) | Never assert on (implementation detail) |
|---|---|
| Visible text content | CSS class names (`.btn-primary`) |
| Accessible name, role, ARIA state (`aria-expanded`) | DOM hierarchy / tag nesting |
| Focus state (`document.activeElement`) | Internal component state (React fiber, Vue instance data) |
| Interactivity (enabled/disabled, visibility) | Specific layout/styling values |

`aria-expanded="true"` verifies both users and assistive tech get the correct signal. Asserting a child `div` has class `.menu-open` couples the test to a styling decision — swap to CSS Modules or a different UI library and the test breaks despite nothing user-facing changing.

## 2. The GUI Test Tradeoff Space

Three competing structural models, each optimizing a different dimension:

- **Testing Pyramid** (Cohn/Fowler): broad unit base, thin E2E apex. Formulated for backend-heavy apps with thin frontends. *Critique*: rich client apps do meaningful state management and routing client-side; heavy unit-only coverage misses integration blind spots at component boundaries.
- **Testing Trophy** (Kent C. Dodds): re-weights toward integration/component tests, static analysis as the base. *Critique*: over-indexing on mocked-network integration tests creates false confidence — real network latency, CORS, DB transaction locks, and token expiry still escape to production.
- **Testing Diamond**: wide middle of integration + component UI tests, unit tests reserved for complex domain math, a strictly capped top tier of E2E. Explicitly separates full E2E (real infra) from component tests (real browser engine, mocked API layer).

### Decision heuristics by layer

| | Unit | Component/Integration | E2E |
|---|---|---|---|
| Target | Pure functions, reducers, domain rules | Rendered component trees, form interactions, state→view mapping | Critical user journeys, multi-service workflows |
| Network | Fully isolated, no network | Intercepted (MSW, route interception) | Live/staging backend |
| Environment | Node/native runtime, no DOM | Real headless browser engine | Full browser instance |
| Relative fix cost | ~$1 | ~$10 | ~$100–1000 |
| Debugging signal | High — exact stack trace | Moderate — isolates subtree | Low — identifies broken workflow, not root cause |

Execution time and flakiness both increase monotonically unit → component → E2E; maintenance burden follows the same curve because E2E is most exposed to environmental and visual change.

## 3. Selector / Locator Strategy

### Priority order (accessibility-first)

1. **WAI-ARIA role + accessible name** — `getByRole('button', { name: 'Submit Payment' })`. Maps directly to the accessibility tree the browser exposes. If a button becomes an unlabeled `<div>`, this locator fails — catching an accessibility regression as a side effect.
2. **Explicit label association** — `getByLabel('Email Address')`. Mirrors how a screen reader announces a form field.
3. **Accessible text content** — `getByText(...)`. For non-interactive elements (headings, static messages) with no distinct role.
4. **`data-testid`** — resilient fallback, not a default.
5. **Prohibited**: structural/styling selectors (`div.main > form > button:nth-child(3)`). Couples the test to transient DOM shape and class-naming decisions.

### `data-testid`: justified vs. smell

Legitimate: canvas/WebGL containers with no accessible internal tree, i18n-driven copy where text assertions are unstable across locales, disambiguating structurally-identical siblings (list rows sharing a role and name). A smell: slapping `data-testid="submit-btn"` on an accessible `<button>` instead of querying by role — this silently tolerates broken or unlabeled controls. Also a smell: dozens of test-ids injected purely to compensate for non-semantic markup.

### Selector stability boundary

Selectors **must not** break on: CSS class renames, utility-class changes, DOM nesting adjustments, swapping UI library primitives, layout/padding changes. Selectors **should** break on: removal of the feature/control, a fundamental semantic change (button → link), a copy rewrite that changes user intent, or an accessibility regression.

### Native (non-browser) desktop mapping

| Platform | Accessibility API | Node type | Locator strategy |
|---|---|---|---|
| Windows | UI Automation (UIA) | `AutomationElement` | `ControlType` + `Name` property |
| macOS | NSAccessibility / XCUITest | `AXUIElement` | `elementType` + `label`/`identifier` |
| Linux | AT-SPI2 / dogtail | D-Bus accessibility node | `roleName` + `name` |

The same accessibility-first principle applies: native GUI toolkits expose a queryable accessibility tree, and querying it (role + name) is the native equivalent of `getByRole`.

## 4. Synchronization and Determinism

Flakiness in GUI automation is fundamentally a timing-skew problem: the driver issues commands faster than the app can complete async state transitions and re-render.

- **Sleep is an anti-pattern.** `Thread.sleep(3000)` / `page.waitForTimeout(3000)` is either wastefully long or fails under CI load — it never establishes a real synchronization contract.
- **Explicit waits** poll (e.g. every ~100ms, up to a ~5000ms timeout) until a condition holds or the timeout expires.
- **Auto-waiting engines** (Playwright-style) run an actionability pipeline before every gesture, checking: attached to DOM → visible (non-zero geometry, not `display:none`/`visibility:hidden`, opacity > 0) → stable (bounding box unchanged across ~2 animation frames) → receives events (not obscured by an overlay at the hit point) → enabled.
- **Animations/transitions**: neutralize globally in the test context (`* { transition-duration: 0s !important; animation-duration: 0s !important; }`) or emulate `prefers-reduced-motion`.
- **Debounced inputs**: a search box debouncing ~300ms needs an explicit wait for the resulting side effect (spinner appears/disappears) — don't assert immediately after typing. Alternative: fake/advance the clock instead of waiting in real time.
- **Network + time**: intercept at the network boundary for instant, static responses; use fake timers to advance time programmatically.

### Visual regression determinism

Non-determinism sources: OS-level font anti-aliasing, GPU vs. CPU rasterization, browser dynamic image decoding, and volatile content (timestamps, avatars, ads). Mitigate by running visual tests in deterministic Linux containers with fixed font libraries and `--disable-gpu`, using a perceptual diff (SSIM/pixelmatch-style) with a normalized color-delta tolerance of roughly **0.05–0.1** rather than exact pixel match, and masking volatile regions before capture (`page.screenshot({ mask: [...] })`).

### GUI-specific race conditions

- **Double-render cycles**: initial render on default props, then an async update triggers a re-render. A click in the gap between renders can hit a now-detached node. Fix: verify the target node's identity is stable across event-loop ticks before acting on it, not just that "an element matching the selector" exists.
- **Hydration mismatches (SSR/SSG)**: static HTML is visible before JS listeners attach. Fix: assert on an explicit hydration-complete signal (`data-hydrated="true"`) before issuing gestures, don't rely on visual presence alone.

## 5. Test Architecture Patterns

### Page Object Model (POM)

Encapsulates per-page selectors and interactions behind a class (`checkoutPage.enterPaymentDetails(...)`). **Known failure modes**: SRP violations as pages grow into "God Objects" mixing locators/helpers/assertions; high churn fragility since layout changes force editing large classes; duplication of shared components (headers, modals) across page classes without inheritance discipline.

### Screenplay (Journey) pattern

Actor-centric instead of page-centric. Five pillars: **Actors** (who), **Abilities** (integration capability, e.g. `BrowseTheWeb`), **Tasks** (high-level workflows, e.g. `CompleteCheckout`), **Interactions** (low-level driver calls, e.g. `Click.on(...)`), **Questions** (typed state assertions, e.g. `Text.of(...)`). Higher upfront class-design cost, but tasks stay stable while UI layout under them shifts — decouples functional intent from driver mechanics.

### Component Object Model (COM) / Flow Model

Models individual design-system components (`DataTableComponent`, `DatePickerWidget`) rather than whole pages — a natural fit for component-driven frontends (React/Vue/Web Components). Flow orchestrators handle transitions between components without representing a static page.

### Choosing between them

| | POM | Screenplay | Component Object Model |
|---|---|---|---|
| Team size | Small, unified QA/dev | Large, cross-functional | Medium-large frontend teams |
| App complexity | Low-moderate | Complex, multi-actor, high business-logic density | Highly modular SPAs/micro-frontends |
| Rate of UI change | Low | High — Tasks absorb it | High — localized to component models |
| Upfront cost | Low | High class density, needs DSL discipline | Moderate, mirrors component hierarchy |

There is no universally correct pattern — POM is the reasonable default for a small, stable app; Screenplay pays for itself only once team size or workflow complexity actually creates duplication pain across page objects. This is a real tradeoff, not a maturity ladder — don't migrate to Screenplay just because it's "more advanced."

## 6. Test Doubles and Mocking Rules for GUI Tests

**Permissible to stub**: third-party APIs (Stripe, Auth0, analytics), time/clock, hardware/browser platform APIs (geolocation, camera, clipboard), destructive mutations.
**Prohibited to stub**: the app's own rendering engine, primary client-side state store (Redux/Zustand/Pinia), local DOM event handlers, and — in true E2E mode — the internal API. Mocking internal state or rendering handlers turns the test into a verification of the mock, not the app.

### Network interception mechanisms

- **Service worker interception** (MSW): intercepts fetch/XHR inside the browser's own service-worker thread — realistic, no global API overrides.
- **Driver protocol interception** (`page.route`, `cy.intercept`): uses CDP/WebDriver BiDi to intercept at the browser-process layer — fast, supports conditional abort/throttle/payload rewrite.
- **HTTP proxy mocking** (WireMock): external proxy between backend and frontend — necessary for native desktop apps that bypass service-worker hooks entirely.

Tradeoff: real unmocked backend gives maximum integration confidence but is slow and environment-dependent; intercepted mocks are fast and deterministic but only as accurate as the mock schema; a static component harness is fastest but only verifies presentation, not integration.

### Full rendering, not shallow rendering

Shallow rendering (rendering a parent without its children) asserts on implementation (a `<ChildComponent />` tag exists in the tree) instead of user-observable output (the child's DOM actually rendered and bound its handlers). Modern browser engines render full trees fast enough that shallow rendering buys no real performance and costs real confidence — treat it as deprecated.

### API-based setup, UI-based verification

Don't drive multi-step setup (login → navigate → add to cart) through the UI just to reach the screen under test. Create the needed state via direct API/DB calls, inject the auth token into browser storage, navigate straight to the target URL, and reserve the actual UI interaction for the one behavior being tested. This is the single highest-leverage change for cutting suite runtime and isolating failures to the thing actually under test.

## 7. Visual Regression Testing

- **Baseline management**: either repo-committed (requires strict Linux-only CI generation to avoid cross-OS diffs from local dev machines) or a cloud registry (Percy/Applitools-style, tied to commit hash/branch).
- **Threshold tuning**: use a perceptual diff with a color-delta tolerance around **0.05–0.1** (not exact match), spatial anti-aliasing detection to ignore subpixel font noise, and explicit masking of dynamic regions (clocks, avatars) before capture.
- **CI review workflow**: capture → compare against branch baseline → gate on whether delta is within threshold → post a diff artifact for human triage → reviewer either rejects (files a bug) or approves (updates the baseline).
- **ROI**: high value for design-system components, dashboards, static marketing pages. Poor ROI on highly dynamic, multi-tenant, or heavily localized views — maintenance cost dominates.

## 8. Accessibility Testing Integration

```javascript
import { AxeBuilder } from '@axe-core/playwright';

test('verify accessible page state', async ({ page }) => {
  await page.goto('/checkout');
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);
});
```

**Know the actual limits.** Automated scanners (axe-core and equivalents) catch roughly **10–30%** of total WCAG defects — missing HTML/ARIA attributes, insufficient contrast (below ~4.5:1), missing alt text, unlabeled inputs, duplicate IDs. They miss an estimated **70–89%** of real accessibility barriers: logical keyboard tab order, whether alt text is contextually accurate, focus trapping in modals, cognitive clarity of error handling. Automated scanning is a floor, not a substitute for manual/screen-reader testing — don't represent a passing axe-core run as "accessible."

Accessibility-first selectors (Section 3) double as a passive a11y regression check for free: if a `<button>` degrades to an unlabeled `<div onClick>`, `getByRole('button', { name: 'Save' })` fails — not because the test is brittle, but because the app just became unusable by assistive tech.

## 9. Named Anti-Patterns

**Ice Cream Cone / Inverted Test Pyramid** — top-heavy E2E layer, thin integration layer, minimal unit base. Usually caused by QA teams automating exclusively through the GUI without source access. Severity critical: multi-hour CI runs, high flake, prohibitive maintenance. Fix: push coverage down the stack, keep E2E to critical paths only.

**Fragile Selector** — locators coupled to CSS classes or DOM position (`div > span:nth-child(2) > button.blue-btn`). Any benign styling refactor breaks the suite with false negatives. Fix: accessibility-first queries, or `data-testid` as an explicit fallback.

**Sleep-Based Synchronization** — fixed-duration pauses standing in for real waits. Multiplies run time without actually preventing flake under variable CI load. Fix: auto-waiting locators or explicit state polling.

**Login-in-Every-Test** — full UI login as `beforeEach` setup for hundreds of unrelated tests. Slows the whole suite and makes a trivial login-page bug block everything. Fix: authenticate via API, inject the session token, navigate directly.

**God Test / Kitchen-Sink E2E Test** — one long script chaining unrelated journeys (register → update profile → search → checkout → change password). If step 2 fails, the other 98 assertions never run, hiding regressions elsewhere. Fix: decompose into atomic, independent tests.

**Order-Dependent UI Test / Shared Browser State** — test B only passes if test A ran first and left cookies/DB rows behind. Blocks parallelization and makes isolated runs behave differently from full-suite runs. Fix: each test seeds its own data and gets a fresh, isolated storage context.

**Screenshot-Only Assertion** — relying entirely on visual diffing with no semantic assertion backing it. Misses functional/accessibility bugs while generating false-positive noise from anti-aliasing shifts. Fix: pair targeted visual diffing with explicit role/text assertions.

**Assertion-Free Smoke Test** — see Section 1; navigates without asserting, "passes" as long as nothing throws.

## 10. Test Data and State Management

- **Seed via API/DB, not UI.** Generate unique, isolated entities (`user_3019482@test.internal`) per test so concurrent tests never contend for the same record. Pre-seed static reference data (country lists, currency codes) once per suite run, not per test.
- **Parallelization requires context isolation.** Use browser-context-level isolation (fresh cookies/cache/localStorage per test, not a fresh browser process) for speed, and isolate at the tenant/user-credential level too — if Worker 1 mutates shared account settings that Worker 2 reads, both go non-deterministic regardless of browser isolation.

## 11. Flakiness: Causes and Triage

**Flakiness taxonomy beyond timing**: CI resource contention (oversubscribed vCPUs throttle JS scheduling, blowing wait-timeout budgets), headless vs. headed rendering differences (font scaling, missing GPU/codecs), unmocked third-party scripts (analytics/chat widgets adding latency or overlay popups — block third-party domains at the router level in tests), and locale/timezone skew between dev machines and UTC CI runners breaking date/calendar assertions.

**Retries — the actual tradeoff**: retries absorb genuine infra noise (socket blips, transient CPU spikes) without blocking a deploy. But they also mask real concurrency bugs and race conditions that production users will hit, and they multiply E2E pipeline latency. Consensus: cap retries at **1–2** attempts, and any test that only passes on retry gets **automatically flagged** in a flake dashboard rather than silently tolerated.

**Quarantine process** (Google-style): (1) track a rolling per-test pass-rate metric; (2) when a test's reliability drops below **~95%**, auto-tag it and pull it out of the gating pre-submit pipeline; (3) keep running it in a non-gating post-submit suite to keep collecting diagnostic signal; (4) enforce an SLA (e.g. 14 days) — if the owning engineer hasn't fixed it by then, delete it rather than let it rot in permanent quarantine.

## 12. Native / Non-Browser GUI Testing

Native toolkits expose their layout through OS accessibility APIs (UIA/NSAccessibility/AT-SPI — see Section 3's table); an abstraction layer such as **AccessKit** formats these into a queryable structure for native test drivers, playing the same role the DOM/accessibility-tree plays for web selectors.

### Rust GUI ecosystem specifically

| Framework | Architecture | Testing approach |
|---|---|---|
| **Tauri** | OS webview + Rust IPC backend | Standard web automation (Playwright/WebDriver) applies directly to the webview layer |
| **Dioxus** | Virtual DOM, cross-platform | `dioxus-ssr` gives headless DOM unit/integration testing without launching a native window |
| **Iced** | Elm-style state/message/update loop | Test the reducer directly — unit/integration test state transitions and message handlers with no GUI window needed |
| **egui** | Immediate-mode, no persistent element tree | Genuine tooling gap — no DOM to query. Mitigated only by AccessKit integration exposing the immediate-mode UI to the OS accessibility tree for external automation |

### Web vs. native automation maturity — be honest about the gap

| | Web (Playwright/Cypress) | Native desktop (Appium/WinAppDriver) |
|---|---|---|
| Driver standard | High maturity (WebDriver BiDi, CDP) | Fragmented — OS-specific bindings, custom IPC |
| Auto-waiting | Native, built into the engine | Usually manual, polling the accessibility tree yourself |
| Network interception | Native service-worker/network-layer stubbing | Needs an external HTTP proxy (WireMock) |
| Execution latency | Fast — process-level browser contexts | Slow — OS window allocation, focus management |

This is a real, current tooling immaturity for native/Rust GUI testing, not a reason to avoid it — Iced's reducer-testability and Dioxus's `dioxus-ssr` are genuinely strong options that sidestep the gap entirely for logic-level coverage; egui is where the gap is sharpest because there's no tree to test against short of AccessKit.

## 13. Coverage Philosophy for GUI Tests

Exhaustive permutation coverage at the GUI layer is combinatorially intractable — N fields with M validation states each scales exponentially. Split coverage by risk tier: **Tier 1 (Critical User Journeys)** — checkout, subscription renewal, auth, onboarding — gets full E2E coverage. **Tier 2 (edge cases/permutations)** — field validation rules, conditional formatting — gets pushed down to unit/component tests where it's cheap to exhaustively cover.

**Mutation testing does not translate well to GUI suites.** A 500-test E2E suite at 20 minutes runtime, times 1000 injected mutants, is months of compute. Mutated CSS/layout can break visual presentation without tripping a functional DOM assertion, producing noisy false "survivors." And a killed mutant in an E2E test doesn't tell you whether the UI layer caught it or an underlying backend dependency just crashed — the signal is too coarse. Reserve mutation testing for the unit layer (see `test-guidelines`).

## 14. Emerging Tooling (2025–2026)

**AI-driven self-healing selectors**: capture a DOM-embedding "fingerprint" (tag, computed CSS, parent context, ARIA attrs, bounding box) at baseline. On a locator failure, compute a vector-distance score against current nodes and re-bind the locator if confidence exceeds roughly **0.85**. Real failure modes to weigh before adopting: false positives where it clicks a structurally-similar-but-wrong element (a broken feature can pass as "healed"), added latency on genuine failures, and vendor lock-in from proprietary cloud engines that don't port to standard open-source drivers. This is a genuine capability with genuine tradeoffs — not a reason to dismiss it, but not a free upgrade either.

**Where consensus has actually shifted since ~2023**: in-browser component testing (Playwright CT / Cypress CT mounting real components in a real headless browser) is displacing JSDOM-based component mocks; WebDriver BiDi/CDP's WebSocket event streams are displacing legacy HTTP JSON Wire polling, enabling real auto-waiting and interception; ephemeral per-PR environments with mocked network layers are displacing shared staging servers as the default integration-test target.

## Summary Checklist

1. **Assert on accessible outcomes** — roles, accessible names, observable state — never brittle CSS/XPath.
2. **Decouple domain logic** — unit-test calculations and invariants; reserve GUI tests for presentation and workflow.
3. **Eliminate time-based waits** — auto-waiting engines, explicit state polling, reduced-motion overrides.
4. **Isolate test state** — API/DB setup, session-token injection, a fresh isolated context per test.
5. **Quarantine flakiness automatically** — pull sub-~95%-pass-rate tests out of the gate; don't let them rot indefinitely.
