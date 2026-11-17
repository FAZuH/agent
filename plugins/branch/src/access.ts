/**
 * Who may fork what.
 *
 * A primary session may fork itself. Any agent may fork a subagent that sits
 * below it in the session tree. The checks are pure so the rules can be tested
 * without a host.
 */

export interface SessionFacts {
  parentID?: string | null
  agent?: string
  outcome?: string | null
}

/** A root session whose agent is not a subagent role. */
export function isPrimarySession(facts: SessionFacts, agentMode?: string): boolean {
  return !facts.parentID && agentMode !== "subagent"
}

export type SessionLookup = (sessionID: string) => Promise<SessionFacts | undefined>

/** True when `targetID` is a child, grandchild, or deeper descendant of `callerID`. */
export async function isDescendant(
  lookup: SessionLookup,
  callerID: string,
  targetID: string,
  maxHops = 64,
): Promise<boolean> {
  if (!callerID || !targetID || callerID === targetID) return false
  const seen = new Set<string>()
  let id: string | undefined = targetID
  for (let hops = 0; hops < maxHops && id && !seen.has(id); hops++) {
    seen.add(id)
    const facts = await lookup(id)
    if (!facts || !facts.parentID) return false
    if (facts.parentID === callerID) return true
    id = facts.parentID
  }
  return false
}

/** The reason a target cannot be forked, or undefined when it can. */
export function subagentTargetError(
  facts: SessionFacts | undefined,
  callerID: string,
  targetID: string,
): string | undefined {
  if (!facts) return `target session ${targetID} was not found.`
  if (targetID === callerID) {
    return "branch_subagent forks a subagent, not the caller. Use branch_ask to fork this session."
  }
  if (!facts.parentID) return `target session ${targetID} is not a subagent.`
  if (facts.outcome == null) {
    return `target session ${targetID} is still running; wait for its report before forking it.`
  }
  return undefined
}
