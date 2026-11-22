/**
 * Self-check for the session-ban rules, the store and the frontier reducer. No
 * host, no network, no model: hand-built records and a temp state directory.
 *
 *   bun test plugins/watchdog/src/session-ban.test.ts
 *
 * These are unit tests against the modules, not host evidence. The store is
 * imported dynamically, as in jev.test.ts: a static import would hoist above the
 * state-directory redirect.
 */

import { afterAll, describe, expect, test } from "bun:test"
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const scratch = mkdtempSync(join(tmpdir(), "jev-session-ban-test-"))
process.env.JEV_DATA_DIR = scratch
process.env.JEV_SECRET_DIR = join(scratch, "secrets")
process.env.OPENCODE_JEV_SESSION_BAN_DIR = join(scratch, "session-ban")

const {
  ADMISSION_WINDOW_MS,
  API_CONTAINMENT,
  BIND_GRACE_MS,
  DEGRADED_RETRY_MS,
  HOLD_FANOUT,
  HOLD_MS,
  HOLD_REPLIES,
  HOST_TASK_ID,
  LOWERCASE,
  STRICTER_TIER,
  TTL_MS,
  boundary,
  fingerprint,
  holdMarker,
  inAdmissionWindow,
  nextGeneration,
  tombstoneState,
  verdict,
} = await import("./session-ban.ts")
type AdmissionInput = import("./session-ban.ts").AdmissionInput
type SessionBan = import("./session-ban.ts").SessionBan
type TaskRecord = import("./session-ban.ts").TaskRecord
const store = await import("./session-ban-state.ts")
const frontier = await import("./session-ban-frontier.ts")

afterAll(() => rmSync(scratch, { recursive: true, force: true }))

const PARENT = "ses_parent"
const OTHER = "ses_other"
const NOW = 1_794_668_707_282

const record = (over: Partial<TaskRecord> = {}): TaskRecord => ({
  parentID: PARENT,
  fingerprint: fingerprint("summarize the parser"),
  agent: "general",
  generation: 1,
  frontierAtAdmit: 41,
  frontierAtAbort: 41,
  callKeys: ["call_aborted"],
  childIDs: [],
  abortedAt: NOW - 1_000,
  abortedBy: "user",
  cause: "interrupt",
  retiredAt: null,
  ...over,
})

const admission = (over: Partial<AdmissionInput> = {}): AdmissionInput => ({
  parentID: PARENT,
  fingerprint: fingerprint("summarize the parser"),
  callKey: "call_new",
  frontierNow: 41,
  stateOk: true,
  audit: "clean",
  now: NOW,
  ...over,
})

describe("fingerprint", () => {
  test("normalizes case, whitespace and NFKC", () => {
    const base = "Summarize the parser and list its entry points"
    expect(fingerprint(base)).toBe(fingerprint(base.toLowerCase()))
    expect(fingerprint(base)).toBe(fingerprint("  Summarize   the parser\nand list its entry points  "))
    expect(fingerprint("file layout")).toBe(fingerprint("\uFB01le layout"))
    expect(fingerprint("caf\u00e9 notes")).toBe(fingerprint("cafe\u0301 notes"))

    expect(fingerprint(base)).not.toBe(fingerprint("Summarize the lexer and list its entry points"))
    expect(fingerprint(base)).not.toBe(fingerprint(`${base} then commit`))

    expect(fingerprint(base)).toHaveLength(64)
    expect(() => fingerprint("   ")).toThrow()
  })
})

describe("case folding", () => {
  test("case-sensitive identifiers collide by decision", () => {
    expect(LOWERCASE).toBe(true)
    expect(fingerprint("createUser")).toBe(fingerprint("createuser"))
    expect(fingerprint("HTTP retry")).toBe(fingerprint("http retry"))

    const camel = record({ fingerprint: fingerprint("createuser") })
    const held = verdict(admission({ fingerprint: fingerprint("createUser") }), [camel])
    expect(held.effect).toBe("hold")
    expect(held.row).toBe("4")
    expect(held.reason).toContain("same task")
  })
})

