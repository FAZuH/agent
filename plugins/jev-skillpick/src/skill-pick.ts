/**
 * Skill-pick hook: advises which installed skill fits a prompt, injected into
 * context. Advisory only and fail-open: a Jev problem never blocks the agent.
 */

import { ask, JevError } from "../../../lib/jev/jev.ts"
import { cfgBool, cfgNum, cfgStr, featureOn, loadData, logCall, saveData, setSkillCriterion } from "../../../lib/jev/state.ts"
import { homedir } from "node:os"
import { join } from "node:path"
import { readFileSync, readdirSync } from "node:fs"
import { createHash } from "node:crypto"

/**
 * Where installed skills live: the global config, the external-skills dir,
 * and the current project. First occurrence of a directory name wins, so a
 * project skill shadows a global one the same way the skill tool resolves.
 */
export const ROSTER_ROOTS = [
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
 * The optimizer once opened every criterion with "Pick for/to/when …", which
 * says nothing: the choice already asks which skill to pick. Stripped on read,
 * so stored entries clean themselves up without re-spending.
 */
export function stripCriterionPreamble(text: string): string {
  const bare = text.replace(/^Pick (?:for |to |when |as |before |until )?/, "")
  const first = bare.charAt(0)
  return (first >= "a" && first <= "z" ? first.toUpperCase() + bare.slice(1) : bare) || text
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
      entries.push({ id: skill.id, meaning: stripCriterionPreamble(hit.terse) })
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

async function routePrompt(prompt: string, roster: SkillEntry[], ctx: any, sessionID = ""): Promise<string | null> {
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
      hook: F,
    },
  )
  const d = result.decisions[0]
  // Auto warm-up runs only when the installed id set changed: rosterHash
  // tracks the last set the optimizer saw, so description-only staleness and
  // steady state never trigger a background call. The manual command covers
  // everything else. Fire-and-forget — the current prompt has its answer.
  if (stale.length && cfgBool(F, "autoOptimize") && rosterHash(capped) !== loadData().rosterHash) {
    void optimizeCriteria(ctx, stale, { sessionID })
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

/** A model reference for generate.text: the pair the host resolves a provider from. */
export interface OptimizerModel {
  providerID: string
  id: string
}

/**
 * The model a generate.text call should name, in order: the `optimizeModel`
 * setting, the model the calling session already runs on, then the host
 * default. An override is `providerID/modelID` and only the first slash splits
 * it, because model ids contain slashes themselves.
 *
 * Naming no model at all hands the choice to the host default, which on this
 * machine resolved to a provider model that answers HTTP 404 — and three of
 * those in a row latch the optimizer off for the life of the process. The
 * session's own model is the safer second choice: the session is demonstrably
 * running on it.
 */
export function optimizerModel(override: string, session: unknown, hostDefault: unknown): OptimizerModel | null {
  const ref = (value: any): OptimizerModel | null => {
    const m = value?.model ?? value?.data?.model ?? value?.data ?? value
    return typeof m?.providerID === "string" && typeof m?.id === "string" && m.providerID && m.id
      ? { providerID: m.providerID, id: m.id }
      : null
  }
  const o = override.trim()
  if (o) {
    const slash = o.indexOf("/")
    return slash > 0 && slash < o.length - 1 ? { providerID: o.slice(0, slash), id: o.slice(slash + 1) } : null
  }
  return ref(session) ?? ref(hostDefault)
}

/** Skills per optimizer call. The rest stay stale for the next run. */
export const OPTIMIZE_BATCH = 30

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
  opts: { manual?: boolean; sessionID?: string } = {},
): Promise<{ done: number; failed: number }> {
  const self = optimizeCriteria as any
  // One call handles this many skills; the rest stay stale for the next run.
  const batch = stale.slice(0, OPTIMIZE_BATCH)
  // Remember a missing generate.text per process: without this, every prompt
  // on such a host logs the same "unavailable" line and the log fills with it.
  if (self._noGenerate) return { done: 0, failed: batch.length }
  if (self._latched && !opts.manual) return { done: 0, failed: batch.length }
  let generate: any
  try {
    generate = ctx?.generate?.text
    if (typeof generate !== "function") throw new Error("host has no generate.text")
  } catch (error) {
    self._noGenerate = true
    logCall({ hook: "hook_skill_pick", skipped: `optimizer unavailable: ${error instanceof Error ? error.message : String(error)}` })
    return { done: 0, failed: batch.length }
  }
  const prompt = [
    "Rewrite each skill description below as ONE terse choice criterion, max 40 words: when the skill is the right pick AND when it is not. Start directly with the trigger; never open with \"Pick for/when/to\" or any label. Return JSON: { \"<id>\": \"<criterion>\" } and nothing else.",
    "",
    ...batch.map((s) => `- ${s.id}: ${s.meaning.slice(0, 600)}`),
  ].join("\n")
  // The model to generate with: the setting, then this session's own model,
  // then the host default. See optimizerModel for why "name no model" is not
  // safe here — the host default was the thing answering 404.
  const override = cfgStr("hook_skill_pick", "optimizeModel")
  if (override.trim() && !override.trim().includes("/")) {
    const detail = `optimizeModel must be providerID/modelID, got "${override.trim()}"`
    logCall({ hook: "hook_skill_pick", skipped: `optimizer failed: ${detail}` })
    self._failures = (self._failures ?? 0) + 1
    if (self._failures >= 3) latch(self, detail)
    return { done: 0, failed: batch.length }
  }
  let model = optimizerModel(override, null, null)
  if (!model) {
    let session: unknown = null
    let hostDefault: unknown = null
    try {
      if (opts.sessionID && typeof ctx?.session?.get === "function") session = await ctx.session.get({ sessionID: opts.sessionID })
      if (typeof ctx?.model?.default === "function") hostDefault = await ctx.model.default()
    } catch {
      // A lookup failure is not fatal on its own; the failure below names it.
    }
    model = optimizerModel(override, session, hostDefault)
  }
  if (!model) {
    const detail = "no model to generate with: set optimizeModel in /jev-settings to providerID/modelID"
    logCall({ hook: "hook_skill_pick", skipped: `optimizer failed: ${detail}` })
    self._failures = (self._failures ?? 0) + 1
    if (self._failures >= 3) latch(self, detail)
    return { done: 0, failed: batch.length }
  }
  const payload = { prompt, model }
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
      const terse = stripCriterionPreamble((typeof parsed[s.id] === "string" ? parsed[s.id] : "").trim())
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
    // The provider the host actually used and the model asked for: the two
    // facts that turn "it 404ed" into something actionable.
    const service = typeof error?.service === "string" && error.service ? ` [${error.service}]` : ""
    const detail = `${tag}${error instanceof Error ? error.message : String(error)}${service}${frame ? ` @ ${frame}` : ""} (model ${model.providerID}/${model.id})`
    self._failures = (self._failures ?? 0) + 1
    if (self._failures >= 3) latch(self, detail)
    else logCall({ hook: "hook_skill_pick", skipped: `optimizer failed: ${detail}` })
  }
  return { done, failed: batch.length - done }
}

/**
 * Register the prompt and context hooks that pick a skill per prompt.
 * A host that rejects "prompt" still gets the context fallback.
 */
export async function attachSkillPick(ctx: any): Promise<void> {
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
          const advice = await routePrompt(text, await skillRoster(ctx, ROSTER_ROOTS), ctx, sessionID)
          routeCache.set(sessionID, { prompt: text, advice, ts: Date.now() })
        } catch (error) {
          logCall({ hook: "hook_skill_pick", error: error instanceof JevError ? error.message : String(error) })
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
            entry.advice = await routePrompt(lastText, await skillRoster(ctx, ROSTER_ROOTS), ctx, sessionID)
          }
        }
        if (entry?.advice && Date.now() - entry.ts < 300_000 && Array.isArray(event?.system)) {
          event.system.push({ type: "text", text: entry.advice })
        }
      } catch (error) {
        logCall({ hook: "hook_skill_pick", error: error instanceof JevError ? error.message : String(error) })
      }
    })
  }
}
