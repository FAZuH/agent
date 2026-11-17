/**
 * Server-side bridge to the host's native question card. A form created here
 * reaches every client, including the mobile web app, which loads no plugin
 * UI half. The card answers the same record the Prompts views show.
 */
import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

import { descriptionOf, formFieldsOf, formIDOf, reopenFormIDOf, type Prompt } from "./shared.ts"

type Service = { url: string; password: string }

function service(): Service | undefined {
  if (process.env.OPENCODE_PROMPT_NO_NATIVE_FORM) return undefined
  const state = process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state")
  try {
    const registration = JSON.parse(readFileSync(join(state, "opencode", "service.json"), "utf8"))
    if (typeof registration.url === "string" && typeof registration.password === "string") {
      return { url: registration.url, password: registration.password }
    }
  } catch {}
  return undefined
}

async function api(method: string, path: string, body?: unknown) {
  const found = service()
  if (!found) return undefined
  const auth = `Basic ${Buffer.from(`opencode:${found.password}`).toString("base64")}`
  const response = await fetch(`${found.url}${path}`, {
    method,
    headers: { authorization: auth, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const text = await response.text()
  let json: any
  try {
    json = text ? JSON.parse(text) : undefined
  } catch {}
  return { status: response.status, ok: response.ok, json }
}

export interface OpenedForm {
  id: string
  created: boolean
}

/** Open a question card for a prompt. A reopen gets a new id so a stale card cannot block it. */
export async function openNativeForm(prompt: Prompt, reopen = false): Promise<OpenedForm | undefined> {
  if (!(prompt.prompts?.questions?.length ?? 0)) return undefined
  const id = reopen ? reopenFormIDOf(prompt.id, Date.now()) : formIDOf(prompt.id)
  const path = `/api/session/${encodeURIComponent(prompt.sessionID)}/form`
  try {
    const result = await api("POST", path, {
      id,
      title: descriptionOf(prompt),
      // Desktop and web only render forms whose kind is "question".
      metadata: { kind: "question", promptID: prompt.id },
      fields: formFieldsOf(prompt),
    })
    if (!result) return undefined
    if (result.status === 409) return { id, created: false }
    if (!result.ok) throw new Error(`HTTP ${result.status}: ${JSON.stringify(result.json)}`)
    return { id, created: true }
  } catch (error) {
    console.error(
      `[prompt] could not open the question card: ${error instanceof Error ? error.message : String(error)}`,
    )
    return undefined
  }
}

/** Remove a card that is still pending after its prompt was deferred or interrupted. */
export async function cancelNativeForm(sessionID: string, formID: string): Promise<void> {
  try {
    await api("DELETE", `/api/session/${encodeURIComponent(sessionID)}/form/${encodeURIComponent(formID)}`)
  } catch {}
}
