/**
 * fazuh.desktop — screenshot, window, pointer, and keyboard control.
 *
 * Why this exists instead of an accessibility server: the `computer-use`
 * server drives Linux through AT-SPI2 only. On this desktop the a11y bus
 * carries no real apps (kitty, Brave, Steam, and every Wine window are absent)
 * and Hyprland implements no org.a11y.atspi.DeviceEventController, so neither
 * discovery nor input could work. The surfaces that do work are grim, hyprctl,
 * XTest (XWayland) and wtype (every client).
 *
 * Backends, and what each one reaches:
 *   screenshots  grim            every window, every monitor; grim -T captures a
 *                                toplevel by handle, so a window on another
 *                                workspace comes back without switching to it
 *   windows      hyprctl         every window, plus focus and geometry
 *   pointer      ydotool         every window, closed-loop against the real
 *                                cursor; XTest cannot target, because it moves
 *                                an X pointer the compositor ignores
 *   keyboard     wtype           every window (virtual-keyboard protocol)
 *                XTest           XWayland only, as a fallback
 *
 * Coordinates are absolute desktop pixels, the same ones grim screenshots use.
 */
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"

import { formatWindows, matchWindow, parseChord, parseRegion, type DeskWindow, type Point, type Windows } from "./shared.ts"

const XTEST = join(import.meta.dir, "xtest.py")
const SHOTS = "/tmp/opencode/shots"

interface Result {
  code: number
  out: string
  err: string
}

function run(cmd: string[]): Result {
  const r = spawnSync(cmd[0], cmd.slice(1), { encoding: "utf8", timeout: 20000 })
  return { code: r.status ?? -1, out: (r.stdout ?? "").trim(), err: (r.stderr ?? "").trim() }
}

function have(binary: string): boolean {
  return run(["sh", "-c", `command -v ${binary}`]).code === 0
}

/**
 * Where ydotoold listens.
 *
 * Arch's user unit runs bare `ydotoold`, which puts the socket in
 * $XDG_RUNTIME_DIR; an older build used /tmp. Check both rather than make the
 * caller care which one is running.
 */
function ydotoolSocket(): string | undefined {
  const uid = process.getuid?.() ?? 1000
  const candidates = [
    process.env.YDOTOOL_SOCKET,
    process.env.XDG_RUNTIME_DIR ? join(process.env.XDG_RUNTIME_DIR, ".ydotool_socket") : undefined,
    `/run/user/${uid}/.ydotool_socket`,
    "/tmp/.ydotool_socket",
  ].filter((path): path is string => Boolean(path))
  return candidates.find((path) => existsSync(path))
}

/** ydotool reaches Wayland clients, but only through its daemon. */
function ydotoolReady(): boolean {
  return have("ydotool") && Boolean(ydotoolSocket())
}

function monitors(): Array<{ id: number; x: number; y: number; width: number; height: number; scale: number }> {
  const r = run(["hyprctl", "monitors", "-j"])
  if (r.code !== 0) return []
  try {
    return JSON.parse(r.out)
  } catch {
    return []
  }
}

/**
 * Where the grim image starts in Hyprland layout coordinates.
 *
 * grim captures the output, so its (0,0) is the layout bounding box corner,
 * not the layout origin. On this desktop the monitor sits at a positive x, so
 * a screenshot pixel is a layout point only after this offset is added. Skip
 * it and every click lands short by the monitor offset.
 */
function originOf(list: Array<{ x: number; y: number }>): Point | undefined {
  if (!list.length) return undefined
  return { x: Math.min(...list.map((m) => m.x)), y: Math.min(...list.map((m) => m.y)) }
}

function layoutOrigin(): Point | undefined {
  return originOf(monitors())
}

function cursorPos(): Point | undefined {
  const r = run(["hyprctl", "cursorpos"])
  if (r.code !== 0) return undefined
  const match = /(-?\d+)\s*,\s*(-?\d+)/.exec(r.out)
  return match ? { x: Number(match[1]), y: Number(match[2]) } : undefined
}

