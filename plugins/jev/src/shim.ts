/**
 * Auth shim for jegrep.
 *
 * jegrep's `--endpoint local` posts to JEGREP_ENDPOINT_URL but deliberately
 * sends no Authorization header, so it cannot talk to a provider that needs a
 * bearer token. This puts a loopback proxy in front: it adds the header and
 * forwards to the provider's real decisions endpoint.
 *
 * Endpoint, model id, and key location all come from the same state file the
 * plugin uses, so pointing the plugin at a different provider moves the shim
 * with it. Env overrides win, which is what you want for a one-off run.
 *
 *   bun src/shim.ts
 *   JEGREP_ENDPOINT_URL=http://127.0.0.1:8756/ jegrep "query" --endpoint local
 */

import { createServer } from "node:http"
import { redact } from "./jev.ts"
import { loadState, resolveKey } from "./state.ts"

const PORT = Number(process.env.JEV_SHIM_PORT ?? 8756)
const UPSTREAM = process.env.JEV_ENDPOINT ?? loadState().endpoint
const WIRE_MODEL = process.env.JEV_MODEL ?? loadState().model

function key(): string | null {
  return resolveKey()
}

// jegrep asks for a model alias of its own; answer with the configured id
// unless the caller named something specific.
function wireModel(requested: unknown): string {
  const v = String(requested ?? "").trim()
  if (!v || v === "jev-latest" || v === "jev-preview") return WIRE_MODEL
  return v
}

const server = createServer((req, res) => {
  if (req.method !== "POST") {
    res.writeHead(405).end()
    return
  }
  const chunks: Buffer[] = []
  req.on("data", (c) => chunks.push(c))
  req.on("end", async () => {
    const secret = key()
    if (!secret) {
      res.writeHead(500, { "content-type": "application/json" })
      res.end(JSON.stringify({ error: "jev shim: no key found; set one of the env vars in jev-state.json or run /jev-key" }))
      return
    }
    let body: any
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"))
    } catch {
      res.writeHead(400).end()
      return
    }
    try {
      const upstream = await fetch(UPSTREAM, {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
        // The state here is file contents from a search index, so it goes
        // through the same redaction as every other call. The Authorization
        // header is set here, never read from the body.
        body: JSON.stringify({ ...(redact(body) as object), model: wireModel(body?.model) }),
        signal: AbortSignal.timeout(60_000),
      })
      const text = await upstream.text()
      res.writeHead(upstream.status, { "content-type": "application/json" })
      res.end(text)
    } catch (error) {
      res.writeHead(502, { "content-type": "application/json" })
      res.end(JSON.stringify({ error: `jev shim upstream failed: ${error instanceof Error ? error.message : error}` }))
    }
  })
})

server.listen(PORT, "127.0.0.1", () => {
  console.log(`jev shim on http://127.0.0.1:${PORT}/ -> ${UPSTREAM} (model ${WIRE_MODEL})`)
})
