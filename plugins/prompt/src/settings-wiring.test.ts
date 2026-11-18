/**
 * Source-level guards for the Prompt settings slice. Unit mocks of the RPC
 * object cannot see a missing contract method, tab, or wrapper forward, so
 * these read the sources directly. Every assertion below fails on the
 * pre-settings version of the file it inspects.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

const src = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), "utf8")

describe("Prompt settings RPC contract", () => {
  test("rpc.ts declares getSettings, setSetting, a sidebar|showPrompts key enum, and a topic on changed", () => {
    const rpc = src("rpc.ts")
    expect(rpc).toMatch(/\bgetSettings\s*:\s*\{/)
    expect(rpc).toMatch(/\bsetSetting\s*:\s*\{/)
    expect(rpc, "key enum must be exactly the two real settings").toMatch(
      /\bkey\s*:\s*\{[\s\S]*?enum\s*:\s*\[\s*"sidebar"\s*,\s*"showPrompts"\s*\]/,
    )
    expect(rpc, "changed event must carry a topic so settings emit is distinguishable").toMatch(
      /required:\s*\[\s*"topic"\s*\]/,
    )
  })
})

describe("Prompt settings server handlers", () => {
  test("index.ts registers both handlers, backs them with the settings store, and emits changed(settings)", () => {
    const index = src("index.ts")
    expect(index).toMatch(/\bgetSettings\s*:\s*async/)
    expect(index).toMatch(/\bsetSetting\s*:\s*async/)
    expect(index, "server must use a persisted settings store").toMatch(/\breadSettings\b/)
    expect(index, "server must use a persisted settings store").toMatch(/\bwriteSetting\b/)
    expect(index, "mutation must emit the changed event with topic settings").toMatch(
      /emit\(\s*["']changed["']\s*,\s*\{\s*topic\s*:\s*["']settings["']/,
    )
  })
})

describe("Prompt settings GUI controller", () => {
  test("PromptTab includes settings and the view state carries SettingsInfo", () => {
    const controller = src("gui-controller.ts")
    expect(controller, "settings must be a panel tab").toMatch(/"dismissed"\s*\|\s*"settings"/)
    expect(controller, "controller must expose the SettingsInfo type").toMatch(/SettingsInfo/)
    expect(controller, "view state must expose settings").toMatch(/\bsettings\??\s*:\s*SettingsInfo/)
  })

  test("the controller RPC surface and mutations forward getSettings/setSetting", () => {
    const controller = src("gui-controller.ts")
    expect(controller).toMatch(/\bgetSettings\s*\(\s*\)\s*:\s*Promise<\s*SettingsInfo\s*>/)
    expect(controller).toMatch(/\bsetSetting\s*\(\s*input\s*:/)
    expect(controller, "controller must load settings").toMatch(/async\s+(function\s+)?loadSettings/)
    expect(controller, "controller must expose a settings mutation").toMatch(/async\s+setSetting/)
  })
})

describe("Prompt settings GUI panel", () => {
  test("gui.tsx initialises settings, shows a Settings tab, and wires both toggles", () => {
    const gui = src("gui.tsx")
    expect(gui, "initial signal must declare settings").toMatch(/settings:\s*DEFAULT_SETTINGS/)
    expect(gui, "tab bar must contain a Settings tab").toMatch(/key:\s*"settings",\s*label:\s*"Settings"/)
    expect(gui, "wrapper must forward getSettings").toMatch(/getSettings:\s*\(\)\s*=>\s*rpc\.getSettings\(\{\}\)/)
    expect(gui, "wrapper must forward setSetting").toMatch(/setSetting:\s*\(input\)\s*=>\s*rpc\.setSetting\(input\)/)
    expect(gui, "settings view must load on mount").toMatch(/view\.loadSettings\(\)/)
    expect(gui, "toggles must call the controller mutation").toMatch(/view\.setSetting\(/)
    expect(gui, "toggles must use switch controls").toContain('role="switch"')
  })
})

describe("Prompt settings TUI alignment", () => {
  test("tui.tsx openSettings reads and writes the shared RPC settings store", () => {
    const tui = src("tui.tsx")
    expect(tui, "TUI settings must read the shared store").toMatch(/rpc\.getSettings\(\)/)
    expect(tui, "TUI settings must write the shared store").toMatch(/rpc\.setSetting\(/)
  })
})
