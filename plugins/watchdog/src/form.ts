/**
 * Server-side bridge to the host's native question card. Auth is read from the
 * host service registration only when a card is actually opened or cancelled;
 * credentials are never logged or stored in Jev files.
 */
import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

type Service = { url: string; password: string }

function service(): Service | undefined {
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

/** Our form ids carry the call token behind this prefix; other forms are not ours. */
const FORM_PREFIX = "frm_jev_"

export function formIDOf(token: string): string {
  return `${FORM_PREFIX}${token}`
}

/** A fresh card for the same hold. The nonce is unique per call (time + random)
 *  so a same-millisecond retry after a 409 gets a genuinely different id. */
export function reopenFormIDOf(token: string, nonce?: number): string {
  const unique = nonce === undefined ? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}` : Math.trunc(nonce).toString(36)
  return `${FORM_PREFIX}${token}_r${unique}`
}

/** The Jev call token a native form belongs to, or nothing when it is not ours. */
export function tokenOfForm(formID: string): string | undefined {
  const id = String(formID ?? "")
  if (!id.startsWith(FORM_PREFIX)) return undefined
  const token = id.slice(FORM_PREFIX.length).replace(/_r[0-9a-z]+$/, "")
  return token || undefined
}

export interface CardInput {
  id: string
  title: string
  metadata: Record<string, unknown>
  fields: unknown[]
}

export interface OpenedCard {
  id: string
  created: boolean
}

/** Open a question card. HTTP 409 means the id already exists (not created). */
export async function createCard(sessionID: string, card: CardInput): Promise<OpenedCard | undefined> {
  const path = `/api/session/${encodeURIComponent(sessionID)}/form`
  try {
    const result = await api("POST", path, card)
    if (!result) return undefined
    if (result.status === 409) return { id: card.id, created: false }
    if (!result.ok) return undefined
    return { id: card.id, created: true }
  } catch {
    return undefined
  }
}

/** Remove a card that is still pending after dismissal, abort or interrupt. */
export async function cancelCard(sessionID: string, formID: string): Promise<void> {
  try {
    await api("DELETE", `/api/session/${encodeURIComponent(sessionID)}/form/${encodeURIComponent(formID)}`)
  } catch {}
}
