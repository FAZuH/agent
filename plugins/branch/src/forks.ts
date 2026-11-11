/**
 * In-flight reporting forks per asking session, for maxForks.
 *
 * A slot is reserved before the fork call because two asks can start in the
 * same turn: neither has a fork id when the other counts, so counting after
 * the fork would let both through. Silent forks never report, so they skip the
 * ledger entirely and their slot cannot be freed.
 */

export interface ForkSlots {
  running(parentID: string): number
  reserve(parentID: string, maxForks: number): { token: string } | { error: string }
  /** Swap the reservation for the real fork id. */
  confirm(parentID: string, token: string, forkID: string): void
  release(parentID: string, forkID: string): void
}

export function createForkSlots(): ForkSlots {
  const active = new Map<string, Set<string>>()
  let sequence = 0

  const setOf = (parentID: string): Set<string> => {
    let set = active.get(parentID)
    if (!set) {
      set = new Set()
      active.set(parentID, set)
    }
    return set
  }

  const release = (parentID: string, forkID: string): void => {
    const set = active.get(parentID)
    if (!set) return
    set.delete(forkID)
    if (set.size === 0) active.delete(parentID)
  }

  return {
    running(parentID) {
      return active.get(parentID)?.size ?? 0
    },
    reserve(parentID, maxForks) {
      const running = active.get(parentID)?.size ?? 0
      if (maxForks > 0 && running >= maxForks) {
        return {
          error: `maxForks=${maxForks} and ${running} forks still running. Wait for a report or raise it with /branch-settings maxForks=N.`,
        }
      }
      const token = `pending:${++sequence}`
      setOf(parentID).add(token)
      return { token }
    },
    confirm(parentID, token, forkID) {
      release(parentID, token)
      setOf(parentID).add(forkID)
    },
    release,
  }
}
