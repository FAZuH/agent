/**
 * Report batching for the branch plugin.
 *
 * A report is a prompt to the asking session, so forks that finish together
 * would wake it once each. Inside the window, reports to one parent leave as a
 * single prompt; each block keeps its own tags, so the parent still matches
 * them by fork id.
 */

export type Deliver = (parentID: string, text: string) => void | Promise<void>

export interface ReportBatcher {
  push(parentID: string, block: string): void
  /** Parent sessions with reports waiting for the window to close. */
  size(): number
}

export function createReportBatcher(deliver: Deliver, windowMs: () => number): ReportBatcher {
  const pending = new Map<string, { blocks: string[]; timer: ReturnType<typeof setTimeout> }>()

  const flush = (parentID: string) => {
    const slot = pending.get(parentID)
    if (!slot) return
    pending.delete(parentID)
    void deliver(parentID, slot.blocks.join("\n\n"))
  }

  return {
    push(parentID, block) {
      const window = windowMs()
      if (window <= 0) {
        void deliver(parentID, block)
        return
      }
      const slot = pending.get(parentID)
      if (slot) {
        slot.blocks.push(block)
        return
      }
      pending.set(parentID, {
        blocks: [block],
        timer: setTimeout(() => flush(parentID), window),
      })
    },
    size() {
      return pending.size
    },
  }
}
