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
