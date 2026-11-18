/**
 * The no-respawn store: one snapshot per parent session plus an append-only
 * audit beside it.
 *
 * The audit is the durable intent and the snapshot is the derived state, so the
 * two are written by different calls: a caller appends the event first, then
 * writes the record. A crash between them leaves an audit line that a corrupt
 * snapshot cannot erase, which is what keeps an unreadable store holding
 * admissions instead of reading as an empty one.
 *
 * Retention. A snapshot record is bounded: a live tombstone is retired past its
 * TTL, and a retired record is dropped one TTL after it retired. The audit is
 * not bounded by age; its lines stay until the session is deleted, because that
 * log is the only remaining evidence of why a record existed.
 *
 * Concurrency. Every mutation of one parent runs under an exclusive lock file,
 * so a read-modify-write cannot lose a sibling's record and a prune cannot
 * overwrite a concurrent write. Temp files are unique per process.
 *
 * Same-UID limit: any process with this user's uid can edit or delete these
 * files. The store is a recovery record, not a tamper boundary.
 */

import { createHash } from "node:crypto"
import { chmodSync, closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { STATE_DIR_MODE, STATE_FILE_MODE, TTL_MS, type AuditEvidence, type Fence, type TaskRecord } from "./nospawn.ts"

/** Test and milestone-B override. Takes precedence over the host state root. */
export const STATE_DIR_ENV = "OPENCODE_JEV_NOSPAWN_DIR"

/**
 * How long a writer waits for another one before it refuses to guess.
 *
 * A caller that gets the throw must treat it as HOLD, never as allow: the store
 * could not prove it wrote, so nothing about the parent is known to be safe.
 */
export const LOCK_WAIT_MS = 2_000
const LOCK_POLL_MS = 5
/** A lock older than this, or held by a dead pid, is abandoned. */
export const LOCK_STALE_MS = 10_000

export type AuditEvent =
  | "admit"
  | "hold"
  | "allow"
  | "deny"
  | "retire"
  | "abort"
  | "abort_done"
  | "abort_refused"
  | "bind"
  | "ambiguous_child_preserved"
  | "hold_preserved"
  | "degraded_hold"
  | "evidence_repaired"
  | "hold_approved"
  | "hold_always_downgraded"
  | "hold_rejected"
  | "hold_expired"
  | "hold_uncancellable"
  | "hold_fanout_skipped"
  | "hold_refused_by_deny"
  | "hold_unrecorded"
  | "hold_revoked"

export interface AuditLine {
  event: AuditEvent
  fingerprint?: string
  callID?: string
  childID?: string
  /** The host's pending-permission id this line settles, when there was one. */
  perId?: string
  detail?: string
}

export interface Snapshot {
  v: 1
  parentID: string
  frontierSeq: number
  eventCursor: number
  fence?: Fence
  tasks: Record<string, TaskRecord>
  degraded?: { reason: string; since: number; attempts: number }
}

export interface SnapshotRead {
  ok: boolean
  /** `unreadable` is an evidence error: the file exists and cannot be read. */
  reason: "ok" | "missing" | "corrupt" | "version" | "unreadable"
  snap: Snapshot | null
  /** What the audit alone proves, readable snapshot or not. */
  audit: AuditEvidence
}

/**
 * The state root. Mirrors the chain state.ts owns, because that module resolves
 * it once at import and a second test file in one bun process would inherit the
 * first file's directory.
 */
export function stateDir(): string {
  const override = process.env[STATE_DIR_ENV]
  if (override) return override
  const root =
    process.env.OPENCODE_JEV_STATE_HOME ??
    process.env.JEV_STATE_HOME ??
    process.env.JEV_DATA_HOME ??
    process.env.JEV_DATA_DIR ??
    join(process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"), "opencode", "jev")
  return join(root, "nospawn")
}

/** Read a parent's snapshot. A missing or unreadable file is never "empty". */
export function readSnapshot(parentID: string): SnapshotRead {
  const audit = auditEvidence(parentID)
  let raw: string
  try {
    raw = readFileSync(snapshotPath(parentID), "utf8")
  } catch (error) {
    // `ENOENT` is the only benign read error. Anything else (EACCES, EISDIR,
    // EIO) means the snapshot is there and cannot be read, so it is evidence a
    // caller must hold on, not an empty store it may write over.
    const code = (error as NodeJS.ErrnoException)?.code
    return { ok: false, reason: code === "ENOENT" ? "missing" : "unreadable", snap: null, audit }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, reason: "corrupt", snap: null, audit }
  }
  return validate(parentID, parsed, audit)
}

/**
 * Write one task record under the parent lock. Merges into what is already
 * there: a terminal record never reopens, a generation never decreases, and a
 * call key or child id is recorded once.
 *
 * Throws on a corrupt snapshot instead of replacing it: overwriting the only
 * copy of a tombstone would be the silent reset this feature exists to prevent.
 */
export function writeTask(parentID: string, key: string, rec: TaskRecord): void {
  withParentLock(parentID, () => {
    const read = readSnapshot(parentID)
    if (!read.ok && read.reason !== "missing") {
      throw new Error(`nospawn: refusing to write over a ${read.reason} snapshot for ${parentID}`)
    }
    const snap = read.snap ?? blank(parentID)
    snap.tasks[key] = merge(snap.tasks[key], { ...rec, parentID, fingerprint: key })
    writeSnapshot(parentID, snap)
  })
}

/**
 * The raw writer. Not for outside callers: it assumes `withParentLock` is held.
 * Use `writeTask`; milestone B must never call this directly.
 */
export function writeSnapshot(parentID: string, snap: Snapshot): void {
  writeAtomic(snapshotPath(parentID), `${JSON.stringify(snap, null, 2)}\n`)
}

/** Append one audit line and flush it before returning. */
export function appendAudit(parentID: string, line: AuditLine): void {
  const path = auditPath(parentID)
  ensureDir(dirname(path))
  const text = `${JSON.stringify({ ts: new Date().toISOString(), parentID, ...line })}\n`
  const fd = openSync(path, "a", STATE_FILE_MODE)
  try {
    writeSync(fd, text)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  chmodSync(path, STATE_FILE_MODE)
}

/**
 * Apply the snapshot's two age bounds under the parent lock: retire a live
 * tombstone past its TTL, then drop a record retired more than one TTL ago.
 * Returns how many records moved or left.
 *
 * An unreadable snapshot also returns 0, because there is nothing to rewrite;
 * the admission path reads the snapshot itself and holds, so this cannot turn
 * corruption into an admission.
 */
export function pruneSnapshot(parentID: string, now: number, ttlMs = TTL_MS): number {
  return withParentLock(parentID, () => {
    const read = readSnapshot(parentID)
    if (!read.ok || !read.snap) return 0
    const snap = read.snap
    let changed = 0
    for (const [key, rec] of Object.entries(snap.tasks)) {
      if (rec.abortedAt == null) continue
      if (rec.retiredAt == null) {
        if (now < rec.abortedAt + ttlMs) continue
        rec.retiredAt = now
        changed++
        continue
      }
      if (now < rec.retiredAt + ttlMs) continue
      delete snap.tasks[key]
      changed++
    }
    if (changed) writeSnapshot(parentID, snap)
    return changed
  })
}

/** Session deletion takes the whole parent with it, audit included. */
export function removeParent(parentID: string): void {
  withParentLock(parentID, () => {
    for (const path of [snapshotPath(parentID), auditPath(parentID)]) {
      try {
        unlinkSync(path)
      } catch {}
    }
  })
}

/** Where one parent's two files live, for diagnostics and damage injection. */
export function parentPaths(parentID: string): { snapshot: string; audit: string } {
  return { snapshot: snapshotPath(parentID), audit: auditPath(parentID) }
}

/**
 * One writer per parent. `wx` fails when the lock exists, so the create is the
 * claim. A lock whose pid is gone, or that has sat longer than `LOCK_STALE_MS`,
 * is abandoned by a crashed writer and is taken over; anything else waits, and
 * a writer that never gets in throws rather than write over a sibling.
 *
 * Exported for a mutation that spans more than one file of the same parent. The
 * throw is a caller error the admission path must treat as a hold.
 */
export function withParentLock<T>(parentID: string, body: () => T): T {
  const path = `${snapshotPath(parentID)}.lock`
  ensureDir(dirname(path))
  const token = `${process.pid} ${Date.now()} ${Math.random().toString(36).slice(2, 10)}`
  const deadline = Date.now() + LOCK_WAIT_MS
  for (;;) {
    try {
      const fd = openSync(path, "wx", STATE_FILE_MODE)
      try {
        writeSync(fd, token)
        fsyncSync(fd)
      } finally {
        closeSync(fd)
      }
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== "EEXIST") throw error
      const stale = staleToken(path)
      if (stale) {
        dropStale(path, stale)
        continue
      }
      if (Date.now() > deadline) throw new Error(`nospawn: ${parentID} is locked by another writer`)
      pause(LOCK_POLL_MS)
    }
  }
  try {
    return body()
  } finally {
    // Only our own lock. A writer judged stale and taken over while the body ran
    // must not unlink the lock the new holder is working under.
    release(path, token)
  }
}

/** Remove the lock only when the on-disk token is still ours. */
function release(path: string, token: string): void {
  try {
    if (readFileSync(path, "utf8") !== token) return
  } catch {
    return
  }
  try {
    unlinkSync(path)
  } catch {}
}

/**
 * The token of a lock left by a writer that is gone, or "" when the lock is
 * live. A lock file that vanished between the failed create and this read is not
 * abandoned: the holder released it, and the caller retries the create.
 */
function staleToken(path: string): string {
  let token: string
  try {
    token = readFileSync(path, "utf8")
  } catch {
    return ""
  }
  const [pid, at] = token.trim().split(/\s+/)
  const holder = Number(pid)
  const since = Number(at)
  if (Number.isFinite(since) && Date.now() - since > LOCK_STALE_MS) return token
  if (!Number.isFinite(holder) || holder <= 0) return token
  try {
    process.kill(holder, 0)
    return ""
  } catch (error) {
    return (error as NodeJS.ErrnoException)?.code === "ESRCH" ? token : ""
  }
}

/**
 * Remove the abandoned lock only if it is still the one judged abandoned. The
 * token carries a random suffix, so a lock re-created in between never matches
 * and survives.
 */
function dropStale(path: string, token: string): void {
  release(path, token)
}

/** A synchronous sleep, because the store's callers are synchronous. */
function pause(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function blank(parentID: string): Snapshot {
  return { v: 1, parentID, frontierSeq: 0, eventCursor: 0, tasks: {} }
}

function merge(prev: TaskRecord | undefined, next: TaskRecord): TaskRecord {
  if (!prev) return next
  return {
    parentID: prev.parentID,
    fingerprint: prev.fingerprint,
    agent: next.agent || prev.agent,
    generation: Math.max(prev.generation, next.generation),
    frontierAtAdmit: Math.min(prev.frontierAtAdmit, next.frontierAtAdmit),
    frontierAtAbort: prev.frontierAtAbort ?? next.frontierAtAbort,
    callKeys: unique([...prev.callKeys, ...next.callKeys]),
    childIDs: unique([...prev.childIDs, ...next.childIDs]),
    abortedAt: prev.abortedAt ?? next.abortedAt,
    abortedBy: prev.abortedBy ?? next.abortedBy,
    cause: prev.cause ?? next.cause,
    retiredAt: prev.retiredAt ?? next.retiredAt ?? null,
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function validate(parentID: string, parsed: unknown, audit: AuditEvidence): SnapshotRead {
  const snap = parsed as Partial<Snapshot> | null
  if (!object(snap) || snap.v !== 1 || snap.parentID !== parentID) {
    return { ok: false, reason: "version", snap: null, audit }
  }
  if (!number(snap.frontierSeq) || !number(snap.eventCursor)) {
    return { ok: false, reason: "corrupt", snap: null, audit }
  }
  if (!object(snap.tasks)) return { ok: false, reason: "corrupt", snap: null, audit }
  if (snap.fence != null) {
    const fence = snap.fence as Partial<Fence>
    // A fence of unknown kind cannot be classified, and guessing would either
    // deny work a human could lift or lift one nobody may.
    const kind = fence?.kind
    if (!object(fence) || (kind !== "parent" && kind !== "subtree") || !number(fence.atSeq) || !number(fence.at)) {
      return { ok: false, reason: "corrupt", snap: null, audit }
    }
  }
  for (const [key, value] of Object.entries(snap.tasks)) {
    if (!validTask(parentID, key, value)) return { ok: false, reason: "corrupt", snap: null, audit }
  }
  return { ok: true, reason: "ok", snap: snap as Snapshot, audit }
}

function validTask(parentID: string, key: string, value: unknown): value is TaskRecord {
  const rec = value as Partial<TaskRecord> | null
  if (!object(rec)) return false
  if (rec.parentID !== parentID || rec.fingerprint !== key) return false
  if (typeof rec.agent !== "string") return false
  if (!number(rec.generation) || rec.generation < 1) return false
  if (!number(rec.frontierAtAdmit)) return false
  if (!strings(rec.callKeys) || !strings(rec.childIDs)) return false
  if (rec.frontierAtAbort != null && !number(rec.frontierAtAbort)) return false
  if (rec.abortedAt != null && !number(rec.abortedAt)) return false
  if (rec.retiredAt != null && !number(rec.retiredAt)) return false
  return true
}

/**
 * What the audit alone proves. Every line is a whole record except a torn final
 * one, which an interrupted append can leave and which is skipped. Any other
 * unparseable line is unreadable evidence, not an absent one: a log that cannot
 * be read must hold the parent, never admit it.
 */
function auditEvidence(parentID: string): AuditEvidence {
  let text: string
  try {
    text = readFileSync(auditPath(parentID), "utf8")
  } catch (error) {
    // No audit yet is clean. An audit that exists and cannot be read proves
    // nothing, and it must not read as "nothing was ever aborted here".
    return (error as NodeJS.ErrnoException)?.code === "ENOENT" ? "clean" : "unreadable"
  }
  const parts = text.split("\n")
  const tail = parts.pop() ?? ""
  const rows: any[] = []
  for (const line of parts) {
    try {
      rows.push(JSON.parse(line))
    } catch {
      return "unreadable"
    }
  }
  // The final element is the empty string after a newline, or a line that no
  // newline follows. A final line that parses is a whole record even without
  // its newline; one that does not parse was torn mid-append and is skipped.
  if (tail !== "") {
    try {
      rows.push(JSON.parse(tail))
    } catch {}
  }
  const live = new Map<string, boolean>()
  for (const row of rows) {
    if (!object(row) || typeof row.event !== "string") return "unreadable"
    const key = typeof row.fingerprint === "string" ? row.fingerprint : ""
    if (!key) continue
    if (row.event === "abort") live.set(key, true)
    else if (row.event === "retire") live.set(key, false)
  }
  for (const value of live.values()) if (value) return "live"
  return "clean"
}

function snapshotPath(parentID: string): string {
  return join(stateDir(), `${slug(parentID)}.json`)
}

function auditPath(parentID: string): string {
  return join(stateDir(), `${slug(parentID)}.audit.jsonl`)
}

/**
 * A session id reaches the filesystem, so it never carries a path segment. The
 * digest suffix keeps two ids that sanitize to the same text on two files, so a
 * delete of one cannot take the other's snapshot with it.
 */
function slug(parentID: string): string {
  const raw = String(parentID ?? "")
  const safe = raw.replace(/[^A-Za-z0-9_.-]/g, "_")
  const stem = safe && safe !== "." && safe !== ".." ? safe : "_"
  return `${stem}-${createHash("sha256").update(raw, "utf8").digest("hex").slice(0, 8)}`
}

function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: STATE_DIR_MODE })
  chmodSync(dir, STATE_DIR_MODE)
}

let tempCounter = 0

function writeAtomic(path: string, text: string): void {
  const dir = dirname(path)
  ensureDir(dir)
  // Unique per writer: a fixed name lets two writers clobber each other's bytes
  // between the write and the rename.
  const temp = `${path}.${process.pid}.${tempCounter++}.tmp`
  const fd = openSync(temp, "w", STATE_FILE_MODE)
  try {
    writeSync(fd, text)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  renameSync(temp, path)
  chmodSync(path, STATE_FILE_MODE)
  // The rename itself is only durable once the directory entry is flushed.
  // Some filesystems refuse a directory fsync; the file fsync above still ran.
  try {
    const dirFd = openSync(dir, "r")
    try {
      fsyncSync(dirFd)
    } finally {
      closeSync(dirFd)
    }
  } catch {}
}

function object(value: unknown): value is Record<string, any> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function number(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
}
