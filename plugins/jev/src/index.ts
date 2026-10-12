/**
 * fazuh.jev — bounded decisions from TypeSafe's Jev, over any provider that
 * exposes a System One /systemone endpoint.
 *
 * Two hooks, no tools. The power is automatic: the skill-routing hook asks Jev
 * which skill fits each user prompt and advises it in context; the risk hook
 * judges bash/edit/write calls and can block one. Both are off by default and
 * fail open — a Jev outage never blocks work, except the opt-in risk gate,
 * which is the one switch allowed to block.
 */

import { ask, JevError } from "./jev.ts"
import { cfgBool, cfgNum, cfgStr, featureOn, featureStored, keySource, loadData, loadState, logCall, pluginEnabled, readLog, saveData, saveState, setSkillCriterion, spend, FEATURES } from "./state.ts"
import { homedir } from "node:os"
import { join } from "node:path"
import { readFileSync, readdirSync } from "node:fs"
import { createHash } from "node:crypto"

/**
 * The one error the hook is allowed to let out. Anything else — a Jev
 * transport failure, a shape error, or a bug in this plugin — is swallowed and
 * logged, because a Jev problem must never be the thing that stops the agent.
 */
class GateBlock extends Error {}

// ——— skill routing hook ———

/**
 * Where installed skills live: the global config, the external-skills dir,
 * and the current project. First occurrence of a directory name wins, so a
 * project skill shadows a global one the same way the skill tool resolves.
 */
const ROSTER_ROOTS = [
  join(process.cwd(), ".opencode", "skills"),
  join(homedir(), ".config", "opencode", "skills"),
  join(homedir(), ".agents", "skills"),
]

interface SkillEntry {
  id: string
  meaning: string
}

/** Stable cache key: the description, not the file. Body edits that leave the
 *  description alone never invalidate. */
export function hashDescription(description: string): string {
  return createHash("sha256").update(description, "utf8").digest("hex").slice(0, 16)
}

/** Stable id for the installed skill set: order-independent. */
export function rosterHash(entries: { id: string }[]): string {
  return createHash("sha256").update(entries.map((e) => e.id).sort().join("\n"), "utf8").digest("hex").slice(0, 16)
}

/**
 * First-sentence truncation. The Jev choice pays per token per candidate, and
 * the decisive signal is usually the opening sentence; the "when NOT to pick"
 * clauses in later sentences are what the optimizer cache preserves properly.
 * New or changed descriptions fall back to this until optimized.
 */
export function firstSentence(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim()
  const cut = oneLine.search(/[.!?](\s|$)/)
  return (cut === -1 ? oneLine : oneLine.slice(0, cut + 1)).slice(0, 200) || oneLine.slice(0, 200)
}

/**
 * Resolve each roster entry to its choice criterion: the cached optimizer
 * output when the stored hash matches the live description, else the
 * first-sentence fallback. Returns the resolved entries plus the ids whose
 * cache missed, so the caller can optimize exactly those.
 */
export function resolveCriteria(roster: SkillEntry[]): { entries: SkillEntry[]; stale: SkillEntry[] } {
  const cache = loadData().skillCriteria
  const entries: SkillEntry[] = []
  const stale: SkillEntry[] = []
  for (const skill of roster) {
    const hit = cache[skill.id]
    if (hit && hit.origHash === hashDescription(skill.meaning)) {
      entries.push({ id: skill.id, meaning: hit.terse })
    } else {
      entries.push({ id: skill.id, meaning: firstSentence(skill.meaning) })
      stale.push(skill)
    }
  }
  return { entries, stale }
}

/**
 * The installed-skill roster: name + description per skill.
 *
 * Preferred source is the host's own registry — `ctx.skill.list` when the
 * runtime exposes it (the types declare only `transform`, but the binary
 * carries `skill.list` and the TUI's @-autocomplete uses the same registry).
 * The manual directory scan is the fallback for a host that does not expose
 * it: same roots the host itself scans, so the roster matches.
 */
export async function skillRoster(ctx: any, roots: string[]): Promise<SkillEntry[]> {
  // In-process skill service, if this host's context carries it.
  try {
    const list = ctx?.skill?.list
    if (typeof list === "function") {
      const raw = await list.call(ctx.skill)
      const entries = normalizeRoster(raw)
      if (entries.length) return entries
    }
  } catch {}

  // Filesystem, matching what the host itself scans.
  return diskRoster(roots)
}

