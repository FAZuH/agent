import {
  buildAddArgs,
  buildEditArgs,
  buildToggleArgs,
  runOctask,
  type AddInput,
  type EditInput,
} from "./shared.ts"

const nameField = {
  type: "string",
  description: "Task name (the part after octask-).",
}
const nameSchema = {
  type: "object",
  properties: { name: nameField },
  required: ["name"],
  additionalProperties: false,
}

function addSchema(edit: boolean) {
  const properties: Record<string, unknown> = {
    name: nameField,
    schedule: {
      type: "string",
      description: "OnCalendar expression, e.g. '*-*-* 09:00:00'.",
    },
    workdir: { type: "string", description: "Directory whose opencode.json and MCP config the job loads." },
    agent: { type: "string", description: "Agent id for an agent task." },
    prompt: { type: "string", description: "Prompt for an agent task." },
    exec: { type: "string", description: "Shell command for an exec task (instead of agent/prompt/workdir)." },
    model: { type: "string", description: "Override the agent model for this job." },
    description: { type: "string" },
    delay: { type: "string", description: "RandomizedDelaySec timespan, e.g. '30min'." },
    timeout: { type: "string", description: "Timeout in seconds." },
    persistent: { type: "boolean", description: "Catch up after the machine was off." },
    dirty_only: { type: "boolean", description: "Skip when the workdir git tree is clean." },
  }
  if (edit) {
    Object.assign(properties, {
      no_model: { type: "boolean" },
      no_delay: { type: "boolean" },
      no_persistent: { type: "boolean" },
      no_dirty_only: { type: "boolean" },
      clear_credentials: { type: "boolean" },
      dry_run: { type: "boolean", description: "Show a diff without writing." },
    })
  } else {
    Object.assign(properties, {
      no_enable: { type: "boolean", description: "Write units but do not enable the timer." },
      force: { type: "boolean", description: "Replace existing units." },
    })
  }
  return { type: "object", properties, required: ["name"], additionalProperties: false }
}

const toggleSchema = {
  type: "object",
  properties: {
    name: nameField,
    all: { type: "boolean", description: "Apply to every managed task." },
    dry_run: { type: "boolean" },
  },
  additionalProperties: false,
}

export default {
  id: "fazuh.octask",
  setup: async (ctx: any) => {
    await ctx.tool.transform((tools: any) => {
      tools.add({
        name: "octask_list",
        description:
          "List every octask-managed systemd timer with kind, schedule, next run, enabled and failed state. Use this first to see what is scheduled.",
        input: { type: "object", properties: {}, additionalProperties: false },
        execute: async () => ({ content: await runOctask(["list", "--json"]) }),
      })

      tools.add({
        name: "octask_show",
        description: "Show the full parsed configuration of one managed task.",
        input: nameSchema,
        execute: async (input: any) => ({
          content: await runOctask(["show", input.name, "--json"]),
        }),
      })

      tools.add({
        name: "octask_status",
        description: "Show timer and service status for one managed task.",
        input: nameSchema,
        execute: async (input: any) => ({
          content: await runOctask(["status", input.name, "--json"]),
        }),
      })

      tools.add({
        name: "octask_logs",
        description: "Recent journal lines for a managed task's service.",
        input: {
          type: "object",
          properties: {
            name: nameField,
            lines: { type: "number", description: "Number of lines (default 50)." },
          },
          required: ["name"],
          additionalProperties: false,
        },
        execute: async (input: any) => ({
          content: await runOctask(["logs", input.name, "-n", String(input.lines ?? 50)]),
        }),
      })

      tools.add({
        name: "octask_schedule",
        description:
          "Create a recurring systemd user timer that runs an OpenCode agent or a shell command. Set agent, prompt and workdir for an agent job, or exec for a command job. Prefer --dry-run on update when changing existing jobs.",
        input: addSchema(false),
        execute: async (input: AddInput) => {
          const built = buildAddArgs(input)
          if (!built.ok) return { content: `octask_schedule failed: ${built.error}` }
          return { content: await runOctask(built.args) }
        },
      })

      tools.add({
        name: "octask_update",
        description: "Change the schedule, prompt, model or flags of an existing managed task.",
        input: addSchema(true),
        execute: async (input: EditInput) => {
          const built = buildEditArgs(input)
          if (!built.ok) return { content: `octask_update failed: ${built.error}` }
          return { content: await runOctask(built.args) }
        },
      })

      tools.add({
        name: "octask_delete",
        description: "Stop, disable and delete a managed task's units. Use dry_run first.",
        input: {
          type: "object",
          properties: {
            name: nameField,
            dry_run: { type: "boolean" },
          },
          required: ["name"],
          additionalProperties: false,
        },
        execute: async (input: any) => ({
          content: await runOctask([
            "remove",
            input.name,
            ...(input.dry_run === true ? ["--dry-run"] : []),
          ]),
        }),
      })

      tools.add({
        name: "octask_run",
        description: "Run a managed task's service now, without waiting for its timer.",
        input: nameSchema,
        execute: async (input: any) => ({ content: await runOctask(["run", input.name]) }),
      })

      for (const verb of ["enable", "disable"] as const) {
        tools.add({
          name: `octask_${verb}`,
          description: `${verb[0].toUpperCase()}${verb.slice(1)} one timer, or every managed timer with all=true.`,
          input: toggleSchema,
          execute: async (input: any) => {
            const built = buildToggleArgs(verb, input)
            if (!built.ok) return { content: `octask_${verb} failed: ${built.error}` }
            return { content: await runOctask(built.args) }
          },
        })
      }

      tools.add({
        name: "octask_pause",
        description:
          "Disable every managed timer and remember which ones were enabled. Use octask_resume to restore exactly that set.",
        input: { type: "object", properties: {}, additionalProperties: false },
        execute: async () => ({ content: await runOctask(["pause"]) }),
      })

      tools.add({
        name: "octask_resume",
        description: "Restore the timers that were enabled before octask_pause.",
        input: { type: "object", properties: {}, additionalProperties: false },
        execute: async () => ({ content: await runOctask(["resume"]) }),
      })
    })
  },
}
