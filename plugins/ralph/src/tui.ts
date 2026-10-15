/**
 * Toasts for the ralph loop. The loop runs on the server side and may be left
 * alone for an hour; a session that goes quiet with nothing on screen looks
 * exactly like a hung one. So the server appends every decision to
 * ralph-loops.jsonl and this tail announces the ones a person needs to see.
 * Iterations are skipped: those already appear in the session as a new prompt.
 *
 * Server plugins cannot open UI, so this is where the toasts live. The slash
 * names stay on the server: one name, one owner.
 */

import { readFileSync } from "node:fs"

import { LOG_FILE } from "./index.ts"

interface Row {
  ts?: string
  event?: string
  iteration?: number
  maxIterations?: number
  completionPromise?: string
  error?: string
}

let started = false

function readRows(): Row[] {
  try {
    return readFileSync(LOG_FILE, "utf8")
      .split("\n")
      .filter(Boolean)
      .slice(-200)
      .reverse()
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as Row]
        } catch {
          return []
        }
      })
  } catch {
    return []
  }
}

function toastFor(row: Row): { message: string; variant: string } | null {
  const n = row.iteration ?? 1
  switch (row.event) {
    case "start":
      return {
        message: `Loop started (${row.maxIterations ? `${row.maxIterations} iterations` : "unlimited"}) · finish with <promise>${row.completionPromise}</promise>`,
        variant: "info",
      }
    case "complete":
      return { message: `Loop done at iteration ${n}.`, variant: "success" }
    case "abort":
      return { message: `Aborted at iteration ${n}.`, variant: "warning" }
    case "max":
      return { message: `Stopped at the iteration cap (${n}).`, variant: "warning" }
    case "silent":
      return { message: `Stopped at iteration ${n}: three turns with no output.`, variant: "warning" }
    case "cancel":
      return { message: `Cancelled at iteration ${n}.`, variant: "info" }
    case "reload":
      return { message: `Stopped at iteration ${n}: the plugin reloaded.`, variant: "warning" }
    case "warn":
      return { message: "Unlimited loop — /cancel-ralph stops it.", variant: "warning" }
    case "error":
      return { message: `Error: ${row.error ?? "unknown"}`, variant: "error" }
    default:
      return null
  }
}

function startTail(ctx: any): void {
  if (started) return
  started = true
  // Today's newest line is the floor, so a full log never replays into the TUI.
  let after = readRows()[0]?.ts ?? ""
  setInterval(() => {
    const fresh = readRows().filter((row) => typeof row.ts === "string" && row.ts > after)
    if (!fresh.length) return
    after = fresh[0].ts as string
    for (const row of fresh) {
      const toast = toastFor(row)
      if (!toast) continue
      try {
        ctx.ui?.toast?.show?.({ title: "ralph", message: toast.message, variant: toast.variant })
      } catch (error) {
        console.error(`[ralph] toast failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }, 2000)
}

export default {
  id: "fazuh.ralph",
  tui: true,

  setup: async (ctx: any) => {
    ctx.ui?.slot?.({
      append: "app",
      render: () => {
        startTail(ctx)
        return null // the slot only carries the tail; it draws nothing
      },
    })
    return undefined
  },
}