---
name: gui-test-guidelines
description: >-
  Write, review, or triage GUI/UI and E2E tests: Playwright, Cypress,
  Selenium, WebDriver, Appium, Testing Library, page objects, Screenplay,
  locators, visual regression, a11y (axe-core, WCAG), and native desktop
  toolkits (Tauri, Dioxus, Iced, egui). Use whenever the user asks about UI
  tests or E2E tests, and for "testing trophy", "testing pyramid", "testing
  diamond", or "self-healing selectors". Do NOT write GUI tests blindly:
  consult these guidelines and reference them. For unit and integration
  tests load @test-guidelines.
---

# GUI Testing Guidelines

Fundamentals (falsifiability, isolation, doubles, coverage) live in @test-guidelines: load it alongside, never re-derive here. When invoked, you MUST:

1. **Reference these guidelines explicitly** (e.g., "Per the GUI testing guidelines, this couples the test to implementation detail...")
2. **Apply them to the task**: new tests, reviews, architecture, flake triage
3. **Quote relevant rules**, not summaries

## 1. Foundational Validity

**A GUI test must have a deterministic, bounded mechanism to fail when the application misbehaves.** No plausible defect that fails it means dead weight. Three forms:

- **Assertion-free navigation ("smoke") scripts**: clicks and fills happen, nothing is asserted. Fails only on a hard crash, so it misses functional regressions, silent data loss, and visual corruption entirely.
- **Un-diffed visual snapshots**: screenshots captured and stored but never compared against a baseline.
- **Decoupled/tautological assertions**: asserting against a local test-context variable or driver return status instead of the live DOM/accessibility tree (e.g. asserting a boolean flipped rather than asserting the UI actually shows the new state).

### Testing business logic through the UI is a boundary violation

Domain logic (calculations, invariants, state-machine transitions, authorization) belongs in unit tests. Presentation logic (rendering state, gestures into commands, layout/routing) belongs in GUI tests. Heuristic: algorithm changes, visuals unaffected means domain logic; visuals fail on untouched algorithm means presentation logic. 50 discount edge cases through a checkout form means 50 browser sessions; against the domain layer they run in milliseconds with zero flake.

### Assert on observable state, not implementation

| Assert on (user-observable) | Never assert on (implementation detail) |
|---|---|
| Visible text content | CSS class names (`.btn-primary`) |
| Accessible name, role, ARIA state (`aria-expanded`) | DOM hierarchy / tag nesting |
| Focus state (`document.activeElement`) | Internal component state (React fiber, Vue instance data) |
| Interactivity (enabled/disabled, visibility) | Specific layout/styling values |

`aria-expanded="true"` serves users and assistive tech. A `.menu-open` class assertion breaks on a styling swap with nothing user-facing changed.

## 2. The GUI Test Tradeoff Space

The **Testing Pyramid** (Cohn/Fowler), the
**Testing Trophy** (Kent C. Dodds), and the **Testing Diamond** are three answers to one
question: where does the browser belong?

None holds on a rich client. Pyramid misses client-side integration blind spots (state, routing). Trophy over-indexes mocked-network integration; latency, CORS, locks, token expiry still escape. Diamond's useful part is the E2E cap plus full-E2E vs component-test separation; tier names are decoration. Choose by risk, then say which and why.

### Decision heuristics by layer

| | Unit | Component/Integration | E2E |
|---|---|---|---|
| Target | Pure functions, reducers, domain rules | Rendered component trees, form interactions, state→view mapping | Critical user journeys, multi-service workflows |
| Network | Fully isolated, no network | Intercepted (MSW, route interception) | Live/staging backend |
| Environment | Node/native runtime, no DOM | Real headless browser engine | Full browser instance |
| Relative fix cost | ~$1 | ~$10 | ~$100–1000 |
| Debugging signal | High: exact stack trace | Moderate: isolates subtree | Low: identifies broken workflow, not root cause |

Execution time, flakiness, and maintenance all grow unit → component → E2E.

## 3. Selector / Locator Strategy

### Priority order (accessibility-first)

1. **WAI-ARIA role + accessible name**: `getByRole('button', { name: 'Submit Payment' })`. Maps directly to the accessibility tree the browser exposes. If a button becomes an unlabeled `<div>`, this locator fails, catching an accessibility regression as a side effect.
2. **Explicit label association**: `getByLabel('Email Address')`. Mirrors how a screen reader announces a form field.
3. **Accessible text content**: `getByText(...)`. For non-interactive elements (headings, static messages) with no distinct role.
4. **`data-testid`**: resilient fallback, not a default.
5. **Prohibited**: structural/styling selectors (`div.main > form > button:nth-child(3)`). Couples the test to transient DOM shape and class-naming decisions.

