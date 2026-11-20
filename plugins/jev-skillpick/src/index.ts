/**
 * fazuh.jev-skillpick — skill advisor. Prompt and context hooks advise a skill
 * per prompt; never blocks or changes a tool call. The /jev-optimize-skills
 * command refreshes cached criteria on demand.
 */

import { JevError } from "../../../lib/jev/jev.ts"
import { logCall } from "../../../lib/jev/state.ts"
import {
  OPTIMIZE_BATCH,
  ROSTER_ROOTS,
  attachSkillPick,
  firstSentence,
  hashDescription,
  optimizeCriteria,
  optimizerModel,
  renderAdvice,
  resolveCriteria,
  rosterHash,
  skillRoster,
  stripCriterionPreamble,
} from "./skill-pick.ts"

export { firstSentence, hashDescription, optimizeCriteria, optimizerModel, renderAdvice, resolveCriteria, rosterHash, skillRoster, stripCriterionPreamble }
export type { OptimizerModel } from "./skill-pick.ts"

const COMMAND = "jev-optimize-skills"
const DESCRIPTION = "Rewrite every unoptimized skill description into a terse choice criterion via the host LLM; /jev-optimize-skills <id> refreshes one skill"

export default {
  id: "fazuh.jev-skillpick",

  setup: async (ctx: any) => {
    await attachSkillPick(ctx)

    await ctx.command.transform((draft: any) => {
      draft.add({
        name: COMMAND,
        description: DESCRIPTION,
        execute: async (input: any) => {
          const arg = String(input?.prompt?.text ?? "").trim()
          const respond = async (text: string) => {
            if (typeof ctx?.session?.synthetic === "function") {
              try {
                await ctx.session.synthetic({ sessionID: input.sessionID, text, resume: false })
              } catch (error) {
                logCall({ hook: COMMAND, error: error instanceof JevError ? error.message : String(error) })
              }
            }
            return { content: text }
          }

          const roster = await skillRoster(ctx, ROSTER_ROOTS)
          const { stale } = resolveCriteria(roster)
          const targets = arg
            ? stale.filter((s) => s.id === arg)
            : stale
          if (arg && targets.length === 0) {
            const known = roster.some((s) => s.id === arg)
            return { content: known ? `@${arg} is already optimized.` : `No installed skill @${arg}.` }
          }
          if (targets.length === 0) return respond(`All ${roster.length} skill criteria are current.`)
          // Awaited, not background: the user asked for this explicitly
          // and wants the result, unlike the hook's silent warm-up. Manual
          // bypasses the failure latch; a success clears it.
          const { done, failed } = await optimizeCriteria(ctx, targets, {
            manual: true,
            sessionID: String(input?.sessionID ?? input?.invocation?.sessionID ?? "") || undefined,
          })
          const attempted = Math.min(targets.length, OPTIMIZE_BATCH)
          const left = targets.length - attempted
          return respond(`Optimized ${done} of ${attempted} criteria${failed ? `, ${failed} failed (see /jev-log)` : ""}${left ? `, ${left} left for a follow-up run` : ""}.`)
        },
      })
    })
  },
}
