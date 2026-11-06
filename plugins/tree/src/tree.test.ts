import { describe, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { buildTree, labelOf, normalizeBase, normalizeHost, resolveLinkBase, sourceOf, statusOf, webBaseURL, type TreeSession } from "./tree.ts"
import { buildGraph, normalizeMessages, LANE_W, type SessionGraph, type SessionMessage } from "./layout.ts"
import { readLiveBase, resolveOptions, viewerURL } from "./server.ts"
import { renderPage } from "./web.ts"

const session = (id: string, init: Partial<TreeSession> = {}): TreeSession => ({
  id,
  title: id,
  time: { created: 0, updated: 0 },
  ...init,
})

describe("buildTree", () => {
  test("walks parentID children and grandchildren", () => {
    const sessions = [
      session("ses_root", { time: { created: 1, updated: 1 } }),
      session("ses_child", { parentID: "ses_root", time: { created: 2, updated: 2 } }),
      session("ses_grand", { parentID: "ses_child", time: { created: 3, updated: 3 } }),
    ]
    const tree = buildTree(sessions, "ses_root")
    expect(tree.focus).toBe("ses_root")
    expect(tree.nodes.map((n) => n.id)).toEqual(["ses_root", "ses_child", "ses_grand"])
    expect(tree.nodes.map((n) => n.kind)).toEqual(["root", "subagent", "subagent"])
    expect(tree.edges).toEqual([
      { from: "ses_root", to: "ses_child", kind: "subagent" },
      { from: "ses_child", to: "ses_grand", kind: "subagent" },
    ])
  })

  test("attaches a fork to the session it forked", () => {
    const sessions = [
      session("ses_root"),
      session("ses_child", { parentID: "ses_root" }),
      session("ses_fork", { fork: { sessionID: "ses_child" } }),
    ]
    const tree = buildTree(sessions, "ses_root")
    expect(tree.focus).toBe("ses_root")
    expect(tree.nodes.map((n) => n.id)).toEqual(["ses_root", "ses_child", "ses_fork"])
    expect(tree.nodes[2].kind).toBe("fork")
    expect(tree.edges).toContainEqual({ from: "ses_child", to: "ses_fork", kind: "fork" })
  })

  test("follows a fork of a fork", () => {
    const sessions = [
      session("ses_root", { time: { created: 1 } }),
      session("ses_fork1", { fork: { sessionID: "ses_root" }, time: { created: 2 } }),
      session("ses_fork2", { fork: { sessionID: "ses_fork1" }, time: { created: 3 } }),
    ]
    const tree = buildTree(sessions, "ses_fork2")
    expect(tree.focus).toBe("ses_root")
    expect(tree.nodes.map((n) => n.id)).toEqual(["ses_root", "ses_fork1", "ses_fork2"])
    expect(tree.edges).toEqual([
      { from: "ses_root", to: "ses_fork1", kind: "fork" },
      { from: "ses_fork1", to: "ses_fork2", kind: "fork" },
    ])
  })

  test("a fork whose source is absent becomes a root", () => {
    const sessions = [session("ses_orphan", { fork: { sessionID: "ses_missing" } })]
    const tree = buildTree(sessions)
    expect(tree.focus).toBe("ses_orphan")
    expect(tree.roots.map((r) => r.id)).toEqual(["ses_orphan"])
    expect(tree.nodes.map((n) => n.id)).toEqual(["ses_orphan"])
    expect(tree.nodes[0].kind).toBe("fork")
    expect(tree.edges).toEqual([])
  })

  test("ignores a self-edge and treats the session as a root", () => {
    const sessions = [session("ses_loop", { parentID: "ses_loop" })]
    const tree = buildTree(sessions)
    expect(tree.roots.map((r) => r.id)).toEqual(["ses_loop"])
    expect(tree.nodes.map((n) => n.id)).toEqual(["ses_loop"])
    expect(tree.edges).toEqual([])
  })

  test("terminates on a two-node cycle", () => {
    const sessions = [
      session("ses_a", { parentID: "ses_b" }),
      session("ses_b", { parentID: "ses_a" }),
    ]
    const tree = buildTree(sessions)
    expect(tree.roots).toEqual([])
    expect(tree.nodes).toEqual([])
    expect(tree.edges).toEqual([])
  })

  test("sorts children by created time", () => {
    const sessions = [
      session("ses_root"),
      session("ses_late", { parentID: "ses_root", time: { created: 30 } }),
      session("ses_early", { parentID: "ses_root", time: { created: 10 } }),
    ]
    const tree = buildTree(sessions, "ses_root")
    expect(tree.nodes.map((n) => n.id)).toEqual(["ses_root", "ses_early", "ses_late"])
  })

  test("defaults focus to the newest root", () => {
    const sessions = [
      session("ses_old", { time: { created: 1, updated: 100 } }),
      session("ses_new", { time: { created: 2, updated: 200 } }),
    ]
    expect(buildTree(sessions).focus).toBe("ses_new")
    expect(buildTree(sessions, "ses_old").focus).toBe("ses_old")
    expect(buildTree(sessions).roots.map((r) => r.id)).toEqual(["ses_new", "ses_old"])
  })

  test("counts nodes, subagents and forks", () => {
    const sessions = [
      session("ses_root"),
      session("ses_child", { parentID: "ses_root" }),
      session("ses_fork", { fork: { sessionID: "ses_root" } }),
    ]
    const tree = buildTree(sessions, "ses_root")
    expect(tree.stats).toEqual({ nodes: 3, subagents: 1, forks: 1 })
  })

  test("only the focus family is rendered", () => {
    const sessions = [
      session("ses_a", { time: { created: 1, updated: 10 } }),
      session("ses_b", { time: { created: 1, updated: 20 } }),
      session("ses_b_child", { parentID: "ses_b" }),
    ]
    const tree = buildTree(sessions, "ses_a")
    expect(tree.nodes.map((n) => n.id)).toEqual(["ses_a"])
    expect(tree.roots.map((r) => r.id)).toEqual(["ses_b", "ses_a"])
  })

  test("duplicate ids are collapsed", () => {
    const sessions = [session("ses_x"), session("ses_x", { title: "second" })]
    const tree = buildTree(sessions)
    expect(tree.nodes).toHaveLength(1)
    expect(tree.nodes[0].title).toBe("ses_x")
  })
})

describe("node fields", () => {
  test("fork wins over parentID as the source", () => {
    expect(sourceOf(session("x", { parentID: "p", fork: { sessionID: "f" } }))).toBe("f")
    expect(sourceOf(session("x", { parentID: "p" }))).toBe("p")
    expect(sourceOf(session("x"))).toBeUndefined()
  })

  test("busy outlasts a stale idle mark", () => {
    expect(statusOf(session("x", { time: { busy: 20, idle: 10 } }))).toBe("busy")
    expect(statusOf(session("x", { time: { busy: 10, idle: 20 } }))).toBe("idle")
    expect(statusOf(session("x", { time: { busy: 10 } }))).toBe("busy")
    expect(statusOf(session("x", { time: { idle: 10 } }))).toBe("idle")
  })

  test("label truncates a long title", () => {
    const label = labelOf("a".repeat(100))
    expect(Array.from(label)).toHaveLength(36)
    expect(label.endsWith("…")).toBe(true)
    expect(labelOf("short")).toBe("short")
  })

  test("node carries the display fields", () => {
    const tree = buildTree([
      session("ses_x", {
        title: "A session",
        agent: "implement",
        model: { id: "m", providerID: "p" },
        cost: 0.5,
        tokens: { input: 1, output: 2, reasoning: 3 },
        outcome: "failed",
        location: { directory: "/tmp" },
      }),
    ])
    expect(tree.nodes[0]).toMatchObject({
      title: "A session",
      label: "A session",
      agent: "implement",
      model: "p/m",
      cost: 0.5,
      tokens: { input: 1, output: 2, reasoning: 3 },
      outcome: "failed",
      directory: "/tmp",
    })
  })
})

describe("normalizeBase", () => {
  test("keeps http and https, drops a trailing slash", () => {
    expect(normalizeBase("http://example.test:1234/")).toBe("http://example.test:1234")
    expect(normalizeBase("https://example.test///")).toBe("https://example.test")
    expect(normalizeBase("  http://example.test  ")).toBe("http://example.test")
  })

  test("drops the query and hash", () => {
    expect(normalizeBase("http://example.test:1234/?x=1#y")).toBe("http://example.test:1234")
  })

  test("rejects anything that cannot be a link base", () => {
    expect(normalizeBase("not a url")).toBe("")
    expect(normalizeBase("ftp://example.test")).toBe("")
    expect(normalizeBase("javascript:alert(1)")).toBe("")
    expect(normalizeBase("")).toBe("")
    expect(normalizeBase(undefined)).toBe("")
  })

  test("normalizes a wildcard host to loopback", () => {
    expect(normalizeBase("http://0.0.0.0:4096")).toBe("http://127.0.0.1:4096")
    expect(normalizeBase("http://[::]:4096")).toBe("http://127.0.0.1:4096")
  })
})

describe("resolveLinkBase", () => {
  const configured = "http://100.64.0.3:4096"
  const live = "http://127.0.0.1:49374"

  test("an explicit base beats everything", () => {
    expect(
      resolveLinkBase({ explicit: "http://example.test:1234/", configured, live, reachable: true }),
    ).toBe("http://example.test:1234")
  })

  test("an unreachable configured base falls back to the live service", () => {
    expect(resolveLinkBase({ configured, live, reachable: false })).toBe(live)
  })

  test("a reachable configured base beats the live service", () => {
    expect(resolveLinkBase({ configured, live, reachable: true })).toBe(configured)
  })

  test("reachability must be an explicit true", () => {
    expect(resolveLinkBase({ configured, live })).toBe(live)
    expect(resolveLinkBase({ configured, live, reachable: undefined })).toBe(live)
  })

  test("falls back to the live service when configured is absent", () => {
    expect(resolveLinkBase({ live, reachable: true })).toBe(live)
    expect(resolveLinkBase({ configured: "", live, reachable: true })).toBe(live)
  })

  test("ignores a garbage explicit and keeps falling through", () => {
    expect(resolveLinkBase({ explicit: "not a url", configured, live, reachable: true })).toBe(configured)
    expect(resolveLinkBase({ explicit: "ftp://x", configured, live, reachable: false })).toBe(live)
  })

  test("normalizes the chosen base", () => {
    expect(resolveLinkBase({ explicit: "http://0.0.0.0:4096/" })).toBe("http://127.0.0.1:4096")
    expect(resolveLinkBase({ configured: "http://[::]:4096", reachable: true })).toBe("http://127.0.0.1:4096")
  })

  test("defaults to loopback when nothing is known", () => {
    expect(resolveLinkBase()).toBe("http://127.0.0.1:4096")
    expect(resolveLinkBase({ configured: "", live: "", reachable: true })).toBe("http://127.0.0.1:4096")
  })
})

describe("webBaseURL", () => {
  test("an option beats the service config", () => {
    expect(
      webBaseURL({ option: "http://example.test:1234/", service: { hostname: "0.0.0.0", port: 4096 } }),
    ).toBe("http://example.test:1234")
  })

  test("the service config beats the default", () => {
    expect(webBaseURL({ service: { hostname: "10.0.0.5", port: 5000 } })).toBe("http://10.0.0.5:5000")
  })

  test("wildcard hosts normalize to loopback", () => {
    expect(webBaseURL({ service: { hostname: "0.0.0.0", port: 4096 } })).toBe("http://127.0.0.1:4096")
    expect(webBaseURL({ service: { hostname: "::", port: 4096 } })).toBe("http://127.0.0.1:4096")
    expect(webBaseURL({ service: { hostname: "[::]", port: 4096 } })).toBe("http://127.0.0.1:4096")
    expect(normalizeHost("[::]")).toBe("127.0.0.1")
  })

  test("falls back to loopback", () => {
    expect(webBaseURL()).toBe("http://127.0.0.1:4096")
    expect(webBaseURL({ option: "  " })).toBe("http://127.0.0.1:4096")
  })
})

describe("normalizeMessages", () => {
  test("keeps only user and assistant records, in ascending order", () => {
    const messages = normalizeMessages([
      { id: "msg_2", type: "assistant", time: { created: 20 }, content: [{ type: "text", text: "answer" }] },
      { id: "msg_1", type: "user", time: { created: 10 }, text: "question" },
      { id: "msg_3", type: "idle", time: { created: 30 }, outcome: "succeeded" },
      { id: "msg_4", type: "synthetic", time: { created: 40 }, text: "injected" },
      { id: "", type: "user", time: { created: 50 }, text: "no id" },
      { id: "msg_5", type: "user", text: "no time" },
    ])
    expect(messages).toEqual([
      { id: "msg_1", role: "user", created: 10, text: "question" },
      { id: "msg_2", role: "assistant", created: 20, text: "answer" },
    ])
  })

  test("reads the preview from the first text part, else reasoning, else the tool name", () => {
    expect(
      normalizeMessages([
        { id: "a", type: "assistant", time: { created: 1 }, content: [{ type: "tool", name: "bash" }, { type: "text", text: "hi" }] },
      ])[0].text,
    ).toBe("hi")
    expect(
      normalizeMessages([
        { id: "b", type: "assistant", time: { created: 1 }, content: [{ type: "reasoning", text: "hmm" }] },
      ])[0].text,
    ).toBe("hmm")
    expect(
      normalizeMessages([
        { id: "c", type: "assistant", time: { created: 1 }, content: [{ type: "tool", name: "grep" }] },
      ])[0].text,
    ).toBe("tool grep")
  })

  test("unwraps array, {data} and nested {data:{data}} shapes", () => {
    const record = { id: "msg_1", type: "user", time: { created: 1 }, text: "x" }
    expect(normalizeMessages([record])).toHaveLength(1)
    expect(normalizeMessages({ data: [record] })).toHaveLength(1)
    expect(normalizeMessages({ data: { data: [record] } })).toHaveLength(1)
    expect(normalizeMessages({ error: "boom" })).toEqual([])
    expect(normalizeMessages(null)).toEqual([])
  })
})

describe("buildGraph", () => {
  const message = (id: string, created: number, text = id): SessionMessage =>
    ({ id, role: "user", created, text }) as SessionMessage
  const messages = (prefix: string, count: number, start = 10, step = 10): SessionMessage[] =>
    Array.from({ length: count }, (_, i) => message(`${prefix}_${i}`, start + i * step, `${prefix} ${i}`))
  const graphOf = (sessions: TreeSession[], msgs: Map<string, SessionMessage[]>, focus?: string) =>
    buildGraph({ sessions, focus, messages: msgs, webBase: "http://base.test", now: 1_000_000 })
  const nodeOf = (graph: SessionGraph, id: string) => graph.nodes.find((node) => node.id === id)!
  const headerOf = (graph: SessionGraph, lane: string) => graph.nodes.find((n) => n.lane === lane && n.role === "header")!

  test("a single session is one lane with its messages below the header", () => {
    const msgs = messages("msg", 3)
    const map = new Map([["ses_root", msgs]])
    const graph = graphOf([session("ses_root")], map)
    expect(graph.lanes).toHaveLength(1)
    expect(graph.lanes[0].id).toBe("ses_root")
    expect(graph.lanes[0].linked).toBe("http://base.test/session/ses_root")
    expect(graph.nodes.map((n) => n.role)).toEqual(["header", "user", "user", "user"])
    expect(graph.nodes.map((n) => n.y)).toEqual([0, 1, 2, 3])
    expect(graph.nodes.map((n) => n.x)).toEqual([0, 0, 0, 0])
    expect(graph.edges.filter((e) => e.kind === "flow")).toHaveLength(3)
    expect(graph.stats.messages).toBe(3)
    expect(graph.stats.omittedMessages).toBe(0)
  })

  test("lanes are ordered by session creation time", () => {
    const sessions = [
      session("ses_b", { parentID: "ses_a", time: { created: 30, updated: 30 } }),
      session("ses_root", { time: { created: 10, updated: 10 } }),
      session("ses_a", { parentID: "ses_root", time: { created: 20, updated: 20 } }),
    ]
    const graph = graphOf(sessions, new Map())
    expect(graph.lanes.map((lane) => lane.id)).toEqual(["ses_root", "ses_a", "ses_b"])
    expect(graph.nodes.filter((n) => n.role === "header").map((n) => n.x)).toEqual([0, LANE_W, LANE_W * 2])
  })

  test("a fork lane starts below its boundary message", () => {
    const parent = messages("mp", 20)
    const forkMessages = messages("mf", 5, 500)
    const sessions = [
      session("ses_root"),
      session("ses_fork", { fork: { sessionID: "ses_root", boundary: { messageID: parent[10].id } }, time: { created: 50, updated: 50 } }),
    ]
    const map = new Map([["ses_root", parent], ["ses_fork", forkMessages]])
    const graph = graphOf(sessions, map, "ses_root")
    const boundaryNode = nodeOf(graph, `ses_root#m${parent[10].id}`)
    const forkHeader = headerOf(graph, "ses_fork")
    expect(boundaryNode.y).toBe(11)
    expect(forkHeader.y).toBe(boundaryNode.y + 1)
    expect(forkHeader.x).toBe(LANE_W)
    const edge = graph.edges.find((e) => e.kind === "fork")
    expect(edge?.from).toBe(boundaryNode.id)
    expect(edge?.to).toBe(forkHeader.id)
  })

  test("the boundary message renders even when it is outside the last-K window", () => {
    const parent = messages("mp", 200)
    const sessions = [
      session("ses_root"),
      session("ses_fork", { fork: { sessionID: "ses_root", boundary: { messageID: parent[5].id } }, time: { created: 50, updated: 50 } }),
    ]
    const map = new Map([["ses_root", parent], ["ses_fork", messages("mf", 3, 500)]])
    const graph = graphOf(sessions, map, "ses_root")
    expect(nodeOf(graph, `ses_root#m${parent[5].id}`)).toBeDefined()
    const forkHeader = headerOf(graph, "ses_fork")
    // header(0), ellipsis(1), boundary message(2) → the fork starts at row 3.
    expect(forkHeader.y).toBe(3)
  })

  test("a run of pruned messages becomes an ellipsis node", () => {
    const parent = messages("mp", 200)
    const sessions = [
      session("ses_root"),
      session("ses_fork", { fork: { sessionID: "ses_root", boundary: { messageID: parent[5].id } }, time: { created: 50, updated: 50 } }),
    ]
    const map = new Map([["ses_root", parent], ["ses_fork", messages("mf", 3, 500)]])
    const graph = graphOf(sessions, map, "ses_root")
    const dots = graph.nodes.filter((n) => n.role === "ellipsis")
    // 200 messages, last 120 kept plus message 5: 74 missing before it in a row.
    expect(dots).toEqual([
      expect.objectContaining({ label: "… 5", lane: "ses_root" }),
      expect.objectContaining({ label: "… 74", lane: "ses_root" }),
    ])
    expect(graph.stats.omittedMessages).toBe(79)
  })

  test("a subagent spawns at the last parent message before its creation", () => {
    const parent = messages("mp", 20, 10, 10)
    const child = messages("mc", 4, 1000)
    const sessions = [
      session("ses_root"),
      session("ses_child", { parentID: "ses_root", time: { created: 125, updated: 130 } }),
    ]
    const map = new Map([["ses_root", parent], ["ses_child", child]])
    const graph = graphOf(sessions, map, "ses_root")
    const spawn = nodeOf(graph, `ses_root#m${parent[11].id}`)
    const childHeader = headerOf(graph, "ses_child")
    expect(childHeader.y).toBe(spawn.y + 1)
    const edge = graph.edges.find((e) => e.kind === "spawn")
    expect(edge?.from).toBe(spawn.id)
    expect(edge?.to).toBe(childHeader.id)
  })

  test("a succeeded subagent merges back into the parent's next message", () => {
    const parent = messages("mp", 20, 10, 10)
    const child = messages("mc", 4, 30, 10)
    const sessions = [
      session("ses_root"),
      session("ses_child", { parentID: "ses_root", outcome: "succeeded", time: { created: 15, updated: 60 } }),
    ]
    const map = new Map([["ses_root", parent], ["ses_child", child]])
    const graph = graphOf(sessions, map, "ses_root")
    // The child last spoke at 60; the parent's message at 60 is the merge point.
    const merge = nodeOf(graph, `ses_root#m${parent[5].id}`)
    const lastChild = nodeOf(graph, `ses_child#m${child[3].id}`)
    const edge = graph.edges.find((e) => e.kind === "merge")
    expect(edge?.from).toBe(lastChild.id)
    expect(edge?.to).toBe(merge.id)
    const lane = graph.lanes.find((l) => l.id === "ses_child")!
    expect(lane.merged).toBe(true)
    expect(lane.mergedAt).toBe(child[3].created)
    expect(lane.live).toBe(false)
  })

  test("no merge edge unless the subagent succeeded", () => {
    const parent = messages("mp", 20)
    const child = messages("mc", 4, 30, 10)
    for (const outcome of ["failed", null]) {
      const sessions = [
        session("ses_root"),
        session("ses_child", { parentID: "ses_root", outcome, time: { created: 15, updated: 60 } }),
      ]
      const map = new Map([["ses_root", parent], ["ses_child", child]])
      const graph = graphOf(sessions, map, "ses_root")
      expect(graph.edges.filter((e) => e.kind === "merge")).toEqual([])
      expect(graph.lanes.find((l) => l.id === "ses_child")!.merged).toBe(false)
    }
  })

  test("a busy subagent is live and does not merge", () => {
    const parent = messages("mp", 5)
    const child = messages("mc", 2, 20, 10)
    const sessions = [
      session("ses_root"),
      session("ses_child", { parentID: "ses_root", outcome: "succeeded", time: { created: 12, updated: 25, busy: 30, idle: 10 } }),
    ]
    const map = new Map([["ses_root", parent], ["ses_child", child]])
    const graph = graphOf(sessions, map, "ses_root")
    const lane = graph.lanes.find((l) => l.id === "ses_child")!
    expect(lane.status).toBe("busy")
    expect(lane.live).toBe(true)
    expect(lane.merged).toBe(false)
    expect(lane.mergedAt).toBeNull()
    expect(graph.edges.filter((e) => e.kind === "merge")).toEqual([])
    expect(headerOf(graph, "ses_child").tooltipFields.live).toBe("live")
  })

  test("a merged lane carries no work below its last message", () => {
    const parent = messages("mp", 10)
    const child = messages("mc", 4, 20, 10)
    const sessions = [
      session("ses_root"),
      session("ses_child", { parentID: "ses_root", outcome: "succeeded", time: { created: 12, updated: 60 } }),
    ]
    const map = new Map([["ses_root", parent], ["ses_child", child]])
    const graph = graphOf(sessions, map, "ses_root")
    const rows = graph.nodes.filter((n) => n.lane === "ses_child").map((n) => n.y)
    expect(Math.max(...rows)).toBe(headerOf(graph, "ses_child").y + 4)
  })

  test("the caps keep a large family readable", () => {
    const rootMessages = messages("mr", 500)
    const forkMessages = messages("mf", 300)
    const subMessages = messages("ms", 200)
    const sessions = [
      session("ses_root"),
      session("ses_fork", { fork: { sessionID: "ses_root", boundary: { messageID: rootMessages[250].id } }, time: { created: 60, updated: 60 } }),
      session("ses_sub", { parentID: "ses_root", time: { created: 70, updated: 70 } }),
    ]
    const map = new Map([["ses_root", rootMessages], ["ses_fork", forkMessages], ["ses_sub", subMessages]])
    const graph = graphOf(sessions, map, "ses_root")
    // 120-message cap plus the fork boundary, the spawn and the merge index.
    expect(graph.nodes.filter((n) => n.lane === "ses_root" && (n.role === "user" || n.role === "assistant"))).toHaveLength(123)
    expect(graph.nodes.filter((n) => n.lane === "ses_fork" && (n.role === "user" || n.role === "assistant"))).toHaveLength(60)
    expect(graph.nodes.filter((n) => n.lane === "ses_sub" && (n.role === "user" || n.role === "assistant"))).toHaveLength(30)
    expect(graph.stats.messages).toBe(213)
  })

  test("flow edges chain a lane's nodes in order", () => {
    const msgs = messages("msg", 3)
    const graph = graphOf([session("ses_root")], new Map([["ses_root", msgs]]))
    expect(graph.edges.filter((e) => e.kind === "flow")).toEqual([
      { from: "ses_root#h", to: `ses_root#m${msgs[0].id}`, kind: "flow" },
      { from: `ses_root#m${msgs[0].id}`, to: `ses_root#m${msgs[1].id}`, kind: "flow" },
      { from: `ses_root#m${msgs[1].id}`, to: `ses_root#m${msgs[2].id}`, kind: "flow" },
    ])
  })

  test("a root with no messages still renders its header", () => {
    const graph = graphOf([session("ses_root")], new Map())
    expect(graph.nodes.map((n) => n.role)).toEqual(["header"])
    expect(graph.nodes[0].y).toBe(0)
    expect(graph.edges).toEqual([])
  })
})

describe("grouping and budget", () => {
  const message = (id: string, created: number): SessionMessage => ({ id, role: "user", created, text: id }) as SessionMessage
  const messages = (prefix: string, count: number): SessionMessage[] =>
    Array.from({ length: count }, (_, i) => message(`${prefix}_${i}`, 10 + i * 10))
  const bigFamily = (subagents: number, busyCount = 0) => {
    const sessions: TreeSession[] = [session("ses_root", { time: { created: 1, updated: 1 } })]
    const map = new Map<string, SessionMessage[]>()
    map.set("ses_root", messages("mr", 2))
    for (let i = 0; i < subagents; i++) {
      const id = `ses_sub_${i}`
      const created = 10 + i
      sessions.push(session(id, {
        parentID: "ses_root",
        agent: "general",
        time: i < busyCount ? { created, updated: created, busy: 999 } : { created, updated: created },
      }))
      map.set(id, messages(`ms${i}`, 2))
    }
    return { sessions, map }
  }
  const graphOf = (sessions: TreeSession[], msgs: Map<string, SessionMessage[]>, extra: Record<string, unknown> = {}) =>
    buildGraph({ sessions, focus: "ses_root", messages: msgs, webBase: "http://base.test", now: 1_000_000, ...extra } as never)

  test("no grouping at 40 lanes, grouping above 40", () => {
    const small = bigFamily(39)
    const smallGraph = graphOf(small.sessions, small.map)
    expect(smallGraph.stats.totalLanes).toBe(40)
    expect(smallGraph.lanes.some((lane) => lane.group)).toBe(false)
    expect(smallGraph.lanes).toHaveLength(40)
    const big = bigFamily(40)
    const bigGraph = graphOf(big.sessions, big.map)
    expect(bigGraph.stats.totalLanes).toBe(41)
    expect(bigGraph.stats.groups).toBe(1)
    expect(bigGraph.lanes).toHaveLength(2)
  })

  test("group header carries count and live count, collapsed group has no member nodes or flow edges", () => {
    const { sessions, map } = bigFamily(45, 3)
    const graph = graphOf(sessions, map)
    const groupLane = graph.lanes.find((lane) => lane.group)!
    expect(groupLane.group).toMatchObject({ agent: "general", count: 45, liveCount: 3 })
    expect(groupLane.group.members).toHaveLength(45)
    expect(groupLane.live).toBe(true)
    const header = graph.nodes.find((n) => n.lane === groupLane.id && n.role === "header")!
    expect(header.label).toContain("general × 45")
    expect(header.label).toContain("live ×3")
    expect(header.tooltipFields.count).toBe("45")
    expect(header.tooltipFields.liveCount).toBe("3")
    expect(graph.nodes.filter((n) => n.lane === groupLane.id)).toHaveLength(1)
    expect(graph.nodes.some((n) => groupLane.group!.members.includes(n.lane))).toBe(false)
    expect(graph.edges.some((e) => groupLane.group!.members.some((id) => e.from.startsWith(`${id}#`) || e.to.startsWith(`${id}#`)))).toBe(false)
    expect(graph.edges.filter((e) => e.from === header.id || e.to === header.id)).toEqual([])
    const groupX = header.x
    expect(groupX).toBe(LANE_W)
  })

  test("expansion includes member lanes in creation order after the group header", () => {
    const { sessions, map } = bigFamily(45)
    const graph = graphOf(sessions, map, { expand: ["general"] })
    const groupIndex = graph.lanes.findIndex((lane) => lane.group)
    expect(groupIndex).toBe(1)
    const memberLanes = graph.lanes.slice(groupIndex + 1)
    expect(memberLanes.map((lane) => lane.id)).toEqual(
      Array.from({ length: 45 }, (_, i) => `ses_sub_${i}`),
    )
    expect(graph.nodes.some((n) => n.lane === "ses_sub_0" && n.role === "user")).toBe(true)
    expect(graph.stats.groups).toBe(1)
  })

  test("expanded member headers carry agent, message count and cost", () => {
    const { sessions, map } = bigFamily(41)
    sessions.find((s) => s.id === "ses_sub_0")!.cost = 0.5
    const graph = graphOf(sessions, map, { expand: ["general"] })
    const header = graph.nodes.find((n) => n.lane === "ses_sub_0" && n.role === "header")!
    expect(header.label).toBe("general · 2 msg · $0.5000")
    expect(header.tooltipFields.messages).toBe("2")
    expect(header.tooltipFields.cost).toBe("$0.5000")
  })

  test("collapsed group renders one node and no message nodes for its lane", () => {
    const { sessions, map } = bigFamily(41)
    const graph = graphOf(sessions, map)
    const groupLane = graph.lanes.find((lane) => lane.group)!
    const groupNodes = graph.nodes.filter((n) => n.lane === groupLane.id)
    expect(groupNodes).toHaveLength(1)
    expect(groupNodes[0].role).toBe("header")
    expect(groupNodes[0].label).toBe("general × 41")
    expect(graph.nodes.filter((n) => groupLane.group!.members.includes(n.lane))).toEqual([])
  })

  test("single-member agent groups render as normal lanes and forks never group", () => {
    const { sessions, map } = bigFamily(41)
    sessions.push(session("ses_solo", { parentID: "ses_root", agent: "solo", time: { created: 500, updated: 500 } }))
    map.set("ses_solo", messages("msolo", 1))
    sessions.push(session("ses_fork", { fork: { sessionID: "ses_root", boundary: { messageID: "mr_0" } }, agent: "general", time: { created: 501, updated: 501 } }))
    map.set("ses_fork", messages("mfork", 1))
    const graph = graphOf(sessions, map)
    expect(graph.lanes.some((lane) => lane.id === "ses_solo")).toBe(true)
    expect(graph.lanes.some((lane) => lane.id === "ses_fork")).toBe(true)
    expect(graph.lanes.find((lane) => lane.id === "ses_fork")!.group).toBeUndefined()
  })

  test("budget drops oldest messages but keeps headers and branch/merge boundary nodes", () => {
    const parent = messages("mp", 30)
    const child = messages("mc", 4, )
    const sessions = [
      session("ses_root"),
      session("ses_fork", { fork: { sessionID: "ses_root", boundary: { messageID: parent[2].id } }, time: { created: 50, updated: 50 } }),
      session("ses_child", { parentID: "ses_root", outcome: "succeeded", time: { created: 35, updated: 60 } }),
    ]
    const map = new Map([["ses_root", parent], ["ses_fork", messages("mf", 5)], ["ses_child", child]])
    const graph = graphOf(sessions, map, { maxNodes: 10 })
    expect(graph.stats.budgeted).toBe(true)
    expect(graph.stats.messages).toBeLessThanOrEqual(10)
    expect(graph.stats.omittedMessages).toBeGreaterThan(0)
    for (const lane of graph.lanes) {
      expect(graph.nodes.some((n) => n.lane === lane.id && n.role === "header")).toBe(true)
    }
    expect(graph.nodes.some((n) => n.id === `ses_root#m${parent[2].id}`)).toBe(true)
    expect(graph.nodes.some((n) => n.role === "ellipsis")).toBe(true)
  })

  test("budget disabled by maxNodes 0 or a large value", () => {
    const parent = messages("mp", 20)
    const sessions = [session("ses_root")]
    const map = new Map([["ses_root", parent]])
    const disabled = graphOf(sessions, map, { maxNodes: 0 })
    expect(disabled.stats.budgeted).toBe(false)
    expect(disabled.stats.messages).toBe(20)
    const large = graphOf(sessions, map, { maxNodes: 10000 })
    expect(large.stats.budgeted).toBe(false)
    expect(large.stats.messages).toBe(20)
  })
})

describe("resolveOptions", () => {  test("defaults", () => {
    const options = resolveOptions({}, {})
    expect(options).toEqual({
      hostname: "127.0.0.1",
      port: 47821,
      limit: 500,
      maxNodes: 2000,
      explicitBase: "",
      configuredBase: "http://127.0.0.1:4096",
    })
  })

  test("maxNodes defaults to 2000 and reads env and options", () => {
    expect(resolveOptions({}, {}).maxNodes).toBe(2000)
    expect(resolveOptions({ OPENCODE_TREE_MAX: "0" }, {}).maxNodes).toBe(0)
    expect(resolveOptions({ OPENCODE_TREE_MAX: "123" }, {}).maxNodes).toBe(123)
    expect(resolveOptions({}, { maxNodes: 777 }).maxNodes).toBe(777)
    expect(resolveOptions({ OPENCODE_TREE_MAX: "nope" }, {}).maxNodes).toBe(2000)
  })

  test("env beats plugin options", () => {
    const options = resolveOptions(
      { OPENCODE_TREE_PORT: "48000", OPENCODE_TREE_HOST: "0.0.0.0", OPENCODE_TREE_LIMIT: "50" },
      { opencodeTreePort: 49000, host: "127.0.0.1", limit: 10 },
    )
    expect(options.port).toBe(48000)
    expect(options.hostname).toBe("0.0.0.0")
    expect(options.limit).toBe(50)
  })

  test("accepts kebab and camel option keys", () => {
    expect(resolveOptions({}, { "opencode-tree-port": 48001 }).port).toBe(48001)
    expect(resolveOptions({}, { opencodeTreePort: 48002 }).port).toBe(48002)
    expect(resolveOptions({}, { port: 48003 }).port).toBe(48003)
    expect(resolveOptions({}, { "opencode-tree-limit": 42 }).limit).toBe(42)
  })

  test("clamps the limit and rejects bad ports", () => {
    expect(resolveOptions({ OPENCODE_TREE_LIMIT: "9999" }, {}).limit).toBe(2000)
    expect(resolveOptions({ OPENCODE_TREE_LIMIT: "-1" }, {}).limit).toBe(500)
    expect(resolveOptions({ OPENCODE_TREE_PORT: "nope" }, {}).port).toBe(47821)
    expect(resolveOptions({ OPENCODE_TREE_PORT: "70000" }, {}).port).toBe(47821)
  })

  test("a web base option wins over the service", () => {
    const options = resolveOptions(
      { OPENCODE_TREE_WEB_BASE: "http://localhost:7777/" },
      {},
      { hostname: "1.2.3.4", port: 5000 },
    )
    expect(options.explicitBase).toBe("http://localhost:7777")
    expect(options.configuredBase).toBe("http://1.2.3.4:5000")
  })

  test("a garbage web base option is ignored", () => {
    expect(resolveOptions({ OPENCODE_TREE_WEB_BASE: "not a url" }, {}).explicitBase).toBe("")
  })
})

describe("readLiveBase", () => {
  const area = () => {
    const root = mkdtempSync(join(tmpdir(), "tree-state-"))
    mkdirSync(join(root, "opencode"), { recursive: true })
    return root
  }

  test("reads the url field of the service state file", () => {
    const root = area()
    writeFileSync(
      join(root, "opencode", "service.json"),
      JSON.stringify({ url: "http://127.0.0.1:49374/", pid: 1 }),
    )
    expect(readLiveBase({ XDG_STATE_HOME: root })).toBe("http://127.0.0.1:49374")
  })

  test("returns an empty string when the file is missing or broken", () => {
    expect(readLiveBase({ XDG_STATE_HOME: area() })).toBe("")
    const root = area()
    writeFileSync(join(root, "opencode", "service.json"), "{")
    expect(readLiveBase({ XDG_STATE_HOME: root })).toBe("")
  })

  test("ignores a url that is not a link base", () => {
    const root = area()
    writeFileSync(join(root, "opencode", "service.json"), JSON.stringify({ url: 42 }))
    expect(readLiveBase({ XDG_STATE_HOME: root })).toBe("")
  })
})

describe("viewerURL", () => {
  test("opens the viewer at the bound loopback port", () => {
    expect(viewerURL(47821)).toBe("http://127.0.0.1:47821/")
  })

  test("focuses the requesting session", () => {
    expect(viewerURL(47821, "ses_abc")).toBe("http://127.0.0.1:47821/?session=ses_abc")
  })

  test("uses the hostname the server actually bound", () => {
    expect(viewerURL(47821, undefined, "10.0.0.5")).toBe("http://10.0.0.5:47821/")
  })

  test("maps a wildcard binding to loopback", () => {
    expect(viewerURL(47821, undefined, "0.0.0.0")).toBe("http://127.0.0.1:47821/")
    expect(viewerURL(47821, undefined, "::")).toBe("http://127.0.0.1:47821/")
  })

  test("brackets an IPv6 host", () => {
    expect(viewerURL(47821, undefined, "::1")).toBe("http://[::1]:47821/")
  })
})

describe("renderPage dialog", () => {
  test("node click opens a dialog and never window.open on first click", () => {
    const page = renderPage("http://base.test", 500)
    expect(page).toContain('id="dialog"')
    expect(page).toContain("Open in OpenCode")
    expect(page).toContain("show in OpenCode")
    expect(page).toContain("Escape")
    expect(page).not.toContain("window.open")
  })
})
