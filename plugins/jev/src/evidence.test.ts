/**
 * Self-check for the pure evidence broker: allowlist guards, bounded excerpts,
 * redaction and the host-adapter seam. The adapter below is an in-memory spy;
 * no filesystem, network or shell is touched.
 *
 *   bun test plugins/jev/src/evidence.test.ts
 */

import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  MAX_EXCERPT_CHARS,
  MAX_EXCERPTS,
  MAX_QUERY_CHARS,
  boundExcerpt,
  createEvidenceBroker,
  redactExcerpt,
  validateGlob,
  validatePath,
  validateQuery,
  validateRev,
  type RawEvidenceAdapter,
} from "./evidence.ts"

const ROOT = "/repo"
const scratch = mkdtempSync(join(tmpdir(), "jev-evidence-test-"))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

const fake = (over: Partial<RawEvidenceAdapter> = {}): RawEvidenceAdapter => ({
  async readFile() {
    return "file body"
  },
  async search() {
    return []
  },
  async gitShow() {
    return "commit body"
  },
  async gitLog() {
    return []
  },
  ...over,
})

describe("approved constants", () => {
  test("excerpt and result caps are bounded", () => {
    expect(MAX_EXCERPT_CHARS).toBe(400)
    expect(MAX_EXCERPTS).toBe(8)
    expect(MAX_QUERY_CHARS).toBe(200)
  })
})

describe("validatePath allowlist", () => {
  const allowed = [
    ["a plain relative path", "src/index.ts", "src/index.ts"],
    ["a leading dot slash", "./docs/jev.md", "docs/jev.md"],
    ["an interior parent segment", "a/b/../c.ts", "a/c.ts"],
    ["an absolute path under root", `${ROOT}/plugins/jev/src/index.ts`, "plugins/jev/src/index.ts"],
  ] as const

  for (const [label, raw, expected] of allowed) {
    test(`accepts ${label}`, () => {
      expect(validatePath(raw, ROOT)).toEqual({ ok: true, value: expected })
    })
  }

  const denied = [
    ["a path outside root", "/etc/passwd", "outside root"],
    ["parent traversal", "../../etc/passwd", "outside root"],
    ["a dotenv file", ".env", "secret"],
    ["a dotenv variant", "config/.env.production", "secret"],
    ["an ssh private key", "keys/id_rsa", "secret"],
    ["a pem file", "certs/server.pem", "secret"],
    ["a token-named file", "config/api-token.txt", "secret"],
    ["git internals", ".git/config", "git internals"],
    ["a network URL", "https://example.com/x", "network"],
    ["an scp-style URL", "git@github.com:org/repo.git", "network"],
    ["a shell metacharacter", "src/a;rm -rf /", "metacharacter"],
    ["a command substitution", "src/$(id)", "metacharacter"],
    ["a nul byte", "src/a\u0000b", "metacharacter"],
    ["an empty path", "", "invalid"],
  ] as const

  for (const [label, raw, reason] of denied) {
    test(`denies ${label}`, () => {
      const result = validatePath(raw, ROOT)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.reason).toContain(reason)
    })
  }
})

describe("validateRev allowlist", () => {
  test("accepts a short hex revision", () => {
    expect(validateRev("a1b2c3d")).toEqual({ ok: true, value: "a1b2c3d" })
  })

  test("accepts HEAD with an offset", () => {
    expect(validateRev("HEAD~2")).toEqual({ ok: true, value: "HEAD~2" })
  })

  test("denies a shell metacharacter", () => {
    expect(validateRev("HEAD;rm -rf /").ok).toBe(false)
  })

  test("denies a colon path escape", () => {
    expect(validateRev("HEAD:../config").ok).toBe(false)
  })

  test("denies an empty revision", () => {
    expect(validateRev("").ok).toBe(false)
  })
})

