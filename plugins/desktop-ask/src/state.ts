/**
 * The one target. A single file, shared by every plugin instance, so the
 * session that armed last is the session every trigger goes to.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

export type Delivery = "steer" | "queue"

export interface Target {
  sessionID: string
  directory: string
  title?: string
  instruction: string
  region?: string
  delivery: Delivery
  armedAt: string
  triggers: number
  lastTriggerAt?: string
}

export function stateRoot(): string {
  const base = process.env.XDG_STATE_HOME || join(homedir(), ".local", "state")
  return join(base, "opencode", "desktop-ask")
}

export function targetPath(root = stateRoot()): string {
  return join(root, "target.json")
}

export function shotsDir(root = stateRoot()): string {
  return join(root, "shots")
}

function normalize(raw: any): Target | undefined {
  if (!raw || typeof raw.sessionID !== "string" || typeof raw.instruction !== "string") return undefined
  if (!raw.sessionID || !raw.instruction.trim()) return undefined
  return {
    sessionID: raw.sessionID,
    directory: typeof raw.directory === "string" ? raw.directory : "",
    title: typeof raw.title === "string" ? raw.title : undefined,
    instruction: raw.instruction,
    region: typeof raw.region === "string" && raw.region.trim() ? raw.region : undefined,
    delivery: raw.delivery === "steer" ? "steer" : "queue",
    armedAt: typeof raw.armedAt === "string" ? raw.armedAt : new Date(0).toISOString(),
    triggers: Number.isFinite(raw.triggers) ? Number(raw.triggers) : 0,
    lastTriggerAt: typeof raw.lastTriggerAt === "string" ? raw.lastTriggerAt : undefined,
  }
}

export function readTarget(root = stateRoot()): Target | undefined {
  const path = targetPath(root)
  if (!existsSync(path)) return undefined
  try {
    return normalize(JSON.parse(readFileSync(path, "utf8")))
  } catch {
    return undefined
  }
}

/** Write to a sibling temp file, then rename, so a trigger never reads half a target. */
export function writeTarget(target: Target, root = stateRoot()): void {
  mkdirSync(root, { recursive: true })
  const path = targetPath(root)
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, `${JSON.stringify(target, null, 2)}\n`)
  renameSync(tmp, path)
}

export function clearTarget(root = stateRoot()): boolean {
  const path = targetPath(root)
  if (!existsSync(path)) return false
  try {
    unlinkSync(path)
    return true
  } catch {
    return false
  }
}

export interface CopyRecord {
  at: string
  ok: boolean
  chars?: number
  preview?: string
  error?: string
}

export function lastCopyPath(root = stateRoot()): string {
  return join(root, "last-copy.json")
}

export function writeLastCopy(record: CopyRecord, root = stateRoot()): void {
  mkdirSync(root, { recursive: true })
  writeFileSync(lastCopyPath(root), `${JSON.stringify(record, null, 2)}\n`)
}

export function readLastCopy(root = stateRoot()): CopyRecord | undefined {
  const path = lastCopyPath(root)
  if (!existsSync(path)) return undefined
  try {
    const raw = JSON.parse(readFileSync(path, "utf8"))
    if (!raw || typeof raw.ok !== "boolean") return undefined
    return raw
  } catch {
    return undefined
  }
}
