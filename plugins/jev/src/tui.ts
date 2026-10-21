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
 * server-side commands (/jev-model, /jev-endpoint, /jev-status, /jev-log)
 * cover the same ground as text for hosts
 * without one. Registering those slash names in both places would shadow a panel
 * with a summary that edits nothing.
 *
 * The key is written at 0600 and is never read back, logged, or echoed.
 */

import { appendFileSync } from "node:fs"
import { grant, readApprovals, type Approval } from "./approve.ts"
import { FEATURES, FEATURE_DEFAULTS, TUI_LOG_FILE, maskUrl, sidebarLines, featureOn, featureStored, keySource, loadState, newSince, pluginEnabled, readLog, saveState, setEnabled, setFeature, setFeatureConfig, setLogMax, spend, toastLine, toastOutcomeAllowed, toastsOn, writeKey, type JevState } from "./state.ts"

const short = (path: string) => path.replace(/^\/home\/[^/]+/, "~")

/** One tail per TUI process: a second slot render must not add a second timer. */
let tailStarted = false
let sidebarStarted = false
/** Refills the sidebar lines. Set once the section exists. */
let refreshSidebar: () => void = () => {}

/**
 * What each setting means, and what it takes. The panel reads these instead
 * of switching on the key, so a new field needs one line here and nothing in
 * the panel code.
 */
const FIELD_HELP: Record<string, string> = {
  timeout: "Milliseconds before the call gives up. 0 waits for the provider, unbounded. Fail-open: the call keeps the host's own effect.",
  minProbability: "The probability a verdict or a rule score must reach. 0 to 1.",
  minMargin: "The gap to the runner-up a verdict must clear. 0 to 1.",
  maxCandidates: "Most skills to offer Jev. The provider's choice limit is 255.",
  maxPicks: "Most skills the advisory names. -1 names every qualifier.",
  alsoAbove: "Runners-up at or above this probability join the winner. 0 to 1.",
  optimizeModel: "providerID/modelID for the optimizer, e.g. 9router/free. Empty uses the host's model.",
  actions: "Permission actions this feature examines, comma separated. Tool names work too: write and patch mean edit, bash means shell. * means every action.",
  cache: "Reuse a verdict for the same call in the same session.",
  alertWebhook: "POST the alert to a Discord webhook. Empty turns it off.",
  rulesFile: "The rules file. YAML, and YAML reads JSON, so a .json file works too.",
  defaultEffect: "What a violated rule does: block or ask.",
  defaultThreshold: "The bar a rule score must reach. 0 to 1.",
  fileMaxChars: "Characters a {file:...} reference may add to a rule.",
  toastOutcomes: "What a call has to end in for this feature to announce it: allow, ask, deny, alert, or all. A skip is never announced.",
}

/** The per-feature settings that are a choice between two words. */
const FIELD_CHOICES: Record<string, [string, string]> = {
  "hook_tool_risk.undecided": ["allow", "ask"],
}

/** The range a numeric setting takes. Anything unlisted is a whole number. */
const FIELD_MIN: Record<string, number> = {
  minProbability: 0,
  minMargin: 0,
  alsoAbove: 0,
  defaultThreshold: 0,
  maxCandidates: 1,
  maxPicks: -1,
  timeout: 0,
  fileMaxChars: 0,
}

/** The top of a 0-1 setting. Unlisted means no top. */
const FIELD_MAX: Record<string, number> = {
  minProbability: 1,
  minMargin: 1,
  alsoAbove: 1,
  defaultThreshold: 1,
}

function summary(): string {
  const s = loadState()
  const key = keySource()
  const money = spend()
  return [
    `endpoint   ${s.endpoint}`,
    `model      ${s.model}`,
    `key        ${key.present ? `present (${key.from})` : "MISSING"}`,
    `plugin     ${pluginEnabled() ? "on" : "OFF — nothing is sent and nothing is spent"}`,
    `toast      ${s.toast ? "on" : "off"}`,
    `features   ${FEATURES.filter((f) => featureStored(f.key)).map((f) => f.key).join(" ") || "none"}`,
    `off        ${FEATURES.filter((f) => !featureStored(f.key)).map((f) => f.key).join(" ") || "none"}`,
    ...FEATURES.map((f) => {
      const cfg = s.config[f.key] ?? {}
      const rendered =
        Object.entries(cfg)
          .map(([k, v]) => `${k}=${k === "alertWebhook" ? maskUrl(String(v)) : v}`)
          .join(" ") || "(defaults)"
      return `config.${f.label.padEnd(14)} ${rendered}`
    }),
    `spend      ${money.calls} calls · ${money.tokens} input tokens · $${money.usd.toFixed(6)}`,
    `logMax     ${s.logMax} lines`,
  ].join("\n")
}