/** Accepts either a bare array or the API's `{ data: [...] }` envelope. */
function normalizeRoster(raw: unknown): SkillEntry[] {
  const rows = Array.isArray(raw) ? raw : Array.isArray((raw as any)?.data) ? (raw as any).data : []
  const out: SkillEntry[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    const id = String(row?.name ?? row?.id ?? "").trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    // Full description here: truncation and the optimizer cache are applied
    // later in resolveCriteria, so every reader of the roster gets the same
    // input regardless of source.
    const description = String(row?.description ?? "").replace(/\s+/g, " ").trim()
    out.push({ id, meaning: description || `installed skill ${id}` })
  }
  return out
}

/** Filesystem fallback: name + description from each SKILL.md's frontmatter. */
function diskRoster(roots: string[]): SkillEntry[] {
  const seen = new Set<string>()
  const out: SkillEntry[] = []
  for (const root of roots) {
    let names: string[]
    try {
      names = readdirSync(root)
    } catch {
      continue
    }
    for (const name of names.sort()) {
      if (seen.has(name)) continue
      let text: string
      try {
        text = readFileSync(join(root, name, "SKILL.md"), "utf8")
      } catch {
        continue
      }
      // Frontmatter is YAML; only the two fields we need, first match wins,
      // description truncated — Jev needs the one-liner, not the body.
      const fm = text.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? ""
      const skillName = fm.match(/^name:\s*(.+)$/m)?.[1]?.trim()
      const description = fm
        .match(/^description:\s*([\s\S]*?)(?=^\w+:|$)/m)?.[1]
        ?.replace(/\s+/g, " ")
        .trim()
      if (!skillName) continue
      seen.add(name)
      out.push({ id: skillName, meaning: description || `installed skill ${skillName}` })
    }
  }
  return out
}

/**
 * One pick per prompt, kept until the next prompt supersedes it. The context
 * hook fires on every LLM request in the agentic loop; without this the same
 * prompt would spend a Jev call per turn.
 */
interface RoutePick {
  prompt: string
  advice: string | null
  ts: number
}
const routeCache = new Map<string, RoutePick>()

async function routePrompt(prompt: string, roster: SkillEntry[], ctx: any): Promise<string | null> {
  const F = "hook_skill_pick"
  const maxCandidates = Math.max(2, Math.round(cfgNum(F, "maxCandidates")))
  const { entries, stale } = resolveCriteria(roster)
  const capped = entries.slice(0, maxCandidates)
  if (capped.length < 2) return null
  const result = await ask(
    { task: prompt },
    {
      pick: {
        type: "choice",
        instructions:
          "Choose which installed skill best covers this task. The candidates are the name and description of each SKILL.md; you do not need their bodies.",
        criteria: Object.fromEntries(capped.map((s) => [s.id, s.meaning])),
      },
    },
    {
      timeoutMs: Math.max(1, Math.round(cfgNum(F, "timeout"))),
      thresholds: { minProbability: cfgNum(F, "minProbability"), minMargin: cfgNum(F, "minMargin") },
    },
  )
  const d = result.decisions[0]
  // Auto warm-up runs only when the installed id set changed: rosterHash
  // tracks the last set the optimizer saw, so description-only staleness and
  // steady state never trigger a background call. The manual command covers
  // everything else. Fire-and-forget — the current prompt has its answer.
  if (stale.length && cfgBool(F, "autoOptimize") && rosterHash(capped) !== loadData().rosterHash) {
    void optimizeCriteria(ctx, stale)
      .then(({ done }) => {
        // Only mark the roster seen on real progress: a failed run stays
        // stale so the next process retries instead of assuming it's warm.
        if (done > 0) saveData({ rosterHash: rosterHash(capped) })
      })
      .catch(() => {})
  }
  if (!d.confident) {
    logCall({ hook: "hook_skill_pick", skipped: `low confidence: ${d.note ?? "weak answer"}`, inputTokens: result.inputTokens })
    return null
  }
  return renderAdvice(d)
}

/**
 * The advised skills: the confident winner plus every runner-up at or above
 * the alsoAbove floor, capped at maxPicks (-1 = every qualifier). A
 * low-confidence winner injects nothing at all — runners-up never rescue a
 * rejected pick, because pluralizing a shrug does not make it decisive.
 */
