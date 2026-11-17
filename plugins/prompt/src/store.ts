/**
 * The prompt file store, server side only.
 *
 * One JSON file per session under the plugin's state home. The file is the
 * channel between the tool that writes a prompt and the views that show it:
 * the server owns writes, the TUI reads through the RPC, and a half-written
 * file must never be observable. Write a sibling temp file, then rename it
 * over the old one.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

import type { Prompt } from "./shared.ts"

const STATE_HOME =
  process.env.OPENCODE_PROMPT_STATE_HOME ??
  join(process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"), "opencode", "prompt")
export const PROMPTS_DIR = join(STATE_HOME, "prompts")

/** How many prompts one session keeps. The view lists the newest first. */
export const PROMPTS_LIMIT = 50

const SAFE_ID = /^[A-Za-z0-9._-]+$/

function fileOf(sessionID: string): string {
  if (!SAFE_ID.test(sessionID)) throw new Error(`unsafe session id: ${sessionID}`)
  return join(PROMPTS_DIR, `${sessionID}.json`)
}

function valid(value: unknown): value is Prompt {
  if (!value || typeof value !== "object") return false
  const item = value as Record<string, unknown>
  return (
    typeof item.id === "string" &&
    typeof item.sessionID === "string" &&
    typeof item.at === "number" &&
    typeof item.title === "string"
  )
}

/** The session's prompts, oldest first. A missing or broken file is empty. */
export function readPrompts(sessionID: string): Prompt[] {
  try {
    const parsed = JSON.parse(readFileSync(fileOf(sessionID), "utf8"))
    return Array.isArray(parsed) ? parsed.filter(valid) : []
  } catch {
    return []
  }
}

/** Every session's prompts merged, oldest first, and capped for one view. */
export function readMany(sessionIDs: readonly string[], limit = 100): Prompt[] {
  const merged = sessionIDs.flatMap((sessionID) => readPrompts(sessionID))
  merged.sort((a, b) => a.at - b.at)
  return merged.length > limit ? merged.slice(merged.length - limit) : merged
}

/** Write a session's whole list atomically. */
export function writePrompts(sessionID: string, list: Prompt[]): void {
  const file = fileOf(sessionID)
  mkdirSync(PROMPTS_DIR, { recursive: true })
  const temp = `${file}.${process.pid}.tmp`
  writeFileSync(temp, `${JSON.stringify(list, null, 2)}\n`, { encoding: "utf8", mode: 0o600 })
  renameSync(temp, file)
}

/** Replace one prompt, by id, with the result of `patch`. Undefined when it is gone. */
export function updatePrompt(
  sessionID: string,
  promptID: string,
  patch: (prompt: Prompt) => Prompt,
): Prompt | undefined {
  const list = readPrompts(sessionID)
  const index = list.findIndex((prompt) => prompt.id === promptID)
  if (index === -1) return undefined
  const next = patch(list[index]!)
  list[index] = next
  writePrompts(sessionID, list)
  return next
}

/**
 * Apply `patch` to one prompt only when `taken` says nobody else has already,
 * in one synchronous read and write. Undefined when the prompt is gone or was
 * taken first, so a repeated answer cannot deliver the same text twice.
 */
export function claimPrompt(
  sessionID: string,
  promptID: string,
  taken: (prompt: Prompt) => boolean,
  patch: (prompt: Prompt) => Prompt,
): Prompt | undefined {
  const list = readPrompts(sessionID)
  const index = list.findIndex((prompt) => prompt.id === promptID)
  if (index === -1) return undefined
  const current = list[index]!
  if (taken(current)) return undefined
  const next = patch(current)
  list[index] = next
  writePrompts(sessionID, list)
  return next
}

/** Append one prompt and return the stored list, capped at the limit. */
export function appendPrompt(prompt: Prompt, limit = PROMPTS_LIMIT): Prompt[] {
  const list = readPrompts(prompt.sessionID)
  const next = [...list, prompt]
  const kept = next.length > limit ? next.slice(next.length - limit) : next
  writePrompts(prompt.sessionID, kept)
  return kept
}
