/**
 * Source-level guards for the Watchdog page (#18). The rendered page is only
 * exercised through the shipped bundle in gui-bundle.test.ts; these guards pin
 * the structures the bundle build could silently drop or drift: two panels,
 * the family split, the off-by-default disabled gate, the overlap honesty
 * sentence, and the one-release-per-click wiring.
 */
import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"

const gui = readFileSync(new URL("./gui.tsx", import.meta.url), "utf8")
const controller = readFileSync(new URL("./watchdog-controller.ts", import.meta.url), "utf8")
const families = readFileSync(new URL("./feature-families.ts", import.meta.url), "utf8")

test("the plugin registers two top-level panels and two menu launchers", () => {
  expect(gui).toContain('const TAB = { id: "jev-view-v1"')
  expect(gui).toContain('const WATCHDOG_TAB = { id: "watchdog-view-v1"')
  expect(gui.match(/ctx\.add\(Panel/g) ?? []).toHaveLength(2)
  expect(gui.match(/ctx\.add\(MenuItem/g) ?? []).toHaveLength(2)
  expect(gui).toContain('mobile: { title: WATCHDOG_TAB.title, order: 52, kind: "menu", icon: "eye" }')
})

test("the Watchdog page has its own view and its own controller", () => {
  expect(gui).toContain("function WatchdogView(")
  expect(gui).toMatch(/createWatchdogView\(\s*\{/)
  expect(gui).toContain("Loading Watchdog…")
  expect(gui).toContain('aria-label="Watchdog"')
})

test("the Jev page keeps only its family: no watchdog feature toggles or groups render there", () => {
  const featuresFilter = gui.match(/features = \(\) => \(status\(\)\?\.features \?\? \[\]\)\.filter\(\(feature: any\) => \(JEV_FEATURES as readonly string\[\]\)\.includes\(feature\.key\)\)/)
  expect(featuresFilter).not.toBeNull()
  expect(gui).toMatch(/const jevConfig = \(\): SettingsInfo\[\"config\"\] => \{[\s\S]{0,220}?for \(const feature of JEV_FEATURES\) \{[\s\S]{0,160}?next\[feature\] = fields/)
  expect(gui).not.toContain("supervisorEndpoint\")}\">\n")
  // The Jev Secrets section no longer carries the supervisor endpoint: it moved
  // to the Watchdog page.
  expect(gui).not.toMatch(/title="Supervisor endpoint"[\s\S]*?putFeature\("hook_supervisor", "endpoint"/)
  expect(families).toContain('export const WATCHDOG_FEATURES = ["hook_session_ban", "hook_supervisor", "hook_abort_receipts"] as const')
  expect(families).toContain('export const JEV_FEATURES = ["hook_skill_pick", "hook_tool_risk", "hook_tool_standard"] as const')
})

test("off by default, and every control below the enablement switch is disabled while off", () => {
  // The gate: every chain-control and secret field passes the page's off state.
  const gated = gui.match(/disabled=\{off\(\)\}/g) ?? []
  expect(gated.length).toBeGreaterThanOrEqual(12)
  // The enablement switch itself stays enabled.
  expect(gui).toMatch(/onClick=\{\(\) => put\("on", !settings\(\)\.on\)\}/)
})

test("the page distinguishes pending, waiting, unavailable, effective bans, and incomplete containment", () => {
  for (const label of ["Pending review", "Admission waiting", "Effective bans", "Incomplete containment"]) {
    expect(gui).toContain(label)
  }
  expect(gui).toContain("durableUnreadable")
  expect(gui).toContain("Review chain unavailable")
})

test("the abort-record alert is conditional: absent on a healthy load, present only when the read failed", () => {
  // The view state declares `operationsReadable`; a gate on any other name
  // (the attempt-1 bug read `recordsReadable`, which exists only on the
  // status object) is undefined on every load and fired the alert always.
  expect(gui).toMatch(/<Show when=\{!state\(\)\.operationsReadable\}>[\s\S]{0,220}?Abort records could not be read/)
  expect(gui).not.toMatch(/when=\{!state\(\)\.recordsReadable\}/)
  // The healthy-load half: the initial view state is readable, so the alert
  // cannot fire before a load says otherwise.
  expect(gui).toMatch(/operationsReadable: true/)
  expect(gui).toMatch(/role="alert"[\s\S]{0,120}?Abort records could not be read/)
})

test("the pending and waiting chips render real counts; the page switch disables controls, not information", () => {
  // The switch `on` does not gate enforcement, so suppressing live counts
  // behind it lied about in-flight reviews (attempt-1 bug).
  expect(gui).toMatch(/<b>Pending review<\/b> \{watch\?\.pending\.inFlight \?\? 0\} in flight · \{watch\?\.pending\.durable \?\? 0\} durable/)
  expect(gui).toMatch(/<b>Admission waiting<\/b> \{watch\?\.pending\.waiting \?\? 0\}/)
  expect(gui).not.toMatch(/cfg\.on \?/)
})

test("the new page carries pointer and focus-visible CSS for its own controls", () => {
  expect(gui).toMatch(/\.fazuh-wd button \{ cursor: pointer; \}/)
  expect(gui).toMatch(/\.fazuh-wd button:focus-visible \{ outline: 2px solid currentColor; outline-offset: 2px; \}/)
  expect(gui).toMatch(/\.fazuh-wd \[data-component="text-input-v2"\]:focus-visible, \.fazuh-wd \[data-component="select-v2"\]:focus-visible/)
})

test("the empty states are named fallbacks, not blank regions", () => {
  expect(gui).toContain("No abort operations recorded.")
  expect(gui).toContain("No session is covered by more than one active operation.")
  expect(gui).toMatch(/<p role="status">Loading Watchdog…<\/p>/)
})

test("the overlaps section carries the covering-ban honesty sentence", () => {
  expect(gui).toContain("Releasing one operation keeps every other covering operation's ban in force")
  expect(gui).toMatch(/covered by \{row\.operations\} active operations/)
})

test("release and release-and-continue go through the controller, one operation per click", () => {
  expect(gui).toMatch(/controller\.release\(operation\.id, false\)/)
  expect(gui).toMatch(/controller\.release\(operation\.id, true\)/)
  expect(gui).toContain("Release &amp; continue")
  // A released operation offers neither button.
  expect(gui).toMatch(/operation\.released !== undefined/)
  expect(controller).not.toMatch(/for .* of .*covered/)
})

test("the page's secrets are presence-flag-only fields", () => {
  expect(gui).toMatch(/title="Receipts webhook"[\s\S]*?present=\{cfg\.receiptsWebhookPresent\}/)
  expect(gui).toMatch(/title="Supervisor endpoint"[\s\S]*?present=\{cfg\.supervisorEndpointPresent\}/)
  expect(gui).not.toMatch(/value=\{[^\n]*(receiptsWebhook|supervisorEndpoint)(Present)?/)
})

test("the page's status and controls come from the watchdog contract methods", () => {
  for (const method of ["watchdogStatus", "getWatchdogSettings", "setWatchdogSetting", "setWatchdogSecret", "abortOperations", "releaseOperation"]) {
    expect(gui).toContain(`rpc.${method}(input)`)
  }
})

test("the page renders an unreadable delivery queue as a state, never as queued-absence", () => {
  expect(gui).toMatch(/!state\(\)\.deliveryReadable/)
  expect(gui).toMatch(/The delivery queue could not be read/)
  // The per-row receipt line renders only from a present delivery row, so an
  // unreadable store can never masquerade as "no receipt queued".
  expect(gui).toMatch(/Show when=\{operation\.delivery\}/)
})

test("the GUI bundle stays clean of server-only modules: no fs reader crosses into the page", () => {
  const imports = gui.match(/^import .*$/gm) ?? []
  for (const line of imports) {
    expect(line).not.toContain("./watchdog-config.ts")
    expect(line).not.toContain("./watchdog-settings.ts")
    expect(line).not.toContain("./gui-rpc.ts")
    expect(line).not.toContain("./index.ts")
  }
  const controllerImports = controller.match(/^import .*$/gm) ?? []
  for (const line of controllerImports) {
    expect(line).not.toContain("node:fs")
    expect(line).not.toContain("./index.ts")
    expect(line).not.toContain("./gui-rpc.ts")
  }
})

test("the initial view state declares every field the page reads with .length or <For each>", () => {
  expect(gui).toMatch(/operations: \[\] as WatchdogOperationInfo\[\]/)
  expect(gui).toMatch(/operationsReadable: true/)
  expect(gui).toMatch(/busy: undefined as string \| undefined/)
})
