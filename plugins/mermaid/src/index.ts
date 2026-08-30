import { Plugin } from "@opencode-ai/plugin"
import { compile } from "./compile-core.ts"
import { runDoctor } from "./doctor-core.ts"

// fazuh.mermaid — one plugin registering both Mermaid tools. V2 does not
// discover standalone files in ~/.config/opencode/tools/, but watched local
// plugin files here DO hot-reload - this registration is what makes the
// tools callable. Engines are shared siblings: compile-core / doctor-core.
export default Plugin.define({
  id: "fazuh.mermaid",
  setup: async (ctx) => {
    const baseDir = ctx.worktree || ctx.directory
    const extraDirs = [ctx.worktree, ctx.directory].filter(Boolean)
    await ctx.tool.transform((tools) => {
      tools.add({
        name: "mermaid-compile",
        description:
          "Compile a Mermaid .mmd diagram to PNG/SVG/PDF using mmdc (mermaid-cli). Validates the diagram and exports to docs/diagrams/ (or a custom output dir). Use whenever a .mmd file needs rendering, or after editing an existing diagram. Applies a roomy spacing preset unless the diagram carries its own %%{init}%% directive. PNG is the default output (SVG is fragile and breaks easily).",
        input: {
          type: "object",
          properties: {
            mmdPath: { type: "string", description: "Path to the .mmd source file (absolute, or relative to the project root)." },
            outputDir: { type: "string", description: "Output directory, relative to the project root (default: docs/diagrams)." },
            format: { type: "string", description: "Comma-separated output formats: svg, png, pdf (default: png)." },
            width: { type: "number", description: "Rendered width in px (default: 4096)." },
            theme: { type: "string", description: "Mermaid theme: default | dark | neutral | forest | base (default: default)." },
            backgroundColor: { type: "string", description: "Canvas background color (default: white)." },
            spacing: { type: "string", description: "Layout spacing preset: roomy | compact | none (default: roomy)." },
          },
          required: ["mmdPath"],
          additionalProperties: false,
        },
        execute: async (input) => {
          try {
            const report = await compile(
              {
                ...(typeof input.mmdPath === "string" ? { mmdPath: input.mmdPath } : {}),
                ...(typeof input.outputDir === "string" ? { outputDir: input.outputDir } : {}),
                ...(typeof input.format === "string" ? { format: input.format } : {}),
                ...(typeof input.width === "number" ? { width: input.width } : {}),
                ...(typeof input.theme === "string" ? { theme: input.theme } : {}),
                ...(typeof input.backgroundColor === "string" ? { backgroundColor: input.backgroundColor } : {}),
                ...(typeof input.spacing === "string" ? { spacing: input.spacing } : {}),
              },
              { baseDir },
            )
            return { content: report }
          } catch (error) {
            return {
              content: `❌ mermaid-compile failed: ${error instanceof Error ? error.message : String(error)}`,
            }
          }
        },
      })

      tools.add({
        name: "mermaid-doctor",
        description:
          "Validate Mermaid diagram syntax by parsing AND rendering every mermaid block in given files through headless Chromium + mermaid@11. Scans .html/.htm/.md/.markdown/.txt/.mmd (directories walked recursively). Reports per-diagram pass/fail with the parser's REAL error messages and file:line locations. Catches what naive checks miss: parse errors, render-time runtime errors, and blocks that silently fail to initialize. Use after writing or editing any HTML/Markdown containing mermaid diagrams.",
        input: {
          type: "object",
          properties: {
            paths: { type: "array", items: { type: "string" }, description: "Files OR directories to scan (.html .htm .md .markdown .txt .mmd; directories recursive). Required unless raw is given." },
            raw: { type: "string", description: "Validate a single diagram source directly instead of scanning files." },
            render: { type: "boolean", description: "After parse, also fully render (catches runtime errors parse misses). Default true." },
            timeout_ms: { type: "number", description: "Overall page budget guard in ms. Default 15000." },
          },
          additionalProperties: false,
        },
        execute: async (input) => {
          try {
            const paths = Array.isArray(input.paths) ? input.paths.map(String).filter(Boolean) : undefined
            const raw = input.raw !== undefined && input.raw !== null ? String(input.raw) : undefined
            if (!raw?.trim() && !paths?.length) {
              return { content: "No input: provide paths (files/directories) or raw diagram source." }
            }
            const args = {
              ...(paths?.length ? { paths } : {}),
              ...(raw?.trim() ? { raw } : {}),
              ...(typeof input.render === "boolean" ? { render: input.render } : {}),
              ...(typeof input.timeout_ms === "number" ? { timeout_ms: input.timeout_ms } : {}),
            }
            const { report } = await runDoctor(args, { baseDir, extraDirs })
            return { content: report }
          } catch (error) {
            return {
              content: `❌ mermaid-doctor failed: ${error instanceof Error ? error.message : String(error)}`,
            }
          }
        },
      })
    })
  },
})