function clamp(value: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, value))
}

/** Block this thread for `ms`. The loop is synchronous, so a busy wait is in place. */
function pause(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/** Read the pointer twice a settle apart and use the second reading, so a move still in flight is not reported as the position. */
function settledCursorPos(gap = 40): Point | undefined {
  const first = cursorPos()
  pause(gap)
  const second = cursorPos()
  if (!first || !second) return undefined
  return second
}

/**
 * Move the pointer to a screenshot coordinate, then prove it arrived.
 *
 * ydotool's virtual device advertises EV_REL only (no EV_ABS), so `--absolute`
 * does not work: it warps. Movement is relative, the gain is not 1:1, and
 * pointer acceleration is in the path. Closing the loop against
 * `hyprctl cursorpos` is the only honest way to land on a pixel — and the
 * caller must never click unless this returns ok, or the click goes wherever
 * the pointer happened to be.
 */
function movePointer(gx: number, gy: number): { ok: boolean; error?: string; pos?: Point } {
  const origin = layoutOrigin()
  if (!origin) return { ok: false, error: "no monitor layout from hyprctl" }
  const target: Point = { x: gx + origin.x, y: gy + origin.y }
  const tolerance = 2
  const arrived = (p: Point) => Math.abs(p.x - target.x) <= tolerance && Math.abs(p.y - target.y) <= tolerance

  let pos = settledCursorPos()
  if (!pos) return { ok: false, error: "hyprctl cursorpos failed" }

  for (let attempt = 0; attempt < 20; attempt++) {
    if (arrived(pos)) {
      // ydotool hands the event to the daemon and returns, so the movement that
      // produced this reading can still be in flight. Confirm before the caller
      // is allowed to press a button somewhere else.
      pause(60)
      const confirmed = cursorPos()
      if (!confirmed) return { ok: false, error: "lost the cursor position while confirming" }
      if (arrived(confirmed)) return { ok: true, pos: confirmed }
      pos = confirmed
      continue
    }

    const dx = target.x - pos.x
    const dy = target.y - pos.y

    // The device reports about two layout pixels per unit here; halving keeps
    // the loop stable whatever the real gain is.
    const ux = Math.trunc(clamp(dx / 2, 400))
    const uy = Math.trunc(clamp(dy / 2, 400))
    const stepX = ux === 0 ? Math.sign(dx) : ux
    const stepY = uy === 0 ? Math.sign(dy) : uy

    const moved = run(["ydotool", "mousemove", "-x", String(stepX), "-y", String(stepY)])
    if (moved.code !== 0) return { ok: false, error: moved.err || "ydotool mousemove failed" }

    pause(35)
    const next = cursorPos()
    if (!next) return { ok: false, error: "lost the cursor position" }
    pos = next
  }

  return { ok: false, error: `pointer stuck at ${pos.x},${pos.y}, wanted ${target.x},${target.y}` }
}

function windows(): Windows {
  const r = run(["hyprctl", "clients", "-j"])
  if (r.code !== 0) return { found: false, error: r.err || "hyprctl clients failed", list: [] }
  let raw: any[]
  try {
    raw = JSON.parse(r.out)
  } catch {
    return { found: false, error: "hyprctl clients returned no JSON", list: [] }
  }
  const list: DeskWindow[] = raw.map((c: any) => {
    const cls = String(c.class ?? "")
    const title = String(c.title ?? "")
    return {
      address: String(c.address ?? ""),
      stableId: String(c.stableId ?? ""),
      class: cls,
      title,
      x: Number(c.at?.[0] ?? 0),
      y: Number(c.at?.[1] ?? 0),
      width: Number(c.size?.[0] ?? 0),
      height: Number(c.size?.[1] ?? 0),
      workspace: String(c.workspace?.name ?? c.workspace?.id ?? ""),
      monitor: Number(c.monitor ?? -1),
      focused: Number(c.focusHistoryID ?? -1) === 0,
      xwayland: Boolean(c.xwayland),
    }
  })
  return { found: true, list }
}

function activeClass(): string {
  const r = run(["hyprctl", "activewindow", "-j"])
  if (r.code !== 0) return ""
  try {
    return String(JSON.parse(r.out)?.class ?? "")
  } catch {
    return ""
  }
}

const CLICK_MASK: Record<string, string> = { left: "0xC0", right: "0xC1", middle: "0xC2" }

function ok(content: string) {
  return { content }
}

function fail(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return { content: `failed: ${message}` }
}

export default {
  id: "fazuh.desktop",
  setup: async (ctx: any) => {
    await ctx.tool.transform((tools: any) => {
      tools.add({
        name: "desktop_windows",
        description:
          "List every window: address, class, title, size, position, workspace, focus, and whether it is XWayland (keyboard falls back to XTest) or Wayland-native (wtype).",
        input: { type: "object", properties: {}, additionalProperties: false },
        execute: async () => {
          try {
            const found = windows()
            if (!found.found) return ok(`failed: ${found.error}`)
            return ok(formatWindows(found.list))
          } catch (error) {
            return fail(error)
          }
        },
      })

      tools.add({
        name: "desktop_screenshot",
        description:
          "Capture the screen with grim and return the PNG path. Pass window to capture just that window, even while it sits on another workspace or behind another window. Region is in image pixels: 'WxH' from the image origin, or 'X,Y WxH'. Image pixels are the coordinates desktop_click takes, so a full-screen shot clicks as-is; region and window captures report the offset to add.",
        input: {
          type: "object",
          properties: {
            window: {
              type: "string",
              description: "Address from desktop_windows ('0x…'), 'class:NAME', 'title:SUBSTR', or a bare class/title substring.",
            },
            region: { type: "string", description: "'WxH' from the image origin, or 'X,Y WxH'; image pixels. Omit for all monitors." },
            path: { type: "string", description: "Where to write the PNG. Defaults under /tmp/opencode/shots." },
          },
          additionalProperties: false,
        },
        execute: async (input: any) => {
          try {
            mkdirSync(SHOTS, { recursive: true })
            const target = String(input?.path ?? join(SHOTS, `desktop-${Date.now()}.png`))
            const wanted = String(input?.window ?? "").trim()
            const region = String(input?.region ?? "").trim()
            if (wanted && region) return ok("failed: give window or region, not both")

            // grim renders at the output scale, so on this 1.25x panel both a
            // region and a toplevel come back larger than the layout and every
            // click lands short. Ask for layout-sized pixels instead, whichever
            // capture path is taken.
            if (wanted) {
              const found = windows()
              if (!found.found) return ok(`failed: ${found.error}`)
              const win = matchWindow(found.list, wanted)
              if (!win) return ok(`no window matches ${JSON.stringify(wanted)}`)
              if (!win.stableId) return ok(`failed: ${win.class} exposes no toplevel handle to capture`)
              const list = monitors()
              const scale = list.find((m) => m.id === win.monitor)?.scale ?? 1
              const r = run(["grim", "-s", String(1 / scale), "-T", win.stableId, target])
              if (r.code !== 0) return ok(`grim failed: ${r.err || "unknown error"}`)
              const origin = originOf(list) ?? { x: 0, y: 0 }
              return ok(
                `${target}\ncaptured ${win.class} "${win.title}" ${win.width}x${win.height} on ws ${win.workspace}\n` +
                  `to click at an image pixel add ${win.x - origin.x},${win.y - origin.y}`,
              )
            }

            if (region) {
              const crop = parseRegion(region)
              if (!crop) return ok(`failed: region must be 'WxH' or 'X,Y WxH', got ${JSON.stringify(region)}`)
              const origin = layoutOrigin()
              if (!origin) return ok("failed: no monitor layout from hyprctl")
              const geometry = `${origin.x + crop.x},${origin.y + crop.y} ${crop.width}x${crop.height}`
              const r = run(["grim", "-s", "1", "-g", geometry, target])
              if (r.code !== 0) return ok(`grim failed: ${r.err || "unknown error"}`)
              return ok(`${target}\nto click at a region pixel add ${crop.x},${crop.y}`)
            }

            const r = run(["grim", "-s", "1", target])
            if (r.code !== 0) return ok(`grim failed: ${r.err || "unknown error"}`)
            return ok(target)
          } catch (error) {
            return fail(error)
          }
        },
      })

      tools.add({
        name: "desktop_focus",
        description:
          "Raise and focus a window. Target is an address from desktop_windows ('0x…'), 'class:NAME', 'title:SUBSTR', or a bare class/title substring.",
        input: {
          type: "object",
          properties: { target: { type: "string", description: "Window address, class:, title:, or substring." } },
          required: ["target"],
          additionalProperties: false,
        },
        execute: async (input: any) => {
          try {
            const found = windows()
            if (!found.found) return ok(`failed: ${found.error}`)
            const target = matchWindow(found.list, String(input?.target ?? ""))
            if (!target) return ok(`no window matches ${JSON.stringify(input?.target)}`)
            const r = run([
              "hyprctl",
              "dispatch",
              `hl.dsp.focus({ window = "address:${target.address}" })`,
            ])
            if (r.code !== 0 || /error|not found/i.test(r.err + r.out)) {
              return ok(`focus failed: ${r.err || r.out}`)
            }
            return ok(`focused ${target.address} ${target.class} "${target.title}"`)
          } catch (error) {
            return fail(error)
          }
        },
      })

      tools.add({
        name: "desktop_click",
        description:
          "Click at a screenshot coordinate. The pointer is moved and verified first; nothing is clicked if it cannot be confirmed at the target. Requires ydotool and a running ydotoold.",
        input: {
          type: "object",
          properties: {
            x: { type: "number" },
            y: { type: "number" },
            button: { type: "string", description: "left, middle, or right. Default left." },
            count: { type: "number", description: "Click count, default 1." },
          },
          required: ["x", "y"],
          additionalProperties: false,
        },
        execute: async (input: any) => {
          try {
            if (!ydotoolReady()) return ok(`click failed: ydotool is not available (ydotool binary plus a running ydotoold)`)
            const x = Number(input.x)
            const y = Number(input.y)
            const button = String(input?.button ?? "left")
            const count = Number(input?.count ?? 1)

            const moved = movePointer(x, y)
            if (!moved.ok) return ok(`click aborted: ${moved.error}`)

            const clicked = run(["ydotool", "click", CLICK_MASK[button] ?? CLICK_MASK.left, "-r", String(count)])
            if (clicked.code !== 0) return ok(`click failed: ${clicked.err || "unknown error"}`)
            return ok(`clicked ${button} x${count} at ${x},${y}`)
          } catch (error) {
            return fail(error)
          }
        },
      })

      tools.add({
        name: "desktop_move",
        description:
          "Move the pointer to a screenshot coordinate and report where it actually landed. Requires ydotool and a running ydotoold.",
        input: {
          type: "object",
          properties: { x: { type: "number" }, y: { type: "number" } },
          required: ["x", "y"],
          additionalProperties: false,
        },
        execute: async (input: any) => {
          try {
            if (!ydotoolReady()) return ok(`move failed: ydotool is not available (ydotool binary plus a running ydotoold)`)
            const x = Number(input.x)
            const y = Number(input.y)
            const moved = movePointer(x, y)
            if (!moved.ok) return ok(`move failed: ${moved.error}`)
            return ok(`pointer at ${x},${y}`)
          } catch (error) {
            return fail(error)
          }
        },
      })

      tools.add({
        name: "desktop_drag",
        description:
          "Press at one screenshot coordinate, move to another, release. Both points are verified before the button goes down or comes up. Requires ydotool.",
        input: {
          type: "object",
          properties: {
            from_x: { type: "number" },
            from_y: { type: "number" },
            to_x: { type: "number" },
            to_y: { type: "number" },
          },
          required: ["from_x", "from_y", "to_x", "to_y"],
          additionalProperties: false,
        },
        execute: async (input: any) => {
          try {
            if (!ydotoolReady()) return ok(`drag failed: ydotool is not available (ydotool binary plus a running ydotoold)`)
            const fx = Number(input.from_x)
            const fy = Number(input.from_y)
            const tx = Number(input.to_x)
            const ty = Number(input.to_y)

            const start = movePointer(fx, fy)
            if (!start.ok) return ok(`drag aborted before pressing: ${start.error}`)

            const down = run(["ydotool", "click", "0x40"])
            if (down.code !== 0) return ok(`drag failed: ${down.err || "unknown error"}`)

            const end = movePointer(tx, ty)
            const up = run(["ydotool", "click", "0x80"])
            if (!end.ok) return ok(`drag released at ${end.pos?.x},${end.pos?.y}: ${end.error}`)
            if (up.code !== 0) return ok(`drag failed: ${up.err || "unknown error"}`)
            return ok(`dragged ${fx},${fy} to ${tx},${ty}`)
          } catch (error) {
            return fail(error)
          }
        },
      })

      tools.add({
        name: "desktop_scroll",
        description:
          "Move the pointer to a screenshot coordinate and turn the wheel there. Positive amount scrolls up. Requires ydotool.",
        input: {
          type: "object",
          properties: {
            x: { type: "number" },
            y: { type: "number" },
            amount: { type: "number", description: "Wheel steps; positive is up." },
          },
          required: ["x", "y", "amount"],
          additionalProperties: false,
        },
        execute: async (input: any) => {
          try {
            if (!ydotoolReady()) return ok(`scroll failed: ydotool is not available (ydotool binary plus a running ydotoold)`)
            const x = Number(input.x)
            const y = Number(input.y)
            const amount = Number(input.amount)

            const moved = movePointer(x, y)
            if (!moved.ok) return ok(`scroll aborted: ${moved.error}`)

            const r = run(["ydotool", "mousemove", "--wheel", "-y", String(amount)])
            if (r.code !== 0) return ok(`scroll failed: ${r.err || "unknown error"}`)
            return ok(`scrolled ${amount} at ${x},${y}`)
          } catch (error) {
            return fail(error)
          }
        },
      })

      tools.add({
        name: "desktop_type",
        description: "Type text into the focused window. wtype reaches any client; XTest is the XWayland fallback.",
        input: {
          type: "object",
          properties: { text: { type: "string", description: "Text to type, newline included as Enter." } },
          required: ["text"],
          additionalProperties: false,
        },
        execute: async (input: any) => {
          try {
            const text = String(input?.text ?? "")
            if (!text) return ok("nothing to type")
            let r = run(["wtype", "--", text])
            if (r.code !== 0) r = run(["python3", XTEST, "type", text])
            if (r.code !== 0) return ok(`type failed: ${r.err || "unknown error"}`)
            return ok(`typed ${text.length} chars`)
          } catch (error) {
            return fail(error)
          }
        },
      })

      tools.add({
        name: "desktop_key",
        description:
          "Press a key or chord in the focused window, e.g. 'Return', 'Escape', 'ctrl+shift+t', 'super+1', 'F8'. wtype first, XTest fallback.",
        input: {
          type: "object",
          properties: { key: { type: "string", description: "Keysym or chord joined with '+'." } },
          required: ["key"],
          additionalProperties: false,
        },
        execute: async (input: any) => {
          try {
            const spec = String(input?.key ?? "")
            const chord = parseChord(spec)
            const wtypeArgs = ["wtype"]
            for (const mod of chord.mods) wtypeArgs.push("-M", mod)
            wtypeArgs.push("-k", chord.key)
            for (const mod of [...chord.mods].reverse()) wtypeArgs.push("-m", mod)

            let r = run(wtypeArgs)
            if (r.code !== 0) r = run(["python3", XTEST, "key", chord.key, ...chord.mods])
            if (r.code !== 0) return ok(`key failed: ${r.err || "unknown error"}`)
            return ok(`pressed ${spec} (focus: ${activeClass() || "unknown"})`)
          } catch (error) {
            return fail(error)
          }
        },
      })
    })
  },
}
