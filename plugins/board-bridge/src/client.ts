import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { BoardEvent } from "./shared.ts"

export type PollPage = { events: BoardEvent[]; cursor: string }

export type PollOptions = {
  after?: string
  wait?: number
  channel?: string
  signal?: AbortSignal
}

export type BoardClient = {
  poll: (options: PollOptions) => Promise<PollPage>
}

function tokenFiles(): string[] {
  const dir = path.join(os.homedir(), ".config", "board", "local")
  try {
    return fs.readdirSync(dir).filter((name) => name.endsWith(".json")).map((name) => path.join(dir, name))
  } catch {
    return []
  }
}

export function discoverToken(url: string, env: Record<string, string | undefined> = process.env): string {
  if (env.BOARD_TOKEN) return env.BOARD_TOKEN
  const explicit = env.BOARD_BRIDGE_TOKEN_FILE
  const candidates = explicit ? [explicit] : tokenFiles()
  for (const file of candidates) {
    try {
      const data = JSON.parse(fs.readFileSync(file, "utf8")) as { url?: string; token?: string }
      if (typeof data.token === "string" && (explicit || data.url === url)) return data.token
    } catch {
      // an unreadable or malformed token file is not this board's credential
    }
  }
  throw new Error(`no board token for ${url}; set BOARD_TOKEN or BOARD_BRIDGE_TOKEN_FILE`)
}

export function makeClient(
  url: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
): BoardClient {
  const base = url.replace(/\/+$/, "")
  return {
    async poll(options: PollOptions): Promise<PollPage> {
      const query = new URLSearchParams()
      if (options.after) query.set("after", options.after)
      if (options.wait !== undefined) query.set("wait", String(options.wait))
      if (options.channel) query.set("channel", options.channel)
      const response = await fetchImpl(`${base}/events?${query.toString()}`, {
        headers: { accept: "application/json", authorization: `Bearer ${token}` },
        signal: options.signal,
      })
      if (!response.ok) throw new Error(`board events returned ${response.status}`)
      return (await response.json()) as PollPage
    },
  }
}
