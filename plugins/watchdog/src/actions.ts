/** Shared tool-name → permission-action mapping. One source for host and holds. */
export const ACTION_ALIASES: Record<string, string> = {
  bash: "shell",
  write: "edit",
  patch: "edit",
  apply_patch: "edit",
}

/** The action a tool name means, or the name itself. */
export function normalizeAction(action: string): string {
  const key = action.trim().toLowerCase()
  return ACTION_ALIASES[key] ?? key
}

/** Resource strings for a tool call, derived from its input when the host did
 *  not supply a permission event. Mirrors callInfo's string coercion. */
export function resourcesOf(input: unknown): string[] {
  if (!input || typeof input !== "object") return []
  const obj = input as Record<string, unknown>
  const out: string[] = []
  for (const key of ["filePath", "path", "file", "command", "pattern", "url"]) {
    const value = obj[key]
    if (typeof value === "string" && value.trim()) out.push(value)
  }
  return out
}