export function renderAdvice(d: { value: unknown; probability?: number; distribution?: Record<string, number> }): string {
  const F = "hook_skill_pick"
  const floor = cfgNum(F, "alsoAbove")
  const cap = Math.round(cfgNum(F, "maxPicks"))
  const ranked = Object.entries(d.distribution ?? {})
    .filter(([id]) => id !== String(d.value))
    .filter(([, p]) => typeof p === "number" && p >= floor)
    .sort((a, b) => b[1] - a[1])
    .slice(0, cap < 0 ? undefined : Math.max(0, cap - 1))
  const names = [`@${String(d.value)} (P=${Number(d.probability ?? 0).toFixed(2)})`]
  for (const [id, p] of ranked) names.push(`@${id} (P=${p.toFixed(2)})`)
  const skills = names.length > 2 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names.join(" and ")
  return `Jev routing: consider loading skill${names.length > 1 ? "s" : ""} ${skills}. Advisory — if your own reading disagrees, decide yourself.`
}

/**
 * Optimize stale skill descriptions through the host LLM. One prompt, all
 * stale skills batched: N descriptions in, N terse criteria out as JSON.
 * Each criterion is a reason, not a label — when the skill is the right pick
 * AND when it is not — capped at ~40 words, because that is what makes a
 * choice sharp instead of a guess.
 *
 * Runs in the background: the current prompt uses the first-sentence fallback
 * and the cache is warm for the next one. Failures log and leave the cache
 * untouched, so a bad optimizer run can never poison the roster — the worst
 * case is another fallback pick next time.
 *
 * Three consecutive failures latch the AUTO path off for the rest of the
 * process (the log showed one failure per prompt otherwise); the manual
 * command bypasses the latch and a success clears it.
 */
export async function optimizeCriteria(
  ctx: any,
  stale: SkillEntry[],
  opts: { manual?: boolean } = {},
): Promise<{ done: number; failed: number }> {
  const self = optimizeCriteria as any
  // Remember a missing generate.text per process: without this, every prompt
  // on such a host logs the same "unavailable" line and the log fills with it.
  if (self._noGenerate) return { done: 0, failed: stale.length }
  if (self._latched && !opts.manual) return { done: 0, failed: stale.length }
  let generate: any
  try {
    generate = ctx?.generate?.text
    if (typeof generate !== "function") throw new Error("host has no generate.text")
  } catch (error) {
    self._noGenerate = true
    logCall({ hook: "hook_skill_pick", skipped: `optimizer unavailable: ${error instanceof Error ? error.message : String(error)}` })
    return { done: 0, failed: stale.length }
  }
  const batch = stale.slice(0, 30)
  const prompt = [
    "Rewrite each skill description below as ONE terse choice criterion, max 40 words: state when the skill is the right pick AND when it is not. Return JSON: { \"<id>\": \"<criterion>\" } and nothing else.",
    "",
    ...batch.map((s) => `- ${s.id}: ${s.meaning.slice(0, 600)}`),
  ].join("\n")
  // optimizeModel overrides the host model: providerID/modelID split on the
  // first slash (model ids themselves contain slashes). Empty = host default.
  const override = cfgStr("hook_skill_pick", "optimizeModel").trim()
  const payload = {
    prompt,
    model: override ? { providerID: override.slice(0, override.indexOf("/")), id: override.slice(override.indexOf("/") + 1) } : null,
  }
  if (override && !override.includes("/")) {
    const detail = `optimizeModel must be providerID/modelID, got "${override}"`
    logCall({ hook: "hook_skill_pick", skipped: `optimizer failed: ${detail}` })
    self._failures = (self._failures ?? 0) + 1
    if (self._failures >= 3) latch(self, detail)
    return { done: 0, failed: batch.length }
  }
  let done = 0
  try {
    // Awaited with a ceiling: the command path waits for the result, the
    // hook's background warm-up just moves on. Either way a slow host only
    // delays the cache, never the prompt.
    const raw = await Promise.race([
      generate.call(ctx.generate, payload),
      new Promise((_, reject) => setTimeout(() => reject(new Error("optimizer timed out after 30000ms")), 30_000)),
    ])
    const text = typeof raw === "string" ? raw : String(raw?.text ?? raw?.data?.text ?? "")
    const jsonText = text.match(/\{[\s\S]*\}/)?.[0]
    if (!jsonText) throw new Error(`optimizer returned no JSON object: ${text.slice(0, 200)}`)
    let parsed: any
    try {
      parsed = JSON.parse(jsonText)
    } catch {
      throw new Error(`optimizer returned unparseable JSON: ${jsonText.slice(0, 200)}`)
    }
    for (const s of batch) {
      const terse = typeof parsed[s.id] === "string" ? parsed[s.id].trim() : ""
      if (!terse || terse.length > 400) continue
      setSkillCriterion(s.id, hashDescription(s.meaning), terse)
      done++
    }
    if (done > 0) {
      self._failures = 0
      self._latched = false
    } else {
      // Host answered but nothing landed: counts toward the latch too, so a
      // silently-junk response cannot spend a call on every prompt forever.
      self._failures = (self._failures ?? 0) + 1
      const detail = "host returned no usable criteria"
      if (self._failures >= 3) latch(self, detail)
      else logCall({ hook: "hook_skill_pick", skipped: `optimizer failed: ${detail}` })
    }
  } catch (error: any) {
    const tag = typeof error?._tag === "string" ? `${error._tag}${error.kind ? `(${error.kind})` : ""} ` : ""
    const frame = error instanceof Error ? String(error.stack ?? "").split("\n")[1]?.trim() : ""
    const detail = `${tag}${error instanceof Error ? error.message : String(error)}${frame ? ` @ ${frame}` : ""}`
    self._failures = (self._failures ?? 0) + 1
    if (self._failures >= 3) latch(self, detail)
    else logCall({ hook: "hook_skill_pick", skipped: `optimizer failed: ${detail}` })
  }
  return { done, failed: batch.length - done }
}

