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
const { Contract } = await import("../../../lib/jev/rpc.ts")
const { CHAIN_LOG_HOOKS, JEV_FEATURES, JEV_LOG_HOOKS, WATCHDOG_FEATURES } = await import("./feature-families.ts")

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

test("every feature hook has a deliberate call-log home", () => {
  // A Jev feature's rows are model calls, so the default `/jev-log` must show
  // them; a watchdog feature writes audit rows, so it must not. A feature added
  // on either side fails here until its log home is chosen.
  for (const hook of JEV_FEATURES) expect(JEV_LOG_HOOKS).toContain(hook)
  for (const hook of WATCHDOG_FEATURES) expect(JEV_LOG_HOOKS).not.toContain(hook)
  for (const hook of [...JEV_FEATURES, ...WATCHDOG_FEATURES]) {
    expect(CHAIN_LOG_HOOKS).not.toContain(hook)
  }
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

test("the page lists pending human reviews, empty-safe and unreadable-safe", () => {
  expect(gui).toContain("Pending human reviews")
  // The empty line claims absence only when the ledger was read: an unreadable
  // ledger is a different operator fact and gets its own sentence.
  expect(gui).toMatch(/when=\{!watch\?\.pending\.durableUnreadable && \(watch\?\.pending\.reviews \?\? \[\]\)\.length === 0\}/)
  expect(gui).toContain("No pending human reviews.")
  expect(gui).toContain("this list may be incomplete, not empty")
  // A row is the display fields and an age.
  expect(gui).toContain("{row.sessionID}")
  expect(gui).toMatch(/\{row\.tool\} · \{row\.action\} · \{row\.stage\} · \{ageText\(row\.ageMs\)\}/)
})

test("an interrupted row is named and offers no reopen; a live row reopens through the controller", () => {
  // A restart-reported review's call did not survive, so nothing can answer it.
  expect(gui).toContain("Interrupted by a restart")
  expect(gui).toMatch(/<Show when=\{row\.interrupted\}>[\s\S]{0,240}?Interrupted by a restart/)
  expect(gui).toMatch(/<Show when=\{!row\.interrupted\}>[\s\S]{0,400}?controller\.reopen\(row\.id\)/)
  // Reopening goes through the contract method, never a local card.
  expect(gui).toMatch(/reopenPendingReview: \(input\) => rpc\.reopenPendingReview\(input\)/)
  expect(controller).toContain("reopenPendingReview({ itemID })")
})

test("the chain switch and the ask routing are the page's two activation settings", () => {
  // The switch is persisted state the page writes; the gate state beside it comes
  // from the live status, never from the switch.
  expect(gui).toMatch(/title="Review chain"[\s\S]{0,400}?checked=\{cfg\.persisted\.chain\}/)
  expect(gui).toMatch(/title="Review chain"[\s\S]{0,500}?put\("chain", !cfg\.persisted\.chain\)/)
  expect(gui).toMatch(/title="Review chain"[\s\S]{0,400}?chainGate\(\)/)
  expect(gui).toMatch(/title="Ask routing"[\s\S]{0,400}?value=\{cfg\.effective\.askMode\}/)
  expect(gui).toMatch(/options=\{\[\["judged", "Judged"\], \["immediate", "Immediate"\]\]\}/)
  expect(gui).toMatch(/onSelect=\{\(v\) => put\("askMode", v\)\}/)
  // Both sit under the page's own off state, like every other control.
  const block = gui.slice(gui.indexOf('title="Review chain"'), gui.indexOf('title="Jev review node"'))
  expect(block.match(/disabled=\{off\(\)\}/g) ?? []).toHaveLength(2)
})

test("the review line names the operator switch, and the gate state only when the switch lets it be read", () => {
  // The switch is persisted now, so the off line cannot blame the environment.
  expect(gui).toContain("Review chain off: the review switch is off")
  expect(gui).toContain("Capability: not checked while the review switch is off.")
  expect(gui).toContain("Capability: the capability gate passed.")
})

test("the chain note claims a passed gate only when the chain is enabled and wired", () => {
  // `wired` reports the wrapper's registration, which exists with the switch off
  // too. The note must not turn that into a gate claim while the gate is unread.
  expect(gui).toMatch(/watch\?\.chain\?\.status === "passed" && watch\.chain\.wired \? " \(the capability gate passed\)"/)
  expect(gui).not.toMatch(/watch\?\.chain && watch\.chain\.wired \?/)
})

test("the review line claims availability only when the host wired the wrapper", () => {
  // `status` passed with `wired` false is a real state: the host refused the
  // registration and the switch was turned on afterwards. Nothing is reviewed
  // then, so the page must not say the chain is available.
  expect(gui).toMatch(/if \(chain\.status === "passed"\) return chain\.wired \?/)
  expect(gui).not.toMatch(/if \(chain\.status === "passed"\) return `Review chain available/)
  expect(gui).toContain("Review chain not wired")
})

test("the settings contract carries the switch and the ask mode, persisted and effective", () => {
  const settings = (Contract.methods.getWatchdogSettings.output.properties as any)
  for (const side of ["persisted", "effective"]) {
    expect(settings[side].properties.chain.type).toBe("boolean")
    expect(settings[side].properties.askMode.enum).toEqual(["judged", "immediate"])
    expect(settings[side].required).toContain("chain")
    expect(settings[side].required).toContain("askMode")
  }
  const key = (Contract.methods.setWatchdogSetting.input.properties as any).key
  expect(key.enum).toContain("chain")
  expect(key.enum).toContain("askMode")
})

test("the status contract carries the pending review rows, and the contract has the reopen method", () => {
  const pending = (Contract.methods.watchdogStatus.output.properties as any).pending
  expect(pending.required).toContain("reviews")
  const row = pending.properties.reviews.items
  expect(row.required.slice().sort()).toEqual(["action", "ageMs", "id", "interrupted", "sessionID", "stage", "tool"])
  expect(row.properties.ageMs.type).toEqual(["number", "null"])
  expect(row.properties.interrupted.type).toBe("boolean")
  expect(row.additionalProperties).toBe(false)
  const reopen = (Contract.methods as any).reopenPendingReview
  expect(reopen.input.required).toEqual(["itemID"])
  expect(reopen.input.properties.itemID.type).toBe("string")
  expect(reopen.output.required.slice().sort()).toEqual(["ok", "reopened"])
  expect(reopen.output.properties.reason.type).toBe("string")
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
