import { createRequire } from "module"
import path from "path"
import fs from "fs/promises"

const MERMAID_CDN = "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs"
// .mjs + type="module" is required: the classic-script .esm.min.js build fails to boot.
const SCAN_EXTS = new Set([".html", ".htm", ".md", ".markdown", ".txt", ".mmd"])
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build"])

export interface Diagram {
  file: string
  line: number
  index: number
  src: string
}

export interface Failure {
  file: string
  line: number
  index: number
  stage: "parse" | "render" | "timeout"
  error: string
}

export interface DoctorMeta {
  ok: boolean
  total: number
  passed: number
  failed: number
  failures: Failure[]
}

export interface DoctorArgs {
  paths?: string[]
  raw?: string
  render?: boolean
  timeout_ms?: number
}

// Browsers hand mermaid decoded text: entity references become chars and <br>
// variants collapse to newlines. We replicate exactly that on raw bytes instead
// of DOM-parsing, so what the parser sees matches what a live page sees.
// &amp; is decoded LAST so "&amp;gt;" never becomes ">".
function preprocessHtmlText(raw: string): string {
  return raw
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, "\u00a0")
    .replace(/&amp;/g, "&")
}

function lineOf(text: string, offset: number): number {
  let line = 1
  for (let i = 0; i < offset && i < text.length; i++) if (text[i] === "\n") line++
  return line
}

// Class attribute must carry "mermaid" as a whole token (extra tokens allowed).
function classHasMermaid(attrs: string): boolean {
  const cls = /\bclass\s*=\s*("([^"]*)"|'([^']*)'|(\S+))/i.exec(attrs)
  return (cls?.[2] ?? cls?.[3] ?? cls?.[4] ?? "").split(/\s+/).some((t) => t.toLowerCase() === "mermaid")
}

function extractHtml(text: string, file: string): Diagram[] {
  const out: Diagram[] = []
  // Nesting-aware scan over raw bytes so true line numbers survive: paired
  // open/close regexes pair an opener with the FIRST closer of its name and
  // silently swallow mermaid blocks wrapped in outer <div>s.
  // Known limitation: pre/div tags inside QUOTED attribute values would be
  // tokenized as markup; real report/document shells never do this.
  const tokens = /<(pre|div)\b([^>]*)>|<\/(pre|div)\s*>/gi
  let stack: string[] | null = null
  let openerAt = -1
  let bodyFrom = -1
  for (const m of text.matchAll(tokens)) {
    const name = (m[1] ?? m[3]).toLowerCase()
    const isOpen = m[1] !== undefined
    if (!stack) {
      if (!isOpen || !classHasMermaid(m[2] ?? "")) continue
      stack = [name]
      openerAt = m.index!
      bodyFrom = m.index! + m[0].length
    } else if (isOpen) {
      stack.push(name)
    } else {
      // Tolerate mild malformation: pop the NEAREST matching name from the
      // tail instead of hard-failing on cross-tag mismatches.
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i] === name) {
          stack.splice(i, 1)
          break
        }
      }
      if (stack.length === 0) {
        out.push({
          file,
          line: lineOf(text, openerAt),
          index: out.length,
          src: preprocessHtmlText(text.slice(bodyFrom, m.index!)).trim(),
        })
        stack = null
      }
    }
  }
  return out
}

