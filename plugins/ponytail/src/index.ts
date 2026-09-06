// ponytail v2 adapter — bridges DietrichGebert/ponytail into the OpenCode v2
// plugin contract. Upstream ships only a V1 adapter (.opencode/plugins/ponytail.mjs,
// async fn export + experimental.chat.system.transform) which v2 refuses to load;
// upstream PRs #729/#734 are still unmerged. This shim reuses upstream's shared
// builders verbatim and registers them through v2 transforms/hooks.
//
// Upstream checkout: ./upstream (submodule → github.com/DietrichGebert/ponytail,
// update with git submodule update --remote plugins/ponytail/upstream, then
// cold-restart the service — nested require()s are not cache-busted by hot-reload).
// Override with PONYTAIL_DIR env var for a machine-level checkout.
//
// Deviations from the V1 adapter (documented, deliberate):
// - Commands only, no skill registration: skills/ponytail SKILL.md is the source
//   the instruction builder embeds every turn, so registering it as a skill would
//   duplicate the same text in every session's skill list.
// - /ponytail <mode> persists inside the command executor (v2 has no
//   command.execute.before); v1's same-turn semantics are preserved because the
//   context hook reads the flag file at dispatch time.

import fs from "fs"
import os from "os"
import path from "path"
import { createRequire } from "module"
import { fileURLToPath } from "url"

const PONYTAIL_DIR =
  process.env.PONYTAIL_DIR ||
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "upstream")

const require = createRequire(import.meta.url)
const { getPonytailInstructions } = require(path.join(PONYTAIL_DIR, "hooks", "ponytail-instructions.js"))
const { getDefaultMode, normalizePersistedMode } = require(path.join(PONYTAIL_DIR, "hooks", "ponytail-config.js"))
const { parseCommandFile } = require(path.join(PONYTAIL_DIR, ".opencode", "plugins", "ponytail-frontmatter.cjs"))

// Same flag file as the V1 adapter: mode state lives beside OpenCode's config.
const statePath = path.join(
  process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"),
  "opencode",
  ".ponytail-active",
)

function readMode() {
  try {
    return normalizePersistedMode(fs.readFileSync(statePath, "utf8").trim()) || getDefaultMode()
  } catch {
    return getDefaultMode()
  }
}

function writeMode(mode) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true })
  fs.writeFileSync(statePath, mode)
}

export default {
  id: "fazuh.ponytail",
  setup: async (ctx) => {
    // Register the six upstream command templates as v2 commands.
    const commandDir = path.join(PONYTAIL_DIR, ".opencode", "command")
    for (const file of fs.readdirSync(commandDir).filter((f) => f.endsWith(".md"))) {
      const name = path.basename(file, ".md")
      const parsed = parseCommandFile(path.join(commandDir, file))
      if (!parsed) continue
      await ctx.command.transform((draft) => {
        draft.add({
          name,
          description: parsed.description,
          execute: async (input) => {
            // beta-19157: session.prompt rejects omitted attachment arrays.
            if (name === "ponytail") {
              const args = String(input.prompt.text || "").trim()
              writeMode(normalizePersistedMode(args) || getDefaultMode())
            }
            await ctx.session.prompt({
              ...input.prompt,
              files: input.prompt.files ?? [],
              agents: input.prompt.agents ?? [],
              skills: input.prompt.skills ?? [],
              sessionID: input.sessionID,
              text: parsed.template.replaceAll("$ARGUMENTS", () => input.prompt.text.trim()),
              delivery: input.delivery,
            })
          },
        })
      })
    }

    // Inject the active-mode ruleset into every model dispatch (any agent,
    // including subagents — all sessions dispatch through this hook).
    // LLM.SystemPart requires { type: "text", text } — the build/plugins docs
    // example shows { text } alone, but the runtime schema rejects it
    // (SchemaError MissingKey "type" → "Failed to drain Session" on every turn).
    await ctx.session.hook("context", async (event) => {
      const mode = readMode()
      if (mode === "off") return
      event.system.push({ type: "text", text: getPonytailInstructions(mode) })
    })
  },
}
