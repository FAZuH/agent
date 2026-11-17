export type ArgResult = { ok: true; args: string[] } | { ok: false; error: string }

export type AddInput = {
  name?: unknown
  schedule?: unknown
  workdir?: unknown
  agent?: unknown
  prompt?: unknown
  exec?: unknown
  model?: unknown
  description?: unknown
  delay?: unknown
  timeout?: unknown
  persistent?: unknown
  dirty_only?: unknown
  no_enable?: unknown
  force?: unknown
}

export type EditInput = AddInput & {
  no_model?: unknown
  no_delay?: unknown
  no_persistent?: unknown
  no_dirty_only?: unknown
  clear_credentials?: unknown
  dry_run?: unknown
}

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined

const flag = (args: string[], name: string, value: unknown) => {
  const v = text(value)
  if (v) args.push(name, v)
}

const toggle = (args: string[], name: string, value: unknown) => {
  if (value === true) args.push(name)
}

function common(args: string[], input: AddInput, mode: "add" | "edit"): ArgResult {
  const name = text(input.name)
  if (!name) return { ok: false, error: "name is required" }

  const exec = text(input.exec)
  if (exec) {
    if (mode === "edit") return { ok: false, error: "exec is only valid when adding a task" }
    args.push("--exec", exec)
  } else {
    const agent = text(input.agent)
    const prompt = text(input.prompt)
    const workdir = text(input.workdir)
    if (mode === "add" && (!agent || !prompt || !workdir)) {
      return {
        ok: false,
        error: "agent, prompt and workdir are required for an agent task (or pass exec)",
      }
    }
    flag(args, "--agent", agent)
    flag(args, "--prompt", prompt)
    flag(args, "--workdir", workdir)
  }

  flag(args, "--oncalendar", input.schedule)
  flag(args, "--model", input.model)
  flag(args, "--description", input.description)
  flag(args, "--delay", input.delay)
  flag(args, "--timeout", input.timeout)
  toggle(args, "--persistent", input.persistent)
  toggle(args, "--dirty-only", input.dirty_only)
  toggle(args, "--no-enable", input.no_enable)
  toggle(args, "--force", input.force)
  return { ok: true, args }
}

export function buildAddArgs(input: AddInput): ArgResult {
  const args = ["add"]
  const result = common(args, input, "add")
  if (!result.ok) return result
  const name = text(input.name)!
  return { ok: true, args: [args[0], name, ...args.slice(1)] }
}

export function buildEditArgs(input: EditInput): ArgResult {
  const name = text(input.name)
  if (!name) return { ok: false, error: "name is required" }
  const args = ["edit"]
  const result = common(args, input, "edit")
  if (!result.ok) return result
  toggle(args, "--no-model", input.no_model)
  toggle(args, "--no-delay", input.no_delay)
  toggle(args, "--no-persistent", input.no_persistent)
  toggle(args, "--no-dirty-only", input.no_dirty_only)
  toggle(args, "--clear-credentials", input.clear_credentials)
  toggle(args, "--dry-run", input.dry_run)
  return { ok: true, args: [args[0], name, ...args.slice(1)] }
}

export function buildToggleArgs(verb: "enable" | "disable", input: {
  name?: unknown
  all?: unknown
  dry_run?: unknown
}): ArgResult {
  const args = [verb]
  const name = text(input.name)
  if (input.all === true) {
    if (name) return { ok: false, error: "give a name or all, not both" }
    args.push("--all")
  } else if (name) {
    args.push(name)
  } else {
    return { ok: false, error: "name or all is required" }
  }
  toggle(args, "--dry-run", input.dry_run)
  return { ok: true, args }
}

export function octaskBin(): string {
  if (process.env.OCTASK_BIN) return process.env.OCTASK_BIN
  const home = process.env.HOME
  return home ? `${home}/.cargo/bin/octask` : "octask"
}

export async function runOctask(args: string[]): Promise<string> {
  const binary = octaskBin()
  try {
    const proc = Bun.spawn([binary, ...args], { stdout: "pipe", stderr: "pipe" })
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ])
    const code = await proc.exited
    const body = stdout.trim()
    if (code !== 0) {
      return `octask failed (exit ${code}): ${stderr.trim() || body || "no output"}`
    }
    return body || "ok"
  } catch (error) {
    return `octask failed: ${error instanceof Error ? error.message : String(error)}`
  }
}
