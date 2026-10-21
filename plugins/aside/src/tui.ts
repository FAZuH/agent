/**
 * /aside in the TUI — move the view to the fork the server half just made.
 *
 * The server owns the command, so it works on the hosts that load no TUI
 * module (desktop, API, mini). This half only reads the mark the server
 * writes into the fork's session metadata: a fork of the session on screen
 * means the view opens it, a fork that never started means the TUI says why.
 */
import { readMarker } from "./aside.ts"

export default {
  id: "fazuh.aside-tui",

  setup: async (ctx: any) => {
    const toast = (message: string, variant = "info") => {
      try {
        ctx.ui?.toast?.show?.({ title: "aside", message, variant })
      } catch {}
    }

    const dispose = ctx.data?.on?.("session.metadata.updated", (event: any) => {
      const sessionID = String(event?.data?.sessionID ?? "")
      const marker = readMarker(event?.data?.metadata)
      if (!marker || !sessionID) return
      const route = ctx.ui?.router?.current?.()
      if (route?.type !== "session") return
      if (marker.parentID !== route.sessionID) return
      if (marker.status === "failed") {
        toast(marker.error ?? "the fork never started", "error")
        return
      }
      if (marker.sessionID !== sessionID) return
      ctx.ui.router.navigate({ type: "session", sessionID })
      toast(`Forked to ${sessionID}`, "info")
    })

    return () => {
      try {
        dispose?.()
      } catch {}
    }
  },
}