describe("verdict table", () => {
  test("table A and B", () => {
    const live = record()

    // Table A: the task tombstone.
    expect(verdict(admission({ callKey: "call_aborted" }), [live])).toMatchObject({ effect: "deny", row: "1" })
    expect(verdict(admission(), [live])).toMatchObject({ effect: "hold", row: "4" })
    expect(verdict(admission({ frontierNow: 40 }), [live])).toMatchObject({ effect: "hold", row: "4" })

    const later = verdict(admission({ frontierNow: 42 }), [live])
    expect(later).toMatchObject({ effect: "allow", row: "5", retire: true })

    expect(verdict(admission({ fingerprint: fingerprint("another task") }), [live])).toMatchObject({ effect: "allow", row: "7", retire: false })
    expect(verdict(admission(), [record({ parentID: OTHER })])).toMatchObject({ effect: "allow", row: "8" })
    expect(verdict(admission(), [record({ retiredAt: NOW - 10 })])).toMatchObject({ effect: "allow", row: "retired" })
    expect(verdict(admission(), [record({ abortedAt: NOW - TTL_MS - 1 })])).toMatchObject({ effect: "allow", row: "retired" })
    expect(verdict(admission(), [])).toMatchObject({ effect: "allow", row: "none" })

    // Table B: exact blocks, the session ban, and missing evidence.
    expect(verdict(admission(), [live], { kind: "subtree", atSeq: 41, cause: "abort", at: NOW })).toMatchObject({ effect: "deny", row: "6" })
    expect(verdict(admission({ resumeChildID: "ses_child" }), [record({ childIDs: ["ses_child"] })])).toMatchObject({ effect: "deny", row: "2" })
    expect(verdict(admission({ resumeChildID: "ses_unknown", frontierNow: 42 }), [live])).toMatchObject({ effect: "hold", row: "3" })

    const sessionBan: SessionBan = { kind: "parent", atSeq: 41, cause: "abort", at: NOW }
    expect(verdict(admission({ frontierNow: 41 }), [], sessionBan)).toMatchObject({ effect: "hold", row: "sessionBan" })
    expect(verdict(admission({ frontierNow: 42 }), [], sessionBan)).toMatchObject({ effect: "allow", row: "none" })

    expect(verdict(admission({ frontierNow: null }), [live])).toMatchObject({ effect: "hold", row: "9" })
    expect(verdict(admission({ stateOk: false, audit: "live" }), [])).toMatchObject({ effect: "hold", row: "9" })
    expect(verdict(admission({ stateOk: false, audit: "unreadable" }), [])).toMatchObject({ effect: "hold", row: "9" })
    expect(verdict(admission({ frontierNow: null }), [])).toMatchObject({ effect: "allow", row: "10" })
    expect(verdict(admission({ stateOk: false }), [])).toMatchObject({ effect: "allow", row: "10" })

    // The nine decisions are the shipped constants, not prose.
    expect(HOLD_MS).toBe(60_000)
    expect(HOLD_REPLIES).toEqual(["once", "always", "reject"])
    // A reject is session-wide on this host, so Jev only rejects a solo request.
    expect(HOLD_FANOUT).toBe("solo-only")
    expect(holdMarker("ses_a|msg_1|call_1", "the reason")).toMatch(/^session-ban hold [0-9a-f]{12}: the reason$/)
    // The digest names the call, not the reason: two calls cannot share a marker.
    expect(holdMarker("ses_a|msg_1|call_1", "x")).not.toBe(holdMarker("ses_a|msg_1|call_2", "x"))
    expect(holdMarker("ses_a|msg_1|call_1", "x")).toBe(holdMarker("ses_a|msg_1|call_1", "y").replace(": y", ": x"))
    expect(STRICTER_TIER).toBe(false)
    expect(HOST_TASK_ID).toBe(false)
    expect(API_CONTAINMENT).toBe("window")

    // The admission window is the binder's evidence (M8). Asserted here so no
    // exported rule ships unchecked in milestone A.
    const bound = { mintAt: NOW, boundAt: NOW + 500 }
    expect(inAdmissionWindow(NOW, bound)).toBe(true)
    expect(inAdmissionWindow(NOW - 1, bound)).toBe(false)
    expect(inAdmissionWindow(NOW + 500 + BIND_GRACE_MS, bound)).toBe(true)
    expect(inAdmissionWindow(NOW + 500 + BIND_GRACE_MS + 1, bound)).toBe(false)

    const unbound = { mintAt: NOW, abortedAt: NOW + 300 }
    expect(inAdmissionWindow(NOW + 300 + BIND_GRACE_MS, unbound)).toBe(true)
    expect(inAdmissionWindow(NOW + 300 + BIND_GRACE_MS + 1, unbound)).toBe(false)

    const capped = { mintAt: NOW, abortedAt: NOW + ADMISSION_WINDOW_MS - 1_000 }
    expect(inAdmissionWindow(NOW + ADMISSION_WINDOW_MS, capped)).toBe(true)
    expect(inAdmissionWindow(NOW + ADMISSION_WINDOW_MS + 1, capped)).toBe(false)
  })
})

describe("approval", () => {
  test("a human approval never overrides an exact deny", () => {
    const live = record()
    const approved = admission({ approvedGeneration: 2 })

    expect(verdict({ ...approved, callKey: "call_aborted" }, [live])).toMatchObject({ effect: "deny", row: "1" })
    expect(verdict({ ...approved, resumeChildID: "ses_child" }, [record({ childIDs: ["ses_child"] })])).toMatchObject({ effect: "deny", row: "2" })
    expect(verdict(approved, [live], { kind: "subtree", atSeq: 41, cause: "abort", at: NOW })).toMatchObject({ effect: "deny", row: "6" })
  })

  test("a human approval admits only a hold, and only with a generation", () => {
    const live = record()

    expect(verdict(admission(), [live])).toMatchObject({ effect: "hold", row: "4", generation: null })
    expect(verdict(admission({ approvedGeneration: undefined }), [live])).toMatchObject({ effect: "hold", row: "4" })
    expect(verdict(admission({ approvedGeneration: Number.NaN }), [live])).toMatchObject({ effect: "hold", row: "4" })
    expect(verdict(admission({ approvedGeneration: 1 }), [live])).toMatchObject({ effect: "hold", row: "4" })

    expect(nextGeneration(live, "human")).toBe(2)
    expect(verdict(admission({ approvedGeneration: 2 }), [live])).toMatchObject({ effect: "allow", row: "4", generation: 2, retire: false })

    expect(verdict(admission({ resumeChildID: "ses_unknown", approvedGeneration: 2 }), [live])).toMatchObject({
      effect: "allow",
      row: "3",
      generation: 2,
    })
    expect(verdict(admission({ frontierNow: null, approvedGeneration: 2 }), [live])).toMatchObject({ effect: "allow", row: "9", generation: 2 })
  })
})

