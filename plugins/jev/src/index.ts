/**
 * fazuh.jev — bounded decisions from TypeSafe's Jev, over any provider that
 * exposes a System One /systemone endpoint.
 *
 * Four tools, one per use case that earned its place. Each hands Jev text plus a
 * typed question and returns an answer with a confidence verdict; none of them
 * acts. Use case 2 (digest priority) is deferred on cost and is not here.
 *
 * Fail-open is the contract: every tool returns a message telling the agent to
 * carry on unaided rather than throwing, so a Jev outage never blocks work. The
 * one exception is the opt-in tool.execute.before gate, which is off by default.
 */

import { ask, estimateCost, JevError, type JevQuestion, type JevStateBody } from "./jev.ts"
import { FEATURES, featureOn, keySource, loadState, logCall, readLog, saveState, setFeature, spend, type JevState } from "./state.ts"

const USAGE_NOTE = `Jev decides, you act. Its answer is a signal, not a verdict: weigh it, verify it, and ignore it when your own reading disagrees.`

/** v2 tool results are { content }; a bare string makes the harness throw. */
function ok(result: { decisions: any[]; inputTokens: number; elapsedMs: number; model: string }, lead: string) {
  return { content: render(result, lead) }
}

function render(result: { decisions: any[]; inputTokens: number; elapsedMs: number; model: string }, lead: string) {
  const lines = result.decisions.map((d) => {
    const bits = [`- **${d.id}** → \`${JSON.stringify(d.value)}\``]
    if (d.probability !== undefined) bits.push(`P=${d.probability.toFixed(2)}`)
    if (d.margin !== undefined) bits.push(`margin=${d.margin.toFixed(2)}`)
    if (d.confidence !== undefined) bits.push(`confidence=${d.confidence.toFixed(2)}`)
    bits.push(d.confident ? "confident" : `**low confidence** — ${d.note ?? "weak answer"}`)
    return bits.join(" · ")
  })
  return [
    lead,
    "",
    ...lines,
    "",
    `${result.inputTokens} input tokens · ${estimateCost(result.inputTokens)} · ${result.elapsedMs}ms · ${result.model}`,
    USAGE_NOTE,
  ].join("\n")
}

/** ok() returns the text; every caller hands it back as a v2 tool result. */

function failOpen(error: unknown, what: string) {
  const detail = error instanceof JevError ? error.message : String(error)
  return { content: `Jev was not consulted for ${what} (${detail}). Proceed without it — decide using your own judgement.` }
}

/** A feature the user switched off. Says how to switch it back on. */
function disabled(tool: string, feature: string) {
  return {
    content: `${tool} is turned off (feature "${feature}"). Turn it on with /jev-features, or decide this yourself — nothing was sent and nothing was spent.`,
  }
}

/**
 * The one error the hook is allowed to let out. Anything else — a Jev
 * transport failure, a shape error, or a bug in this plugin — is swallowed and
 * logged, because a Jev problem must never be the thing that stops the agent.
 */
class GateBlock extends Error {}

const CHOICE_CANDIDATES = {
  type: "array",
  description: "The options to choose between, 2-20. Each needs a stable `id` and a `meaning` that says when it is the right pick.",
  items: {
    type: "object",
    properties: {
      id: { type: "string", description: "Short stable identifier, e.g. a skill name or a control ref." },
      meaning: { type: "string", description: "When this option is the correct one." },
    },
    required: ["id", "meaning"],
    additionalProperties: false,
  },
}

