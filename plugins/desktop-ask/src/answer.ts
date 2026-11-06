/**
 * Picking the answer out of the transcript. The trigger prompt asks for the
 * text to copy inside <copy> tags so the post-task report stays out of the
 * clipboard; a reply without the tags copies whole.
 */

export interface MessagePart {
  type?: string
  text?: string
}

export interface Message {
  id?: string
  type?: string
  time?: { created?: number }
  content?: MessagePart[]
}

export function textOf(message: Message): string {
  const parts = Array.isArray(message.content) ? message.content : []
  return parts
    .map((part) => (part?.type === "text" && typeof part.text === "string" ? part.text : ""))
    .filter(Boolean)
    .join("\n")
    .trim()
}

/** The newest assistant text written after `since`, tags removed. */
export function answerFrom(messages: unknown, since: number): string | undefined {
  if (!Array.isArray(messages)) return undefined
  let best: { created: number; text: string } | undefined
  for (const raw of messages as Message[]) {
    if (!raw || raw.type !== "assistant") continue
    const created = Number(raw.time?.created)
    if (!Number.isFinite(created) || created <= since) continue
    const text = textOf(raw)
    if (!text) continue
    if (!best || created > best.created) best = { created, text }
  }
  return best ? clip(best.text) : undefined
}

/** The text inside the first <copy> block, or the whole reply when absent. */
export function clip(text: string): string {
  const match = text.match(/<copy>([\s\S]*?)<\/copy>/i)
  return (match ? match[1] : text).trim()
}