/** Trip the auto-path latch after OPTIMIZER_LATCH consecutive failures. */
const OPTIMIZER_LATCH = 3
function latch(self: any, detail: string): void {
  if (self._latched) return
  self._latched = true
  logCall({
    hook: "hook_skill_pick",
    skipped: `optimizer off for this process after ${OPTIMIZER_LATCH} consecutive failures (last: ${detail}); /jev-optimize-skills retries, restart clears`,
  })
}

/**
 * Whether one risk answer blocks a tool call. Two conditions, not either: a
 * probability at or above the threshold is only trustworthy when the answer is
 * also confident, and a noul's "confidence" is just distance from a coin flip.
 */
export function blocksCall(decision: { confident: boolean; probability?: number }, threshold: number): boolean {
  return decision.confident && Number(decision.probability) >= threshold
}

function riskHook() {
  return {
    name: "risk",
    /** Applies to the tools whose arguments carry text worth judging. */
    description: "Jev risk annotation",
    execute: async (input: any) => {
      const tool = String(input?.tool ?? "")
      if (!featureOn("hook_risk")) return
      const F = "hook_risk"
      const args = input?.args ?? input?.output?.args ?? {}
      const subject =
        typeof args.command === "string"
          ? `shell command: ${args.command}`
          : typeof args.patchText === "string"
            ? `code patch:\n${args.patchText}`
            : typeof args.filePath === "string"
              ? `edit to ${args.filePath}`
              : typeof args.content === "string"
                ? `file write:\n${args.content}`
                : null
      if (!subject) return
      try {
        const result = await ask(
          { action: subject },
          {
            risky: {
              type: "noul",
              instructions: "Does this action destroy data, leak a credential, or make an irreversible external change?",
              criteria: {
                true: "It deletes or overwrites data irrecoverably, sends a secret somewhere, or performs an irreversible external action.",
                false: "It is a read, a local reversible edit, or a normal development command.",
              },
            },
          },
          { log: true, timeoutMs: Math.max(1, Math.round(cfgNum(F, "timeout"))), thresholds: { minProbability: cfgNum(F, "minProbability"), minMargin: 0 } },
        )
        const d = result.decisions[0]
        if (blocksCall(d, cfgNum(F, "gateProbability"))) {
          throw new GateBlock(
            `jev gate: Jev puts P(risky)=${Number(d.probability).toFixed(2)} on this ${tool} call, at or above the ${cfgNum(F, "gateProbability")} block threshold. Confirm the action is intended, then retry. Change the threshold or turn the hook_risk feature off in /jev-features.`,
          )
        }
      } catch (error) {
        if (error instanceof GateBlock) throw error
        logCall({ hook: "hook_risk", tool, skipped: error instanceof JevError ? error.message : String(error) })
      }
    },
  }
}