### `data-testid`: justified vs. smell

Legitimate: canvas/WebGL with no accessible tree, i18n-unstable copy, disambiguating identical siblings. Smell: `data-testid="submit-btn"` on an accessible `<button>` (tolerates broken controls), or dozens of test-ids compensating for non-semantic markup.

### Selector stability boundary

Selectors **must not** break on: CSS class renames, utility-class changes, DOM nesting adjustments, swapping UI library primitives, layout/padding changes. Selectors **should** break on: removal of the feature/control, a fundamental semantic change (button → link), a copy rewrite that changes user intent, or an accessibility regression.

### Native (non-browser) desktop mapping

| Platform | Accessibility API | Node type | Locator strategy |
|---|---|---|---|
| Windows | UI Automation (UIA) | `AutomationElement` | `ControlType` + `Name` property |
| macOS | NSAccessibility / XCUITest | `AXUIElement` | `elementType` + `label`/`identifier` |
| Linux | AT-SPI2 / dogtail | D-Bus accessibility node | `roleName` + `name` |

The same accessibility-first principle applies: query the native accessibility tree by role + name, the native `getByRole`.

## 4. Synchronization and Determinism

Flakiness is timing skew: the driver outruns async transitions and re-render.

- **Sleep is an anti-pattern.** `Thread.sleep(3000)` / `page.waitForTimeout(3000)` is wastefully long or fails under CI load. No synchronization contract.
- **Explicit waits** poll (e.g. every ~100ms, up to ~5000ms) until a condition holds or the timeout expires.
- **Auto-waiting engines** (Playwright-style) check before every gesture: attached → visible → stable (~2 frames) → receives events → enabled.
- **Animations/transitions**: neutralize globally in test context (`* { transition-duration: 0s !important; animation-duration: 0s !important; }`) or emulate `prefers-reduced-motion`.
- **Debounced inputs**: a ~300ms-debounce search box needs an explicit wait on the side effect (spinner). Never assert right after typing. Alternative: fake/advance the clock.
- **Network + time**: intercept at the network boundary; fake timers for time.

### Visual regression determinism

Non-determinism: font anti-aliasing, GPU vs CPU rasterization, dynamic image decoding, volatile content (timestamps, avatars, ads). Mitigate: deterministic Linux containers with fixed fonts and `--disable-gpu`, perceptual diff (SSIM/pixelmatch) at **0.05–0.1** color-delta tolerance (never exact match), mask volatile regions (`page.screenshot({ mask: [...] })`).

### GUI-specific race conditions

- **Double-render cycles**: async update re-renders after the default-props render. A click in the gap hits a detached node. Fix: verify node identity is stable across ticks before acting, not just selector existence.
- **Hydration mismatches (SSR/SSG)**: static HTML shows before listeners attach. Fix: assert an explicit hydration-complete signal (`data-hydrated="true"`), never visual presence alone.

## 5. Test Architecture Patterns

### Page Object Model (POM)

Encapsulates per-page selectors and interactions (`checkoutPage.enterPaymentDetails(...)`). **Failure modes**: SRP violations as pages grow into God Objects; layout churn forcing large class edits; shared-component (headers, modals) duplication without inheritance discipline.

### Screenplay (Journey) pattern

Actor-centric, not page-centric. Five pillars: **Actors** (who), **Abilities** (`BrowseTheWeb`), **Tasks** (`CompleteCheckout`), **Interactions** (`Click.on(...)`), **Questions** (`Text.of(...)`). Higher upfront class cost; tasks survive layout shifts, decoupling intent from driver mechanics.

### Component Object Model (COM) / Flow Model

Models design-system components (`DataTableComponent`, `DatePickerWidget`), not pages; fits component-driven frontends. Flow orchestrators handle transitions without static pages.

### Choosing between them

| | POM | Screenplay | Component Object Model |
|---|---|---|---|
| Team size | Small, unified QA/dev | Large, cross-functional | Medium-large frontend teams |
| App complexity | Low-moderate | Complex, multi-actor, high business-logic density | Highly modular SPAs/micro-frontends |
| Rate of UI change | Low | High: Tasks absorb it | High: localized to component models |
| Upfront cost | Low | High class density, needs DSL discipline | Moderate, mirrors component hierarchy |

No universally correct pattern. POM is the default for a small, stable app; Screenplay pays off only once team size or workflow complexity creates real duplication pain. A tradeoff, not a maturity ladder: never migrate for "more advanced."

## 6. Test Doubles and Mocking Rules for GUI Tests

