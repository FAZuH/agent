/**
 * The rollout gate writer for `chain-gate.json`, the file the review chain
 * reads as its second activation condition. The chain activates only on
 * `{"gate":"passed"}`; this module is the only writer the repository has.
 *
 * Refusal semantics: the gate passes only when a real-host run sheet verifies
 * every required capability. A failed, partial, or unverified capability, a
 * missing sheet item, or evidence from anything but a real-host run records a
 * gating limitation and keeps the gate blocked. The writer has no path that
 * invents a verified verdict: nothing in this repository or its test suite can
 * mark a capability verified, only an operator's run sheet can. A sheet it
 * cannot parse, one naming an unknown capability, or a note carrying an
 * endpoint URL or a control character is refused outright with no file
 * written, so no malformed input ever becomes a gate record.
 *
 * The written file carries structured fields only: capability ids, verdicts,
 * one-line notes, and the sheet's source label. Sheet evidence text, probe
 * transcripts, and secrets have no field on the gate and never reach it.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { CHAIN_GATE_FILE, CHAIN_GATE_PASSED, chainStateHome } from "./chain.ts"

/** What a run sheet may state about one capability. */
export type CapabilityVerdict = "verified" | "failed" | "unverified" | "partial"

/** The closed list the issue names: seven families, C5b measured apart. */
export const REQUIRED_CAPABILITIES: { id: string; requirement: string }[] = [
  { id: "c1_busy_parent", requirement: "Transient generation while a session is busy" },
  { id: "c2_filtering", requirement: "Filtered history and exact current-action preservation" },
  { id: "c2_isolation", requirement: "Transcript isolation, no fork, no judge tool execution" },
  { id: "c3_cancellation", requirement: "Cancellation and late results" },
  { id: "c4_native_coverage", requirement: "Native and tool-surface coverage" },
  { id: "c5_exact_reply_isolation", requirement: "Exact Human reply isolation" },
  { id: "c5b_human_only_absolute", requirement: "The human-only gate stays absolute" },
  { id: "c6_no_wake_notices", requirement: "Queued parent notice without waking the parent" },
]

const REQUIRED_IDS = new Set(REQUIRED_CAPABILITIES.map((entry) => entry.id))
const VERDICTS = new Set<CapabilityVerdict>(["verified", "failed", "unverified", "partial"])
const REAL_HOST = "real-host"
/** One line: a note is a summary, never a transcript. */
const NOTE_MAX = 240

export interface CapabilitySheetItem {
  capability: string
  verdict: CapabilityVerdict
  note: string
}

export interface CapabilitySheet {
  source: { kind: string; report?: string; date?: string }
  items: CapabilitySheetItem[]
}

export interface GateLimitation {
  capability: string
  requirement: string
  state: CapabilityVerdict | "synthetic-evidence"
  note: string
}

export type GateWriteResult =
  | {
      ok: true
      gate: "passed" | "blocked"
      path: string
      limitations: GateLimitation[]
    }
  | { ok: false; error: string }

/** The gate file the chain reads, resolved exactly as the chain resolves it. */
export function gateFilePath(): string {
  return join(chainStateHome(), CHAIN_GATE_FILE)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Rejects the note shapes the gate never carries: an endpoint URL (nothing on
 * a gate names a destination), a control character, or more than one line.
 */
function noteViolation(item: CapabilitySheetItem): string | null {
  if (typeof item.note !== "string") return `the note for ${item.capability} is not a string`
  if (item.note.length > NOTE_MAX) return `the note for ${item.capability} exceeds ${NOTE_MAX} characters`
  if (/https?:\/\//.test(item.note)) return `the note for ${item.capability} names a URL, and a gate note never does`
  if (/[\u0000-\u001f\u007f]/.test(item.note)) return `the note for ${item.capability} carries a control character`
  return null
}

/** Parses and validates one run sheet. Every refusal names what is wrong. */
export function parseCapabilitySheet(text: string): { ok: true; sheet: CapabilitySheet } | { ok: false; error: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, error: "the sheet cannot be parsed as JSON" }
  }
  if (!isRecord(parsed)) return { ok: false, error: "the sheet must be one JSON object" }
  const source = parsed.source
  if (!isRecord(source) || typeof source.kind !== "string" || !source.kind.trim()) {
    return { ok: false, error: "the sheet source must name its kind" }
  }
  const rawItems = parsed.items
  if (!Array.isArray(rawItems)) return { ok: false, error: "the sheet items must be an array" }
  const items: CapabilitySheetItem[] = []
  const seen = new Set<string>()
  for (const raw of rawItems) {
    if (!isRecord(raw)) return { ok: false, error: "every sheet item must be an object" }
    const capability = raw.capability
    const verdict = raw.verdict
    if (typeof capability !== "string" || !REQUIRED_IDS.has(capability)) {
      return { ok: false, error: `the sheet names an unknown capability: ${String(capability)}` }
    }
    if (seen.has(capability)) return { ok: false, error: `the sheet states ${capability} twice` }
    seen.add(capability)
    if (typeof verdict !== "string" || !VERDICTS.has(verdict as CapabilityVerdict)) {
      return { ok: false, error: `the verdict for ${capability} is not one of verified, failed, unverified, partial` }
    }
    const item: CapabilitySheetItem = { capability, verdict: verdict as CapabilityVerdict, note: typeof raw.note === "string" ? raw.note : "" }
    if (item.verdict === "verified") {
      if (!item.note.trim()) return { ok: false, error: `the note for ${item.capability} must name the evidence: a verified capability without evidence is refused` }
    }
    const violation = noteViolation(item)
    if (violation) return { ok: false, error: violation }
    items.push(item)
  }
  return {
    ok: true,
    sheet: {
      source: {
        kind: source.kind,
        ...(typeof source.report === "string" ? { report: source.report } : {}),
        ...(typeof source.date === "string" ? { date: source.date } : {}),
      },
      items,
    },
  }
}