function choiceTool(opts: {
  name: string
  lead: string
  question: string
  stateField: string
  stateHint: string
  feature: string
}) {
  return {
    name: opts.name,
    description: `${opts.question}\n\nGive Jev the ${opts.stateField} and the candidates; it picks one and says how sure it is. ${opts.lead} Jev is advisory — if it is unsure, decide yourself.`,
    input: {
      type: "object",
      properties: {
        [opts.stateField]: { type: "string", description: opts.stateHint },
        question: { type: "string", description: "The one question to ask, in a sentence." },
        candidates: CHOICE_CANDIDATES,
      },
      required: [opts.stateField, "question", "candidates"],
      additionalProperties: false,
    },
    execute: async (input: any) => {
      if (!featureOn(opts.feature)) return disabled(opts.name, opts.feature)
      const candidates = (input.candidates ?? []) as { id: string; meaning: string }[]
      if (candidates.length < 2) return failOpen(new JevError("needs at least 2 candidates", "shape"), opts.name)
      if (candidates.length > 20) {
        return failOpen(new JevError(`${candidates.length} candidates is too many; narrow to the plausible ones first`, "shape"), opts.name)
      }
      const seen = new Set(candidates.map((c) => c.id))
      if (seen.size !== candidates.length) return failOpen(new JevError("candidate ids must be distinct", "shape"), opts.name)
      try {
        const questions: Record<string, JevQuestion> = {
          pick: {
            type: "choice",
            instructions: String(input.question),
            criteria: Object.fromEntries(candidates.map((c) => [c.id, String(c.meaning)])),
          },
        }
        const result = await ask(String(input[opts.stateField]) as JevStateBody, questions)
        const chosen = result.decisions[0]
        return ok(result, `${opts.lead}\n\nPicked: \`${chosen.value}\`${chosen.confident ? "" : " (low confidence — verify before relying on it)"}`)
      } catch (error) {
        return failOpen(error, opts.name)
      }
    },
  }
}

const REVIEW_LEVELS = [
  "No concrete concern in the evidence given.",
  "A localized concern worth a closer look.",
  "Touches shared behaviour, a boundary, or a contract.",
  "Directly conflicts with a stated requirement or weakens a check.",
]

/**
 * Yes/no gates asked about the change as a whole. Each one is a question the
 * diff can answer on its own, so "no" is a real signal rather than a shrug.
 * A gate that fires means read harder, never read less: the verdict only
 * raises the floor on attention, and every item is still returned.
 */
const REVIEW_GATES: [string, string][] = [
  ["breaks_a_stated_rule", "Does this change violate a rule, convention, or constraint stated in the goal or project docs?"],
  ["should_not_be_here", "Does this change do something the task did not ask for, or belong in a different place?"],
  ["weakens_a_check", "Does this remove, skip, or loosen a test, assertion, validation, or guard?"],
  ["touches_a_boundary", "Does this change auth, permissions, input handling, secrets, money, or another trust boundary?"],
  ["changes_a_contract", "Does this change a public interface, a schema, a serialized format, or a shared signature?"],
  ["has_unverified_claims", "Does the change or its evidence assert something that no test or receipt supports?"],
  ["is_hard_to_reverse", "Would reverting this be expensive, or would it affect data already written?"],
]