**Permissible to stub**: third-party APIs (Stripe, Auth0, analytics), time/clock, platform APIs (geolocation, camera, clipboard), destructive mutations.
**Prohibited to stub**: the app's own rendering engine, primary state store (Redux/Zustand/Pinia), local DOM handlers, and in true E2E the internal API. Mocking those verifies the mock, not the app.

### Network interception mechanisms

- **Service worker interception** (MSW): inside the browser's service-worker thread. Realistic, no global API overrides.
- **Driver protocol interception** (`page.route`, `cy.intercept`): CDP/WebDriver BiDi at the browser-process layer. Fast; supports abort/throttle/rewrite.
- **HTTP proxy mocking** (WireMock): external proxy, required for native desktop apps bypassing service-worker hooks.

Tradeoff: real backend gives max confidence, slow and environment-dependent; intercepted mocks are fast and deterministic but only as accurate as the schema; static harnesses verify presentation only.

### Full rendering, not shallow rendering

Shallow rendering asserts on implementation (`<ChildComponent />` exists) instead of observable output (child DOM rendered and handlers bound). Modern engines render full trees fast; shallow buys no performance and costs confidence. Deprecated.

### API-based setup, UI-based verification

Never drive multi-step setup (login → navigate → add to cart) through the UI to reach the screen under test. Seed state via API/DB, inject the auth token, navigate straight to the URL. Reserve UI interaction for the one behavior under test. Highest-leverage cut to suite runtime and failure isolation.

## 7. Visual Regression Testing

- **Baseline management**: repo-committed (needs strict Linux-only CI generation to avoid cross-OS diffs) or cloud registry (Percy/Applitools-style, tied to commit/branch).
- **Threshold tuning**: perceptual diff at **0.05–0.1** color-delta tolerance (never exact match), anti-aliasing detection for subpixel font noise, explicit masking of dynamic regions before capture.
- **CI review workflow**: capture → compare against branch baseline → gate on threshold → post diff artifact → reviewer rejects (bug) or approves (baseline update).
- **ROI**: high for design-system components, dashboards, static marketing pages. Poor on dynamic, multi-tenant, or heavily localized views.

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

**Limits.** Automated scanners (axe-core and equivalents) catch roughly **10–30%** of WCAG defects: missing attributes, contrast below ~4.5:1, missing alt, unlabeled inputs, duplicate IDs. They miss an estimated **70–89%**: tab order, alt-text accuracy, focus trapping, error-handling clarity. A floor, never a substitute for manual/screen-reader testing. Never call a passing axe-core run "accessible."

Accessibility-first selectors (Section 3) double as passive a11y regression checks: a `<button>` degrading to an unlabeled `<div onClick>` fails `getByRole('button', { name: 'Save' })` because the app just became unusable by assistive tech, not because the test is brittle.

## 9. Named Anti-Patterns

**Ice Cream Cone / Inverted Test Pyramid**: top-heavy E2E, thin integration, minimal unit base. Usually QA automating GUI-only without source access. Critical: multi-hour CI, high flake, prohibitive maintenance. Fix: push coverage down, keep E2E to critical paths.

**Fragile Selector**: locators on CSS classes or DOM position (`div > span:nth-child(2) > button.blue-btn`). Benign styling refactors break the suite. Fix: accessibility-first queries, `data-testid` fallback.

**Sleep-Based Synchronization**: fixed pauses for real waits. Multiplies runtime without preventing CI-load flake. Fix: auto-waiting locators or state polling.

**Login-in-Every-Test**: full UI login as `beforeEach` for hundreds of unrelated tests. One login-page bug blocks everything. Fix: API auth, token injection, direct navigation.

**God Test / Kitchen-Sink E2E Test**: one script chaining unrelated journeys. Step 2 fails, 98 assertions never run. Fix: atomic, independent tests.

**Order-Dependent UI Test / Shared Browser State**: test B passes only after test A left cookies/DB rows. Blocks parallelization; isolated runs differ from suite runs. Fix: each test seeds its own data with a fresh isolated context.

**Screenshot-Only Assertion**: visual diffing with no semantic assertions. Misses functional/a11y bugs, false-positives on anti-aliasing. Fix: pair visual diffs with role/text assertions.

**Assertion-Free Smoke Test**: see Section 1; navigates without asserting, "passes" unless something throws.

## 10. Test Data and State Management

- **Seed via API/DB, not UI.** Unique isolated entities (`user_3019482@test.internal`) per test so concurrent tests never contend. Pre-seed static reference data once per suite, not per test.
- **Parallelization requires context isolation.** Fresh cookies/cache/localStorage per test via browser contexts (not fresh browser processes), plus tenant/credential isolation. Worker 1 mutating shared account settings breaks Worker 2 regardless of browser isolation.