export default {
  id: "fazuh.jev",
  tui: true,

  setup: async (ctx: any) => {
    // The routing hook. `session.hook("prompt")` fires once per admitted user
    // input — exactly "every time the user prompts". The host may reject the
    // hook name (it is the least-documented of the session hooks), so
    // registration is try/catch and rejection just disables the prompt-side
    // trigger: the context hook still runs and picks up unseen prompts itself,
    // at the cost of spending inside the request path.
    if (typeof ctx?.session?.hook === "function") {
      let promptHookLive = false
      try {
        await ctx.session.hook("prompt", async (event: any) => {
          try {
            if (!featureOn("hook_skill_pick")) return
            const sessionID = String(event?.sessionID ?? event?.session?.id ?? "")
            const text = String(event?.text ?? event?.prompt?.text ?? "")
            if (!sessionID || !text.trim()) return
            if (routeCache.has(sessionID) && routeCache.get(sessionID)!.prompt === text) return
            // Seed synchronously so a slow Jev cannot race a second prompt
            // into double-spending; the advice fills in when it lands.
            routeCache.set(sessionID, { prompt: text, advice: null, ts: Date.now() })
            const advice = await routePrompt(text, await skillRoster(ctx, ROSTER_ROOTS), ctx)
            routeCache.set(sessionID, { prompt: text, advice, ts: Date.now() })
          } catch (error) {
            logCall({ hook: "hook_skill_pick", skipped: error instanceof JevError ? error.message : String(error) })
          }
        })
        promptHookLive = true
      } catch {
        logCall({ hook: "hook_skill_pick", skipped: "prompt hook rejected by host; context-hook fallback only" })
      }

      // The injection side, and the fallback trigger when the prompt hook is
      // unavailable. Fires on every LLM request; the cache makes it spend
      // once per prompt and inject every turn until the next prompt supersedes.
      await ctx.session.hook("context", async (event: any) => {
        try {
          if (!featureOn("hook_skill_pick")) return
          const sessionID = String(event?.sessionID ?? event?.session?.id ?? "")
          if (!sessionID) return
          // Subagent sessions route through the parent's skills already.
          if (event?.parentID ?? event?.session?.parentID) return

          const messages = Array.isArray(event?.messages) ? event.messages : []
          const last = [...messages].reverse().find((m: any) => m?.role === "user")
          const lastText = String(typeof last?.content === "string" ? last?.content : (last?.content?.[0]?.text ?? "")).trim()
          let entry = routeCache.get(sessionID)

          if (!promptHookLive && lastText) {
            if (!entry || entry.prompt !== lastText) {
              routeCache.set(sessionID, { prompt: lastText, advice: null, ts: Date.now() })
              entry = routeCache.get(sessionID)!
              entry.advice = await routePrompt(lastText, await skillRoster(ctx, ROSTER_ROOTS), ctx)
            }
          }
          if (entry?.advice && Date.now() - entry.ts < 300_000 && Array.isArray(event?.system)) {
            event.system.push({ type: "text", text: entry.advice })
          }
        } catch (error) {
          logCall({ hook: "hook_skill_pick", skipped: error instanceof JevError ? error.message : String(error) })
        }
      })
    }

    if (typeof ctx?.tool?.hook === "function") {
      await ctx.tool.hook("execute.before", async (event: any) => {
        const tool = String(event?.tool ?? "").toLowerCase()
        if (!["bash", "edit", "write", "apply_patch"].includes(tool)) return
        await riskHook().execute({ tool, args: event?.args ?? event?.input })
      })
    }

    // /jev commands. Every field the client reads at call time is a setting,
    // not a constant: the wire model id and the endpoint path are
    // provider-specific and neither has a portable default. The same settings
    // are also editable from the TUI panel, and both write the same state file.
    //
    // /jev-settings, /jev-features and /jev-key are deliberately absent: the
    // TUI module owns those names, and a server command of the same name
    // shadows the panel and the key dialog with a summary that edits nothing.
    // A singular /jev-feature used to fill the gap for hosts with no TUI, but it
    // duplicated the panel badly enough to be more confusing than missing.
    // /jev-gate and /jev-on are gone for the same reason: the risk hook is the
    // hook_risk feature switch, and two names for one switch is one too many.
    // /jev-status, /jev-model, /jev-endpoint and /jev-log remain the text route.
    // See tui.ts.
    const COMMANDS: Record<string, string> = {
      "jev-status": "Jev endpoint, model, key source, which features are on, thresholds, and spend",
      "jev-model": "Set the wire model id, e.g. /jev-model typesafe/jev",
      "jev-endpoint": "Set the decisions endpoint, e.g. /jev-endpoint https://host/v1/systemone",
      "jev-log": "Show recent Jev calls: what was sent, what came back, what it cost",
      "jev-optimize-skills": "Rewrite every unoptimized skill description into a terse choice criterion via the host LLM; /jev-optimize-skills <id> refreshes one skill",
    }

    for (const [name, description] of Object.entries(COMMANDS)) {
      await ctx.command.transform((draft: any) => {
        draft.add({
          name,
          description,
          execute: async (input: any) => {
            const arg = String(input?.prompt?.text ?? "").trim()
            const state = loadState()

            if (name === "jev-model") {
              if (!arg) return { content: `Model: ${state.model}` }
              saveState({ model: arg })
              return { content: `Model set to ${arg}.` }
            }
            if (name === "jev-endpoint") {
              if (!arg) return { content: `Endpoint: ${state.endpoint}` }
              saveState({ endpoint: arg })
              return { content: `Endpoint set to ${arg}.` }
            }
            if (name === "jev-log") {
              const rows = readLog(20)
              if (rows.length === 0) return { content: "No Jev calls logged yet." }
              return {
                content: rows
                  .map((r) => {
                    // Skipped-hook entries: the feature name in `hook`, the
                    // reason in `skipped`, and the tool when the risk hook
                    // logged one. A regular call logs its decisions instead.
                    if (r.hook) {
                      const on = typeof r.tool === "string" && r.tool ? ` on ${r.tool}` : ""
                      return `${r.ts}  ${r.hook}${on} skipped: ${r.skipped ?? "unknown"}`
                    }
                    const answers = (r.decisions ?? [])
                      .map((d: any) => `${d.id}=${JSON.stringify(d.value)}${d.confident ? "" : " (low)"}`)
                      .join(" ")
                    return `${r.ts}  ${answers}  ${r.inputTokens}tok $${((r.inputTokens / 1e6) * 0.04).toFixed(6)}`
                  })
                  .join("\n"),
              }
            }
            if (name === "jev-optimize-skills") {
              const roster = await skillRoster(ctx, ROSTER_ROOTS)
              const { stale } = resolveCriteria(roster)
              const targets = arg
                ? stale.filter((s) => s.id === arg)
                : stale
              if (arg && targets.length === 0) {
                const known = roster.some((s) => s.id === arg)
                return { content: known ? `@${arg} is already optimized.` : `No installed skill @${arg}.` }
              }
              if (targets.length === 0) return { content: `All ${roster.length} skill criteria are current.` }
              // Awaited, not background: the user asked for this explicitly
              // and wants the result, unlike the hook's silent warm-up. Manual
              // bypasses the failure latch; a success clears it.
              const { done, failed } = await optimizeCriteria(ctx, targets, { manual: true })
              return { content: `Optimized ${done} of ${targets.length} criteria${failed ? `, ${failed} failed (see /jev-log)` : ""}.` }
            }
            const key = keySource()
            const money = spend()
            return {
              content: [
                `endpoint  ${state.endpoint}`,
                `model     ${state.model}`,
                `key       ${key.present ? `present (${key.from})` : `MISSING — set one of $${state.keyEnv}, or /jev-key`}`,
                `plugin    ${pluginEnabled() ? "on" : "OFF — every hook is silent, nothing is sent, nothing is spent"}`,
                `on        ${FEATURES.filter((f) => featureStored(f.key)).map((f) => f.key).join(" ") || "nothing"}`,
                `off       ${FEATURES.filter((f) => !featureStored(f.key)).map((f) => f.key).join(" ") || "nothing"}`,
                ...FEATURES.map(
                  (f) => `config.${f.key}  ${Object.entries(state.config[f.key] ?? {})
                    .map(([k, v]) => `${k}=${v}`)
                    .join(" ")}`,
                ),
                `spend     ${money.calls} calls · ${money.tokens} input tokens · $${money.usd.toFixed(6)}`,
                `logMax    ${state.logMax} lines (jev-calls.jsonl, pruned to tail)`,
                "",
                "Edit any of it with /jev-settings.",
              ].join("\n"),
            }
          },
        })
      })
    }
  },
}
