/**
 * /jev-settings and /jev-key — the TUI surface for the plugin's settings.
 *
 * Everything the plugin reads at call time is editable here: endpoint, model,
 * where the key comes from, the gate, and the confidence thresholds. The
 * provider is a setting rather than an assumption, because the wire model id
 * and the endpoint path differ per provider and neither has a portable default.
 *
 * Both panels are built on `ctx.ui.dialog.replace(() => DialogSelect(...))`,
 * which is how OpenCode's own settings panel is drawn: a value column on the
 * right, category headers, arrow keys to move, esc to close. The promise
 * helpers `ctx.ui.dialog.select()` / `.prompt()` were the wrong tool — they
 * resolve on selection, which closes the dialog, so every edit bounced the
 * panel. `replace` swaps the rendered content and leaves the dialog open, so
 * a toggle redraws the row in place.
 *
 * Changing a value opens a prompt with `replace` too, then replaces back to the
 * panel, so the list is where you left it.
 *
 * The panels live here and nowhere else. The desktop app loads no TUI module, so
 * /jev-settings, /jev-features and /jev-key exist only in the TUI; the
 * server-side commands (/jev-model, /jev-endpoint, /jev-gate, /jev-on,
 * /jev-feature, /jev-status, /jev-log) cover the same ground as text for hosts
 * without one. Registering those slash names in both places would shadow a panel
 * with a summary that edits nothing.
 *
 * The key is written at 0600 and is never read back, logged, or echoed.
 */

import { appendFileSync } from "node:fs"
import { join } from "node:path"
import { FEATURES, featureOn, keySource, loadState, readLog, saveState, setFeature, spend, writeKey, type JevState } from "./state.ts"

const DATA_DIR = join(process.env.HOME ?? "", ".config", "fazuh-agent", "data")

const short = (path: string) => path.replace(/^\/home\/[^/]+/, "~")

function summary(): string {
  const s = loadState()
  const key = keySource()
  const money = spend()
  return [
    `endpoint   ${s.endpoint}`,
    `model      ${s.model}`,
    `key        ${key.present ? `present (${key.from})` : "MISSING"}`,
    `features   ${FEATURES.filter((f) => featureOn(f.key)).map((f) => f.key).join(" ") || "none"}`,
    `off        ${FEATURES.filter((f) => !featureOn(f.key)).map((f) => f.key).join(" ") || "none"}`,
    `thresholds minProbability=${s.minProbability} minMargin=${s.minMargin} gateProbability=${s.gateProbability}`,
    `spend      ${money.calls} calls · ${money.tokens} input tokens · $${money.usd.toFixed(6)}`,
  ].join("\n")
}

