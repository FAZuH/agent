import { For, onCleanup } from "solid-js"
import { ComposerPill, Command, createKeyed, Panel, Plugin } from "@opencode/plugin/gui"
import { readMarker } from "./branch.ts"
import { Contract } from "./rpc.ts"

/**
 * The desktop half of fazuh.branch.
 *
 * The server still owns `/branch`, `/branch-silent`, `branch_ask`,
 * `branch_subagent`, and `branch_report`, so they work on every host. This half
 * only reads the same fork markers the TUI reads: a fork of the session on
 * screen opens its tab, a fork that never started says why, and a fork's
 * composer offers the way back to the session that asked. The panel lists the
 * forks of whatever session is on screen.
 */
export default Plugin.define({
  setup(ctx) {
    createKeyed(
      () => ctx.servers.get("sidecar")?.data,
      (data) =>
        onCleanup(
          data.on("session.metadata.updated", (event: any) => {
            const marker = readMarker(event.data?.metadata)
            if (!marker) return
            if (marker.reportedAt) return
            const session = ctx.sessions.current()
            if (!session || marker.parentID !== session.id) return
            if (marker.status === "failed") {
              ctx.toast.show({
                title: "Fork failed",
                description: marker.error ?? "the fork never started",
                variant: "error",
              })
              return
            }
            if (!marker.sessionID) return
            if (!marker.background) {
              ctx.tabs.open({ server: session.server.id, id: marker.sessionID }, { focus: true })
            }
            ctx.toast.show({ title: `Forked to ${marker.sessionID}` })
          }),
        ),
    )

    ctx.add(ComposerPill, {
      id: "from",
      show: (input) => {
        const data = ctx.servers.get("sidecar")?.data
        if (!data) return undefined
        const info = data.session.get(input.session.id)
        const marker = readMarker((info as any)?.metadata)
        if (!marker || marker.status !== "forked" || marker.parentID === input.session.id) return undefined
        const parent = data.session.get(marker.parentID)
        return {
          icon: "fork",
          label: `Forked from ${(parent as any)?.title ?? marker.parentID}`,
          title: "Open the asking session",
          run: () => ctx.tabs.open({ server: input.session.server.id, id: marker.parentID }, { focus: true }),
        }
      },
    })

    ctx.add(Panel, {
      id: "forks",
      region: "side",
      list: () => [{ id: "forks", title: "Forks" }],
      render: (props) => {
        const forks = () => {
          const data = ctx.servers.get("sidecar")?.data
          if (!data) return []
          return (data.session.list() as any[]).filter((info) => {
            const marker = readMarker(info.metadata)
            return marker && marker.status === "forked" && marker.parentID === props.session.id
          })
        }
        return (
          <div>
            <For each={forks()} fallback={<p>No forks yet.</p>}>
              {(fork: any) => {
                const marker = readMarker(fork.metadata)
                return (
                  <div style={{ "margin-block": "8px" }}>
                    <button
                      onClick={() =>
                        ctx.tabs.open({ server: props.session.server.id, id: fork.id }, { focus: true })
                      }
                    >
                      Open fork
                    </button>
                    <span>{(marker as any)?.prompt ?? (marker as any)?.question ?? fork.title ?? fork.id}</span>
                  </div>
                )
              }}
            </For>
          </div>
        )
      },
    })

    ctx.add(Command, {
      id: "ask",
      title: "Ask in a fork",
      description: "Fork this session with a prompt and open the fork.",
      section: "session",
      bind: "mod+shift+a",
      get enabled() {
        const session = ctx.sessions.current()
        if (!session) return false
        const info: any = ctx.servers.get("sidecar")?.data?.session.get(session.id)
        return !info || info.parentID == null
      },
      run: async () => {
        const session = ctx.sessions.current()
        if (!session) return
        const prompt = await ctx.dialogs.prompt({ title: "Ask in a fork", placeholder: "Prompt for the fork" })
        if (!prompt) return
        let result: any
        try {
          result = await ctx.client.rpc(Contract).start({ prompt, parentID: session.id, silent: false })
        } catch (error) {
          ctx.toast.show({ title: "Fork failed", description: String(error), variant: "error" })
          return
        }
        if (result.error) {
          ctx.toast.show({ title: "Fork failed", description: result.error, variant: "error" })
          return
        }
        ctx.tabs.open({ server: session.server.id, id: result.forkID }, { focus: true })
      },
    })
  },
})
