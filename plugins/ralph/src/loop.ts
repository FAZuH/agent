/**
 * Loop rules for the ralph plugin: argument parsing, promise detection, and the
 * decision made when a session goes idle. No host API here, so every rule is
 * testable on its own.
 *
 * Ported from the Ralph Wiggum plugin (anthropics/claude-code), which runs the
 * loop from a Stop hook, and open-ralph-wiggum, which runs it from an external
 * CLI. Here the host has no Stop hook, so the loop is driven by session events;
 * the prompt discipline is the same either way.
 */

export interface LoopState {
  /** The loop belongs to one session. Two sessions never feed each other. */
  sessionID: string
  /** The task, fed back verbatim every iteration. That repetition is the trick. */
  prompt: string
  /** Iterations already run, starting at 1. */
  iteration: number
  /** 0 means unlimited. */
  maxIterations: number
  completionPromise: string
  /** Optional early stop, e.g. when the task turns out to be impossible as written. */
  abortPromise: string | null
  /** Turns in a row that produced no assistant text. */
  emptyStreak: number
  startedAt: number
}

export const DEFAULT_COMPLETION_PROMISE = "COMPLETE"

/** Turns with no text in a row before the loop gives up. Without this a model that answers nothing loops forever on an unlimited run. */
export const MAX_EMPTY_STREAK = 3

export interface Options {
  prompt: string
  maxIterations: number
  completionPromise: string
  abortPromise: string | null
}

export type Parsed = { ok: true; options: Options } | { ok: false; error: string }

export const USAGE = 'Usage: /ralph-loop "<task>" [--max-iterations N] [--completion-promise TEXT] [--abort-promise TEXT]'

/** Splits on whitespace, but keeps a "quoted span" as one token, so a multi-word promise survives. */
export function tokenize(raw: string): string[] {
  const tokens: string[] = []
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(raw)) !== null) tokens.push(match[1] ?? match[2] ?? match[3] ?? "")
  return tokens.filter((token) => token.length > 0)
}

/**
 * Parses the command text. Unquoted words are the task, so a task needs no
 * quotes; a quoted value stays one token. Anything unknown is an error, not a
 * silently dropped flag.
 */
export function parseArgs(raw: string): Parsed {
  const words = tokenize(raw)
  const task: string[] = []
  let maxIterations = 0
  let completionPromise = DEFAULT_COMPLETION_PROMISE
  let abortPromise: string | null = null

  for (let i = 0; i < words.length; i++) {
    const word = words[i]
    if (word === "-h" || word === "--help") return { ok: false, error: USAGE }
    if (word === "--max-iterations" || word === "--completion-promise" || word === "--abort-promise") {
      const value = words[++i]
      if (value === undefined) return { ok: false, error: `${word} needs a value. ${USAGE}` }
      if (word === "--max-iterations") {
        if (!/^\d+$/.test(value)) return { ok: false, error: `--max-iterations takes a whole number, 0 for unlimited; got "${value}". ${USAGE}` }
        maxIterations = Number(value)
      } else if (word === "--completion-promise") {
        completionPromise = value
      } else {
        abortPromise = value
      }
      continue
    }
    task.push(word)
  }

  const prompt = task.join(" ").trim()
  if (!prompt) return { ok: false, error: `No task given. ${USAGE}` }
  return { ok: true, options: { prompt, maxIterations, completionPromise, abortPromise } }
}

const collapse = (value: string) => value.replace(/\s+/g, " ").trim()

/** The first `<promise>…</promise>` in the text, whitespace-collapsed, or null. */
export function promiseIn(text: string): string | null {
  const match = /<promise>([\s\S]*?)<\/promise>/i.exec(text)
  return match ? collapse(match[1]) : null
}

/** Literal comparison: a promise is text, not a pattern, so `*` and `?` match themselves. */
export function matches(text: string, promise: string): boolean {
  const said = promiseIn(text)
  return said !== null && said.toLowerCase() === collapse(promise).toLowerCase()
}

export type Decision =
  | { kind: "continue"; next: LoopState }
  | { kind: "complete" }
  | { kind: "abort" }
  | { kind: "max" }
  | { kind: "silent" }

/**
 * What to do when the session went idle. The promise is checked before the
 * iteration cap, unlike the upstream stop hook: if the last allowed turn
 * finished the work, saying "complete" is the truth and "max reached" is not.
 */
export function decide(state: LoopState, lastText: string): Decision {
  if (state.abortPromise && matches(lastText, state.abortPromise)) return { kind: "abort" }
  if (matches(lastText, state.completionPromise)) return { kind: "complete" }
  if (state.maxIterations > 0 && state.iteration >= state.maxIterations) return { kind: "max" }
  const emptyStreak = lastText.trim() === "" ? state.emptyStreak + 1 : 0
  if (emptyStreak >= MAX_EMPTY_STREAK) return { kind: "silent" }
  return { kind: "continue", next: { ...state, iteration: state.iteration + 1, emptyStreak } }
}

/** The task, then the loop rules. The task text never changes between iterations. */
export function iterationPrompt(state: LoopState): string {
  const cap = state.maxIterations > 0 ? `${state.iteration} / ${state.maxIterations}` : `${state.iteration} (unlimited)`
  const lines = [
    state.prompt,
    "",
    "---",
    `Ralph iteration ${cap}. Same task as last time: read the files and git diff to see what the previous iteration did, then carry on.`,
    `Finish by outputting exactly: <promise>${state.completionPromise}</promise> — only when it is genuinely true.`,
  ]
  if (state.abortPromise) lines.push(`Stop early by outputting exactly: <promise>${state.abortPromise}</promise> — use it when the task cannot be done as written.`)
  return lines.join("\n")
}

/** One loop, rendered for /ralph-status. */
export function status(state: LoopState, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - state.startedAt) / 1000))
  const cap = state.maxIterations > 0 ? `${state.iteration} / ${state.maxIterations}` : `${state.iteration} (unlimited)`
  const task = state.prompt.length > 160 ? `${state.prompt.slice(0, 160)}…` : state.prompt
  return [
    `session    ${state.sessionID}`,
    `iteration  ${cap}`,
    `elapsed    ${seconds}s`,
    `finish     <promise>${state.completionPromise}</promise>`,
    ...(state.abortPromise ? [`abort      <promise>${state.abortPromise}</promise>`] : []),
    `task       ${task}`,
  ].join("\n")
}