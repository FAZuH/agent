# plugins/tui — TUI discovery shims (STALE — dead on beta-19086)

> **STALE as of 2026-09-05.** The `plugins/tui/` scan directory stopped working
> in opencode2 beta-19086: these shims are never imported anymore (verified by
> marker probes). The mechanism that replaced it: a local dir plugin's TUI
> entrypoint is now resolved as `<plugin-dir>/tui.ts` at the plugin dir ROOT
> (package.json `exports: {"./tui": ...}` is only consulted for package
> installs). The live shims are now `plugins/md-link/tui.ts` and
> `plugins/viz/tui.ts`. See findings.md `[2026-09-05] tui` for the full
> evidence. The files below are kept only as historical reference / downgrade
> safety — delete freely.

The files here exist because of an OpenCode v2 CLI discovery quirk (verified
2026-08-28 in commit `acd8c1c` of the upstream learn repo):

> The CLI does not autoload the TUI side via `tui: true` for auto-discovered
> local `plugins/` directories. The CLI only autoloads TUI modules via
> `opencode.json` plugins with `tui: true`, `cli.json`, or this `plugins/tui/`
> scan directory.

Every plugin in this repo (`fazuh.*`) is an auto-discovered local directory,
not listed in `opencode.json` — so `plugins/tui/` is the only path that loads
their TUI commands (`ctrl+alt:m` / `/md-link`, `/viz-dir`).

Each shim is a thin re-export of its plugin's canonical `src/tui.ts`:

- `md-link.ts` → `plugins/md-link/src/tui.ts` (id `fazuh.md-link-tui`)
- `viz.ts` → `plugins/viz/src/tui.ts` (id `fazuh.viz-tui`)

Keep `tui: true` on the server plugins too: it makes the TUI loadable when a
plugin is published/installed as a package, without breaking the local path.