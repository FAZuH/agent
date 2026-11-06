/**
 * grim capture for the trigger. The screenshot is written to the state dir,
 * not /tmp, because the prompt resolves the file when it is admitted and the
 * agent may read it again while answering.
 */
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs"
import { join } from "node:path"

import { shotsDir } from "./state.ts"

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
  let region = opts.region?.trim() || undefined
  if (opts.window) {
    const focused = activeWindow()
    if (!focused.region) return { ok: false, error: "no focused window to capture" }
    region = focused.region
  }

  const dir = shotsDir(opts.root)
  try {
    mkdirSync(dir, { recursive: true })
  } catch (error) {
    return { ok: false, error: `cannot create ${dir}: ${message(error)}` }
  }

  const stamp = opts.now ?? Date.now()
  const path = join(dir, `${stamp}.png`)
  const args = ["grim"]
  if (region) args.push("-g", region)
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
