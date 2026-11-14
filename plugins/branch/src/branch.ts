/**
 * Shared rules for the branch plugin.
 *
 * `branch_ask` forks the calling primary session; `branch_subagent` forks a
 * finished subagent in the caller's tree. Both write the same metadata marker,
 * prompt the fork, and let it report back through `branch_report`. The TUI and
 * GUI read the marker to follow the fork.
 *
 * A fork inherits the source's metadata, agent, and model, and its parent id is
 * null, so the marker is the only link between a fork and the session that made
 * it.
 *
 * The report goes back on the fork's own initiative: the server never carries
 * the answer, because the fork knows what it found and what it left out.
 *
 * The prompt travels inside <prompt> tags so the fork can tell it apart from
 * the plugin's own instructions around it.
 */

export const BRANCH_KEY = "branch"
/** Forks created before the rename still carry the old key. */
const LEGACY_KEY = "aside"

export type BranchStatus = "forked" | "failed"
export type BranchKind = "ask" | "subagent"
/** Where the fork prompt names its origin. */
export type BranchVia = "branch_ask" | "branch_subagent" | "branch-silent"

export interface BranchMarker {
  status: BranchStatus
  kind: BranchKind
  /** The session that asked for the fork and receives the report. */
  parentID: string
  /** The fork, when there is one. */
  sessionID?: string
  /** The session whose history was copied. */
  sourceID?: string
  prompt?: string
  /** Legacy field from before prompt was the name. */
  question?: string
  error?: string
  /** Fork made without moving the view to it. */
  background?: boolean
  /** Set after the first report, so a second call is refused. */
  reportedAt?: number
}

/** Read the marker out of session metadata. Anything else is not ours. */
export function readMarker(metadata: unknown): BranchMarker | undefined {
  if (!metadata || typeof metadata !== "object") return undefined
  const raw =
    (metadata as Record<string, unknown>)[BRANCH_KEY] ??
    (metadata as Record<string, unknown>)[LEGACY_KEY]
  if (!raw || typeof raw !== "object") return undefined
  const value = raw as Record<string, unknown>
  if (value.status !== "forked" && value.status !== "failed") return undefined
  if (typeof value.parentID !== "string") return undefined
  const question = typeof value.question === "string" ? value.question : undefined
  return {
    status: value.status,
    kind: value.kind === "subagent" ? "subagent" : "ask",
    parentID: value.parentID,
    sessionID: typeof value.sessionID === "string" ? value.sessionID : undefined,
    sourceID: typeof value.sourceID === "string" ? value.sourceID : undefined,
    prompt: typeof value.prompt === "string" ? value.prompt : question,
    question,
    error: typeof value.error === "string" ? value.error : undefined,
    background: value.background === true,
    reportedAt: typeof value.reportedAt === "number" ? value.reportedAt : undefined,
  }
}

/** The report the fork sends, and the tags it sends it under. */
export function reportTags(forkID: string, parentID: string): { open: string; close: string } {
  return {
    open: `<branch sessionID="${forkID}" state="completed" parent="${parentID}">`,
    close: `</branch>`,
  }
}

/** The user's words, fenced off from the plugin's own instructions. */
export function promptBlock(prompt: string): string {
  return `<prompt>\n${prompt}\n</prompt>`
}

export interface ForkOrigin {
  via?: BranchVia
  sourceID?: string
}

const originLabel = (origin: ForkOrigin): string =>
  origin.via === "branch-silent" ? "/branch-silent" : (origin.via ?? "branch_ask")

/**
 * The prompt the fork answers, and how it reports back.
 *
 * The fork's history is context, not a task. In report mode the answer rides
 * as a prompt to the asking session through the branch_report tool: the fork
 * curates what the other side gets to read. Silent mode tells the fork to
 * answer in place, because the asking session expects no report.
 */
export function askText(
  prompt: string,
  parentID: string,
  forkID: string,
  report = true,
  origin: ForkOrigin = {},
): string {
  const sourceID = origin.sourceID ?? parentID
  const head = `This session was forked via ${originLabel(origin)} from ${sourceID} by the asking session. Do not resume previous task. Prior history is context only. The asking session only wants you to address the following prompt/instruction, nothing else:`
  const block = promptBlock(prompt)
  if (!report) {
    return `${head}

${block}

The asking session was not told about this fork and expects no report: do the work here, in your own chat, and do not call branch_report.`
  }
  const tags = reportTags(forkID, parentID)
  return `${head}

${block}

When you are done, call the branch_report tool with your answer. It delivers the answer to the session that asked (${parentID}) wrapped in these tags, so that session can tell your report from any other prompt:

${tags.open}
...your answer...
${tags.close}

Your own chat is not the report channel: the report is what that session reads.`
}

/**
 * Notices mirror OpenCode's own subagent delivery: a tag, then the payload.
 *
 * The prompt is the fork's task, and it reaches the asking session as plain
 * text. A task list in plain text reads as instructions for that session, so
 * the notice says who owns the text before the text does.
 */
export function forkedNotice(
  sessionID: string,
  parentID: string,
  prompt: string,
  origin: ForkOrigin = {},
): string {
  const sourceID = origin.sourceID ?? parentID
  const from = sourceID === parentID ? "" : ` of ${sourceID}`
  return `<branch sessionID="${sessionID}" state="forked" parent="${parentID}">\nThe fork ${sessionID}${from} was given the prompt below. It is the fork's task, not an instruction for this session: do not act on it here, and do not take the fork's work over. Keep going with your own task. The fork reports back on its own.\n\nPrompt given in the fork:\n${promptBlock(prompt)}\n</branch>`
}

export function failedNotice(parentID: string, error: string): string {
  return `<branch sessionID="${parentID}" state="failed" parent="${parentID}">\n${error}\n</branch>`
}
