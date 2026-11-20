import type { WakeState } from "./shared.ts"

export type CursorRecord = { cursor: string; seen: string[]; at: number }

const SEEN_CAP = 200

export function cursorKey(url: string, channel: string): string {
  return `board-bridge:${url.replace(/\/+$/, "")}:${channel}`
}

export function encodeCursorRecord(cursor: string, state: WakeState, now: number): CursorRecord {
  return { cursor, seen: [...state.seen.keys()].slice(-SEEN_CAP), at: now }
}

export function decodeCursorRecord(value: unknown): CursorRecord | null {
  if (value === null || typeof value !== "object") return null
  const record = value as Record<string, unknown>
  if (typeof record.cursor !== "string" || record.cursor === "") return null
  if (!Array.isArray(record.seen) || record.seen.some((id) => typeof id !== "string")) return null
  if (typeof record.at !== "number" || !Number.isFinite(record.at)) return null
  return { cursor: record.cursor, seen: record.seen as string[], at: record.at }
}

export function hydrateState(state: WakeState, record: CursorRecord): void {
  for (const id of record.seen) {
    if (!state.seen.has(id)) state.seen.set(id, record.at)
  }
}