export default {
  id: "fazuh.jev-tui",

  setup: async (ctx: any) => {
    /**
     * A TUI failure used to be silent: the command ran, threw, and nothing
     * appeared. So every panel entry point reports what it saw and what broke,
     * to the user and to a log I can read without asking them to describe it.
     */
    const trace = (event: string, detail: Record<string, unknown> = {}) => {
      try {
        appendFileSync(
          join(DATA_DIR, "jev-tui.log"),
          `${new Date().toISOString()} ${event} ${JSON.stringify(detail)}\n`,
          { mode: 0o600 },
        )
      } catch {}
    }

    const api = () => ({
      dialog: typeof ctx.ui?.dialog,
      dialogKeys: Object.keys(ctx.ui?.dialog ?? {}),
      replace: typeof ctx.ui?.dialog?.replace,
      select: typeof (ctx.ui?.dialog as any)?.select,
      DialogSelect: typeof ctx.ui?.DialogSelect,
      DialogPrompt: typeof ctx.ui?.DialogPrompt,
    })

    const toast = (message: string, variant = "info") => {
      try {
        ctx.ui?.toast?.show?.({ title: "jev", message, variant })
      } catch (error: any) {
        trace("toast-failed", { message, error: String(error?.message ?? error) })
      }
    }

    /** Run a panel entry point, surfacing anything it throws. */
    function guard(what: string, run: () => void): void {
      try {
        trace(`${what}:open`, api())
        run()
      } catch (error: any) {
        trace(`${what}:threw`, { error: String(error?.message ?? error), stack: String(error?.stack ?? "").slice(0, 600) })
        toast(`${what} failed: ${error?.message ?? error}`, "error")
      }
    }

    /** Standalone /jev-key: a prompt with no panel to return to. */
    async function setKey(): Promise<void> {
      try {
        const value = await ctx.ui.dialog.prompt({
          title: "Jev API key",
          description: `Written at 0600 to ${short(loadState().keyFile)}. Never echoed, logged, or read back.`,
          placeholder: "paste the key",
        })
        if (typeof value !== "string") return
        if (!value.trim()) {
          toast("Empty — nothing written.", "error")
          return
        }
        toast(`Key saved to ${short(writeKey(value.trim()))}`)
      } catch (error: any) {
        trace("setKey:failed", { error: String(error?.message ?? error) })
        toast(`Could not save: ${error?.message ?? error}`, "error")
      }
    }

    /**
     * Draw a panel. `replace` + `DialogSelect` is how OpenCode's own settings
     * panel works and it stays open, but calling `DialogSelect` as a plain
     * function skips Solid's `createComponent`, which the host's own code always
     * goes through — so that path only renders if the runtime tolerates it.
     *
     * `ctx.ui.dialog.select()` is the host's own helper: it does the wrapping
     * correctly, at the cost of closing on selection. So: try the persistent
     * path, and if the runtime cannot draw it, use the helper and accept the
     * close. A panel that opens and closes beats one that does nothing.
     */
    function panel(title: string, rows: () => any[]): () => void {
      const canReplace = typeof ctx.ui?.dialog?.replace === "function" && typeof ctx.ui?.DialogSelect === "function"
      let persistent = false

      const viaHelper = () => {
        persistent = false
        void ctx.ui.dialog.select({ title, options: rows() }).catch((error: any) => {
          trace("panel:select-failed", { title, error: String(error?.message ?? error) })
          toast(`Could not open ${title}: ${error?.message ?? error}`, "error")
        })
      }

      const render = () => {
        if (persistent) {
          try {
            ctx.ui.dialog.replace(() => ctx.ui.DialogSelect({ title, options: rows() }) as any)
            return
          } catch (error: any) {
            trace("panel:replace-failed", { title, error: String(error?.message ?? error) })
          }
          viaHelper()
          return
        }
        if (canReplace) {
          try {
            ctx.ui.dialog.setSize?.("large")
            ctx.ui.dialog.replace(() => ctx.ui.DialogSelect({ title, options: rows() }) as any)
            persistent = true
            // Calling DialogSelect as a plain function skips Solid's
            // createComponent. That can fail silently, so confirm the dialog is
            // actually up rather than trusting the call not to throw.
            setTimeout(() => {
              const isOpen = ctx.ui.dialog.open
              trace("panel:replace-check", { title, open: isOpen, persistent })
              if (!isOpen) {
                persistent = false
                toast(`${title}: persistent panel did not open, using the closing one.`, "error")
                viaHelper()
              }
            }, 60)
            return
          } catch (error: any) {
            trace("panel:replace-failed", { title, error: String(error?.message ?? error) })
          }
        }
        viaHelper()
      }

      render()
      trace(`panel:${title}`, { canReplace, rows: rows().length })
      return render
    }

    /**
     * A text row. `footer` is the right-hand value column, which is what makes
     * this read like the settings panel instead of a list of sentences.
     */
    function row(value: string, title: string, footer: string | undefined, onSelect: () => void, category?: string) {
      return { title, value, footer, category, onSelect }
    }

    /**
     * A prompt, then back to the panel. `ctx.ui.dialog.prompt()` is the host's
     * own helper and it resolves with the typed value, which is what I need;
     * the panel is redrawn afterwards so you land back on the list.
     */
    async function ask(back: () => void, props: Record<string, unknown>): Promise<void> {
      try {
        const value = await ctx.ui.dialog.prompt({
          title: String(props.title ?? ""),
          description: props.description as string | undefined,
          value: props.value as string | undefined,
          placeholder: props.placeholder as string | undefined,
        })
        const onConfirm = props.onConfirm as ((v: string) => void) | undefined
        if (typeof value === "string" && onConfirm) onConfirm(value)
      } catch (error: any) {
        trace("ask:failed", { title: String(props.title ?? ""), error: String(error?.message ?? error) })
        toast(`Could not edit: ${error?.message ?? error}`, "error")
      } finally {
        back()
      }
    }

    /**
     * The feature panel. Six switches, grouped, each flipping in place — the
     * dialog never closes, so holding enter walks the list.
     */
    function openFeatures(): () => void {
      const render = panel(
        "Jev features",
        () =>
          FEATURES.map((f) => {
            const on = featureOn(f.key)
            return row(
              f.key,
              f.label,
              on ? "on" : "off",
              () => {
                const next = setFeature(f.key, !on)
                toast(next ? `${f.label} on` : `${f.label} off`)
                render()
              },
              f.key === "risk_hook" ? "Hooks" : "Tools",
            )
          }),
      )
      return render
    }

    /**
     * The settings panel. Same shape as the features panel: label left, value
     * right, edit with enter, back to the list afterwards.
     */
    function openSettings(): () => void {
      const render = panel("Jev settings", () => {
        const s: JevState = loadState()
        const key = keySource()
        const money = spend()
        return [
          row("endpoint", "Endpoint", s.endpoint, () =>
            ask(render, {
              title: "Endpoint",
              description: "The provider's decisions endpoint, e.g. https://host/v1/systemone",
              value: s.endpoint,
              onConfirm: (v: string) => saveState({ endpoint: v.trim() }),
            }),
          "Provider"),
          row("model", "Model", s.model, () =>
            ask(render, {
              title: "Model id",
              description: "The provider's WIRE model id, not the host's namespaced id",
              value: s.model,
              onConfirm: (v: string) => saveState({ model: v.trim() }),
            }),
          "Provider"),
          row("key", "API key", key.present ? "set" : "MISSING", () =>
            ask(render, {
              title: "Jev API key",
              description: `Written at 0600 to ${short(s.keyFile)}. Never echoed, logged, or read back.`,
              placeholder: "paste the key",
              onConfirm: (v: string) => {
                if (v.trim()) writeKey(v.trim())
              },
            }),
          "Provider"),
          row("keyenv", "Key env vars", s.keyEnv, () =>
            ask(render, {
              title: "Key env vars",
              description: "Comma-separated, checked in order before the key file",
              value: s.keyEnv,
              onConfirm: (v: string) => saveState({ keyEnv: v.trim() }),
            }),
          "Provider"),
          row("keyfile", "Key file", short(s.keyFile), () =>
            ask(render, {
              title: "Key file",
              description: "Read when no env var matched",
              value: s.keyFile,
              onConfirm: (v: string) => saveState({ keyFile: v.trim() }),
            }),
          "Provider"),
          row("minprobability", "minProbability", String(s.minProbability), () =>
            ask(render, {
              title: "minProbability",
              description: "A choice below this top probability is reported as low confidence. 0 to 1.",
              value: String(s.minProbability),
              onConfirm: (v: string) => saveState({ minProbability: clamp01(v, s.minProbability) }),
            }),
          "Confidence"),
          row("minmargin", "minMargin", String(s.minMargin), () =>
            ask(render, {
              title: "minMargin",
              description: "A choice below this gap to the runner-up is low confidence. 0 to 1.",
              value: String(s.minMargin),
              onConfirm: (v: string) => saveState({ minMargin: clamp01(v, s.minMargin) }),
            }),
          "Confidence"),
          row("gateprobability", "gateProbability", String(s.gateProbability), () =>
            ask(render, {
              title: "gateProbability",
              description: "Blocks a tool call and warns on a review gate at or above this. Only when confident. 0 to 1.",
              value: String(s.gateProbability),
              onConfirm: (v: string) => saveState({ gateProbability: clamp01(v, s.gateProbability) }),
            }),
          "Confidence"),
          row("features", "Features", `${FEATURES.filter((f) => featureOn(f.key)).length} of ${FEATURES.length} on`, () => openFeatures(), "Plugin"),
          row("status", "Status", `${money.calls} calls · $${money.usd.toFixed(6)}`, () => toast(summary()), "Plugin"),
          row("log", "Recent calls", "", () => toast(recentCalls()), "Plugin"),
        ]
      })
      return render
    }

    /**
     * An unparseable or out-of-range number keeps the old value rather than
     * writing a NaN (which JSON turns into null, silently unsetting the value).
     */
    function clamp01(raw: string, current: number): number {
      const n = Number(String(raw).trim())
      if (!Number.isFinite(n) || n < 0 || n > 1) {
        toast(`Not a number between 0 and 1 — still ${current}.`, "error")
        return current
      }
      return n
    }

    // ——— registration (must happen inside a rendered component) ———

    function recentCalls(): string {
      const rows = readLog(12)
      if (rows.length === 0) return "No calls logged yet."
      return rows
        .map((r) => {
          if (r.hook) return `${r.ts}  hook ${r.tool} skipped`
          const answers = (r.decisions ?? []).map((d: any) => `${d.id}=${JSON.stringify(d.value)}`).join(" ")
          return `${r.ts}  ${answers}  ${r.inputTokens ?? 0}tok`
        })
        .join("\n")
    }

    ctx.ui?.slot?.({
      append: "app",
      render: () => {
        ctx.keymap.layer(() => ({
          mode: "global",
          priority: 1,
          enabled: true,
          commands: [
            { id: "jev.settings", title: "Jev settings", group: "jev", palette: true, slash: { name: "jev-settings" }, run: () => guard("jev-settings", () => void openSettings()) },
            { id: "jev.features", title: "Jev features", group: "jev", palette: true, slash: { name: "jev-features" }, run: () => guard("jev-features", () => void openFeatures()) },
            { id: "jev.status", title: "Jev status", group: "jev", palette: true, slash: { name: "jev-status" }, run: () => guard("jev-status", () => toast(summary())) },
            { id: "jev.key", title: "Set Jev API key", group: "jev", palette: true, slash: { name: "jev-key" }, run: () => guard("jev-key", () => void setKey()) },
            { id: "jev.log", title: "Jev recent calls", group: "jev", palette: true, slash: { name: "jev-log" }, run: () => toast(recentCalls()) },
          ],
        }))
        return null // layer carrier renders nothing
      },
    })

    return undefined
  },
}
