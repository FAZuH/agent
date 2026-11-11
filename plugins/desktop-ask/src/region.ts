/**
 * Region specs are image pixels, the same ones a screenshot is read in. grim
 * wants Hyprland layout coordinates, so this is the one place that converts:
 * the layout origin is added here, never by the caller.
 */

export interface Region {
  x: number
  y: number
  width: number
  height: number
}

/** Read "WxH" (from the image origin) or "X,Y WxH" (from that image pixel). */
export function parseRegion(spec: string): Region | undefined {
  const raw = spec.trim()
  if (!raw) return undefined

  const bare = /^(\d+)x(\d+)$/i.exec(raw)
  if (bare) {
    const width = Number(bare[1])
    const height = Number(bare[2])
    return width > 0 && height > 0 ? { x: 0, y: 0, width, height } : undefined
  }

  const placed = /^(-?\d+),\s*(-?\d+)\s+(\d+)x(\d+)$/i.exec(raw)
  if (!placed) return undefined
  const width = Number(placed[3])
  const height = Number(placed[4])
  if (width <= 0 || height <= 0) return undefined
  return { x: Number(placed[1]), y: Number(placed[2]), width, height }
}

/** grim geometry for a region, given where the layout's (0,0) sits. */
export function toLayout(region: Region, origin: { x: number; y: number }): string {
  return `${origin.x + region.x},${origin.y + region.y} ${region.width}x${region.height}`
}
