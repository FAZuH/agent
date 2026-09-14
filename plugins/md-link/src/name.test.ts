import { describe, expect, test } from "bun:test"
import { resolveMirrorName, sanitizeTitle, shortSuffix } from "./core.ts"

describe("sanitizeTitle", () => {
  test("strips path separators and control chars, trims, caps length", () => {
    expect(sanitizeTitle("a/b\\c")).toBe("a-b-c")
    expect(sanitizeTitle("  spaced  ")).toBe("spaced")
    expect(sanitizeTitle("bad\x00\x1fname")).toBe("badname")
    expect(sanitizeTitle("x".repeat(200)).length).toBe(120)
  })

  test("trailing dots/spaces removed (Windows-safe)", () => {
    expect(sanitizeTitle("title. ")).toBe("title")
  })

  test("empty/untypeable input → empty string (caller falls back to session ID)", () => {
    expect(sanitizeTitle(null)).toBe("")
    expect(sanitizeTitle("///")).toBe("-")
  })
})

describe("shortSuffix", () => {
  test("first 6 alphanumerics after ses_, non-empty", () => {
    expect(shortSuffix("ses_f6296a732ffeunvD5N8Onp3QJ9")).toBe("f6296a")
    expect(shortSuffix("weird__id")).toBe("weirdi")
    expect(shortSuffix("")).toBe("x")
  })
})

describe("resolveMirrorName", () => {
  test("plain name when free", () => {
    expect(resolveMirrorName("Rust lesson", "ses_abc123", new Set())).toBe("link_Rust lesson.md")
  })

  test("collision → suffixed with short session ID", () => {
    const taken = new Set(["link_Rust lesson.md"])
    expect(resolveMirrorName("Rust lesson", "ses_abc123def", taken)).toBe("link_Rust lesson_abc123.md")
  })

  test("double collision → -2, -3 …", () => {
    const taken = new Set(["link_T.md", "link_T_abc123.md", "link_T_abc123-2.md"])
    expect(resolveMirrorName("T", "ses_abc123", taken)).toBe("link_T_abc123-3.md")
  })
})
