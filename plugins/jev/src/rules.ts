/**
 * The rules file: a list of rules, each one scored against a tool call.
 *
 * The file is YAML, and YAML reads JSON, so one loader takes both. The
 * parser is the host's own, when it has one: `Bun.YAML` on a recent Bun,
 * `JSON.parse` otherwise. A YAML file on a host without `Bun.YAML` is an
 * error that names the fix rather than a stack trace.
 *
 * A rule is a filter plus a sentence:
 *
 *   - id: no-exfil
 *     match: { action: shell, resource: "curl *" }
 *     text: "The command uploads local data to a remote host."
 *     threshold: 0.7      # optional, overrides the global bar
 *     effect: block       # optional, overrides the global action
 *
 * `match` is the filter: `action` is a permission action (or a tool alias),
 * `resource` is a whole-value wildcard. Both are optional, and a rule with
 * neither applies to every call the feature examines.
 *
 * `text` is the question the model is asked. A `{file:<path>}` marker in it
 * is replaced with that file's contents, so a rule can quote the policy it
 * enforces. A file that cannot be read skips its rule: a missing reference
 * must never block a call.
 */

import { readFileSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { isAbsolute, join, resolve } from "node:path"

/** One rule, after validation. */
export interface Rule {
  id: string
  match: { action?: string; resource?: string }
  text: string
  threshold?: number
  effect?: "block" | "propagate"
}

/** What a violated rule does. */
export type RuleEffect = "block" | "propagate"

/** The parsed file, with the source it came from. */
export interface RuleSet {
  rules: Rule[]
  path: string
  /** Set when the file could not be read or parsed. The feature then does nothing. */
  error?: string
}

const EFFECTS: RuleEffect[] = ["block", "propagate"]

/** The YAML parser, when the host has one. */
function yaml(): { parse: (text: string) => unknown } | null {
  const bun = (globalThis as any).Bun
  return bun?.YAML?.parse ? (bun.YAML as { parse: (text: string) => unknown }) : null
}

/** Which parser is live, for the status output. */
export function parserName(): string {
  return yaml() ? "yaml" : "json"
}

/** `~` and a relative path resolve against the home directory. */
export function expandPath(path: string): string {
  const text = path.trim()
  if (!text) return text
  if (text === "~") return homedir()
  if (text.startsWith("~/")) return join(homedir(), text.slice(2))
  return text
}

/**
 * Parse a rules file. Throws with a message that names the rule and the
 * field at fault, so a typo in a policy file is loud instead of silent.
 */
export function parseRules(text: string): Rule[] {
  const parser = yaml()
  let raw: unknown
  if (parser) {
    try {
      raw = parser.parse(text)
    } catch (error) {
      throw new Error(`rules file is not valid YAML: ${error instanceof Error ? error.message : String(error)}`)
    }
  } else {
    try {
      raw = JSON.parse(text)
    } catch (error) {
      throw new Error(
        `rules file is not valid JSON and this host has no YAML parser: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
  if (raw === null || raw === undefined) return []
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as any).rules)
      ? (raw as any).rules
      : null
  if (!list) throw new Error("rules file must be a list of rules, or an object with a `rules` list")
  const rules = list.map((entry, index) => normalizeRule(entry, index))
  // The id is the question's key, so two rules cannot share one.
  const seen = new Set<string>()
  for (const rule of rules) {
    if (seen.has(rule.id)) throw new Error(`duplicate rule id: ${rule.id}`)
    seen.add(rule.id)
  }
  return rules
}

function normalizeRule(entry: unknown, index: number): Rule {
  const where = `rule ${index + 1}`
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error(`${where} is not an object`)
  const rule = entry as Record<string, unknown>
  const id = typeof rule.id === "string" && rule.id.trim() ? rule.id.trim() : ""
  if (!id) throw new Error(`${where} has no id`)
  if (typeof rule.text !== "string" || !rule.text.trim()) throw new Error(`rule ${id} has no text`)
  const known = new Set(["id", "match", "text", "threshold", "effect"])
  for (const key of Object.keys(rule)) {
    if (!known.has(key)) throw new Error(`rule ${id} has an unknown field: ${key}`)
  }
  const match: Rule["match"] = {}
  if (rule.match !== undefined) {
    if (!rule.match || typeof rule.match !== "object" || Array.isArray(rule.match)) throw new Error(`rule ${id} has a match that is not an object`)
    const m = rule.match as Record<string, unknown>
    for (const key of Object.keys(m)) {
      if (key !== "action" && key !== "resource") throw new Error(`rule ${id} has an unknown match field: ${key}`)
    }
    if (m.action !== undefined) {
      if (typeof m.action !== "string") throw new Error(`rule ${id} match.action is not text`)
      match.action = m.action
    }
    if (m.resource !== undefined) {
      if (typeof m.resource !== "string") throw new Error(`rule ${id} match.resource is not text`)
      match.resource = m.resource
    }
  }
  const out: Rule = { id, match, text: rule.text.trim() }
  if (rule.threshold !== undefined) {
    const value = Number(rule.threshold)
    if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`rule ${id} threshold is not a probability between 0 and 1`)
    out.threshold = value
  }
  if (rule.effect !== undefined) {
    if (typeof rule.effect !== "string" || !EFFECTS.includes(rule.effect as RuleEffect)) {
      throw new Error(`rule ${id} effect must be one of ${EFFECTS.join(", ")}`)
    }
    out.effect = rule.effect as RuleEffect
  }
  return out
}

/**
 * Whole-value wildcard matching, the host's dialect: `*` is any run of
 * characters, `?` is exactly one, and everything else is literal. A pattern
 * ending in ` *` also matches the bare value — `git status *` matches
 * `git status` and `git status --short`, but not `git-status`.
 */
export function matchesPattern(pattern: string, value: string): boolean {
  const source = pattern.endsWith(" *")
    ? `${escapeLiteral(pattern.slice(0, -2))}( .*)?`
    : pattern
        .split("")
        .map((ch) => (ch === "*" ? ".*" : ch === "?" ? "." : escapeLiteral(ch)))
        .join("")
  try {
    return new RegExp(`^${source}$`).test(value)
  } catch {
    return pattern === value
  }
}

function escapeLiteral(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** Whether a rule applies to a call: its action, and any of its resources. */
export function ruleApplies(rule: Rule, action: string, resources: string[]): boolean {
  if (rule.match.action !== undefined && !matchesPattern(rule.match.action, action)) return false
  if (rule.match.resource === undefined) return true
  return resources.some((resource) => matchesPattern(rule.match.resource!, resource))
}

/**
 * Replace every `{file:<path>}` marker with that file's contents. A path is
 * absolute or relative to `dir`. The result is capped, and a file that cannot
 * be read is reported so its rule can be skipped.
 */
export function expandFileRefs(text: string, dir: string, maxChars: number): { text: string; missing: string[] } {
  const missing: string[] = []
  let budget = maxChars
  const out = text.replace(/\{file:([^}]+)\}/g, (_match, raw: string) => {
    const path = raw.trim()
    if (!path) return ""
    const target = isAbsolute(path) ? path : resolve(dir, path)
    let body: string
    try {
      body = readFileSync(target, "utf8")
    } catch {
      missing.push(path)
      return ""
    }
    const room = Math.max(0, budget)
    const clipped = body.length > room ? `${body.slice(0, room)}\n[truncated]` : body
    budget -= clipped.length
    return clipped
  })
  return { text: out, missing }
}

let cached: { path: string; mtimeMs: number; rules: Rule[]; error?: string } | null = null

/**
 * The rules on disk, re-read only when the file moves. A missing file is not
 * an error: the feature simply has no rules to apply.
 */
export function loadRules(path: string): RuleSet {
  const target = expandPath(path)
  let mtimeMs = 0
  try {
    mtimeMs = statSync(target).mtimeMs
  } catch {
    cached = null
    return { rules: [], path: target }
  }
  if (cached && cached.path === target && cached.mtimeMs === mtimeMs) {
    return { rules: cached.rules, path: target, error: cached.error }
  }
  let rules: Rule[] = []
  let error: string | undefined
  try {
    rules = parseRules(readFileSync(target, "utf8"))
  } catch (err) {
    error = err instanceof Error ? err.message : String(err)
    rules = []
  }
  cached = { path: target, mtimeMs, rules, error }
  return { rules, path: target, error }
}

/** Test seam: forget the cached file. */
export function resetRulesCache(): void {
  cached = null
}
