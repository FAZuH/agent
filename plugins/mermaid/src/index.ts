import { compile } from "./compile-core.ts"
import { runDoctor } from "./doctor-core.ts"

// fazuh.mermaid — one plugin registering both Mermaid tools. V2 does not
// discover standalone files in ~/.config/opencode/tools/, but watched local
// plugin files here DO hot-reload - this registration is what makes the
// tools callable. Engines are shared siblings: compile-core / doctor-core.
// Modern plugin module shape (beta-19124 dropped the legacy `Plugin` helper
// export from @opencode-ai/plugin — plain {id, setup} is the supported form).
export default {
  id: "fazuh.mermaid",
  setup: async (ctx) => {
    // This plugin loads globally, so its own setup ctx has no string project
    // path (ctx.worktree is an empty object, ctx.directory undefined) — the
    // calling session's project is resolved per call instead. The lookup must
    // stay async: a synchronous call back into this same server deadlocks.
    const setupBase =
      typeof ctx.location?.directory === "string" && ctx.location.directory
        ? ctx.location.directory
        : process.cwd()
    const projectDirs = new Map()

    async function projectDir(tctx) {
      const sid = typeof tctx?.sessionID === "string" ? tctx.sessionID : ""
      if (!sid) return setupBase
      const hit = projectDirs.get(sid)
      if (hit) return hit
      let dir = setupBase
      try {
        const proc = Bun.spawn(["opencode2", "api", "get", `/api/session/${sid}`], {
          stdout: "pipe",
          stderr: "ignore",
        })
        const out = await new Response(proc.stdout).text()
        await proc.exited
        const found = JSON.parse(out)?.data?.location?.directory
        if (typeof found === "string" && found) dir = found
      } catch {}
      projectDirs.set(sid, dir)
      return dir
    }

    await ctx.tool.transform((tools) => {
      tools.add({
        name: "mermaid-compile",
        description:
          "Compile a Mermaid .mmd diagram to PNG/SVG/PDF with mmdc and export it to docs/diagrams/. Use whenever a .mmd file needs rendering, or after editing an existing diagram. PNG is the default format (SVG breaks easily in downstream viewers).",
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
        execute: async (input, tctx) => {
          try {
            const baseDir = await projectDir(tctx)
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
          "Validate Mermaid syntax in the given files by parsing AND rendering every diagram through headless Chromium + mermaid@11 (rendering is what catches blocks that parse but never initialize). Reports per-diagram pass/fail with the parser's real error and file:line. Use after writing or editing any HTML/Markdown containing mermaid diagrams.",
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
        execute: async (input, tctx) => {
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
            return { content: await runDoctor(args, { baseDir: await projectDir(tctx) }) }
          } catch (error) {
            return {
              content: `❌ mermaid-doctor failed: ${error instanceof Error ? error.message : String(error)}`,
            }
          }
        },
      })
    })
  },
}
