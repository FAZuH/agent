import path from "path"

// mermaid-compile engine: validate + export a .mmd via mmdc.
// Registered by ./index.ts (the single fazuh.mermaid plugin).

const DEFAULT_OUTPUT_DIR = "docs/diagrams"
const DEFAULT_WIDTH = 4096
const DEFAULT_THEME = "default"
const DEFAULT_BG = "white"
const DEFAULT_FORMAT = "png"

const FORMATS = new Set(["svg", "png", "pdf"])

export const SPACING_PRESETS: Record<string, Record<string, unknown> | null> = {
  roomy: {
    layout: { nodeSpacing: 140, rankSpacing: 220 },
    stateDiagram: { padding: 80, textHeight: 30 },
  },
  compact: {
    layout: { nodeSpacing: 40, rankSpacing: 80 },
    stateDiagram: { padding: 20 },
  },
  none: null,
}

export interface CompileArgs {
  mmdPath?: string
  outputDir?: string
  format?: string
  width?: number
  theme?: string
  backgroundColor?: string
  spacing?: string
}

async function mmdc(args: string[]): Promise<{ ok: boolean; stderr: string }> {
  const proc = Bun.spawn(["mmdc", ...args], { stdout: "pipe", stderr: "pipe" })
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  const exit = await proc.exited
  return { ok: exit === 0, stderr }
}

export async function compile(
  args: CompileArgs,
  opts: { baseDir?: string },
): Promise<string> {
  const baseDir = opts.baseDir || process.cwd()
  const resolve = (p: string) => (path.isAbsolute(p) ? p : path.resolve(baseDir, p))

  if (!args.mmdPath?.trim()) {
    return "Error: mmdPath is required"
  }
  const mmdPath = resolve(args.mmdPath.trim())
  const outDir = resolve(args.outputDir?.trim() || DEFAULT_OUTPUT_DIR)

  const input = Bun.file(mmdPath)
  if (!(await input.exists())) {
    return `Error: .mmd file not found at ${mmdPath}`
  }

  const formats = (args.format ?? DEFAULT_FORMAT)
    .split(",")
    .map((f) => f.trim().toLowerCase())
    .filter((f) => FORMATS.has(f))
  if (formats.length === 0) {
    return "Error: format must be one or more of: svg, png, pdf"
  }

  await Bun.$`mkdir -p ${outDir}`.nothrow().quiet()

  const mmdContent = await input.text()

  const spacing = (args.spacing ?? "roomy").toLowerCase()
  let configFile: string | null = null
  if (SPACING_PRESETS[spacing] && !mmdContent.includes("%%{init")) {
    const cfgPath = path.join("/tmp", "opencode", `mermaid-config-${Date.now()}.json`)
    await Bun.$`mkdir -p /tmp/opencode`.nothrow().quiet()
    await Bun.write(cfgPath, JSON.stringify(SPACING_PRESETS[spacing]))
    configFile = cfgPath
  }

  const basename = path.basename(mmdPath, ".mmd")
  const written: string[] = []
  const errors: string[] = []

  for (const format of formats) {
    const outFile = path.join(outDir, `${basename}.${format}`)
    const extra = configFile ? ["--configFile", configFile] : []
    const { ok, stderr } = await mmdc([
      "-i",
      mmdPath,
      "-o",
      outFile,
      "-w",
      String(args.width ?? DEFAULT_WIDTH),
      "--backgroundColor",
      args.backgroundColor ?? DEFAULT_BG,
      "--theme",
      args.theme ?? DEFAULT_THEME,
      ...extra,
    ])
    if (ok) {
      written.push(outFile)
    } else {
      errors.push(`Format ${format}: ${stderr.trim()}`)
    }
  }

  if (written.length === 0) {
    return `Compile failed for ${mmdPath}. Errors:\n${errors.join("\n\n")}\nFix the .mmd and retry.`
  }

  const lines = written.map((f) => `- ${f}`)
  if (errors.length > 0) {
    lines.push("", "Partial failures:", ...errors)
  }
  return lines.join("\n")
}
