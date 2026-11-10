/**
 * grim capture for the trigger. The screenshot is written to the state dir,
 * not /tmp, because the prompt resolves the file when it is admitted and the
 * agent may read it again while answering.
 */
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs"
import { join } from "node:path"

import { shotsDir } from "./state.ts"
import { parseRegion, toLayout } from "./region.ts"

export type CaptureResult = { ok: true; path: string } | { ok: false; error: string }

export interface WindowInfo {
  label?: string
  region?: string
}

/** Class, title, and layout geometry of the focused window. */
export function activeWindow(): WindowInfo {
  const r = spawnSync("hyprctl", ["activewindow", "-j"], { encoding: "utf8", timeout: 5000 })
  if (r.status !== 0) return {}
  try {
    const w = JSON.parse(r.stdout ?? "{}")
    if (!w || typeof w.class !== "string" || !w.class) return {}
    const at = Array.isArray(w.at) ? w.at : []
    const size = Array.isArray(w.size) ? w.size : []
    const [x, y] = at
    const [width, height] = size
    const region =
      Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
        ? `${x},${y} ${width}x${height}`
        : undefined
    return { label: w.title ? `${w.class} - ${w.title}` : w.class, region }
  } catch {
    return {}
  }
}

/** Where Hyprland layout (0,0) sits; grim -g takes layout coordinates, not image ones. */
function layoutOrigin(): { x: number; y: number } | undefined {
  const r = spawnSync("hyprctl", ["monitors", "-j"], { encoding: "utf8", timeout: 5000 })
  if (r.status !== 0) return undefined
  try {
    const list = JSON.parse(r.stdout ?? "[]")
    if (!Array.isArray(list) || !list.length) return undefined
    return { x: Math.min(...list.map((m) => Number(m.x ?? 0))), y: Math.min(...list.map((m) => Number(m.y ?? 0))) }
  } catch {
    return undefined
  }
}

/** Keep the newest `keep` shots. */
export function prune(dir: string, keep = 50): void {
  let names: string[]
  try {
    names = readdirSync(dir).filter((name) => name.endsWith(".png"))
  } catch {
    return
  }
  if (names.length <= keep) return
  const ranked = names
    .map((name) => {
      const path = join(dir, name)
      let mtime = 0
      try {
        mtime = statSync(path).mtimeMs
      } catch {}
      return { path, mtime }
    })
    .sort((a, b) => b.mtime - a.mtime)
  for (const entry of ranked.slice(keep)) {
    try {
      unlinkSync(entry.path)
    } catch {}
  }
}

export interface CaptureOptions {
  root: string
  region?: string
  window?: boolean
  now?: number
}

export function capture(opts: CaptureOptions): CaptureResult {
  let geometry: string | undefined
  if (opts.window) {
    const focused = activeWindow()
    if (!focused.region) return { ok: false, error: "no focused window to capture" }
    geometry = focused.region
  } else if (opts.region?.trim()) {
    const region = parseRegion(opts.region)
    if (!region) return { ok: false, error: "region must be 'WxH' or 'X,Y WxH'" }
    const origin = layoutOrigin()
    if (!origin) return { ok: false, error: "no monitor layout from hyprctl" }
    geometry = toLayout(region, origin)
  }

  const dir = shotsDir(opts.root)
  try {
    mkdirSync(dir, { recursive: true })
  } catch (error) {
    return { ok: false, error: `cannot create ${dir}: ${message(error)}` }
  }

  const stamp = opts.now ?? Date.now()
  const path = join(dir, `${stamp}.png`)
  // -s 1 makes image pixels layout pixels, matching desktop-control, so a shot
  // is not 1.25x larger than the coordinates anything else reports.
  const args = ["grim", "-s", "1"]
  if (geometry) args.push("-g", geometry)
  args.push(path)

  const r = spawnSync(args[0], args.slice(1), { encoding: "utf8", timeout: 20000 })
  if (r.status !== 0) {
    const detail = (r.stderr ?? "").trim() || `grim exited ${r.status ?? "without a status"}`
    return { ok: false, error: detail }
  }
  if (!existsSync(path)) return { ok: false, error: "grim reported success but wrote no file" }
  prune(dir)
  return { ok: true, path }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
