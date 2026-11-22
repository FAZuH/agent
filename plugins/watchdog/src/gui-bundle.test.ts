import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { join } from "node:path"

const realRequire = createRequire(import.meta.url)
const Panel = { registry: "panel" }
const MenuItem = { registry: "menu-item" }

test("the shipped GUI registers jev-view-v1 and its session panel launcher", () => {
  const panels: any[] = []
  const menus: any[] = []
  const opened: unknown[] = []
  const session = { id: "ses_desktop", server: { id: "sidecar" } }
  const code = readFileSync(join(import.meta.dir, "../dist/gui-experimental.cjs"), "utf8")
  const module = { exports: {} as any }
  const host = {
    Plugin: { define: (plugin: unknown) => plugin },
    Panel,
    MenuItem,
    Style: {},
  }
  const require = (name: string) => {
    if (name === "@opencode/plugin/gui") return host
    if (name === "solid-js/web") return { template: () => () => {}, delegateEvents: () => {} }
    return realRequire(name)
  }
  new Function("require", "module", "exports", code)(require, module, module.exports)
  module.exports.default.setup({
    id: "fazuh.watchdog",
    add: (registry: unknown, item: any) => {
      if (registry === Panel) panels.push(item)
      if (registry === MenuItem) menus.push(item)
    },
    sessions: { current: () => session },
    layout: { state: () => "closed", open: (...args: unknown[]) => opened.push(args) },
  })

  const panel = panels.find((item) => item.id === "jev-view-v1")
  expect(panel?.region).toBe("side")
  expect(panel.list({ open: ["jev-view-v1"] })).toEqual([
    { id: "jev-view-v1", title: "Jev", closable: "compact" },
  ])
  expect(panel.list({ open: [] })).toEqual([])
  const menu = menus[0]()
  expect(menu.menu).toBe("session.panel")
  menu.run()
  expect(opened).toEqual([["fazuh.watchdog:jev-view-v1", session]])
})

test("the shipped GUI renders friendly setting titles and OpenCode-style rows", () => {
  const code = readFileSync(join(import.meta.dir, "../dist/gui-experimental.cjs"), "utf8")
  expect(code).toContain("Minimum probability")
  expect(code).toContain("Toast outcomes")
  expect(code).toContain("data-component=settings-list")
  expect(code).toContain("data-slot=settings-row-description")
})

test("the shipped GUI offers both tool-ban actions and friendly audit labels", () => {
  const code = readFileSync(join(import.meta.dir, "../dist/gui-experimental.cjs"), "utf8")
  expect(code).toContain("Lift tool ban")
  expect(code).toContain("Lift tool ban & resume")
  expect(code).toContain("Tool ban ·")
  expect(code).toContain("Raw verdict")
  expect(code).toContain("Decision note")
})

test("the shipped GUI registers the Watchdog page as its own panel with its own launcher", () => {
  const panels: any[] = []
  const menus: any[] = []
  const opened: unknown[] = []
  const session = { id: "ses_desktop", server: { id: "sidecar" } }
  const code = readFileSync(join(import.meta.dir, "../dist/gui-experimental.cjs"), "utf8")
  const module = { exports: {} as any }
  const host = {
    Plugin: { define: (plugin: unknown) => plugin },
    Panel,
    MenuItem,
    Style: {},
  }
  const require = (name: string) => {
    if (name === "@opencode/plugin/gui") return host
    if (name === "solid-js/web") return { template: () => () => {}, delegateEvents: () => {} }
    return realRequire(name)
  }
  new Function("require", "module", "exports", code)(require, module, module.exports)
  module.exports.default.setup({
    id: "fazuh.watchdog",
    add: (registry: unknown, item: any) => {
      if (registry === Panel) panels.push(item)
      if (registry === MenuItem) menus.push(item)
    },
    sessions: { current: () => session },
    layout: { state: () => "closed", open: (...args: unknown[]) => opened.push(args) },
  })

  expect(panels.map((item) => item.id)).toEqual(["jev-view-v1", "watchdog-view-v1"])
  const panel = panels.find((item) => item.id === "watchdog-view-v1")
  expect(panel?.region).toBe("side")
  expect(panel?.mobile.order).toBe(52)
  expect(panel.list({ open: ["watchdog-view-v1"] })).toEqual([
    { id: "watchdog-view-v1", title: "Watchdog", closable: "compact" },
  ])
  expect(panel.list({ open: ["jev-view-v1"] })).toEqual([])
  const menu = menus[1]()
  expect(menu.menu).toBe("session.panel")
  expect(menu.title).toBe("Watchdog")
  menu.run()
  expect(opened).toEqual([["fazuh.watchdog:watchdog-view-v1", session]])
})

test("the shipped Watchdog page carries the status chips, the overlap honesty sentence, and the recovery actions", () => {
  const code = readFileSync(join(import.meta.dir, "../dist/gui-experimental.cjs"), "utf8")
  expect(code).toContain("Pending review")
  expect(code).toContain("Admission waiting")
  expect(code).toContain("Effective bans")
  expect(code).toContain("Incomplete containment")
  expect(code).toContain("Releasing one operation keeps every other covering operation's ban in force")
  expect(code).toContain("Release & continue")
  expect(code).toContain("Turn Watchdog on")
  expect(code).toContain("Receipts webhook")
  expect(code).toContain("Supervisor endpoint")
  expect(code).toContain("Chain timing")
  expect(code).toContain("Admission cap")
  expect(code).toContain("Jev collection window")
  expect(code).toContain("Supervisor collection window")
  expect(code).toContain("Loading Watchdog…")
})

test("the shipped Watchdog page carries the corrected alert gate, focus CSS, and empty fallbacks", () => {
  const code = readFileSync(join(import.meta.dir, "../dist/gui-experimental.cjs"), "utf8")
  // The alert's compiled gate reads the view state's operationsReadable field;
  // the attempt-1 bundle shipped a gate on a status-only field, which is
  // undefined on the view state, so the alert fired on every healthy load.
  expect(code).toMatch(/get when\(\)\{return![a-z]+\(\)\.operationsReadable\}/)
  expect(code).not.toMatch(/get when\(\)\{return![a-z]+\(\)\.recordsReadable\}/)
  // The healthy-load default travels into the bundle: readable until a load
  // says otherwise, so the alert cannot fire before the first load.
  expect(code).toContain("operationsReadable:!0")
  expect(code).toContain(".fazuh-wd button:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }")
  expect(code).toContain(
    '.fazuh-wd [data-component="text-input-v2"]:focus-visible, .fazuh-wd [data-component="select-v2"]:focus-visible { outline: 2px solid var(--v2-border-border-focus, #e0a458); outline-offset: -1px; }',
  )
  expect(code).toContain("No abort operations recorded")
  expect(code).toContain("No session is covered by more than one active operation")
})

test("the shipped Watchdog page is gated off by default and never binds a secret value", () => {
  const code = readFileSync(join(import.meta.dir, "../dist/gui-experimental.cjs"), "utf8")
  // The off gate travels into the bundle: every control below the enablement
  // switch binds the page's off state to its disabled prop.
  const gated = code.match(/get disabled\(\)\{return ?[a-z]\(\)/g) ?? []
  expect(gated.length).toBeGreaterThanOrEqual(12)
  // Secret fields render a presence state, never a stored value: no binding
  // ever reads the webhook itself. (The Contract schema's `value` property name
  // near the enum is not a binding.)
  expect(code).toContain("MISSING")
  expect(code).not.toMatch(/value[:=][^,;]{0,20}receiptsWebhook/i)
})