function extractFenced(text: string, file: string): Diagram[] {
  const out: Diagram[] = []
  const re = /```mermaid[ \t]*\r?\n([\s\S]*?)(?:\r?\n[ \t]*```|```)/g
  for (const m of text.matchAll(re)) {
    out.push({ file, line: lineOf(text, m.index!), index: out.length, src: m[1].trim() })
  }
  return out
}

async function collectFiles(paths: string[], baseDir: string): Promise<string[]> {
  const abs = paths.map((p) => (path.isAbsolute(p) ? p : path.resolve(baseDir, p)))
  const files: string[] = []
  const seen = new Set<string>()
  async function walk(dir: string) {
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      throw new Error(`Path not accessible: ${dir}`)
    }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name) && !e.name.startsWith("target")) await walk(full)
      } else if (e.isFile() && SCAN_EXTS.has(path.extname(e.name).toLowerCase())) {
        const rp = path.resolve(full)
        if (!seen.has(rp)) {
          seen.add(rp)
          files.push(rp)
        }
      }
    }
  }
  for (const p of abs) {
    const st = await fs.stat(p).catch(() => null)
    if (!st) throw new Error(`Path not found: ${p}`)
    if (st.isDirectory()) await walk(p)
    else {
      const rp = path.resolve(p)
      if (!seen.has(rp)) {
        seen.add(rp)
        files.push(rp)
      }
    }
  }
  return files.sort()
}

async function extractDiagrams(files: string[]): Promise<Diagram[]> {
  const out: Diagram[] = []
  for (const file of files) {
    const ext = path.extname(file).toLowerCase()
    const text = await fs.readFile(file, "utf8")
    if (ext === ".mmd") {
      out.push({ file, line: 1, index: 0, src: text.trim() })
    } else if (ext === ".html" || ext === ".htm") {
      out.push(...extractHtml(text, file))
    } else {
      out.push(...extractFenced(text, file))
    }
  }
  return out.map((d, i) => ({ ...d, index: i }))
}

function resolvePlaywright(extraDirs: string[]): { chromium: any; from: string } {
  const tried: string[] = []
  const dirs = [
    ...(process.env.MERMAID_DOCTOR_PLAYWRIGHT_PATH
      ? [path.resolve(process.env.MERMAID_DOCTOR_PLAYWRIGHT_PATH)]
      : []),
    ...extraDirs,
    process.cwd(),
  ]
  for (const dir of [...new Set(dirs.filter(Boolean))]) {
    tried.push(dir)
    try {
      const req = createRequire(path.join(dir, "__doctor__.js"))
      return { chromium: req("playwright").chromium, from: dir }
    } catch {}
  }
  throw new Error(
    `playwright not resolvable. Tried (in order): ${tried.join(", ")}. ` +
      `Fix: install playwright in the project (npm i playwright), or point MERMAID_DOCTOR_PLAYWRIGHT_PATH at a node_modules dir containing playwright.`,
  )
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`diagram timed out after ${ms}ms`)), ms)),
  ])
}

// Parse/render errors carry caret art plus a long pako mermaid.live link.
// Keep the human-readable part only.
function cleanError(e: unknown): string {
  let msg = e instanceof Error ? e.message : typeof e === "object" && e !== null ? JSON.stringify(e) : String(e)
  msg = msg.replace(/^evaluate:\s*/i, "")
  msg = msg.replace(/https?:\/\/\S+/g, "")
  const lines = msg
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !/^at\b/.test(l))
    .filter((l, i, arr) => l !== arr[i - 1])
    .slice(0, 3)
  return lines.join(" | ").slice(0, 300)
}

// Engine behind the mermaid-doctor tool registered in ./index.ts. Returns
// the human-readable report plus structured metadata.
export async function runDoctor(
  args: DoctorArgs,
  opts?: { baseDir?: string; extraDirs?: string[] },
): Promise<{ report: string; meta?: DoctorMeta }> {
  const baseDir = opts?.baseDir || process.cwd()
  const doRender = args.render !== false
  const deadline = Date.now() + (args.timeout_ms ?? 15000)

  let diagrams: Diagram[]
  try {
    if (args.raw !== undefined && args.raw.trim()) {
      diagrams = [{ file: "(raw)", line: 1, index: 0, src: args.raw.trim() }]
    } else if (args.paths?.length) {
      diagrams = await extractDiagrams(await collectFiles(args.paths, baseDir))
    } else {
      return { report: "No input: provide paths (files/directories) or raw diagram source." }
    }
  } catch (e) {
    return { report: `Scan failed: ${e instanceof Error ? e.message : String(e)}` }
  }
  if (diagrams.length === 0) {
    return {
      report: `No mermaid blocks found in ${args.paths!.length} path(s). Supported: <pre/div class="mermaid"> in HTML, fenced \`\`\`mermaid blocks, .mmd files.`,
    }
  }

  let browser: any
  let page: any
  let engineFrom = "?"
  let cdnError: string | null = null
  const failures: Failure[] = []

  try {
    const pw = resolvePlaywright(opts?.extraDirs ?? [])
    engineFrom = pw.from
    browser = await pw.chromium.launch({ headless: true })
    page = await browser.newPage()
    page.on("pageerror", (e: Error) => (cdnError ??= String(e)))
    page.on("requestfailed", (r: any) => {
      if (r.url().includes("mermaid")) cdnError = `mermaid CDN request failed: ${r.failure()?.errorText ?? "unknown"}`
    })
    const html = `<!doctype html><html><body><script type="module">
      import mermaid from '${MERMAID_CDN}';
      window.mermaid = mermaid;
      mermaid.initialize({ startOnLoad: false });
      window.__ready = true;
    </script></body></html>`
    await page.setContent(html, { waitUntil: "load" })
    const budget = Math.max(1, deadline - Date.now())
    try {
      await page.waitForFunction(() => (window as any).__ready === true, undefined, { timeout: budget })
    } catch {
      throw new Error(
        cdnError
          ? `mermaid failed to initialize: ${cdnError}`
          : `mermaid did not initialize within ${budget}ms (possible CDN/network failure reaching ${MERMAID_CDN})`,
      )
    }

    for (const d of diagrams) {
      const remaining = deadline - Date.now()
      if (remaining <= 0) {
        failures.push({ ...d, stage: "timeout", error: "overall timeout_ms budget exhausted" })
        continue
      }
      const id = `md_${d.index}`
      // Parse and render run as separate guarded steps so a failure is
      // attributed to the right stage; one diagram failing must not stop
      // the rest.
      try {
        await withTimeout(
          page.evaluate(async (src: string) => (window as any).mermaid.parse(src), d.src),
          Math.min(remaining, 15000),
        )
      } catch (e) {
        failures.push({ ...d, stage: "parse", error: cleanError(e) })
        continue
      }
      if (!doRender) continue
      try {
        await withTimeout(
          page.evaluate(async ({ src, id }: { src: string; id: string }) => {
            const m = (window as any).mermaid
            // Fresh container per render, ATTACHED to the document: some
            // diagram types measure layout, so a detached div risks false
            // negatives. Removed right after to isolate renders.
            const holder = document.createElement("div")
            document.body.appendChild(holder)
            try {
              await m.render(id, src, holder)
            } finally {
              holder.remove()
            }
          }, { src: d.src, id }),
          Math.min(remaining, 15000),
        )
      } catch (e) {
        failures.push({ ...d, stage: "render", error: cleanError(e) })
      }
    }
  } catch (e) {
    return { report: `Engine failure: ${e instanceof Error ? e.message : String(e)}` }
  } finally {
    await page?.close().catch(() => {})
    await browser?.close().catch(() => {})
  }

  const total = diagrams.length
  const failed = failures.length
  const passed = total - failed
  const ok = failed === 0
  const rel = (f: string) => (f.startsWith("(") ? f : path.relative(baseDir, f) || f)

  const lines: string[] = [
    `${passed}/${total} diagrams OK in ${new Set(diagrams.map((d) => d.file)).size} file(s) [engine: chromium via playwright@${engineFrom}, mermaid@11 CDN${doRender ? ", parse+render" : ", parse-only"}]`,
  ]
  for (const f of failures) lines.push(`FAIL ${rel(f.file)}:${f.line} [${f.index}] (${f.stage}) ${f.error}`)
  const okList = diagrams.filter((d) => !failures.some((f) => f.index === d.index))
  if (total <= 20) for (const d of okList) lines.push(`ok   ${rel(d.file)}:${d.line} [${d.index}]`)
  else lines.push(`… ${okList.length} further diagrams passed`)

  return {
    report: lines.join("\n"),
    meta: { ok, total, passed, failed, failures },
  }
}
