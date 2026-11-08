import { onCleanup } from "solid-js"
import { ComposerPill, createKeyed, Plugin } from "@opencode/plugin/gui"
import { readDispatched } from "./shared.ts"

/**
 * The desktop half of fazuh.dispatch.
 *
 * The server still owns `/dispatch` and remains the only one that spawns:
 * this half only reads the dispatched markers the server writes onto the
 * background subagents. A dispatch from the session on screen opens its
 * tab in the background, and the composer pill lists the dispatches of the
 * session the composer belongs to.
 */
export default Plugin.define({
  setup(ctx) {
    createKeyed(
      () => ctx.servers.get("sidecar")?.data,
      (data) =>
        onCleanup(
          data.on("session.metadata.updated", (event: any) => {
            const marker = readDispatched(event.data?.metadata)
            if (!marker) return
            const session = ctx.sessions.current()
            if (!session || marker.parentID !== session.id) return
            ctx.tabs.open({ server: session.server.id, id: marker.sessionID })
            ctx.toast.show({
              title: "Dispatched to background subagent",
              description: marker.task.slice(0, 60),
              actions: [
                {
                  label: "View subagent",
                  run: () => ctx.tabs.open({ server: session.server.id, id: marker.sessionID }, { focus: true }),
                },
              ],
            })
          }),
        ),
    )

    ctx.add(ComposerPill, {
      id: "dispatched",
      show: (input) => {
        const data = ctx.servers.get("sidecar")?.data
        if (!data) return undefined
        const list = data.session.list() as any[]
        const children = list
          .filter((info) => {
            const marker = readDispatched(info.metadata)
            return marker && marker.parentID === input.session.id
          })
          .map((info) => {
            const marker = readDispatched(info.metadata)!
            return { marker, status: data.session.status(info.id) }
          })
          .sort((a, b) => b.marker.at - a.marker.at)
        if (children.length === 0) return undefined
        return {
          icon: "arrow-up",
          label: `${children.length} dispatched subagent${children.length === 1 ? "" : "s"}`,
          rows: children.map(({ marker, status }) => ({
            id: marker.sessionID,
            label: marker.task.slice(0, 60),
            icon: status === "running" ? "arrow-up" : "check",
            tone: status === "running" ? "warning" : "success",
            detail: status === "running" ? "running" : "done",
            run: () =>
              ctx.tabs.open({ server: input.session.server.id, id: marker.sessionID }, { focus: true }),
          })),
        }
      },
    })
  },
})
