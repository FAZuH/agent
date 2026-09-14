#!/usr/bin/env bun
// oc-plugin-load.mjs — load OpenCode v2 plugins out of process and report what
// they register, without touching the running service.
//
//   oc-plugin-load.mjs <plugins-dir> [name...]
//   oc-plugin-load.mjs ~/Projects/agent/plugins
//   oc-plugin-load.mjs .opencode/plugins my-tool.js
//
// Why: a plugin can be loaded, listed as healthy by /api/plugin, and still be
// dead — a global plugin's setup ctx has no string project path, so the v1
// `ctx.worktree || ctx.directory` idiom hands downstream code an object and
// every call dies. Nothing else catches that until a user hits the tool.
//
// Exit codes: 0 all loaded clean · 1 a plugin failed to load/register, or a
// source still reads ctx.worktree / ctx.directory.

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

// Shape captured from a live v2.0.3 setup ctx (2026-09-13). Anything the
// plugin reaches for that this fake does not model is recorded and answered
// with an inert callable, so an unmodelled API shows up as a note instead of
// crashing the check.
function stub(name, hits) {
  const fn = (...args) => {
    hits.push(name + "()");
    return Promise.resolve(undefined);
  };
  return new Proxy(fn, {
    get: (_t, k) => (typeof k === "symbol" || k === "then" ? undefined : stub(`${name}.${String(k)}`, hits)),
  });
}

const FAKE_CTX = () => {
  const touched = new Set();
  const hits = [];
  const registered = { tools: [], commands: [], hooks: [] };
  const transform = (kind) => (fn) =>
    fn({
      add: (t) => registered[kind].push(t),
      update: (t) => registered[kind].push(t),
      remove: () => {},
      all: [],
    });
  const hook = (ns) => async (kind) => {
    registered.hooks.push(`${ns}.${kind}`);
    return () => {};
  };
  const base = {
    worktree: {},
    directory: undefined,
    location: { directory: process.cwd(), project: null },
    options: {},
    tool: { transform: transform("tools"), hook: hook("tool") },
    command: { transform: transform("commands") },
    session: { hook: hook("session"), prompt: async () => ({}) },
    state: {
      read: async () => undefined,
      write: async () => undefined,
      subscribe: async () => () => {},
    },
  };
  const ctx = new Proxy(base, {
    get(t, k) {
      if (typeof k === "symbol") return t[k];
      if (k in t) return t[k];
      touched.add(String(k));
      return stub(String(k), hits);
    },
  });
  return { ctx, registered, touched };
};

const BAD_IDIOM = /\b(?:t?ctx)(\?)?\.(worktree|directory)\b/;

// Comments talk about the idiom ("ctx.worktree is {} in v2") far more often
// than code does, so strip them before scanning — blanking each block comment
// in place, since deleting it would shift every line number after it.
const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ""))
    .split("\n")
    .map((l) => (l.trimStart().startsWith("*") || l.trimStart().startsWith("//") ? "" : l.replace(/\/\/.*$/, "")))
    .join("\n");

function sources(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d)) {
      if (e === "node_modules" || e.startsWith(".")) continue;
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|js|mjs)$/.test(e)) out.push(p);
    }
  };
  walk(dir);
  return out;
}

/** Files under scanDir whose code — not comments — still reads the v1 idiom. */
function idiomHitsIn(scanDir, relBase) {
  return sources(scanDir)
    .filter((s) => !s.endsWith("oc-plugin-load.mjs"))
    .flatMap((s) =>
      stripComments(readFileSync(s, "utf8"))
        .split("\n")
        .map((l, i) => ({ l, i }))
        .filter(({ l }) => BAD_IDIOM.test(l))
        .map(({ l, i }) => `${s.slice(relBase.length + 1)}:${i + 1}`),
    );
}

// The scanner's own check: the hit below sits under a seven-line block
// comment, so a comment stripper that deletes the comment reports it early.
const FIXTURE = `/**
 * doc comment mentioning ctx.worktree and ctx.directory, which must not be
 * reported, and long enough that
 * shifting
 * line
 * numbers
 */
export default {
  id: "fixture",
  setup: async (ctx) => ctx.worktree || ctx.directory,
}`;

if (process.argv[2] === "--self-test") {
  const dir = mkdtempSync(join(tmpdir(), "ocpl-"));
  const plugin = join(dir, "fixture");
  mkdirSync(plugin);
  writeFileSync(join(plugin, "index.js"), FIXTURE);
  const got = idiomHitsIn(plugin, dir);
  const want = ["fixture/index.js:10"];
  const pass = got.join() === want.join();
  console.log(`${pass ? "PASS" : "FAIL"} ${got.join(", ") || "(no hits)"}${pass ? "" : ` — want ${want.join(", ")}`}`);
  rmSync(dir, { recursive: true, force: true });
  process.exit(pass ? 0 : 1);
}

const root = resolve(process.argv[2] ?? ".");
if (!statSync(root, { throwIfNoEntry: false })?.isDirectory()) {
  console.error(`not a directory: ${root}`);
  process.exit(1);
}

const picks = process.argv.slice(3);
const entries = readdirSync(root)
  .filter((n) => !n.startsWith("."))
  .filter((n) => (picks.length ? picks.includes(n) : true))
  .flatMap((n) => {
    const p = join(root, n);
    if (statSync(p).isFile()) {
      return /\.(ts|js|mjs)$/.test(n) ? [{ name: n, file: p }] : [];
    }
    const index = ["index.ts", "index.js", "server.ts"].find((f) =>
      existsSync(join(p, f)),
    );
    return index ? [{ name: n, file: join(p, index) }] : [];
  });

let bad = 0;
for (const { name, file } of entries) {
  const idiomHits = idiomHitsIn(
    name === file.split("/").pop() ? root : join(root, name),
    root,
  );

  let mod;
  try {
    mod = (await import(file)).default;
  } catch (e) {
    console.log(`FAIL ${name}\n  import: ${String(e.message).split("\n")[0]}`);
    bad++;
    continue;
  }
  if (!mod?.id || typeof mod.setup !== "function") {
    console.log(`FAIL ${name}\n  default export needs {id, setup}; got id=${mod?.id}`);
    bad++;
    continue;
  }
  const { ctx, registered, touched } = FAKE_CTX();
  try {
    await mod.setup(ctx);
  } catch (e) {
    console.log(`FAIL ${mod.id}\n  setup threw: ${String(e.message).split("\n")[0]}`);
    bad++;
    continue;
  }
  const ok =
    !idiomHits.length &&
    (registered.tools.length || registered.commands.length || registered.hooks.length);
  console.log(
    `${ok ? "OK  " : "WARN"} ${mod.id}\n  tools:    ${registered.tools.map((t) => t.name).join(", ") || "-"}\n` +
      `  commands: ${registered.commands.map((t) => t.name ?? t.id ?? "?").join(", ") || "-"}\n` +
      `  hooks:    ${registered.hooks.join(", ") || "-"}` +
      (touched.size ? `\n  ctx keys this fake does not model (answered with an inert stub): ${[...touched].join(", ")}` : "") +
      (idiomHits.length ? `\n  v1 path idiom (ctx.worktree/ctx.directory is not a string in v2):\n    ${idiomHits.join("\n    ")}` : ""),
  );
  if (idiomHits.length) bad++;
}
console.log(`\n${entries.length} entries, ${bad} problem(s).`);
process.exit(bad ? 1 : 0);
