/**
 * Wayland clipboard, with X11 fallbacks for a session that runs through
 * XWayland. wl-copy exits after forking the process that owns the selection.
 */
import { spawnSync } from "node:child_process"

const tools: Array<[string, string[]]> = [
  ["wl-copy", []],
  ["xclip", ["-selection", "clipboard"]],
  ["xsel", ["--clipboard", "--input"]],
]

export function copyToClipboard(text: string): boolean {
  for (const [command, args] of tools) {
    // wl-copy forks a process that owns the selection. That child inherits
    // stdout/stderr, so a piped stdio would make spawnSync wait for it and
    // report ETIMEDOUT even though the copy succeeded.
    const result = spawnSync(command, args, { input: text, stdio: ["pipe", "ignore", "ignore"], timeout: 5000 })
    if (result.error && (result.error as NodeJS.ErrnoException).code === "ENOENT") continue
    if (result.status === 0 && !result.error) return true
  }
  return false
}
