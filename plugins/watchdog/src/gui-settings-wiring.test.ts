/** Source-level guards for the Settings tab. All assertions fail against the
 *  pre-change gui.tsx / rpc.ts / gui-rpc.ts. */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

const gui = readFileSync(new URL("./gui.tsx", import.meta.url), "utf8")
const controller = readFileSync(new URL("./gui-controller.ts", import.meta.url), "utf8")
const rpc = readFileSync(new URL("../../../lib/jev/rpc.ts", import.meta.url), "utf8")
const server = readFileSync(new URL("./gui-rpc.ts", import.meta.url), "utf8")

describe("Jev Desktop Settings tab wiring", () => {
  test("gui.tsx tab union and tab bar include settings", () => {
    expect(gui).toMatch(/createSignal<"blocked" \| "features" \| "calls" \| "settings">/)
    expect(gui).toMatch(/selectTab\("settings"\)/)
  })

  test("gui.tsx initial view state declares settings", () => {
    expect(gui).toMatch(/settings:\s*undefined as SettingsInfo/)
  })

  test("RPC wrapper forwards the three settings methods", () => {
    for (const method of ["getSettings", "setSetting", "setSecret"]) {
      expect(gui, `wrapper must forward ${method}`).toMatch(
        new RegExp(`${method}:\\s*\\(input\\)\\s*=>\\s*rpc\\.${method}\\(input\\)`),
      )
    }
  })

  test("lib/jev/rpc.ts declares the three settings methods", () => {
    for (const method of ["getSettings", "setSetting", "setSecret"]) {
      expect(rpc, `contract must declare ${method}`).toMatch(new RegExp(`^\\s{4}${method}:\\s*\\{`, "m"))
    }
  })

  test("gui-rpc.ts wires the three handlers and emits settings changes", () => {
    for (const method of ["getSettings", "setSetting", "setSecret"]) {
      expect(server, `server must register ${method}`).toMatch(new RegExp(`^\\s{4}${method}:\\s*async`, "m"))
    }
    expect(server).toContain('changed("settings")')
  })

  test("controller loads settings and exposes the mutations", () => {
    expect(controller).toMatch(/getSettings\(\{\}\)/)
    expect(controller).toMatch(/settings\?:\s*SettingsInfo/)
    for (const method of ["setSetting", "setSecret"]) {
      expect(controller, `controller must expose ${method}`).toMatch(new RegExp(`${method}:\\s*\\(input`))
    }
  })

  test("secret values are never bound to a rendered input value", () => {
    expect(gui, "secret inputs must be password fields").toContain('type="password"')
    expect(gui, "alertWebhook must be hidden in the per-feature loop").toContain('k !== "alertWebhook"')
    expect(gui, "the Jev settings loop only copies the Jev family's groups, so the supervisor endpoint and receipts webhook groups never render here").toMatch(/for \(const feature of JEV_FEATURES\) \{[\s\S]{0,160}?next\[feature\] = fields/)
    expect(gui).not.toMatch(/value=\{[^\n]*(apiKey|alertWebhook|secrets\.)/)
  })
})