## 11. Flakiness: Causes and Triage

**Beyond timing**: CI resource contention (oversubscribed vCPUs blowing wait budgets), headless vs headed rendering (font scaling, missing GPU/codecs), unmocked third-party scripts (analytics/chat latency, overlay popups: block third-party domains at the router in tests), locale/timezone skew between dev machines and UTC CI breaking date assertions.

**Retries**: absorb infra noise (socket blips, CPU spikes) without blocking deploys. Cost: masked concurrency bugs and multiplied pipeline latency. Cap at **1–2** attempts; any test passing only on retry gets **flagged** in a flake dashboard, never silently tolerated.

**Quarantine** (Google-style): (1) track rolling per-test pass rate; (2) below **~95%**, auto-tag and pull from gating pre-submit; (3) keep running in non-gating post-submit for signal; (4) enforce an SLA (e.g. 14 days); unfixed by then means delete, not permanent quarantine.

## 12. Native / Non-Browser GUI Testing

Native toolkits expose layout through OS accessibility APIs (UIA/NSAccessibility/AT-SPI, Section 3 table); **AccessKit** formats these into a queryable structure, the native DOM/accessibility-tree equivalent for test drivers.

### Rust GUI ecosystem specifically

| Framework | Architecture | Testing approach |
|---|---|---|
| **Tauri** | OS webview + Rust IPC backend | Standard web automation (Playwright/WebDriver) applies directly to the webview layer |
| **Dioxus** | Virtual DOM, cross-platform | `dioxus-ssr` gives headless DOM unit/integration testing without launching a native window |
| **Iced** | Elm-style state/message/update loop | Test the reducer directly: unit/integration test state transitions and message handlers with no GUI window needed |
| **egui** | Immediate-mode, no persistent element tree | Genuine tooling gap: no DOM to query. Mitigated only by AccessKit integration exposing the immediate-mode UI to the OS accessibility tree for external automation |

### Web vs. native automation maturity: be honest about the gap

| | Web (Playwright/Cypress) | Native desktop (Appium/WinAppDriver) |
|---|---|---|
| Driver standard | High maturity (WebDriver BiDi, CDP) | Fragmented: OS-specific bindings, custom IPC |
| Auto-waiting | Native, built into the engine | Usually manual, polling the accessibility tree yourself |
| Network interception | Native service-worker/network-layer stubbing | Needs an external HTTP proxy (WireMock) |
| Execution latency | Fast: process-level browser contexts | Slow: OS window allocation, focus management |

Tooling gap, not a reason to skip: Iced reducer-testability and Dioxus `dioxus-ssr` sidestep it for logic coverage; egui is sharpest (no tree short of AccessKit).

## 13. Coverage Philosophy for GUI Tests

Exhaustive GUI permutation coverage is combinatorially intractable: N fields with M states each scales exponentially. Split by risk: **Tier 1 (Critical User Journeys)** (checkout, renewal, auth, onboarding) gets full E2E. **Tier 2 (edge cases/permutations)** (validation rules, conditional formatting) drops to unit/component tests where exhaustive coverage is cheap.

**Mutation testing does not translate to GUI suites.** 500 E2E tests at 20 minutes times 1000 mutants is months of compute. Mutated CSS/layout breaks visuals without tripping DOM assertions (false "survivors"). A killed mutant cannot say whether the UI caught it or a backend dependency crashed; the signal is too coarse. Reserve mutation for the unit layer (see @test-guidelines).

## 14. Emerging Tooling (2025–2026)

**AI-driven self-healing selectors**: baseline a DOM-embedding "fingerprint" (tag, computed CSS, parent context, ARIA attrs, bounding box). On locator failure, re-bind when vector-distance confidence exceeds roughly **0.85**. Weigh before adopting: false positives clicking a similar-but-wrong element (broken features pass as "healed"), added latency on genuine failures, vendor lock-in from proprietary engines. Genuine capability, genuine tradeoffs.

**Consensus shifts since ~2023**: in-browser component testing (Playwright CT / Cypress CT in a real headless browser) displacing JSDOM mocks; WebDriver BiDi/CDP event streams displacing HTTP JSON Wire polling (real auto-waiting and interception); ephemeral per-PR environments with mocked networks displacing shared staging servers.

## Summary Checklist

1. **Eliminate time-based waits**: auto-waiting engines, explicit state polling, reduced-motion overrides.
2. **Isolate test state**: API/DB setup, token injection, fresh isolated context per test.
3. **Quarantine flakiness automatically**: sub-~95% pass rate leaves the gate; never rots indefinitely.

Every item above must fail loudly: no assertion, no baseline diff, no tautology.