export default {
  id: "fazuh.jev-tui",

  setup: async (ctx: any) => {
    /** The feature a setting belongs to, in words rather than in its key. */
    const featureLabel = (key: string) => FEATURES.find((f) => f.key === key)?.label ?? key

    /**
     * A TUI failure used to be silent: the command ran, threw, and nothing
     * appeared. So every panel entry point reports what it saw and what broke,
     * to the user and to a log I can read without asking them to describe it.
     */
    const trace = (event: string, detail: Record<string, unknown> = {}) => {
      try {
        appendFileSync(
          TUI_LOG_FILE,
          `${new Date().toISOString()} ${event} ${JSON.stringify(detail)}\n`,
          { mode: 0o600 },
        )
      } catch {}
    }

    const api = () => {
      const ui = ctx.ui ?? {}
      const dialog: any = ui.dialog ?? {}
      const types: Record<string, string> = {}
      for (const key of Object.keys(ui)) types[key] = typeof ui[key]
      const dialogTypes: Record<string, string> = {}
      for (const key of Object.keys(dialog)) dialogTypes[key] = typeof dialog[key]
      return {
        ctxKeys: Object.keys(ctx),
        uiKeys: Object.keys(ui),
        uiTypes: types,
        dialogKeys: Object.keys(dialog),
        dialogTypes,
      }
    }

    const toast = (message: string, variant = "info", title = "jev") => {
      try {
        ctx.ui?.toast?.show?.({ title, message, variant })
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
          title: "API key",
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

      /**
       * A row's action, held until the select has finished closing.
       *
       * `dialog.select` resolves on selection and its own teardown clears the
       * dialog stack. An action run inside `onSelect` — opening a prompt, for
       * one — is therefore wiped by that teardown, which is why selecting a row
       * used to do nothing at all. Holding the action and running it from the
       * promise means the stack is already clear when it starts.
       *
       * Declared beside `redraw` at setup scope so `row` can reach it.
       */
      const viaHelper = () => {
        persistent = false
        pending = null
        void ctx.ui.dialog
          .select({ title, options: rows() })
          .then(async () => {
            const action = pending
            pending = null
            if (action) await action()
          })
          .catch((error: any) => {
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
      redraw = render
      return render
    }

    /**
     * A text row. `footer` is the right-hand value column, which is what makes
     * this read like the settings panel instead of a list of sentences.
     *
     * `onSelect` is recorded rather than run: see `panel`'s `pending`.
     */
    function row(value: string, title: string, footer: string | undefined, onSelect: () => void | Promise<void>, category?: string) {
      return { title, value, footer, category, onSelect: () => { pending = onSelect } }
    }

    /**
     * A prompt, then back to the panel. Runs after the panel has closed, which
     * is what stops the closing teardown from wiping the prompt.
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

    let redraw: (() => void) | null = null
    /**
     * The action the selected row wants, run once the panel has closed.
     * `dialog.select` resolves on selection and clears the stack, so an action
     * started inside `onSelect` gets wiped before it draws.
     */
    let pending: (() => void | Promise<void>) | null = null

    /**
     * The feature panel. The master switch on top is the plugin's own on/off —
     * it does not touch the six below, it just gates them, so the list reads
     * "on" even while the plugin is off. That is deliberate: you can configure
     * features with the plugin disabled, and turning it back on restores
     * exactly what you had.
     */
    function openFeatures(): () => void {
      redraw = panel("Features", () => {
        const master = pluginEnabled()
        return [
          row(
            "enabled",
            "Plugin",
            master ? "on" : "off",
            () => {
              const next = setEnabled(!master)
              toast(
                next
                  ? "Jev on"
                  : "Jev off",
              )
              redraw?.()
            },
            "Master",
          ),
          ...FEATURES.map((f) => {
            const on = featureStored(f.key)
            return row(
              f.key,
              f.label,
              on ? "on" : "off",
              () => {
                const next = setFeature(f.key, !on)
                toast(next ? `${f.label} on` : `${f.label} off`)
                redraw?.()
              },
              "Hooks",
            )
          }),
        ]
      })
      return redraw
    }

    /**
     * The settings panel. Same shape as the features panel: label left, value
     * right, edit with enter, back to the list afterwards.
     */
    function openSettings(): () => void {
      const render = panel("Settings", () => {
        const s: JevState = loadState()
        const key = keySource()
        const money = spend()
        return [
          row("protocol", "Protocol", s.protocol === "chat" ? "chat (/api/chat)" : "systemone (/systemone)", () => {
            const next = s.protocol === "chat" ? "systemone" : "chat"
            saveState({ protocol: next })
            toast(
              next === "chat"
                ? "Chat protocol"
                : "System One protocol",
            )
            render()
          }, "Provider"),
          row("think", "Thinking", s.think ? "on — slow, may judge better" : "off", () => {
            const next = !s.think
            saveState({ think: next })
            toast(next ? "Thinking on" : "Thinking off.")
            render()
          }, "Provider"),
          row("endpoint", "Endpoint", s.endpoint, () =>
            ask(render, {
              title: "Endpoint",
              description: s.protocol === "chat" ? "The chat endpoint, e.g. http://host/api/chat" : "The provider's decisions endpoint, e.g. https://host/v1/systemone",
              value: s.endpoint,
              onConfirm: (v: string) => saveState({ endpoint: v.trim() }),
            }),
          "Provider"),
          row("model", "Model", s.model, () =>
            ask(render, {
              title: "Model id",
              description: "The provider's model id",
              value: s.model,
              onConfirm: (v: string) => saveState({ model: v.trim() }),
            }),
          "Provider"),
          row("key", "API key", key.present ? "set" : "MISSING", () =>
            ask(render, {
              title: "API key",
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
          // One row per per-feature setting, generated from FEATURE_DEFAULTS,
          // so the panel cannot drift from what the plugin honours. 0-1 fields
          // clamp to the range; timeouts, counts, and maxPicks take integers
          // (-1 = uncapped); booleans toggle in place without a prompt;
          // strings save trimmed text.
          ...Object.entries(FEATURE_DEFAULTS).flatMap(([feature, fields]) =>
            Object.keys(fields).map((key) => {
              const current = s.config[feature]?.[key] ?? fields[key]
              if (typeof fields[key] === "boolean") {
                return row(
                  key,
                  key,
                  current ? "on" : "off",
                  () => {
                    setFeatureConfig(feature, key, !(current === true))
                    toast(`${featureLabel(feature)}: ${key} ${!(current === true) ? "on" : "off"}`)
                    render()
                  },
                  FEATURES.find((f) => f.key === feature)?.label ?? feature,
                )
              }
              // A two-valued setting is a toggle, not free text.
              const choice = FIELD_CHOICES[`${feature}.${key}`]
              if (choice) {
                return row(
                  key,
                  key,
                  String(current),
                  () => {
                    const next = current === choice[0] ? choice[1] : choice[0]
                    setFeatureConfig(feature, key, next)
                    toast(`${featureLabel(feature)}: ${key} ${next}`)
                    render()
                  },
                  feature,
                )
              }
              if (typeof fields[key] === "string") {
                return row(
                  key,
                  key,
                  key === "alertWebhook" ? maskUrl(String(current)) || "(empty)" : String(current) || "(empty)",
                  () =>
                    ask(render, {
                      title: `${featureLabel(feature)}: ${key}`,
                      description: FIELD_HELP[key] ?? "A text setting.",
                      value: String(current),
                      onConfirm: (v: string) => {
                        const text = v.trim()
                        if (key === "optimizeModel" && text && !text.includes("/")) {
                          toast("Needs providerID/modelID, e.g. 9router/free.", "error")
                          return
                        }
                        setFeatureConfig(feature, key, text)
                      },
                    }),
                  FEATURES.find((f) => f.key === feature)?.label ?? feature,
                )
              }
              return row(
                key,
                key,
                String(current),
                () =>
                  ask(render, {
                    title: `${featureLabel(feature)}: ${key}`,
                    description: FIELD_HELP[key] ?? "A number.",
                    value: String(current),
                    onConfirm: (v: string) =>
                      setFeatureConfig(
                        FEATURES.find((f) => f.key === feature)?.label ?? feature,
                        key,
                        clampNumber(v, typeof current === "number" ? current : Number(fields[key]), key),
                      ),
                  }),
                FEATURES.find((f) => f.key === feature)?.label ?? feature,
              )
            }),
          ),
          row("logmax", "logMax", String(s.logMax), () =>
            ask(render, {
              title: "Call log cap",
              description: "jev-calls.jsonl keeps at most this many lines; older lines are pruned to the tail. Minimum 10.",
              value: String(s.logMax),
              onConfirm: (v: string) => {
                const n = Number(String(v).trim())
                if (!Number.isFinite(n) || n < 10 || !Number.isInteger(n)) {
                  toast(`Not an integer >= 10 — still ${s.logMax}.`, "error")
                  return
                }
                setLogMax(n)
              },
            }),
          "Plugin"),
          // The toast master switch. Per-feature opt-outs are the `toast` rows
          // the FEATURE_DEFAULTS loop below generates.
          row("toast", "Toast calls", s.toast ? "on" : "off", () => {
            const next = !s.toast
            saveState({ toast: next })
            toast(next ? "Toasts on. Each Jev call is announced in the TUI." : "Toasts off.")
            render()
          }, "Plugin"),
          // What an "ask" verdict does while the client auto-accepts. The
          // client answers its own permission requests in that mode, so an
          // ask never reaches a human.
          row("yolo", "YOLO ask", s.yoloAsk === "no-op" ? "no-op" : "block-notify", () => {
            const next = s.yoloAsk === "no-op" ? "block-notify" : "no-op"
            saveState({ yoloAsk: next })
            toast(
              next === "no-op"
                ? "An ask does nothing while the client auto-accepts."
                : "An ask blocks the call and asks you while the client auto-accepts.",
            )
            render()
          }, "Plugin"),
          row("sidebar", "Sidebar section", s.sidebar ? "on" : "off", () => {
            const next = !s.sidebar
            saveState({ sidebar: next })
            toast(next ? "Sidebar on. The recent Jev calls appear in the sidebar." : "Sidebar off.")
            render()
          }, "Plugin"),
          row("sidebarcount", "Sidebar calls", String(s.sidebarCount), () =>
            ask(render, {
              title: "Sidebar calls",
              description: "How many recent calls the sidebar shows. 1 to 20.",
              value: String(s.sidebarCount),
              onConfirm: (v: string) => {
                const n = Number(String(v).trim())
                if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1 || n > 20) {
                  toast(`Not a whole number between 1 and 20 — still ${s.sidebarCount}.`, "error")
                  return
                }
                saveState({ sidebarCount: n })
              },
            }),
          "Plugin"),
          row("sidebarsubject", "Sidebar subjects", s.sidebarSubject ? "on" : "off", () => {
            const next = !s.sidebarSubject
            saveState({ sidebarSubject: next })
            toast(next ? "Subjects on. Each sidebar line carries a clipped subject." : "Subjects off.")
            render()
          }, "Plugin"),
          row("approvettl", "Approval TTL", `${s.approveTtl}s`, () =>
            ask(render, {
              title: "Approval TTL",
              description: "Seconds a blocked call stays approvable. 0 keeps it forever.",
              value: String(s.approveTtl),
              onConfirm: (v: string) => {
                const n = Number(String(v).trim())
                if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
                  toast(`Not a whole number of seconds — still ${s.approveTtl}.`, "error")
                  return
                }
                saveState({ approveTtl: n })
              },
            }),
          "Plugin"),
          row("features", "Features", `${FEATURES.filter((f) => featureOn(f.key)).length} of ${FEATURES.length} on`, () => openFeatures(), "Plugin"),
          row("status", "Status", `${money.calls} calls · $${money.usd.toFixed(6)}`, () => toast(summary()), "Plugin"),
          row("log", "Recent calls", "", () => toast(recentCalls()), "Plugin"),
        ]
      })
      return render
    }

    /**
     * A number outside its range keeps the old value rather than writing a
     * NaN (which JSON turns into null, silently unsetting the value). The
     * range comes from the field tables, so a new setting needs no code here.
     */
    function clampNumber(raw: string, current: number, key: string): number {
      const n = Number(String(raw).trim())
      const min = FIELD_MIN[key] ?? 0
      const max = FIELD_MAX[key]
      const whole = max === undefined
      const bad = !Number.isFinite(n) || n < min || (max !== undefined && n > max) || (whole && !Number.isInteger(n))
      if (bad) {
        toast(`Not ${whole ? "a whole number" : `a number between ${min} and ${max}`} — still ${current}.`, "error")
        return current
      }
      return n
    }

    // ——— registration (must happen inside a rendered component) ———

    /**
     * The blocked calls waiting for a human, newest first. Not filtered by
     * the session on screen: a blocked call often ran in a subagent session
     * that this window never shows, and the grant is keyed to the call's
     * identity anyway, so approving it from anywhere still spends it right.
     */
    function pendingApprovals(): Approval[] {
      return readApprovals(loadState().approveTtl).reverse()
    }

    /**
     * Approve one blocked call. The grant lets the next matching call through
     * once, and the server spends it there.
     */
    async function approve(prefix: string): Promise<void> {
      const pending = pendingApprovals()
      if (!pending.length) {
        toast("Nothing is waiting for approval.")
        return
      }
      const query = prefix.trim().toLowerCase()
      const matches = pending.filter((a) => !query || a.token.includes(query) || a.subject.toLowerCase().includes(query))
      if (!matches.length) {
        toast(`No blocked call matches "${prefix.trim()}".`)
        return
      }
      const chosen = matches.length === 1 ? matches[0] : await pick(matches)
      if (!chosen) return
      grant(chosen.token, chosen.sessionID)
      toast(`Approved ${chosen.token}. The next matching call is allowed once.`)
    }

    /** The picker: the host's own searchable list of what is blocked. */
    async function pick(matches: Approval[]): Promise<Approval | undefined> {
      const token = await ctx.ui.dialog.select({
        title: "Approve a blocked call",
        options: matches.map((a) => ({
          title: `${a.token}  ${a.subject.split("\n")[0].slice(0, 80)}`,
          value: a.token,
          description: `${a.reason} — ${a.sessionID}`,
        })),
        search: (query: string, options: any[]) =>
          options.filter(
            (o: any) =>
              o.title.toLowerCase().includes(query.toLowerCase()) ||
              (o.description ?? "").toLowerCase().includes(query.toLowerCase()),
          ),
      })
      if (!token) return undefined
      return matches.find((a) => a.token === token)
    }

    function recentCalls(): string {
      const rows = readLog(12)
      if (rows.length === 0) return "No calls logged yet."
      return rows
        .map((r) => {
          if (r.skipped || r.error) {
            const on = typeof r.tool === "string" && r.tool ? ` on ${r.tool}` : ""
            return `${r.ts}  ${r.hook ?? "jev"}${on} ${r.error ? `failed: ${r.error}` : `skipped: ${r.skipped}`}`
          }
          const answers = (r.decisions ?? []).map((d: any) => `${d.id}=${JSON.stringify(d.value)}`).join(" ")
          return `${r.ts}  ${r.hook ? `${r.hook}  ` : ""}${answers}  ${r.inputTokens ?? 0}tok`
        })
        .join("\n")
    }

    /**
     * The toast tail. Jev calls happen in the server process and this module is
     * the only place a toast can be drawn, so the log the server already writes
     * is the whole channel between them: poll its tail rather than invent a
     * second file. The interval is the price of the process boundary.
     *
     * ponytail: a fixed 2s poll and a 200-line window. Move to a real event
     * bridge if the TUI plugin ever gets one.
     */
    function startToasts(): void {
      if (tailStarted) return
      tailStarted = true
      // Today's newest entry is the floor, so an already-full log never
      // replays its history into the TUI on startup.
      let after = readLog(1)[0]?.ts ?? ""
      setInterval(() => {
        const { fresh, after: next } = newSince(readLog(200), after)
        after = next
        for (const row of fresh) {
          if (!toastsOn(row.hook)) continue
          if (!toastOutcomeAllowed(row)) continue
          const line = toastLine(row)
          if (line) toast(line.message, line.variant, line.title)
        }
        refreshSidebar()
      }, 2000)
    }

    // ——— the sidebar section ———

    /**
     * The recent hook calls, one terse line each. A slot claim must return a
     * real element: a bare string is an orphan text node and the host's tree
     * walk treats that as a crash. The element runtime comes from the host
     * itself, so nothing is vendored.
     */
    async function startSidebar(): Promise<void> {
      if (sidebarStarted) return
      sidebarStarted = true
      if (typeof ctx.ui?.slot !== "function" || typeof ctx.storage?.memory !== "function") return
      let jsx: (type: string, props?: Record<string, unknown>) => unknown
      try {
        const runtime: any = await import("@opentui/solid/jsx-runtime")
        jsx = runtime.jsx
      } catch (error) {
        trace("sidebar:no-runtime", { error: String(error?.message ?? error) })
        return
      }
      const [store, update] = ctx.storage.memory("jev-sidebar", { initial: { lines: [] as string[] } })
      // The fold state is durable, like the host's own sidebar sections.
      const [view, setView] = ctx.storage.store("jev-view", { initial: { open: true } })
      // The host's own sidebar sections: a box, a bold label in the base
      // colour, and the rows in the muted one.
      const theme = ctx.theme
      const draw = () => {
        const lines: string[] = store?.lines ?? []
        if (!lines.length) return null
        const open = view?.open !== false
        // The host's own sections: a header row that folds on a click, the
        // arrow, and the label in the base colour.
        const header = jsx("box", {
          flexDirection: "row",
          gap: 1,
          onMouseDown: () => {
            void setView((draft: any) => {
              draft.open = draft.open !== true
            })
          },
          children: [
            jsx("text", { fg: theme?.text?.base, children: open ? "\u25BC" : "\u25B6" }),
            jsx("text", { fg: theme?.text?.base, children: jsx("b", { children: "Jev" }) }),
          ],
        })
        const rows = open ? lines.map((line) => jsx("text", { fg: theme?.text?.muted, children: line })) : []
        return jsx("box", { children: [header, ...rows] })
      }
      ctx.ui.slot({ append: "sidebar.content", render: draw })
      // The lines ride the same poll the toasts use: the log the server writes
      // is the only channel between the two processes.
      refreshSidebar = () => {
        const state = loadState()
        if (!state.sidebar) {
          update((draft: any) => {
            draft.lines = []
          })
          return
        }
        // readLog is newest first already.
        const lines = sidebarLines(readLog(60), state.sidebarCount)
        update((draft: any) => {
          draft.lines = lines
        })
      }
    }

    void startSidebar()

    ctx.ui?.slot?.({
      append: "app",
      render: () => {
        startToasts()
        ctx.keymap.layer(() => ({
          mode: "global",
          priority: 1,
          enabled: true,
          commands: [
            { id: "jev.settings", title: "Settings", group: "jev", palette: true, slash: { name: "jev-settings" }, run: () => guard("jev-settings", () => void openSettings()) },
            { id: "jev.features", title: "Features", group: "jev", palette: true, slash: { name: "jev-features" }, run: () => guard("jev-features", () => void openFeatures()) },
            // No slash name on the two the server also owns. A name with two
            // owners is listed twice in the slash list, and the server's
            // command shadows this one anyway: the text route prints the same
            // thing into the transcript, and it is the route that works
            // without a TUI. The palette entry stays for the quick look.
            { id: "jev.status", title: "Status", group: "jev", palette: true, run: () => guard("jev-status", () => toast(summary())) },
            { id: "jev.key", title: "Set API key", group: "jev", palette: true, slash: { name: "jev-key" }, run: () => guard("jev-key", () => void setKey()) },
            { id: "jev.log", title: "Recent calls", group: "jev", palette: true, run: () => toast(recentCalls()) },
            {
              id: "jev.approve",
              title: "Approve a blocked call",
              group: "jev",
              palette: true,
              slash: { name: "jev-approve", arguments: true },
              run: (input) =>
                guard(
                  "jev-approve",
                  () =>
                    void approve(String(input ?? "")).catch((error: any) =>
                      toast(`Approve failed: ${error?.message ?? error}`, "error"),
                    ),
                ),
            },
          ],
        }))
        return null // layer carrier renders nothing
      },
    })

    return undefined
  },
}