describe("session ban kinds", () => {
  const parentSessionBan: SessionBan = { kind: "parent", atSeq: 41, cause: "abort", at: NOW }
  const subtreeSessionBan: SessionBan = { kind: "subtree", atSeq: 41, cause: "abort", at: NOW }

  test("a parent session ban holds without an approval", () => {
    expect(verdict(admission(), [], parentSessionBan)).toMatchObject({ effect: "hold", row: "sessionBan", generation: null })
    expect(verdict(admission({ frontierNow: 40 }), [], parentSessionBan)).toMatchObject({ effect: "hold", row: "sessionBan" })

    // A user item past the session ban admits, approval or not. The task table is what
    // decided, so its row is what the decision reports.
    expect(verdict(admission({ frontierNow: 42 }), [], parentSessionBan)).toMatchObject({ effect: "allow", row: "none", generation: null })
  })

  test("a parent session ban admits one generation with a valid approval", () => {
    expect(verdict(admission({ approvedGeneration: 2 }), [], parentSessionBan)).toMatchObject({ effect: "allow", row: "sessionBan", generation: 2 })

    // The approval answers that call only; the next one holds again.
    expect(verdict(admission(), [], parentSessionBan)).toMatchObject({ effect: "hold", row: "sessionBan", generation: null })
  })

  test("a parent session ban never rescues a stale approval that the task table rejects", () => {
    const newer = record({ generation: 5 })

    // The task table decides first: row 4 holds, and the session ban does not lift it.
    expect(verdict(admission({ approvedGeneration: 2 }), [newer], parentSessionBan)).toMatchObject({
      effect: "hold",
      row: "4",
      generation: null,
    })

    // A generation newer than the record passes row 4, and that same answer
    // already satisfies the session ban.
    expect(verdict(admission({ approvedGeneration: 6 }), [newer], parentSessionBan)).toMatchObject({
      effect: "allow",
      row: "4",
      generation: 6,
    })
  })

  test("rows 3 and 9 compare an approval against the newest live record", () => {
    const newer = record({ generation: 5 })

    expect(verdict(admission({ resumeChildID: "ses_unknown", approvedGeneration: 2 }), [newer])).toMatchObject({
      effect: "hold",
      row: "3",
      generation: null,
    })
    expect(verdict(admission({ resumeChildID: "ses_unknown", approvedGeneration: 6 }), [newer])).toMatchObject({
      effect: "allow",
      row: "3",
      generation: 6,
    })

    expect(verdict(admission({ frontierNow: null, approvedGeneration: 2 }), [newer])).toMatchObject({
      effect: "hold",
      row: "9",
      generation: null,
    })
    expect(verdict(admission({ frontierNow: null, approvedGeneration: 6 }), [newer])).toMatchObject({
      effect: "allow",
      row: "9",
      generation: 6,
    })
  })

  test("a row 5 admit retires, and the session ban opens only on the same user item", () => {
    const live = record()

    expect(verdict(admission({ frontierNow: 42 }), [live], parentSessionBan)).toMatchObject({
      effect: "allow",
      row: "5",
      retire: true,
      generation: null,
    })

    // A user item past the tombstone but not past the session ban still holds.
    const laterSessionBan: SessionBan = { kind: "parent", atSeq: 50, cause: "abort", at: NOW }
    expect(verdict(admission({ frontierNow: 42 }), [live], laterSessionBan)).toMatchObject({
      effect: "hold",
      row: "sessionBan",
      retire: false,
    })

    // The session ban hold compares against the record the task table matched, so a
    // stale approval cannot slip through the session ban after row 5 let it by.
    const newer: TaskRecord = record({ generation: 5 })
    expect(verdict(admission({ frontierNow: 42, approvedGeneration: 2 }), [newer], laterSessionBan)).toMatchObject({
      effect: "hold",
      row: "sessionBan",
      generation: null,
    })
    expect(verdict(admission({ frontierNow: 42, approvedGeneration: 6 }), [newer], laterSessionBan)).toMatchObject({
      effect: "allow",
      row: "sessionBan",
      generation: 6,
    })
  })

  test("a parent session ban keeps a stale or missing generation held", () => {
    for (const approvedGeneration of [undefined, Number.NaN, 0, -1, 1.5]) {
      expect(verdict(admission({ approvedGeneration }), [], parentSessionBan)).toMatchObject({
        effect: "hold",
        row: "sessionBan",
        generation: null,
      })
    }
  })

  test("a child subtree session ban denies with a valid generation present", () => {
    expect(verdict(admission(), [], subtreeSessionBan)).toMatchObject({ effect: "deny", row: "6", generation: null })
    expect(verdict(admission({ approvedGeneration: 2 }), [record({ generation: 1 })], subtreeSessionBan)).toMatchObject({
      effect: "deny",
      row: "6",
    })

    // An unknown kind is not a session ban a human can lift.
    expect(verdict(admission({ approvedGeneration: 2 }), [], { kind: "other" } as unknown as SessionBan)).toMatchObject({
      effect: "deny",
      row: "6",
    })
  })
})

