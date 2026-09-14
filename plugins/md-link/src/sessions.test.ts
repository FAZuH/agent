import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { sessionRow } from "./tui.ts"

const dir = mkdtempSync(join(tmpdir(), "md-link-sessions-"))
const SID = "ses_abc123def456"

function st(extra: any = {}) {
  return { defaultDir: null, keep: null, sessions: { [SID]: dir }, titles: {}, files: {}, ...extra } as any
}

describe("sessionRow", () => {
  test("recorded title + file path + mtime timestamp", () => {
    const name = "link_Rust lesson.md"
    writeFileSync(join(dir, name), "<!-- msg:x -->\n**10:00**\n\nhi\n\n", "utf-8")
    const when = new Date(2026, 8, 15, 8, 12) // local: Sep 15 2026 08:12
    utimesSync(join(dir, name), when, when)
    const row = sessionRow(st({ titles: { [SID]: "Rust lesson" }, files: { [SID]: name } }), SID)
    expect(row.title).toBe("Rust lesson")
    expect(row.value).toBe(SID)
    expect(row.description).toContain(join(dir, name))
    expect(row.description).toMatch(/· 2026-09-15 08:12$/)
    expect(Math.round(row.mtime / 1000)).toBe(Math.round(when.getTime() / 1000))
  })

  test("legacy entry without title/file records falls back to session ID + old name", () => {
    const row = sessionRow(st(), SID)
    expect(row.title).toBe(SID)
    expect(row.description).toContain(`${SID}_link.md`)
  })

  test("path-like recorded name is ignored (state file is user-editable)", () => {
    const row = sessionRow(st({ files: { [SID]: "../escape.md" } }), SID)
    expect(row.description).toContain(`${SID}_link.md`)
    expect(row.description).not.toContain("escape")
  })

  test("missing file is flagged, mtime 0", () => {
    const row = sessionRow(st({ files: { [SID]: "link_gone.md" }, titles: { [SID]: "Gone" } }), SID)
    expect(row.title).toBe("Gone")
    expect(row.description).toContain("(file missing)")
    expect(row.mtime).toBe(0)
  })

  afterAll(() => rmSync(dir, { recursive: true, force: true }))
})
