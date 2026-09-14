/**
 * md-link TUI plugin — silent toggle for the Obsidian live mirror.
 *
 * Loader contract (opencode2 beta): default export MUST be { id, setup }.
 * ctx.keymap.layer() is Solid-scoped and only works inside a rendered
 * component — the ui.slot({ append: "app" }) carrier below is required.
 * Runtime dialog API: await ctx.ui.dialog.prompt({...}) → string | undefined.
 *
 * Commands (all purely client-side — nothing is ever sent to the LLM):
 *   ctrl+alt:n / /md-link [dir]   toggle mirroring for the focused session;
 *                                 ON backfills the newest completed reply,
 *                                 and opens the mirror if auto-open is ON
 *   ctrl+alt:o / /md-link-open    open this session's mirror with the opener
 *   /md-link-open-with            set the opener command template
 *   /md-link-auto-open [on|off]   toggle open-on-enable (default ON)
 *   /md-link-sessions             list mirrored sessions; delete a mirror
 *                                 (file + state entry) behind a confirm
 *   /md-link-dir                  set the default output directory
 *   /md-link-keep                 keep only the N newest replies (empty = all);
 *                                 existing mirrors are trimmed immediately
 *   /md-link-persist [on|off]     persistent mirrors: while ON, TUI exit keeps
 *                                 this project's mirror files + session entries
 *                                 and mirroring auto-resumes next launch;
 *                                 explicit /md-link OFF still deletes at once
 *
 * On TUI exit, mirror files belonging to this project are deleted unless
 * persistence (/md-link-persist) is ON. See core.ts for state/file contracts.
 */

import { accessSync, constants as fsConstants, existsSync, readFileSync, rmSync, statSync } from "fs"
import { isAbsolute, join, normalize } from "path"
import { homedir } from "os"
import {
  appendMessage,
  DEFAULT_OPENER,
  disableSession,
  isEnabled,
  isSafeName,
  loadState,
  messageText,
  mirrorFile,
  openArgs,
  pruneMirror,
  resolveMirrorName,
  sanitizeTitle,
  saveState,
  touchMirror,
} from "./core.ts"
import type { MdLinkState } from "./core.ts"

type DirResult = { ok: true; abs: string } | { ok: false; error: string }