describe("retirement", () => {
  test("TTL expiry and user-turn retirement", () => {
    const rec = record({ abortedAt: NOW })

    expect(tombstoneState(rec, NOW + TTL_MS - 1)).toBe("live")
    expect(tombstoneState(rec, NOW + TTL_MS)).toBe("expired")
    expect(tombstoneState(rec, NOW + TTL_MS + 1)).toBe("expired")
    expect(tombstoneState(rec, NOW + 1, TTL_MS * 2)).toBe("live")
    expect(tombstoneState(record({ abortedAt: undefined }), NOW)).toBe("none")
    expect(tombstoneState(record({ retiredAt: NOW - 5 }), NOW)).toBe("retired")

    expect(boundary(rec, 40)).toBe("same")
    expect(boundary(rec, 41)).toBe("same")
    expect(boundary(rec, 42)).toBe("later")

    expect(verdict(admission({ frontierNow: 41 }), [rec]).effect).toBe("hold")
    expect(verdict(admission({ frontierNow: 42 }), [rec])).toMatchObject({ effect: "allow", retire: true })
    expect(verdict(admission({ frontierNow: 41 }), [{ ...rec, abortedAt: NOW - TTL_MS - 1 }]).effect).toBe("allow")

    // Unattended, a hold denies at its deadline rather than waiting forever.
    expect(HOLD_MS).toBe(60_000)
    expect(TTL_MS).toBe(900_000)
  })
})

