/**
 * Stop a tool call's whole execution tree immediately.
 * VERIFIED host APIs only (see /tmp/opencode/jev-stop-session-research.md):
 *  - ctx.session.interrupt({sessionID, resume?}) — targets ONE session, no cascade.
 *  - ctx.session.list/get to enumerate sessions; parent linkage via parentID.
 *  - ctx.session.synthetic for the user notice.
 * There is NO plugin API to abort a shell directly, NO standalone "resume"
 * method, and NO fiber interrupt primitive. "Stop the shell" is achieved by
 * interrupting the session whose tool fiber is running; host Fiber.interruptAll
 * tears the tool fiber down (prior Q9). interrupt(resume:false) avoids promoting
 * a pending steer input, so a terminal stop does not auto-continue the agent.
 *
 * "Resume main only": no resume API exists. The closest achievable behavior is
 * to clear the tool ban and leave the main session to be driven by the next user
 * message; subagents are NOT restarted (the main session does that itself).
 */
import { logCall } from "../../../lib/lib-jev/state.ts"
import { isToolBanned } from "../../../lib/lib-jev/tool-ban.ts"
import { banTool, unbanTool } from "../../../lib/lib-jev/tool-ban.ts"

export interface StopDeps {
  ctx: any
  /** Reuse the session-ban durable session ban instead of duplicating it when on. */
  abortSession?: (sessionID: string, by: "user", cause: string) => Promise<unknown>
}

/** Enumerate child + descendant sessions of a parent from ctx.session.list. */
export async function subagentsOf(ctx: any, parentID: string): Promise<string[]> {
  let all: any[]
  try {
    const result = typeof ctx?.session?.list === "function" ? await ctx.session.list({}) : []
    all = Array.isArray(result) ? result : Array.isArray((result as any)?.data) ? (result as any).data : []
  } catch {
    return []
  }
  const byParent = new Map<string, string[]>()
  for (const row of all) {
    const id = String(row?.id ?? "")
    const parent = String(row?.parentID ?? "")
    if (!id || !parent) continue
    byParent.set(parent, [...(byParent.get(parent) ?? []), id])
  }
  const out: string[] = []
  const queue = [parentID]
  while (queue.length) {
    const current = queue.shift()!
    for (const child of byParent.get(current) ?? []) {
      if (out.includes(child) || child === parentID) continue
      out.push(child)
      queue.push(child)
    }
  }
  return out
}

/** Stop the parent session and every subagent, then leave a user notice. */
export async function stopSessionTree(ctx: any, sessionID: string, deps: Omit<StopDeps, "ctx"> = {}): Promise<string[]> {
  const subagents = await subagentsOf(ctx, sessionID)
  if (deps.abortSession) {
    try {
      await deps.abortSession(sessionID, "user", "jev block: stop session tree")
    } catch (error) {
      logCall({ hook: "hook_tool_risk", sessionID, error: error instanceof Error ? error.message : String(error) })
    }
  }
  // Interrupt the parent last with resume:false so no steer input is promoted.
  for (const child of subagents) {
    try {
      await ctx?.session?.interrupt?.({ sessionID: child, resume: false })
    } catch {}
  }
  try {
    await ctx?.session?.interrupt?.({ sessionID, resume: false })
  } catch {}
  try {
    await ctx?.session?.synthetic?.({
      sessionID,
      text: "jev: this call was blocked and the session (including its subagents) was stopped. Use Lift tool ban to lift the tool ban, then continue from the main session.",
      delivery: "queue",
    })
  } catch {}
  logCall({ hook: "hook_tool_risk", sessionID, detail: `session tree stopped; subagents=${subagents.length}` })
  return subagents
}

/** Lift the tool ban for a session and its subagents. No resume API exists here;
 *  the resume action starts a new turn. */
export async function liftToolBan(ctx: any, sessionID: string): Promise<number> {
  const count = unbanTool(sessionID)
  logCall({ hook: "hook_tool_risk", sessionID, detail: `tool ban lifted for session and subagents (${count} records)` })
  return count
}

export { banTool, unbanTool, isToolBanned }