/** Validate a user-supplied output dir. Must already exist and be writable. */
function validateDir(raw: string, pwd: string): DirResult {
  let d = String(raw ?? "").trim().replace(/^["']+|["']+$/g, "")
  if (d.startsWith("~")) d = join(homedir(), d.slice(1))
  if (d.length === 0) d = "."
  if (d.includes("\0")) return { ok: false, error: "invalid path" }
  if (d.split("/").includes("..")) return { ok: false, error: "path may not contain '..'" }
  if (!/^[A-Za-z0-9 ._\-\/]+$/.test(d)) return { ok: false, error: `unsupported characters in "${d}"` }

  const abs = isAbsolute(d) ? normalize(d) : normalize(join(pwd, d))
  try {
    if (!existsSync(abs)) return { ok: false, error: `directory does not exist: ${abs}` }
    if (!statSync(abs).isDirectory()) return { ok: false, error: `not a directory: ${abs}` }
    accessSync(abs, fsConstants.W_OK)
  } catch (e: any) {
    return { ok: false, error: `cannot use ${abs}: ${e?.code ?? e?.message ?? e}` }
  }
  return { ok: true, abs }
}

/** Pull a free-form argument out of whatever the slash/keybind run() hands us. */
function extractArg(input: unknown): string {
  if (typeof input === "string") return input
  if (Array.isArray(input)) return input.map((x) => extractArg(x)).join(" ")
  const r = input as any
  if (r && typeof r === "object") {
    for (const k of ["value", "arg", "args", "input", "arguments", "text", "message", "prompt"]) {
      const v = r[k]
      if (typeof v === "string") return v
      if (Array.isArray(v)) return v.map((x) => extractArg(x)).join(" ")
    }
  }
  return ""
}

/** One row of the /md-link-sessions menu: the dialog.select option shape
 * (`title`/`value`/`description` — not `label`, the list truncates `title`)
 * plus `mtime` for sorting. "(file missing)" marks stale state entries.
 * Exported for tests; the menu sorts rows by `mtime`, newest first. */
export function sessionRow(st: MdLinkState, sid: string): { title: string; value: string; description: string; mtime: number } {
  const dir = st.sessions[sid] ?? ""
  const rec = st.files?.[sid]
  const name = isSafeName(rec) ? rec : `${sid}_link.md`
  const file = join(dir || ".", name)
  let mtime = 0
  let when = "(file missing)"
  try {
    const d = new Date((mtime = statSync(file).mtimeMs))
    const pad = (n: number) => String(n).padStart(2, "0")
    when = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  } catch {}
  return { title: st.titles?.[sid] || sid, value: sid, description: `${file} · ${when}`, mtime }
}

/** Fetch the session title once (GET /api/session/<sid> → data.title).
 * Null when unfetchable — the caller falls back to the session ID. */
async function fetchSessionTitle(sessionID: string): Promise<string | null> {
  try {
    const proc = Bun.spawn(["opencode2", "api", "get", `/api/session/${sessionID}`], {
      stdout: "pipe",
      stderr: "pipe",
    })
    const timeout = setTimeout(() => proc.kill(), 10_000)
    const out = await new Response(proc.stdout).text()
    clearTimeout(timeout)
    await proc.exited
    const title = JSON.parse(out)?.data?.title
    return typeof title === "string" && title.trim() ? title : null
  } catch {
    return null
  }
}

/**
 * Backfill the newest COMPLETED assistant reply via the service HTTP API
 * (ctx.state.session.messages() returns no rows in this beta).
 *
 * `opencode2 api` handles port discovery + auth; response items are
 * NEWEST-FIRST and may cap at ~50, with two text shapes (content[] parts or
 * flat text — see core.messageText).
 *
 * Replies still streaming when the toggle fires are skipped: their
 * time.created is too recent, and live ordinals will finish them anyway.
 */
async function backfillLatestTurn(
  sessionID: string,
  file: string,
  keep: number | null,
  enabledAt: number,
): Promise<boolean> {
  try {
    const proc = Bun.spawn(["opencode2", "api", "get", `/api/session/${sessionID}/message`], {
      stdout: "pipe",
      stderr: "pipe",
    })
    const out = await new Response(proc.stdout).text()
    await proc.exited

    const parsed = JSON.parse(out)
    const items: any[] = Array.isArray(parsed) ? parsed : (parsed?.data ?? [])
    for (const m of items) {
      if (m?.type !== "assistant") continue
      const created = Number(m?.time?.created ?? 0)
      if (created && enabledAt - created < 15_000) continue // likely still streaming
      const text = messageText(m)
      if (!text) continue
      if (readFileSync(file, "utf-8").includes(`<!-- msg:${m.id}`)) break // already mirrored
      return appendMessage(file, { text, markerKey: `${m.id}#backfill` }, keep) === "written"
    }
  } catch {}
  return false
}

export default {
  id: "fazuh.md-link-tui",

  setup: async (ctx: any) => {
    const pwd = (): string =>
      ctx?.state?.path?.directory ?? ctx?.state?.path?.worktree ?? process.cwd()

    const toast = (message: string, variant: string = "info") => {
      try {
        ctx.ui?.toast?.show?.({ title: "md-link", message, variant })
      } catch {}
    }

    const short = (s: string) => (s.length > 28 ? s.slice(0, 28) + "…" : s)

    // ——— toggle ———

    /** Collapse duplicate activations: stacked layers from hot-reloads fire
     * run() twice per keypress (ON then instantly OFF). */
    let lastRun = 0
    async function run(input?: unknown): Promise<void> {
      const now = Date.now()
      if (now - lastRun < 500) return
      lastRun = now

      try {
        const cur = ctx?.ui?.router?.current?.()
        const sessionID = cur?.sessionID ?? cur?.params?.sessionID
        if (!sessionID || typeof sessionID !== "string") {
          toast("No active session found", "warning")
          return
        }

        const st = loadState()
        const arg = extractArg(input).trim()
        const res = validateDir(arg || st.defaultDir || pwd(), pwd())
        if (!res.ok) {
          toast(`Invalid dir "${arg || st.defaultDir}": ${res.error}`, "error")
          return
        }
        if (arg) st.defaultDir = res.abs // remember explicitly requested dirs

        if (isEnabled(st, sessionID)) {
          const oldDir = st.sessions[sessionID]
          const name = st.files?.[sessionID]
          const legacy = `${sessionID}_link.md`
          disableSession(st, sessionID)
          for (const dir of new Set([oldDir, res.abs])) {
            for (const n of new Set([name, legacy])) {
              if (!isSafeName(n)) continue
              try { rmSync(join(dir ?? "", n), { force: true }) } catch {}
            }
          }
          toast(`Live mirror OFF (${short(name ?? sessionID)})`, "warning")
          return
        }

        // Title fixed at enable time (recorded in state) so later renames
        // never orphan content. TUI router may already know it; else one API call.
        const curTitle = cur?.title ?? cur?.sessionTitle ?? cur?.session?.title
        const fetched = typeof curTitle === "string" && curTitle.trim()
          ? curTitle
          : await fetchSessionTitle(sessionID)
        const title = sanitizeTitle(fetched) || sessionID
        // Unique within this dir: other enabled sessions' recorded names,
        // plus anything already on disk (never clobber a user note).
        const taken = new Set<string>()
        for (const [id, f] of Object.entries(st.files ?? {})) {
          if (id === sessionID || !f) continue
          const d = st.sessions[id] ?? ""
          if ((d || st.defaultDir || "") === res.abs) taken.add(f)
        }
        let name = resolveMirrorName(title, sessionID, taken)
        while (existsSync(join(res.abs, name))) {
          taken.add(name)
          name = resolveMirrorName(title, sessionID, taken)
        }

        st.sessions[sessionID] = res.abs
        ;(st.titles ??= {})[sessionID] = title
        ;(st.files ??= {})[sessionID] = name
        saveState(st)
        const file = join(res.abs, name)
        touchMirror(file)
        const backfilled = await backfillLatestTurn(sessionID, file, st.keep, Date.now())
        const tag = st.persist ? " (persistent)" : ""
        toast(
          backfilled
            ? `Live mirror ON, latest reply backfilled → ${short(file)}${tag}`
            : `Live mirror ON → ${file}${tag}`,
        )
        if (st.openOnEnable) {
          const res = await launchOpener(st, file)
          if (res !== true) toast(`Open failed: ${res}`, "error") // success is its own feedback
        }
      } catch (e: any) {
        toast(`Failed: ${e?.message ?? e}`, "error")
      }
    }

    // ——— dialogs ———

    async function openSetDirDialog(): Promise<void> {
      try {
        const v = await ctx.ui.dialog.prompt({
          title: "md-link output directory",
          placeholder: `relative to project (${pwd()}) or absolute path`,
          value: loadState().defaultDir ?? "",
        })
        if (typeof v !== "string") return // cancelled
        const res = validateDir(v, pwd())
        if (!res.ok) {
          toast(`Invalid dir: ${res.error}`, "error")
          return
        }
        const st = loadState()
        st.defaultDir = res.abs
        saveState(st)
        toast(`Default output dir set → ${res.abs}`)
      } catch (e: any) {
        toast(`Cannot open dialog: ${e?.message ?? e}`, "error")
      }
    }

    async function openKeepDialog(): Promise<void> {
      try {
        const cur = loadState().keep
        const v = await ctx.ui.dialog.prompt({
          title: "md-link: show last N messages",
          placeholder: "number of recent messages to keep (empty = unlimited)",
          value: cur != null ? String(cur) : "",
        })
        if (typeof v !== "string") return // cancelled
        const t = v.trim()
        let keep: number | null = null
        if (t.length > 0) {
          const n = Number(t)
          if (!Number.isInteger(n) || n < 1 || n > 500) {
            toast(`Invalid count "${t}" — use 1..500 or empty`, "error")
            return
          }
          keep = n
        }
        const st = loadState()
        st.keep = keep
        saveState(st)
        if (keep == null) {
          toast("Mirror keeps all messages")
          return
        }
        // Apply immediately: trim every enabled session's live mirror now.
        let trimmed = 0
        for (const sid of Object.keys(st.sessions)) {
          const f = mirrorFile(st, sid, pwd())
          if (!f || !existsSync(f)) continue
          const before = readFileSync(f, "utf-8")
          pruneMirror(f, keep)
          if (readFileSync(f, "utf-8") !== before) trimmed++
        }
        toast(`Mirror shows only the last ${keep}${trimmed ? ` (${trimmed} mirror${trimmed === 1 ? "" : "s"} trimmed)` : ""}`)
      } catch (e: any) {
        toast(`Cannot open dialog: ${e?.message ?? e}`, "error")
      }
    }

    // ——— persistence toggle ———

    /** Flip (or force via on|off arg) persistent-mirror mode: kept mirrors
     * survive TUI exit and their sessions auto-resume on next launch. */
    async function togglePersistence(input?: unknown): Promise<void> {
      try {
        const st = loadState()
        const arg = extractArg(input).trim().toLowerCase()
        if (arg === "on" || arg === "true" || arg === "1") st.persist = true
        else if (arg === "off" || arg === "false" || arg === "0") st.persist = false
        else st.persist = !st.persist
        saveState(st)
        toast(
          st.persist
            ? "Persistent mirrors ON — survive TUI exit, resume next launch"
            : "Persistent mirrors OFF — mirrors deleted on TUI exit",
          st.persist ? "info" : "warning",
        )
      } catch (e: any) {
        toast(`Failed: ${e?.message ?? e}`, "error")
      }
    }

    // ——— opener (Obsidian by default, template-overridable) ———

    /** Launch the configured opener for a mirror file. True, or an error line. */
    async function launchOpener(st: MdLinkState, file: string): Promise<true | string> {
      try {
        const argv = openArgs(st.openWith, file)
        const proc = Bun.spawn(argv, { stdout: "ignore", stderr: "pipe", stdin: "ignore" })
        const err = (await new Response(proc.stderr).text()).trim().split("\n")[0] ?? ""
        const code = await proc.exited
        return code === 0 ? true : `exit ${code}${err ? `: ${err}` : ""}`
      } catch (e: any) {
        return e?.message ?? String(e)
      }
    }

    /** ctrl+alt:o / /md-link-open — open the focused session's mirror. */
    async function openMirror(): Promise<void> {
      const cur = ctx?.ui?.router?.current?.()
      const sessionID = cur?.sessionID ?? cur?.params?.sessionID
      const st = loadState()
      const file = sessionID && typeof sessionID === "string" ? mirrorFile(st, sessionID, pwd()) : null
      if (!file || !isEnabled(st, sessionID as string) || !existsSync(file)) {
        toast("No mirror for this session — toggle it ON first (ctrl+alt+n)", "warning")
        return
      }
      const res = await launchOpener(st, file)
      if (res !== true) toast(`Open failed (${short(file)}): ${res}`, "error")
      else toast(`Opened in viewer → ${short(file)}`)
    }

    /** /md-link-open-with — set the opener template; empty = Obsidian default. */
    async function openWithDialog(): Promise<void> {
      try {
        const cur = loadState().openWith ?? DEFAULT_OPENER
        const v = await ctx.ui.dialog.prompt({
          title: "md-link: opener command",
          description: 'argv template; {path} = mirror file, {uri} = its percent-encoded form',
          placeholder: DEFAULT_OPENER,
          value: cur,
        })
        if (typeof v !== "string") return // cancelled
        const st = loadState()
        const t = v.trim()
        st.openWith = t === "" || t === DEFAULT_OPENER ? undefined : t
        saveState(st)
        toast(t ? `Opener → ${t}` : "Opener reset to Obsidian (default)")
      } catch (e: any) {
        toast(`Cannot open dialog: ${e?.message ?? e}`, "error")
      }
    }

    /** /md-link-auto-open [on|off] — open the mirror when toggled ON. */
    async function toggleAutoOpen(input?: unknown): Promise<void> {
      try {
        const st = loadState()
        const arg = extractArg(input).trim().toLowerCase()
        if (arg === "on" || arg === "true" || arg === "1") st.openOnEnable = true
        else if (arg === "off" || arg === "false" || arg === "0") st.openOnEnable = false
        else st.openOnEnable = st.openOnEnable === false
        saveState(st)
        toast(
          st.openOnEnable ? "Auto-open ON — mirrors open on toggle" : "Auto-open OFF — open with ctrl+alt+o",
          st.openOnEnable ? "info" : "warning",
        )
      } catch (e: any) {
        toast(`Failed: ${e?.message ?? e}`, "error")
      }
    }

    // ——— mirrored-sessions menu ———

    /** /md-link-sessions — list every mirrored session from state and delete
     * its mirror (file + state entry) behind a confirm, re-showing until the
     * user cancels. Only derived mirror data is touched, never the session. */
    async function sessionsMenu(): Promise<void> {
      for (;;) {
        const st = loadState()
        const rows = Object.keys(st.sessions)
          .map((sid) => sessionRow(st, sid))
          .sort((a, b) => b.mtime - a.mtime)
        if (rows.length === 0) {
          toast("No mirrored sessions — toggle one ON with ctrl+alt+n")
          return
        }
        const fail = (e: any) => toast(`Cannot open dialog: ${e?.message ?? e}`, "error")
        let picked: string | undefined
        try {
          picked = await ctx.ui.dialog.select({
            title: `Mirrored sessions (${rows.length}) — delete which?`,
            placeholder: "esc cancels",
            options: rows.map(({ title, value, description }) => ({ title, value, description })),
          })
        } catch (e: any) {
          return fail(e)
        }
        if (!picked) return // cancelled
        const row = rows.find((r) => r.value === picked)
        let ok: boolean | undefined
        try {
          ok = await ctx.ui.dialog.confirm({
            title: "Delete this mirror?",
            message: `${row?.title ?? picked}\n${row?.description ?? ""}\n\nThe session itself is untouched; only the mirror file and its state entry go away.`,
          })
        } catch (e: any) {
          return fail(e)
        }
        if (!ok) continue // back to the list
        const cur = loadState() // state can move while the dialogs are open
        for (const n of new Set([cur.files?.[picked], `${picked}_link.md`])) {
          if (!isSafeName(n)) continue
          try { rmSync(join(cur.sessions[picked] || ".", n), { force: true }) } catch {}
        }
        disableSession(cur, picked)
        toast(`Mirror deleted → ${short(row?.title ?? picked)}`)
      }
    }

    // ——— startup notice for persistent mirrors ———

    try {
      const root = pwd()
      const resumed = Object.values(loadState().sessions).filter((d) => root && d.startsWith(root)).length
      if (resumed > 0) toast(`md-link: resumed ${resumed} persistent mirror${resumed === 1 ? "" : "s"}`)
    } catch {}

    // ——— cleanup on TUI close (skipped while persistence is ON) ———

    let cleaned = false
    function cleanupOnExit(): void {
      if (cleaned) return
      cleaned = true
      try {
        const root = pwd()
        const st = loadState()
        if (st.persist) return // persistent mode: keep files + entries, resume next launch
        for (const sid of Object.keys(st.sessions)) {
          const dir = st.sessions[sid]
          // only remove mirrors owned by THIS project — other TUIs keep theirs
          if (root && !dir.startsWith(root)) continue
          const names = new Set([st.files?.[sid], `${sid}_link.md`])
          for (const n of names) {
            if (!isSafeName(n)) continue
            try { rmSync(join(dir || ".", n), { force: true }) } catch {}
          }
          delete st.sessions[sid]
          if (st.titles) delete st.titles[sid]
          if (st.files) delete st.files[sid]
        }
        saveState(st)
      } catch {}
    }
    try { ctx.lifecycle?.onDispose?.(cleanupOnExit) } catch {}
    try { ctx.lifecycle?.signal?.addEventListener("abort", cleanupOnExit, { once: true }) } catch {}
    try { process.once("exit", cleanupOnExit) } catch {}

    // ——— registration (MUST happen inside a rendered component) ———

    ctx.ui?.slot?.({
      append: "app",
      render: () => {
        ctx.keymap.layer(() => ({
          mode: "global",
          priority: 1,
          enabled: true,
          commands: [
            {
              id: "md-link.toggle",
              title: "Live mirror",
              group: "md-link",
              bind: "ctrl+alt+n",
              palette: true,
              slash: { name: "md-link" },
              run,
            },
            {
              id: "md-link.open",
              title: "Open mirror in viewer",
              group: "md-link",
              bind: "ctrl+alt+o",
              palette: true,
              slash: { name: "md-link-open" },
              run: () => openMirror(),
            },
            {
              id: "md-link.opener",
              title: "Opener command",
              group: "md-link",
              palette: true,
              slash: { name: "md-link-open-with" },
              run: () => openWithDialog(),
            },
            {
              id: "md-link.autoopen",
              title: "Auto-open on toggle",
              group: "md-link",
              palette: true,
              slash: { name: "md-link-auto-open" },
              run: (input?: unknown) => toggleAutoOpen(input),
            },
            {
              id: "md-link.sessions",
              title: "Mirrored sessions",
              group: "md-link",
              palette: true,
              slash: { name: "md-link-sessions" },
              run: () => sessionsMenu(),
            },
            {
              id: "md-link.setdir",
              title: "Output directory",
              group: "md-link",
              palette: true,
              slash: { name: "md-link-dir" },
              run: () => openSetDirDialog(),
            },
            {
              id: "md-link.keep",
              title: "Keep last N",
              group: "md-link",
              palette: true,
              slash: { name: "md-link-keep" },
              run: () => openKeepDialog(),
            },
            {
              id: "md-link.persist",
              title: "Persistence",
              group: "md-link",
              palette: true,
              slash: { name: "md-link-persist" },
              run: (input?: unknown) => togglePersistence(input),
            },
          ],
        }))
        return null // layer carrier renders nothing
      },
    })

    return undefined
  },
}