describe("store", () => {
  test("snapshot survives reopen", async () => {
    const parent = "ses_reopen"
    const key = fingerprint("summarize the parser")
    store.appendAudit(parent, { event: "abort", fingerprint: key, detail: "durability" })
    store.writeTask(parent, key, record({ parentID: parent }))

    const reopened = await import(`./session-ban-state.ts?reopen=${Date.now()}`)
    const read = reopened.readSnapshot(parent)
    expect(read).toMatchObject({ ok: true, reason: "ok", audit: "live" })
    expect(read.snap?.tasks[key]?.abortedAt).toBe(NOW - 1_000)
    expect(read.snap?.tasks[key]?.callKeys).toEqual(["call_aborted"])
    expect(read.snap?.frontierSeq).toBe(0)

    const paths = store.parentPaths(parent)
    expect(statSync(store.stateDir()).mode & 0o777).toBe(0o700)
    expect(statSync(paths.snapshot).mode & 0o777).toBe(0o600)
    expect(statSync(paths.audit).mode & 0o777).toBe(0o600)
    expect(readFileSync(paths.snapshot, "utf8")).toContain(key)
  })

  test("corrupt snapshot with readable audit holds parent-wide", () => {
    const parent = "ses_corrupt"
    const other = fingerprint("a different task")
    store.appendAudit(parent, { event: "abort", fingerprint: fingerprint("summarize the parser") })

    const paths = store.parentPaths(parent)
    writeFileSync(paths.snapshot, "{ not json", "utf8")

    const read = store.readSnapshot(parent)
    expect(read).toMatchObject({ ok: false, reason: "corrupt", audit: "live" })
    expect(() => store.writeTask(parent, other, record({ parentID: parent, fingerprint: other }))).toThrow()

    // Row 9: the key does not matter, the parent holds.
    const blind = admission({ parentID: parent, fingerprint: other, stateOk: false, audit: read.audit })
    expect(verdict(blind, [])).toMatchObject({ effect: "hold", row: "9" })

    // Row 10: unreadable, but nothing was ever aborted here.
    const empty = "ses_empty"
    writeFileSync(store.parentPaths(empty).snapshot, "", "utf8")
    const clean = store.readSnapshot(empty)
    expect(clean).toMatchObject({ ok: false, reason: "corrupt", audit: "clean" })
    expect(verdict(admission({ parentID: empty, fingerprint: other, stateOk: false, audit: clean.audit }), [])).toMatchObject({
      effect: "allow",
      row: "10",
    })

    // A session ban of unknown kind cannot be classified, so the snapshot is corrupt
    // and the parent holds. A named kind is readable.
    const sessionBannedID = "ses_ban_kind"
    const base = { v: 1, parentID: sessionBannedID, frontierSeq: 0, eventCursor: 0, tasks: {} }
    const sessionBanPath = store.parentPaths(sessionBannedID).snapshot
    writeFileSync(sessionBanPath, JSON.stringify({ ...base, sessionBan: { kind: "other", atSeq: 1, at: 2 } }), "utf8")
    expect(store.readSnapshot(sessionBannedID).reason).toBe("corrupt")
    writeFileSync(sessionBanPath, JSON.stringify({ ...base, sessionBan: { kind: "parent", atSeq: 1, cause: "abort", at: 2 } }), "utf8")
    expect(store.readSnapshot(sessionBannedID).snap?.sessionBan?.kind).toBe("parent")

    // A wrong schema is corruption, never an empty store.
    const wrong = "ses_version"
    writeFileSync(store.parentPaths(wrong).snapshot, JSON.stringify({ v: 2, parentID: wrong, tasks: {} }), "utf8")
    expect(store.readSnapshot(wrong).reason).toBe("version")
  })

  test("a torn audit line is skipped and a malformed one is unreadable", () => {
    const key = fingerprint("summarize the parser")

    // An interrupted append leaves a partial last line. It is not evidence.
    const torn = "ses_torn"
    store.appendAudit(torn, { event: "abort", fingerprint: key })
    appendFileSync(store.parentPaths(torn).audit, '{"event":"abo')
    expect(store.readSnapshot(torn).audit).toBe("live")

    // Anything else unparseable is a log that cannot be read at all.
    const broken = "ses_broken"
    store.appendAudit(broken, { event: "abort", fingerprint: key })
    appendFileSync(store.parentPaths(broken).audit, "not json\n")
    store.appendAudit(broken, { event: "retire", fingerprint: key })
    expect(store.readSnapshot(broken).audit).toBe("unreadable")

    writeFileSync(store.parentPaths(broken).snapshot, "{ not json", "utf8")
    const read = store.readSnapshot(broken)
    expect(verdict(admission({ parentID: broken, stateOk: false, audit: read.audit }), [])).toMatchObject({ effect: "hold", row: "9" })
  })

  test("a complete final audit line without a newline is parsed", () => {
    const key = fingerprint("summarize the parser")
    const parent = "ses_whole"
    mkdirSync(store.stateDir(), { recursive: true })
    const audit = store.parentPaths(parent).audit

    writeFileSync(audit, JSON.stringify({ event: "retire", fingerprint: key }), "utf8")
    expect(store.readSnapshot(parent).audit).toBe("clean")

    writeFileSync(audit, JSON.stringify({ event: "abort", fingerprint: key }), "utf8")
    expect(store.readSnapshot(parent).audit).toBe("live")
  })

  test("duplicate writes and replayed settlement are idempotent", () => {
    const parent = "ses_dupe"
    const key = fingerprint("summarize the parser")
    const first = record({ parentID: parent, childIDs: ["ses_child"], callKeys: ["call_a"], retiredAt: NOW - 100 })
    store.writeTask(parent, key, first)
    store.writeTask(parent, key, {
      ...first,
      retiredAt: NOW + 5_000,
      childIDs: ["ses_child", "ses_child"],
      callKeys: ["call_a", "call_a"],
      generation: 3,
    })

    const snap = store.readSnapshot(parent).snap
    expect(Object.keys(snap?.tasks ?? {})).toHaveLength(1)
    const rec = snap!.tasks[key]!
    expect(rec.retiredAt).toBe(NOW - 100)
    expect(rec.childIDs).toEqual(["ses_child"])
    expect(rec.callKeys).toEqual(["call_a"])
    expect(rec.generation).toBe(3)

    // Prune retires a live tombstone past its TTL exactly once.
    const old = fingerprint("an old task")
    store.writeTask(parent, old, record({ parentID: parent, fingerprint: old, abortedAt: NOW - TTL_MS - 1 }))
    expect(store.pruneSnapshot(parent, NOW)).toBe(1)
    expect(store.pruneSnapshot(parent, NOW)).toBe(0)
    expect(store.readSnapshot(parent).snap!.tasks[old]!.retiredAt).toBe(NOW)
    expect(store.readSnapshot(parent).snap!.tasks[key]!.retiredAt).toBe(NOW - 100)
  })

  test("a held lock blocks the write", () => {
    const parent = "ses_locked"
    const key = fingerprint("summarize the parser")
    mkdirSync(store.stateDir(), { recursive: true })
    const lock = `${store.parentPaths(parent).snapshot}.lock`
    writeFileSync(lock, `${process.pid} ${Date.now()} holder`)

    expect(() => store.writeTask(parent, key, record({ parentID: parent }))).toThrow()
    expect(store.readSnapshot(parent).ok).toBe(false)

    unlinkSync(lock)
    store.writeTask(parent, key, record({ parentID: parent }))
    expect(store.readSnapshot(parent).ok).toBe(true)
  })

  test("a takeover survives the preempted writer's release", () => {
    const parent = "ses_takeover"
    mkdirSync(store.stateDir(), { recursive: true })
    const lock = `${store.parentPaths(parent).snapshot}.lock`

    const body = store.withParentLock(parent, () => {
      // Another writer judged this holder stale and took the lock mid-body.
      writeFileSync(lock, "999999 1000 new-holder")
      return "ran"
    })

    expect(body).toBe("ran")
    // The preempted writer's release must not unlink the new holder's lock.
    expect(readFileSync(lock, "utf8")).toBe("999999 1000 new-holder")
    unlinkSync(lock)
  })

  test("a stale lock is recovered", () => {
    const parent = "ses_stale"
    const key = fingerprint("summarize the parser")
    mkdirSync(store.stateDir(), { recursive: true })
    const lock = `${store.parentPaths(parent).snapshot}.lock`
    writeFileSync(lock, "999999 1000 dead")

    store.writeTask(parent, key, record({ parentID: parent }))
    expect(store.readSnapshot(parent).ok).toBe(true)
    expect(existsSync(lock)).toBe(false)
  })

  test("two processes writing one parent keep every key", async () => {
    const parent = "ses_race"
    const module = join(import.meta.dir, "session-ban-state.ts")
    const script = join(scratch, "race-writer.ts")
    writeFileSync(
      script,
      `import { writeTask } from ${JSON.stringify(module)}
const rec = (key: string) => ({
  parentID: ${JSON.stringify(parent)},
  fingerprint: key,
  agent: "general",
  generation: 1,
  frontierAtAdmit: 0,
  callKeys: [],
  childIDs: [],
  retiredAt: null,
})
for (let i = 0; i < 100; i++) writeTask(${JSON.stringify(parent)}, "child-" + i, rec("child-" + i))
`,
      "utf8",
    )

    const child = Bun.spawn([process.execPath, script], {
      cwd: scratch,
      env: { ...process.env, OPENCODE_JEV_SESSION_BAN_DIR: store.stateDir() },
      stdout: "ignore",
      stderr: "inherit",
    })
    for (let i = 0; i < 100; i++) store.writeTask(parent, `parent-${i}`, record({ parentID: parent, fingerprint: `parent-${i}` }))
    expect(await child.exited).toBe(0)

    const keys = Object.keys(store.readSnapshot(parent).snap?.tasks ?? {})
    expect(keys).toHaveLength(200)
    expect(keys).toContain("child-99")
    expect(keys).toContain("parent-99")
  })

  test("retired records are pruned and the audit is kept", () => {
    const parent = "ses_prune"
    const kept = fingerprint("a kept task")
    const dropped = fingerprint("a dropped task")
    store.appendAudit(parent, { event: "abort", fingerprint: dropped })
    store.appendAudit(parent, { event: "retire", fingerprint: dropped })
    store.writeTask(parent, kept, record({ parentID: parent, fingerprint: kept, retiredAt: NOW - 1 }))
    store.writeTask(parent, dropped, record({ parentID: parent, fingerprint: dropped, retiredAt: NOW - TTL_MS - 1 }))

    expect(store.pruneSnapshot(parent, NOW)).toBe(1)
    expect(Object.keys(store.readSnapshot(parent).snap?.tasks ?? {})).toEqual([kept])

    // The snapshot record is bounded; the audit is not.
    expect(readFileSync(store.parentPaths(parent).audit, "utf8")).toContain(dropped)
    store.removeParent(parent)
    expect(existsSync(store.parentPaths(parent).audit)).toBe(false)
  })

  test("colliding session ids keep separate files", () => {
    const slash = "ses_collide/one"
    const underscore = "ses_collide_one"
    const keyA = fingerprint("first task")
    const keyB = fingerprint("second task")

    expect(store.parentPaths(slash).snapshot).not.toBe(store.parentPaths(underscore).snapshot)
    store.writeTask(slash, keyA, record({ parentID: slash, fingerprint: keyA }))
    store.writeTask(underscore, keyB, record({ parentID: underscore, fingerprint: keyB }))

    store.removeParent(slash)
    expect(store.readSnapshot(slash).reason).toBe("missing")
    expect(store.readSnapshot(underscore).ok).toBe(true)
  })
})

