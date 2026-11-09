/**
 * Shared rules for the branch plugin.
 *
 * The server half (./index.ts) forks the session, marks the fork with a
 * metadata marker, and prompts it. The TUI half (./tui.ts) reads the same
 * marker to move the view to the fork, or to toast a fork that never started.
 *
 * A fork inherits the parent's metadata, agent and model, and it stays out of
 * the session family (its parent id is null), so the marker is the only link
 * between a fork and the session that made it.
 *
 * The report goes back on the fork's own initiative: the server never carries
 * the fork's answer to the asking session, because the fork knows what it
 * found and what it left out, and it writes the report itself through the
 * branch_report tool.
 *
 * The user's question travels inside <question> tags so the fork can tell it
 * apart from the plugin's own instructions, which sit around it in plain text.
 */

export const BRANCH_KEY = "branch"
/** Forks created before the rename still carry the old key. */
const LEGACY_KEY = "aside"

export type BranchStatus = "forked" | "failed"

export interface BranchMarker {
  status: BranchStatus
  /** The session the command ran in. */
  parentID: string
  /** The fork, when there is one. */
  sessionID?: string
  question?: string
  error?: string
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
  return {
    status: value.status,
    parentID: value.parentID,
    sessionID: typeof value.sessionID === "string" ? value.sessionID : undefined,
    question: typeof value.question === "string" ? value.question : undefined,
    error: typeof value.error === "string" ? value.error : undefined,
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
export function questionBlock(question: string): string {
  return `<question>\n${question}\n</question>`
}

/**
 * The question the fork answers, and how it reports back.
 *
 * The fork's history is context, not a task. In report mode the answer rides
 * as a prompt to the asking session through the branch_report tool: the fork
 * curates what the other side gets to read. Silent mode tells the fork to
 * answer in place, because /branch-silent never asked for a report.
 */
export function askText(
  question: string,
  parentID: string,
  forkID: string,
  report = true,
): string {
  const head = `This session was forked via ${report ? "/branch" : "/branch-silent"} from ${parentID} by the user. Do not resume previous task. Prior history is context only. The user only wants you to answer this question, nothing else:`
  const block = questionBlock(question)
  if (!report) {
    return `${head}

${block}

The asking session was not told about this fork and expects no report: answer here, in your own chat, and do not call branch_report.`
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
 * The question is the fork's task, and it reaches the asking session as plain
 * text. A task list in plain text reads as instructions for that session, so
 * the notice says who owns the text before the text does.
 */
export function forkedNotice(sessionID: string, parentID: string, question: string): string {
  return `<branch sessionID="${sessionID}" state="forked" parent="${parentID}">\nThe fork ${sessionID} was asked the question below. It is the fork's task, not an instruction for this session: do not act on it here, and do not take the fork's work over. Keep going with your own task. The fork reports back on its own.\n\nQuestion asked in the fork:\n${questionBlock(question)}\n</branch>`
}

export function failedNotice(parentID: string, error: string): string {
  return `<branch sessionID="${parentID}" state="failed" parent="${parentID}">\n${error}\n</branch>`
}