function reviewTool() {
  return {
    name: "jev_review_rank",
    description:
      "Rank changed code by how much review attention it deserves, using diff hunks, each file's role, and the related tests as evidence. " +
      "Returns a priority order plus any rules the change appears to break. " +
      "HARD RULE: this never excludes code from review. A low score and a clean gate list mean 'nothing stood out', not 'skip it' — " +
      "an unscored change is exactly the change a reviewer should not trust. Every item you pass in comes back.",
    input: {
      type: "object",
      properties: {
        goal: { type: "string", description: "What the change is trying to accomplish." },
        items: {
          type: "array",
          description: "The changed units to rank. Every one is returned.",
          items: {
            type: "object",
            properties: {
              path: { type: "string", description: "File path, or file:line for a hunk." },
              role: { type: "string", description: "What this file is for, e.g. 'auth middleware', 'generated', 'test fixture'." },
              change: { type: "string", description: "The diff hunk or a summary of what changed." },
              relatedTests: { type: "string", description: "Tests covering this change, and whether they were run." },
            },
            required: ["path", "role", "change"],
            additionalProperties: false,
          },
        },
      },
      required: ["goal", "items"],
      additionalProperties: false,
    },
    execute: async (input: any) => {
      if (!featureOn("review_rank")) return disabled("jev_review_rank", "review_rank")
      const items = (input.items ?? []) as any[]
      const gateProbability = loadState().gateProbability
      if (items.length === 0) return { content: "No items to rank." }
      if (items.length > 20) {
        return { content: `Too many items (${items.length}) for one call. Rank the top 20 by size or blast radius first, then run the rest.` }
      }
      try {
        // One question per item over a shared state: Jev evaluates them in
        // parallel, so the whole diff ranks in a single billed call.
        const result = await ask(
          {
            goal: String(input.goal),
            changes: items.map((i) => ({
              path: String(i.path),
              role: String(i.role ?? "unstated"),
              change: String(i.change),
              related_tests: i.relatedTests ? String(i.relatedTests) : "none given",
            })),
          },
          Object.fromEntries(
            items.map((item, i) => [
              `item_${i}`,
              {
                type: "score" as const,
                instructions: `Review attention for ${String(item.path)} (${String(item.role ?? "unstated")}). Judge the change as given; missing evidence means unknown, not safe.`,
                criteria: REVIEW_LEVELS,
              },
            ]),
          ),
        )
        const ranked = result.decisions
          .map((d, i) => ({ path: String(items[i].path), level: Number(d.value), margin: d.margin ?? 0 }))
          .sort((a, b) => b.level - a.level || b.margin - a.margin)

        // Gates run in a second call so a big diff does not dilute them into the
        // per-item scores. Same state, different question shape.
        let fired: { id: string; question: string; p: number }[] = []
        let gateNote = ""
        try {
          // The gates are a second billed call. Turning them off leaves the
          // ranking intact, which is why it is its own switch.
          if (!featureOn("review_gates")) throw new JevError("review gates are turned off (/jev-features)", "shape")
          const gate = await ask(
            {
              goal: String(input.goal),
              changes: items.map((i) => ({
                path: String(i.path),
                role: String(i.role ?? "unstated"),
                change: String(i.change),
                related_tests: i.relatedTests ? String(i.relatedTests) : "none given",
              })),
            },
            Object.fromEntries(
              REVIEW_GATES.map(([id, instructions]) => [
                id,
                {
                  type: "noul" as const,
                  instructions,
                  criteria: {
                    true: "The supplied evidence shows this condition holds.",
                    false: "The supplied evidence does not show this condition holding. Absent evidence is not evidence of absence.",
                  },
                },
              ]),
            ),
          )
          fired = REVIEW_GATES.map(([id, question]) => {
            const p = Number(gate.decisions.find((x) => x.id === id)?.probability ?? 0.5)
            return { id, question, p }
          })
          gateNote = `${gate.inputTokens} + ${gate.elapsedMs}ms`
        } catch (error) {
          gateNote = `gates unavailable (${error instanceof JevError ? error.message : String(error)})`
        }

        const warnings = fired.filter((g) => g.p >= gateProbability)
        // Below the gate and above 0.3 is Jev declining to answer. Silence is
        // not a pass, so it reads as a reason to look closer.
        const unsure = fired.filter((g) => g.p < gateProbability && g.p > 0.3)

        return {
          content: [
            `Review order, highest attention first (${ranked.length} of ${items.length} items — nothing was dropped):`,
            "",
            ...ranked.map((r, i) => `${i + 1}. \`${r.path}\` — level ${r.level.toFixed(2)}/3 · between "${REVIEW_LEVELS[Math.min(REVIEW_LEVELS.length - 1, Math.floor(r.level))]}" and "${REVIEW_LEVELS[Math.min(REVIEW_LEVELS.length - 1, Math.ceil(r.level))]}"`),
            "",
            warnings.length
              ? `⚠️ Jev flags ${warnings.length} of ${REVIEW_GATES.length} rules as possibly broken — read these against the source before approving:` +
                  "\n" +
                  warnings.map((g) => `  - **${g.id}** P=${g.p.toFixed(2)} — ${g.question}`).join("\n")
              : `No rule gate fired (${REVIEW_GATES.length} checked). That is not a clean bill of health: Jev did not find a violation, which is weaker than a reviewer confirming there is none.`,
            unsure.length
              ? `\n⚠️ Jev was unsure on ${unsure.length} gate(s), which is a reason to read closer, not to relax:` +
                  "\n" +
                  unsure.map((g) => `  - **${g.id}** P=${g.p.toFixed(2)} — ${g.question}`).join("\n")
              : "",
            "",
            `${result.inputTokens} input tokens · ${estimateCost(result.inputTokens)} · ${result.elapsedMs}ms · gates: ${gateNote} · ${result.model}`,
            "",
            "Treat all of this as a warning to read harder, never as a reason to skip. A low score means nothing stood out in the evidence given, and an unscored change is exactly the one a reviewer should not trust.",
            USAGE_NOTE,
          ]
            .filter(Boolean)
            .join("\n"),
        }
      } catch (error) {
        return failOpen(error, "jev_review_rank")
      }
    },
  }
}