describe("the abort release seam on the ban store", () => {
  test("an attributed row persists and clears only for its own operation", () => {
    const parent = "ses_attr"
    expect(store.writeSubtreeBan(parent, "abort: operator abort", NOW, "op_mine")).toBe(true)
    // The attribution survives a reopen read; it is what a release keys on.
    expect(store.readSnapshot(parent).snap?.sessionBan).toMatchObject({ kind: "subtree", operation: "op_mine" })

    // Another active operation's row is an independent restriction.
    const other = "ses_attr_other"
    store.writeSubtreeBan(other, "abort: operator abort", NOW, "op_live")
    expect(store.clearSubtreeBan(other, "op_mine")).toBe("kept")
    expect(store.readSnapshot(other).snap?.sessionBan?.operation).toBe("op_live")

    expect(store.clearSubtreeBan(parent, "op_mine")).toBe("cleared")
    expect(store.readSnapshot(parent).snap?.sessionBan).toBeUndefined()
    // The clear is idempotent: a retried release answers absent, not failed.
    expect(store.clearSubtreeBan(parent, "op_mine")).toBe("absent")
  })

  test("a row whose operation is already released is debris, not a restriction", () => {
    // B-then-A overlap: the ancestor's later write replaced the child's row, so
    // the row names an operation that is itself released by the time the
    // child's release sweeps the session.
    const parent = "ses_debris"
    store.writeSubtreeBan(parent, "abort: operator abort", NOW, "op_released_anc")
    // Without the released ids, the row is not this release's to lift.
    expect(store.clearSubtreeBan(parent, "op_child")).toBe("kept")
    expect(store.clearSubtreeBan(parent, "op_child", ["op_released_anc"])).toBe("cleared")
    expect(store.readSnapshot(parent).snap?.sessionBan).toBeUndefined()
    // A live operation named in the list is still a restriction: the list is
    // released ids, not a blanket clear.
    const live = "ses_debris_live"
    store.writeSubtreeBan(live, "abort: operator abort", NOW, "op_still_live")
    expect(store.clearSubtreeBan(live, "op_child", ["op_released_anc"])).toBe("kept")
  })

  test("another family's rows stay, whatever their kind or cause", () => {
    const base = (parentID: string, sessionBan: SessionBan) => ({ v: 1, parentID, frontierSeq: 0, eventCursor: 0, tasks: {}, sessionBan })
    // The session-ban host's own parent-kind row: the approvable one a release
    // must not lift.
    const parentKind = "ses_family_parent"
    writeFileSync(
      store.parentPaths(parentKind).snapshot,
      JSON.stringify(base(parentKind, { kind: "parent", atSeq: 1, cause: "session: user: stopped the session", at: NOW })),
      "utf8",
    )
    expect(store.clearSubtreeBan(parentKind, "op_mine")).toBe("kept")

    // The task family's subtree row shares the kind but not the cause.
    const taskKind = "ses_family_task"
    writeFileSync(
      store.parentPaths(taskKind).snapshot,
      JSON.stringify(base(taskKind, { kind: "subtree", atSeq: 1, cause: "task abc123: budget reached", at: NOW })),
      "utf8",
    )
    expect(store.clearSubtreeBan(taskKind, "op_mine")).toBe("kept")
    expect(store.readSnapshot(taskKind).snap?.sessionBan?.cause).toContain("task")
  })

  test("legacy rows attribute by the abort family's fixed cause prefixes", () => {
    const aborted = "ses_legacy_abort"
    store.writeSubtreeBan(aborted, "abort: operator abort", NOW)
    expect(store.clearSubtreeBan(aborted, "op_mine")).toBe("cleared")

    const recovered = "ses_legacy_recovery"
    store.writeSubtreeBan(recovered, "recovery: the abort ban was not confirmed", NOW)
    expect(store.clearSubtreeBan(recovered, "op_mine")).toBe("cleared")
  })

  test("an unreadable store fails the clear and the row stands", () => {
    const parent = "ses_clear_failed"
    store.writeSubtreeBan(parent, "abort: operator abort", NOW, "op_mine")
    writeFileSync(store.parentPaths(parent).snapshot, "{ not json", "utf8")
    expect(store.clearSubtreeBan(parent, "op_mine")).toBe("failed")
  })
})