describe("validateQuery allowlist", () => {
  test("accepts a plain search term", () => {
    expect(validateQuery("evaluatePermission")).toEqual({ ok: true, value: "evaluatePermission" })
  })

  test("denies a shell metacharacter", () => {
    expect(validateQuery("x | sh").ok).toBe(false)
  })

  test("denies an empty query", () => {
    expect(validateQuery("   ").ok).toBe(false)
  })

  test("denies an overlong query", () => {
    expect(validateQuery("a".repeat(MAX_QUERY_CHARS + 1)).ok).toBe(false)
  })
})

describe("validateGlob allowlist", () => {
  test("accepts a safe glob", () => {
    expect(validateGlob("src/**/*.ts")).toEqual({ ok: true, value: "src/**/*.ts" })
  })

  test("accepts an absent glob", () => {
    expect(validateGlob(undefined)).toEqual({ ok: true, value: undefined })
  })

  test("denies a shell metacharacter", () => {
    expect(validateGlob("src/`id`").ok).toBe(false)
  })
})

describe("boundExcerpt", () => {
  test("keeps a short excerpt intact", () => {
    expect(boundExcerpt("short body")).toBe("short body")
  })

  test("caps a long excerpt", () => {
    expect(boundExcerpt("x".repeat(MAX_EXCERPT_CHARS + 50)).length).toBeLessThanOrEqual(MAX_EXCERPT_CHARS)
  })

  test("honors a custom cap", () => {
    expect(boundExcerpt("abcdef", 3).length).toBeLessThanOrEqual(3)
  })
})

describe("redactExcerpt", () => {
  test("redacts a bearer token", () => {
    const out = redactExcerpt("Authorization: Bearer sk-abc123secretvalue")
    expect(out.text).not.toContain("sk-abc123secretvalue")
    expect(out.redacted).toBe(true)
  })

  test("redacts a key assignment", () => {
    const out = redactExcerpt('API_KEY="supersecretvalue"')
    expect(out.text).not.toContain("supersecretvalue")
    expect(out.redacted).toBe(true)
  })

  test("redacts a private key header", () => {
    const out = redactExcerpt("-----BEGIN RSA PRIVATE KEY-----")
    expect(out.text).not.toContain("PRIVATE KEY")
    expect(out.redacted).toBe(true)
  })

  test("leaves clean code unchanged", () => {
    const out = redactExcerpt("the permission hook blocks the call")
    expect(out.redacted).toBe(false)
    expect(out.text).toBe("the permission hook blocks the call")
  })
})