/**
 * Computes the gate for one sheet: the per-capability effective verdict and
 * the limitations that keep it closed. Pure: nothing is written here.
 */
export function gateOf(sheet: CapabilitySheet): { gate: "passed" | "blocked"; capabilities: Record<string, { verdict: CapabilityVerdict; note: string }>; limitations: GateLimitation[] } {
  const byID = new Map(sheet.items.map((item) => [item.capability, item]))
  const capabilities: Record<string, { verdict: CapabilityVerdict; note: string }> = {}
  const limitations: GateLimitation[] = []
  for (const entry of REQUIRED_CAPABILITIES) {
    const item = byID.get(entry.id)
    const realHost = sheet.source.kind === REAL_HOST
    const verified = item?.verdict === "verified" && realHost
    const effective: CapabilityVerdict = verified ? "verified" : item ? (item.verdict === "verified" ? "unverified" : item.verdict) : "unverified"
    capabilities[entry.id] = { verdict: effective, note: item?.note ?? "" }
    if (effective !== "verified") {
      limitations.push({
        capability: entry.id,
        requirement: entry.requirement,
        state: item?.verdict === "verified" ? "synthetic-evidence" : effective,
        note: item?.note ?? "no sheet item recorded this capability",
      })
    }
  }
  return { gate: limitations.length === 0 ? CHAIN_GATE_PASSED : "blocked", capabilities, limitations }
}

/**
 * Writes the gate file for one run sheet. Atomic: the file is never observed
 * half-written. A refusal writes nothing at all.
 */
export function writeCapabilityGate(sheetText: string): GateWriteResult {
  const parsed = parseCapabilitySheet(sheetText)
  if (!parsed.ok) return { ok: false, error: parsed.error }
  const { gate, capabilities, limitations } = gateOf(parsed.sheet)
  const path = gateFilePath()
  const record = {
    gate,
    writtenAt: new Date().toISOString(),
    source: parsed.sheet.source,
    capabilities,
    limitations,
  }
  const temp = `${path}.${process.pid}.tmp`
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(temp, `${JSON.stringify(record, null, 2)}\n`)
    renameSync(temp, path)
  } catch (error) {
    return { ok: false, error: `the gate file could not be written: ${(error as Error).message}` }
  }
  return { ok: true, gate: gate === CHAIN_GATE_PASSED ? "passed" : "blocked", path, limitations }
}

if (import.meta.main) {
  const sheetPath = process.argv[2]
  if (!sheetPath) {
    console.error("usage: bun capability-gate.ts <run-sheet.json>")
    process.exit(1)
  }
  let text: string
  try {
    text = readFileSync(sheetPath, "utf8")
  } catch (error) {
    console.error(`the run sheet could not be read: ${(error as Error).message}`)
    process.exit(1)
  }
  const result = writeCapabilityGate(text)
  if (!result.ok) {
    console.error(`refused, nothing written: ${result.error}`)
    process.exit(1)
  }
  console.log(
    JSON.stringify({
      gate: result.gate,
      limitations: result.limitations.map((row) => row.capability),
      path: result.path,
    }),
  )
}