describe("frontier", () => {
  test("only user enqueues advance", () => {
    const enqueue = (seq: number, type: string) => ({
      type: "session.inbox.enqueued",
      durable: { aggregateID: PARENT, seq },
      data: { item: { type } },
    })

    expect(frontier.applyEvent({ seq: 0, cursor: 0 }, enqueue(5, "user"), PARENT)).toEqual({ seq: 5, cursor: 5 })
    expect(frontier.applyEvent({ seq: 5, cursor: 5 }, enqueue(6, "synthetic"), PARENT)).toEqual({ seq: 5, cursor: 6 })
    expect(frontier.applyEvent({ seq: 5, cursor: 6 }, enqueue(7, "compaction"), PARENT)).toEqual({ seq: 5, cursor: 7 })
    expect(
      frontier.applyEvent({ seq: 5, cursor: 7 }, { type: "session.inbox.delivered", durable: { aggregateID: PARENT, seq: 8 } }, PARENT),
    ).toEqual({ seq: 5, cursor: 8 })

    // A replay of an old sequence moves nothing.
    expect(frontier.applyEvent({ seq: 5, cursor: 8 }, enqueue(5, "user"), PARENT)).toEqual({ seq: 5, cursor: 8 })
    // An event without a durable sequence is unordered, so it is ignored.
    expect(
      frontier.applyEvent({ seq: 5, cursor: 8 }, { type: "session.inbox.enqueued", data: { item: { type: "user" } } }, PARENT),
    ).toEqual({ seq: 5, cursor: 8 })

    // Another session's sequence belongs to another aggregate and cannot retire
    // a tombstone here.
    const foreign = { type: "session.inbox.enqueued", durable: { aggregateID: OTHER, seq: 99 }, data: { item: { type: "user" } } }
    expect(frontier.applyEvent({ seq: 5, cursor: 8 }, foreign, PARENT)).toEqual({ seq: 5, cursor: 8 })
    expect(frontier.applyEvent({ seq: 0, cursor: 0 }, foreign, PARENT)).toEqual({ seq: 0, cursor: 0 })

    expect([...DEGRADED_RETRY_MS]).toEqual([250, 1_000, 4_000, 15_000])
    expect([1, 2, 3, 4].map((attempt) => frontier.retrySchedule(attempt))).toEqual([250, 1_000, 4_000, 15_000])
    expect(frontier.retrySchedule(0)).toBeNull()
    expect(frontier.retrySchedule(5)).toBeNull()

    expect(frontier.degraded("failed", "ok")).toBe(true)
    expect(frontier.degraded("ok", "failed")).toBe(true)
    expect(frontier.degraded("ok", "ok")).toBe(false)

    expect(frontier.repair({ seq: 5, cursor: 8 }, "failed", "ok")).toBeNull()
    expect(frontier.repair({ seq: 5, cursor: 8 }, "ok", "failed")).toBeNull()
    expect(frontier.repair({ seq: 5, cursor: 8 }, "ok", "ok")).toEqual({ seq: 5, cursor: 8 })
  })
})