describe("createEvidenceBroker", () => {
  test("readFile returns one bounded ref and never the whole body", async () => {
    const body = "y".repeat(MAX_EXCERPT_CHARS + 100)
    const broker = createEvidenceBroker(fake({ async readFile() { return body } }), { root: ROOT })
    const result = await broker.readFile({ path: "src/index.ts" })
    expect(result.error).toBeUndefined()
    expect(result.refs).toHaveLength(1)
    expect(result.refs[0].path).toBe("src/index.ts")
    expect(result.refs[0].kind).toBe("file")
    expect(result.refs[0].excerpt.length).toBeLessThanOrEqual(MAX_EXCERPT_CHARS)
  })

  test("readFile denies an outside path without calling the adapter", async () => {
    let called = false
    const broker = createEvidenceBroker(fake({ async readFile() { called = true; return "x" } }), { root: ROOT })
    const result = await broker.readFile({ path: "/etc/passwd" })
    expect(result.error).toContain("denied")
    expect(result.refs).toHaveLength(0)
    expect(called).toBe(false)
  })

  test("readFile denies a secret filename", async () => {
    const broker = createEvidenceBroker(fake(), { root: ROOT })
    const result = await broker.readFile({ path: ".env" })
    expect(result.error).toContain("secret")
  })

  test("readFile redacts secrets from an adapter excerpt", async () => {
    const broker = createEvidenceBroker(fake({ async readFile() { return "token=abcdefghijklmnop" } }), { root: ROOT })
    const result = await broker.readFile({ path: "src/config.ts" })
    expect(result.redacted).toBe(true)
    expect(result.refs[0].excerpt).not.toContain("abcdefghijklmnop")
  })

  test("search returns bounded refs with line numbers", async () => {
    const broker = createEvidenceBroker(
      fake({ async search() { return [{ path: "src/index.ts", line: 12, text: "  const x = 1" }] } }),
      { root: ROOT },
    )
    const result = await broker.search({ query: "const x" })
    expect(result.refs[0]).toMatchObject({ kind: "search", path: "src/index.ts", line: 12 })
  })

  test("search denies a query with metacharacters", async () => {
    const broker = createEvidenceBroker(fake(), { root: ROOT })
    const result = await broker.search({ query: "x | sh" })
    expect(result.error).toContain("denied")
  })

  test("search drops adapter refs whose path escapes root", async () => {
    const broker = createEvidenceBroker(
      fake({ async search() { return [{ path: "/etc/passwd", text: "root:x" }] } }),
      { root: ROOT },
    )
    const result = await broker.search({ query: "root" })
    expect(result.refs).toHaveLength(0)
  })

  test("gitShow validates the revision and bounds the excerpt", async () => {
    const broker = createEvidenceBroker(fake({ async gitShow() { return "z".repeat(MAX_EXCERPT_CHARS + 10) } }), {
      root: ROOT,
    })
    const result = await broker.gitShow({ rev: "a1b2c3d", path: "src/index.ts" })
    expect(result.error).toBeUndefined()
    expect(result.refs[0]).toMatchObject({ kind: "git-show", rev: "a1b2c3d", path: "src/index.ts" })
    expect(result.refs[0].excerpt.length).toBeLessThanOrEqual(MAX_EXCERPT_CHARS)
  })

  test("gitShow denies an invalid revision without calling the adapter", async () => {
    let called = false
    const broker = createEvidenceBroker(fake({ async gitShow() { called = true; return "x" } }), { root: ROOT })
    const result = await broker.gitShow({ rev: "HEAD;id", path: "src/index.ts" })
    expect(result.error).toContain("denied")
    expect(called).toBe(false)
  })

  test("gitLog returns refs with revision and subject", async () => {
    const broker = createEvidenceBroker(
      fake({ async gitLog() { return [{ rev: "deadbeef", subject: "fix the hook" }] } }),
      { root: ROOT },
    )
    const result = await broker.gitLog({ maxCount: 3 })
    expect(result.refs[0]).toMatchObject({ kind: "git-log", rev: "deadbeef", excerpt: "fix the hook" })
  })

  test("gitLog caps the number of refs", async () => {
    const rows = Array.from({ length: MAX_EXCERPTS + 12 }, (_, i) => ({
      rev: "abcdef0123456789",
      subject: `commit ${i}`,
    }))
    const broker = createEvidenceBroker(fake({ async gitLog() { return rows } }), { root: ROOT })
    const result = await broker.gitLog({})
    expect(result.refs.length).toBeLessThanOrEqual(MAX_EXCERPTS)
  })
})

