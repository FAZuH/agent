import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { discoverToken, makeClient } from "./client.ts"

const URL = "http://127.0.0.1:4100/api/board"

describe("makeClient", () => {
  test("poll sends the cursor, wait, channel, and token", async () => {
    let seen = ""
    const client = makeClient(URL + "/", "secret", async (input, init) => {
      seen = String(input)
      expect(init?.headers).toEqual({
        accept: "application/json",
        authorization: "Bearer secret",
      })
      return new Response(JSON.stringify({ events: [], cursor: "7" }), { status: 200 })
    })
    const page = await client.poll({ after: "6", wait: 25, channel: "wake" })
    expect(seen).toBe(`${URL}/events?after=6&wait=25&channel=wake`)
    expect(page).toEqual({ events: [], cursor: "7" })
  })

  test("poll throws on a failed response", async () => {
    const client = makeClient(URL, "secret", async () => new Response("nope", { status: 401 }))
    await expect(client.poll({})).rejects.toThrow("401")
  })
})

describe("discoverToken", () => {
  test("prefers BOARD_TOKEN", () => {
    expect(discoverToken(URL, { BOARD_TOKEN: "from-env" })).toBe("from-env")
  })

  test("reads an explicit token file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "board-bridge-token-"))
    const file = path.join(dir, "token.json")
    fs.writeFileSync(file, JSON.stringify({ url: "http://elsewhere", token: "from-file" }))
    expect(discoverToken(URL, { BOARD_BRIDGE_TOKEN_FILE: file })).toBe("from-file")
  })

  test("throws when no token is available", () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "board-bridge-empty-")), "missing.json")
    expect(() => discoverToken(URL, { BOARD_BRIDGE_TOKEN_FILE: file })).toThrow(/no board token/)
  })
})