describe("session ban store migration", () => {
  test("the new state-dir env var wins and the old one is a fallback", () => {
    const savedNew = process.env[store.STATE_DIR_ENV]
    const savedOld = process.env.OPENCODE_JEV_NOSPAWN_DIR
    const savedRoot = process.env.OPENCODE_JEV_STATE_HOME
    try {
      process.env.OPENCODE_JEV_STATE_HOME = scratch
      process.env[store.STATE_DIR_ENV] = join(scratch, "migration-new")
      process.env.OPENCODE_JEV_NOSPAWN_DIR = join(scratch, "migration-old")
      expect(store.stateDir()).toBe(join(scratch, "migration-new"))
      delete process.env[store.STATE_DIR_ENV]
      expect(store.stateDir()).toBe(join(scratch, "migration-old"))
      delete process.env.OPENCODE_JEV_NOSPAWN_DIR
      expect(store.stateDir()).toBe(join(scratch, "session-ban"))
    } finally {
      if (savedNew === undefined) delete process.env[store.STATE_DIR_ENV]
      else process.env[store.STATE_DIR_ENV] = savedNew
      if (savedOld === undefined) delete process.env.OPENCODE_JEV_NOSPAWN_DIR
      else process.env.OPENCODE_JEV_NOSPAWN_DIR = savedOld
      if (savedRoot === undefined) delete process.env.OPENCODE_JEV_STATE_HOME
      else process.env.OPENCODE_JEV_STATE_HOME = savedRoot
    }
  })

  test("a legacy store directory is read, then the new one takes over", () => {
    const root = mkdtempSync(join(tmpdir(), "jev-ban-dir-"))
    const savedNew = process.env[store.STATE_DIR_ENV]
    const savedOld = process.env.OPENCODE_JEV_NOSPAWN_DIR
    const savedData = process.env.JEV_DATA_DIR
    const savedState = process.env.JEV_STATE_HOME
    const savedRoot = process.env.OPENCODE_JEV_STATE_HOME
    try {
      delete process.env[store.STATE_DIR_ENV]
      delete process.env.OPENCODE_JEV_NOSPAWN_DIR
      delete process.env.OPENCODE_JEV_STATE_HOME
      process.env.JEV_DATA_DIR = root
      process.env.JEV_STATE_HOME = root
      const parent = "ses_legacy_dir"
      const key = fingerprint("legacy dir task")
      process.env[store.STATE_DIR_ENV] = join(root, "nospawn")
      store.writeTask(parent, key, record({ parentID: parent, fingerprint: key }))
      delete process.env[store.STATE_DIR_ENV]

      expect(store.stateDir()).toBe(join(root, "nospawn"))
      expect(store.readSnapshot(parent).snap?.tasks[key]).toBeDefined()

      const currentParent = "ses_current_dir"
      const currentKey = fingerprint("current dir task")
      process.env[store.STATE_DIR_ENV] = join(root, "session-ban")
      store.writeTask(currentParent, currentKey, record({ parentID: currentParent, fingerprint: currentKey }))
      delete process.env[store.STATE_DIR_ENV]

      expect(store.stateDir()).toBe(join(root, "session-ban"))
      expect(store.readSnapshot(currentParent).snap?.tasks[currentKey]).toBeDefined()
    } finally {
      if (savedNew === undefined) delete process.env[store.STATE_DIR_ENV]
      else process.env[store.STATE_DIR_ENV] = savedNew
      if (savedOld === undefined) delete process.env.OPENCODE_JEV_NOSPAWN_DIR
      else process.env.OPENCODE_JEV_NOSPAWN_DIR = savedOld
      if (savedData === undefined) delete process.env.JEV_DATA_DIR
      else process.env.JEV_DATA_DIR = savedData
      if (savedState === undefined) delete process.env.JEV_STATE_HOME
      else process.env.JEV_STATE_HOME = savedState
      if (savedRoot === undefined) delete process.env.OPENCODE_JEV_STATE_HOME
      else process.env.OPENCODE_JEV_STATE_HOME = savedRoot
      rmSync(root, { recursive: true, force: true })
    }
  })
})