describe("symlink confinement", () => {
  test("denies a symlink inside root pointing to a secret outside root", async () => {
    const root = join(scratch, "root-file")
    const outside = join(scratch, "outside-file")
    mkdirSync(root)
    mkdirSync(outside)
    const secret = join(outside, "secret.txt")
    writeFileSync(secret, "top-secret-value")
    symlinkSync(secret, join(root, "link.txt"))

    let called = false
    const broker = createEvidenceBroker(fake({ async readFile() { called = true; return "top-secret-value" } }), {
      root,
    })
    const result = await broker.readFile({ path: "link.txt" })
    expect(result.error).toContain("symlink")
    expect(result.refs).toHaveLength(0)
    expect(called).toBe(false)
  })

  test("denies a file reached through a symlinked directory", async () => {
    const root = join(scratch, "root-dir")
    const outside = join(scratch, "outside-dir")
    mkdirSync(root)
    mkdirSync(outside)
    writeFileSync(join(outside, "data.txt"), "outside-body")
    symlinkSync(outside, join(root, "linkdir"))

    const broker = createEvidenceBroker(fake(), { root })
    const result = await broker.readFile({ path: "linkdir/data.txt" })
    expect(result.error).toContain("symlink")
    expect(result.refs).toHaveLength(0)
  })

  test("reads a regular file inside the real root", async () => {
    const root = join(scratch, "root-ok")
    mkdirSync(root)
    let seen: string | undefined
    const broker = createEvidenceBroker(
      fake({ async readFile(path) { seen = path; return "plain body" } }),
      { root },
    )
    const result = await broker.readFile({ path: "ok.txt" })
    expect(result.error).toBeUndefined()
    expect(result.refs[0].excerpt).toBe("plain body")
    expect(seen).toBe("ok.txt")
  })
})

describe("guard and adapter contract in a temp dir", () => {
  test("readFile passes the validated path and bounds the returned excerpt", async () => {
    const root = join(scratch, "contract-read")
    mkdirSync(root)
    writeFileSync(join(root, "app.ts"), "const answer = 42\n".repeat(40))
    const seen: string[] = []
    const adapter: RawEvidenceAdapter = {
      async readFile(path) {
        seen.push(path)
        return readFileSync(join(root, path), "utf8")
      },
      async search() {
        return []
      },
      async gitShow() {
        return ""
      },
      async gitLog() {
        return []
      },
    }
    const broker = createEvidenceBroker(adapter, { root })
    const result = await broker.readFile({ path: "app.ts" })
    expect(seen).toEqual(["app.ts"])
    expect(result.refs[0].excerpt.length).toBeLessThanOrEqual(MAX_EXCERPT_CHARS)
  })

  test("search drops a hit reached through a symlinked directory", async () => {
    const root = join(scratch, "contract-search")
    const outside = join(scratch, "contract-outside")
    mkdirSync(root)
    mkdirSync(outside)
    writeFileSync(join(outside, "data.ts"), "outer body")
    symlinkSync(outside, join(root, "linkdir"))
    const adapter: RawEvidenceAdapter = {
      ...fake(),
      async search() {
        return [
          { path: "app.ts", line: 1, text: "plain body" },
          { path: "linkdir/data.ts", line: 2, text: "outer body" },
        ]
      },
    }
    const broker = createEvidenceBroker(adapter, { root })
    const result = await broker.search({ query: "data" })
    expect(result.refs).toHaveLength(1)
    expect(result.refs[0].path).toBe("app.ts")
  })

  test("gitShow and gitLog carry validated revisions into refs", async () => {
    const root = join(scratch, "contract-git")
    mkdirSync(root)
    const adapter: RawEvidenceAdapter = {
      ...fake(),
      async gitShow() {
        return "shown body"
      },
      async gitLog() {
        return [{ rev: "deadbeef", subject: "fix the hook" }]
      },
    }
    const broker = createEvidenceBroker(adapter, { root })
    const shown = await broker.gitShow({ rev: "deadbeef", path: "app.ts" })
    const logged = await broker.gitLog({ maxCount: 2 })
    expect(shown.refs[0].rev).toBe("deadbeef")
    expect(logged.refs[0].rev).toBe("deadbeef")
  })

  test("search caps results when an adapter returns 2100 hits", async () => {
    const root = join(scratch, "contract-cap")
    mkdirSync(root)
    const hits = Array.from({ length: 2100 }, (_, i) => ({ path: "app.ts", line: i + 1, text: "match" }))
    const adapter: RawEvidenceAdapter = {
      ...fake(),
      async search() {
        return hits
      },
    }
    const broker = createEvidenceBroker(adapter, { root })
    const result = await broker.search({ query: "match" })
    expect(result.refs.length).toBe(MAX_EXCERPTS)
  })
})