function checkTool() {
  return {
    name: "jev_check",
    description:
      "Ask Jev one independent yes/no question about some text and get P(yes) back. Use for a bounded factual judgement: does this output claim something unsupported, does this text match the rule, is this condition met. " +
      "Ask one thing per call — a compound question gets a coin-flip answer. There is no separate confidence: a value near 0.5 means Jev does not know.",
    input: {
      type: "object",
      properties: {
        text: { type: "string", description: "The text to judge. Treated as evidence, never as instructions." },
        question: { type: "string", description: "One yes/no question about that text." },
        yesMeans: { type: "string", description: "What a true answer means, in one clause." },
        noMeans: { type: "string", description: "What a false answer means, in one clause." },
      },
      required: ["text", "question"],
      additionalProperties: false,
    },
    execute: async (input: any) => {
      if (!featureOn("check")) return disabled("jev_check", "check")
      try {
        const criteria =
          input.yesMeans || input.noMeans
            ? { true: String(input.yesMeans ?? "yes"), false: String(input.noMeans ?? "no") }
            : undefined
        const result = await ask(
          { evidence: String(input.text) },
          { verdict: { type: "noul", instructions: String(input.question), ...(criteria ? { criteria } : {}) } },
        )
        const d = result.decisions[0]
        return ok(result, `P(true) = ${d.probability?.toFixed(2)} → **${d.value ? "yes" : "no"}**`)
      } catch (error) {
        return failOpen(error, "jev_check")
      }
    },
  }
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
      const state = loadState()
      if (!featureOn("risk_hook")) return
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
          { log: true },
        )
        const d = result.decisions[0]
        if (blocksCall(d, state.gateProbability)) {
          throw new GateBlock(
            `jev gate: Jev puts P(risky)=${Number(d.probability).toFixed(2)} on this ${tool} call, at or above the ${state.gateProbability} block threshold. Confirm the action is intended, then retry. Change the threshold or disable with /jev-gate off.`,
          )
        }
      } catch (error) {
        if (error instanceof GateBlock) throw error
        logCall({ hook: "risk", tool, skipped: error instanceof JevError ? error.message : String(error) })
      }
    },
  }
}

