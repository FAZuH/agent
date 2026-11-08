/**
 * The GUI bundle against a fake host: the contract the app itself checks.
 * The app provides @opencode/plugin/gui at runtime, so a test cannot import
 * the bundle normally; evaluate it with a stub module and a fake ctx, then
 * assert the registration the host will read.
 *
 *   bun test src/gui-bundle.test.ts
 */

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { createRequire } from "node:module"

const root = join(import.meta.dir, "..")
const realRequire = createRequire(import.meta.url)

const Panel = { registry: "panel" } as const
const MenuItem = { registry: "menu-item" } as const
const Command = { registry: "command" } as const
const ComposerPill = { registry: "composer-pill" } as const
const Slot = { registry: "slot" } as const
const Style = { registry: "style" } as const

const stub = {
  Plugin: { define: (plugin: unknown) => plugin },
  Panel,
  MenuItem,
  Command,
  ComposerPill,
  Slot,
  Style,
  createKeyed: () => {},
  createLatest: () => ({ latest: undefined, loading: false, error: undefined }),
  usePlugin: () => ({}),
  bindPlugin: (value: unknown) => value,
  usePanel: () => undefined,
  useDrawer: () => undefined,
}

// The bundle compiles JSX with Solid's DOM runtime; the test has no DOM, so
// the runtime is stubbed. Rendering is not this test's job: registration is.
const web = {
  template: () => () => {},
  insert: () => {},
  effect: () => {},
  delegateEvents: () => {},
  setStyleProperty: () => {},
  createComponent: (component: unknown, props: unknown) =>
    typeof component === "function" ? (component as any)(props) : undefined,
}

function load(): any {
  const code = readFileSync(join(root, "dist/gui-experimental.cjs"), "utf8")
  const mod = { exports: {} as any }
  const require = (name: string) => {
    if (name === "@opencode/plugin/gui") return stub
    if (name === "solid-js/web") return web
    return realRequire(name)
  }
  new Function("require", "module", "exports", code)(require, mod, mod.exports)
  return mod.exports.default ?? mod.exports
}

describe("gui bundle", () => {
  test("registers the Reports panel and the + menu row", () => {
    const panels: any[] = []
    const menus: any[] = []
    const opened: Array<[string, any]> = []
    const session = { id: "ses_1", server: { id: "sidecar" } }
    const ctx = {
      id: "fazuh.report",
      add: (registry: unknown, item: any) => {
        if (registry === Panel) panels.push(typeof item === "function" ? item() : item)
        if (registry === MenuItem) menus.push(item)
        return () => {}
      },
      servers: { get: () => undefined },
      client: {},
      sessions: { current: () => session },
      layout: { state: () => "closed", open: (key: string, target: any) => opened.push([key, target]) },
      toast: { show: () => {} },
      t: (key: string) => key,
    }

    const plugin = load()
    expect(typeof plugin.setup).toBe("function")
    plugin.setup(ctx)

    const panel = panels.find((item) => item.id === "reports")
    expect(panel?.region).toBe("side")
    expect(panel.list({ open: ["reports"], session, screen: {} })).toHaveLength(1)
    expect(panel.list({ open: [], session, screen: {} })).toHaveLength(0)

    const menu = menus.map((item) => (typeof item === "function" ? item() : item)).find((item) => item?.id === "reports")
    expect(menu?.menu).toBe("session.panel")
    menu.run()
    expect(opened).toEqual([["fazuh.report:reports", session]])
  })
})
