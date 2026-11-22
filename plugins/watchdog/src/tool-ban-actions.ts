/**
 * Subtree discovery and tool-ban lifting for the abort and lift routes.
 *
 * The stop itself lives in `abort.ts`: it is one durable operation per abort, so
 * there is no second, weaker stop here to reach by mistake.
 *
 * A session is stopped by interrupting the session whose tool fiber runs; the
 * host has no plugin API to cancel one shell, no standalone resume, and no fiber
 * interrupt primitive (capability report C3). There is also no resume API: the
 * closest achievable behaviour is to lift the ban and let the next user message
 * drive the session, and subagents are never restarted here.
 */
import { logCall } from "../../../lib/jev/state.ts"
import { isToolBanned } from "../../../lib/jev/tool-ban.ts"
import { banTool, unbanTool } from "../../../lib/jev/tool-ban.ts"

/**
 * A descendant listing. `ok:false` is a discovery failure, never an empty set:
 * a caller that cannot enumerate cannot claim the subtree is covered.
 */
export type DescendantScan = { ok: true; ids: string[] } | { ok: false; reason: string }

/** Enumerate child + descendant sessions of a parent from ctx.session.list. */
export async function descendantScan(ctx: any, parentID: string): Promise<DescendantScan> {
  let all: any[]
  try {
    if (typeof ctx?.session?.list !== "function") return { ok: false, reason: "the host has no session listing" }
    const result = await ctx.session.list({})
    if (Array.isArray(result)) all = result
    else if (Array.isArray((result as any)?.data)) all = (result as any).data
    else return { ok: false, reason: "the host returned no session listing" }
  } catch {
    return { ok: false, reason: "the session listing failed" }
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
  return { ok: true, ids: out }
}

/** Lift the tool ban for a session and its subagents. No resume API exists here;
 *  the resume action starts a new turn. */
export async function liftToolBan(ctx: any, sessionID: string): Promise<number> {
  const count = unbanTool(sessionID)
  logCall({ hook: "hook_tool_risk", sessionID, detail: `tool ban lifted for session and subagents (${count} records)` })
  return count
}

export { banTool, unbanTool, isToolBanned }