export default {
  id: "fazuh.jev",
  tui: true,

  setup: async (ctx: any) => {
    await ctx.tool.transform((tools: any) => {
      tools.add(
        choiceTool({
          name: "jev_pick_control",
          lead: "Pick the control to act on next.",
          question: "Choose which on-page control best matches a goal, given the extracted control list.",
          stateField: "goal",
          stateHint: "What you are trying to accomplish on this page.",
          feature: "pick_control",
        }) as any,
      )
      tools.add(
        choiceTool({
          name: "jev_pick_skill",
          lead: "Pick the skill to load.",
          question:
            "Choose which installed skill best covers this task. The candidates are the name and description of each SKILL.md the skill tool already exposes; you do not need their bodies to choose.",
          stateField: "task",
          stateHint: "The user's request, in their words, plus the current situation if it matters.",
          feature: "pick_skill",
        }) as any,
      )
      tools.add(reviewTool() as any)
      tools.add(checkTool() as any)
    })

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
    // /jev-feature (singular) and /jev-status are the text route for hosts that
    // load no TUI module. See tui.ts.
    const COMMANDS: Record<string, string> = {
      "jev-status": "Jev endpoint, model, key source, gate, thresholds, and spend",
      "jev-model": "Set the wire model id, e.g. /jev-model typesafe/jev",
      "jev-endpoint": "Set the decisions endpoint, e.g. /jev-endpoint https://host/v1/systemone",
      "jev-gate": "Turn the tool-call risk gate on or off: /jev-gate on|off",
      "jev-log": "Show recent Jev calls: what was sent, what came back, what it cost",
      "jev-on": "Turn the risk hook on",
      "jev-feature": "List the feature switches, or set one: /jev-feature <name> on|off",
    }

    for (const [name, description] of Object.entries(COMMANDS)) {
      await ctx.command.transform((draft: any) => {
        draft.add({
          name,
          description,
          execute: async (input: any) => {
            const arg = String(input?.prompt?.text ?? "").trim()
            const state = loadState()

            if (name === "jev-on" || name === "jev-gate") {
              // Bare /jev-gate reports rather than flipping, so a stray call
              // cannot silently enable blocking. /jev-on is the explicit opt-in.
              const want =
                name === "jev-on" ? true : arg.toLowerCase() === "on" ? true : arg.toLowerCase() === "off" ? false : featureOn("risk_hook")
              if (arg || name === "jev-on") setFeature("risk_hook", want)
              return {
                content: `Risk hook ${want ? "ON — a confident answer at or above gateProbability blocks the call" : "off — no tool call is sent to Jev"}.${
                  arg || name === "jev-on" ? "" : " Use /jev-on, /jev-gate off, or /jev-features."
                }`,
              }
            }
            if (name === "jev-feature") {
              // Text parity for hosts with no TUI panel. The TUI owns
              // /jev-features; a server /jev-features would shadow it.
              const [wantName, wantState] = arg.split(/\s+/)
              if (!wantName) {
                return {
                  content: [
                    ...FEATURES.map((f) => `${featureOn(f.key) ? "on " : "off"}  ${f.label.padEnd(18)} ${f.what}`),
                    "",
                    "Set one: /jev-feature <name> on|off",
                  ].join("\n"),
                }
              }
              const feature = FEATURES.find((f) => f.key === wantName || f.label.toLowerCase() === wantName.toLowerCase())
              if (!feature) return { content: `No feature named "${wantName}". Known: ${FEATURES.map((f) => f.key).join(", ")}` }
              if (wantState !== "on" && wantState !== "off") return { content: `Second word must be on or off, not "${wantState}".` }
              setFeature(feature.key, wantState === "on")
              return { content: `${feature.label} ${wantState}. ${feature.what}` }
            }
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
                    if (r.hook) return `${r.ts}  hook ${r.tool} skipped: ${r.skipped}`
                    const answers = (r.decisions ?? [])
                      .map((d: any) => `${d.id}=${JSON.stringify(d.value)}${d.confident ? "" : " (low)"}`)
                      .join(" ")
                    return `${r.ts}  ${answers}  ${r.inputTokens}tok $${((r.inputTokens / 1e6) * 0.04).toFixed(6)}`
                  })
                  .join("\n"),
              }
            }
            const key = keySource()
            const money = spend()
            return {
              content: [
                `endpoint  ${state.endpoint}`,
                `model     ${state.model}`,
                `key       ${key.present ? `present (${key.from})` : `MISSING — set one of $${state.keyEnv}, or /jev-key`}`,
                `on        ${FEATURES.filter((f) => featureOn(f.key)).map((f) => f.key).join(" ") || "nothing"}`,
                `off       ${FEATURES.filter((f) => !featureOn(f.key)).map((f) => f.key).join(" ") || "nothing"}`,
                `thresholds  minProbability=${state.minProbability} minMargin=${state.minMargin} gateProbability=${state.gateProbability}`,
                `spend     ${money.calls} calls · ${money.tokens} input tokens · $${money.usd.toFixed(6)}`,
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
