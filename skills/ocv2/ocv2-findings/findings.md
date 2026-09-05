# OpenCode v2 findings

Findings log — one entry per testable claim, newest at the bottom.
Format defined in SKILL.md beside this file.

## [2026-08-24] tools: standalone files in ~/.config/opencode/tools/ are not discovered on v2
status: confirmed
source: live-test
evidence: mermaid-compile.ts sat in tools/ and never appeared in any tool catalog; adding plugins/mermaid-compile.ts that calls ctx.tool.transform((tools) => tools.add({name, description, input, execute})) made it callable in the same session. Working reference: plugins/mermaid-doctor.ts.
Registration on V2 happens only through a plugin's setup() via ctx.tool.transform; a default-exported tool({...}) in tools/ loads nothing by itself. Keep engines in a shared core file with two skins (tools/ thin adapter + plugins/ adapter), as mermaid-doctor does.

## [2026-08-24] plugins: watched local plugin files hot-reload without restart
status: confirmed
source: live-test
evidence: created plugins/mermaid-compile.ts mid-session; /api/plugin listed fazuh.mermaid-compile active and the Code Mode catalog picked up the tool within the same session, no restart.
Local plugin files under watched dirs (~/.config/opencode/plugins/) hot-reload on change. Config-entry (`plugins` in opencode.json) and npm-installed plugins do NOT hot-reload — changing those needs a restart.

## [2026-08-24] codemode: plugin-registered custom tools surface as tools["name"]
status: confirmed
source: live-test
evidence: after plugin registration, tools["mermaid-compile"] executed from Code Mode execute() and rendered a PNG.
Custom tools registered by plugins appear in the Code Mode catalog under their bare name. The catalog's own `search` helper is NOT callable inside execute (raises "Unknown tool 'search'") despite catalog instructions referencing it — papercut pc_9138c611a6c0 tracks that.

## [2026-08-24] skills: discovery order across roots, later wins
status: confirmed
source: docs
evidence: skill-doctor SKILL.md documents it and its scanner models these roots; consistent with observed shadowing of installed copies by config copies.
Order: built-ins < .claude < .agents < ~/.config/opencode/skills (config) < project .opencode < explicit skills-config. Among installed roots, config shadows agents. The source repo root (~/Projects/skills/skills) is never loaded directly — edits there need redeployment via npx skills add to take effect.

## [2026-08-24] tui: external TUI plugin module must default-export {id, setup}
status: confirmed
source: live-test + upstream-code
evidence: loader validation extracted from the opencode2 binary (`typeof e === "object" && typeof e.id === "string" && e.id.length > 0 && typeof e.setup === "function"`); bare function and `{id, tui}` shapes both rejected with "Invalid V2 TUI plugin module", `{id, setup}` shows "(configured)".
The v2 TUI plugin loader requires a default export `{ id: string, setup: Function }`. The `TuiPluginModule = {id?, tui}` shape in `@opencode-ai/plugin/dist/tui.d.ts` does NOT match what the installed beta binary validates — trust the binary over the .d.ts.

## [2026-08-24] tui: keymap.layer() only works inside a rendered component
status: confirmed
source: live-test + upstream-code
evidence: calling ctx.keymap.layer(...) directly in setup() loaded fine but the bind never fired; wrapping in ctx.ui.slot({append:"app", render: () => { ctx.keymap.layer(...); return null }}) made ctrl+alt+m and /md-link work (user-verified). Root cause per sst/opentui packages/keymap/src/solid/index.ts:107 — createLayer is useContext+createEffect scoped; outside a Solid owner it throws "Keymap.Provider is missing" which the plugin loader swallows.
Layer factory shape that works: `{ mode: "global", priority, enabled, commands: [{ id, title, description, group, bind, palette, slash: {name}, run }] }`. `mode:"global"` keeps binds active while dialogs are open; omitting mode gates to base state. `slash.name` registers the prompt slash command from the same command entry. No legacy `api.command.register` exists in v2.

## [2026-08-24] plugins: message.updated never fires; context hook is the only pre-dispatch text source
status: confirmed (superseded in part — see [2026-08-25] turn-completion entry: session.idle no longer fires on beta-1805x, use session.text.ended)
source: live-test
evidence: debug log at /tmp/opencode/md-link-debug.log showed 0 message.updated events across a full session; Object.keys(ctx.session) = [hook,create,get,switchAgent,switchModel,prompt,generate,command,synthetic,interrupt,rename,wait] — no messages()/client surface. session.idle fired on turn end AT THE TIME and ctx.session.hook("context") exposes user text before model dispatch.
For server-side plugins reacting to prompts/turns in this beta: enable-detect via `ctx.session.hook("context")`, mirror work by re-fetching messages (poll — see the external-events entry below). `noReply` on chat.message output is inert (upstream proposals unmerged).

## [2026-08-24] tui: plugin dialog API is promise-based (dialog.prompt/alert/confirm/select)
status: confirmed (binary-extracted; live test pending)
source: upstream-code
evidence: jBt() in the opencode2 binary — the plugin-facing ui.dialog is {show(render,onClose?), set, clear, alert({title,message}):Promise, confirm(...):Promise<bool>, prompt({title,description?,placeholder?,value?}):Promise<string>, select(...)}. prompt resolves with the typed value on confirm (auto-clears), undefined on cancel. The .d.ts's DialogPrompt component / dialog.replace do NOT exist at runtime — another case of trusting the binary over @opencode-ai/plugin types.
Input dialogs: `await ctx.ui.dialog.prompt({...})`. Cleanup-on-exit hooks (lifecycle.onDispose / signal abort) still live-verification pending.

## [2026-08-24] config: beta-18050 honors subagent_depth ONLY as experimental.subagent_depth
status: confirmed
source: live-test + upstream-code
evidence: top-level `"subagent_depth": 2` logged `path=$.subagent_depth kind=unsupported action="omitted unsupported legacy setting"` on every config load while implement→test spawns hit depth-limit; installed binary strings show the depth check reading `entries("experimental")?.subagent_depth ?? 1` with error text `Increase "experimental.subagent_depth"`; after adding `experimental.subagent_depth: 2`, `opencode2 debug config` parses it and zero normalization diagnostics fire.
Top-level key is dead weight on this build. DRIFT TRAP: dev branch has moved it BACK to top level (`packages/opencode/src/tool/task.ts` reads `cfg.subagent_depth ?? 1`; PR #37132 documents top level) — after future opencode2 updates, if depth-limit errors return, try moving the key out of `experimental`. Tracked by papercut pc_d83c3c46fd46; original symptom papercut pc_87ff91dd6ad7 resolved 2026-08-24.

## [2026-08-24] config: enabled_providers works via silent migration into experimental.policies
status: confirmed
source: live-test
evidence: `opencode2 debug config` output shows global config rendered with `"policies": [{"action":"provider.use","resource":"*","effect":"deny"},{"action":"provider.use","resource":"opencode","effect":"allow"},{"action":"provider.use","resource":"opencode-go","effect":"allow"}]` derived from `"enabled_providers": ["opencode","opencode-go"]`.
`enabled_providers` appears in NO V2 doc page (config or providers guide) yet IS honored — the normalizer rewrites it to a provider.use policy allowlist (deny-all + allows). Don't delete it thinking it's inert; treat policies as the canonical form going forward.

## [2026-08-24] plugins: duplicate `plugin` + `plugins` arrays make every plugin load twice
status: confirmed
source: live-test
evidence: server log showed TWO `msg="loading plugin"` events per configured plugin at identical timestamps (e.g. v5-live.js ×2 @ 15:35:09.631Z) while both arrays coexisted in opencode.json; after deleting the legacy singular `plugin` array, the hot reload at 15:41:56 loaded each plugin exactly once.
V1-era singular `plugin` is still honored alongside documented `plugins`, so keeping both doubles hook executions (double notifications, double transforms). Keep only the plural `plugins` array.

## [2026-08-24] config: session snapshots fail on repos with committed symlinks pointing into submodules
status: confirmed
source: live-test
evidence: repeated WARN `failed to capture snapshot cause="Git.OperationError: fatal: pathspec '.agents/skills/learn-profile/SKILL.md' is beyond a symbolic link"`; `git ls-files -s .agents` in ~/Workspaces/Notes shows mode `120000` for `.agents/skills/learn-profile` targeting `.agents/Alvarmethod/skills/learn-profile` inside a gitmodule.
Snapshot's targeted `git add <file>` cannot traverse a tracked symlink whose target leaves the worktree, so undo/revert coverage silently degrades for those paths. Fix repo-side (materialize the symlink) — OpenCode-side has no knob short of `"snapshots": false`.

## [2026-08-24] agents: depth≥2 "ask" permission prompts reportedly never surface (hangs)
status: unverified
source: secondhand
evidence: upstream issues #39112 and #43996 (plus #13715) report depth-2 subagents blocking forever on bash "ask" prompts that never reach the TUI; not reproduced locally because our implement/test chain uses explicit allow/deny rules only.
Until fixed upstream, avoid `"ask"` permission rules in agents reachable below depth 1 — prefer explicit allow/deny. Confirm by giving a depth-2 agent an ask rule and watching for the missing prompt.

## [2026-08-25] plugins: duplicate plugin id across discovery roots hard-throws and can take down TUI plugin init
status: confirmed
source: live-test + upstream-code + user-report
evidence: after copying md-link.ts to ~/.config/opencode/plugins/ while the same-id copy still existed in project .opencode/plugins/, the TUI stopped loading its plugins; binary has `this.plugins.some((t)=>t.plugin.id===e.id) throw Error('Plugin with id "..." is already registered')`. Removing the project copies restored TUI loading; /api/plugin shows one active vault.md-link. SECOND MANIFESTATION (2026-08-25, user-reported): the learn repo installed globally via symlinks WHILE the same repo was also present as the working directory's .opencode — same ids reachable from two roots in one session; OpenCode hung instead of throwing cleanly. Removing the .opencode self-link fixed it.
A plugin id must be unique across ALL discovery roots (global plugins/, project .opencode/plugins/, npm entries) — and that includes one repo symlinked into global AND used as a project's .opencode. When moving a plugin between roots, delete the old copy in the same step; installers should refuse the combination (learn's install.sh does).

## [2026-08-25] tui: tui-plugins/ is NOT a scanned directory; TUI modules need explicit cli.json entry
status: confirmed (SUPERSEDED 2026-09-05 — beta-19086 changed local-dir discovery to `<plugin-dir>/tui.ts`; see that entry)
source: live-test
evidence: "tui-plugins" appears 0 times in the opencode2 binary; ~/.config/opencode/tui-plugins/md-link-tui.ts loads only because it is listed in cli.json top-level "plugins". Server plugins in ~/.config/opencode/plugins/ load with NO config entry (vault.md-link is in no plugins list yet shows active via /api/plugin).
Server-shaped plugins auto-load from the standard plugin dirs; TUI-shaped modules do not auto-load from anywhere — register them in cli.json "plugins". Do not move TUI modules into auto-scanned plugin dirs: their {id, setup} shape passes both loaders' validation, and a TUI module running under the server process would hook process exit handlers.

## [2026-08-25] api: local service auth is HTTP Basic with username "opencode" + password from service.json
status: confirmed
source: live-test
evidence: curl to the opencode2 serve --service port returned 401; `-u "opencode:$PW"` with PW from ~/.config/opencode/service.json "password" field returned 200 on /api/plugin and /api/session. Bearer token and x-opencode-password headers both stayed 401.
To script against a running v2 service: find its port via `ss -tlnp | grep opencode2` (probe candidates for the 401 challenge), then `curl -u "opencode:$(jq -r .password ~/.config/opencode/service.json)" http://127.0.0.1:$PORT/api/...`. Useful endpoints seen: /api/plugin (per-plugin id/status/source/tui), /api/session (all sessions with time.updated).

## [2026-08-25] plugins: slash command invocations emit command.executed server-side — server handlers will fight a client toggle
status: confirmed
source: live-test
evidence: /tmp/opencode/md-link-tui-debug.log showed currentlyEnabled:true on every toggle press; the TUI plugin's OFF branch deleted the state entry, but invoking /md-link made opencode emit a command.executed/tui.command.execute event (name "md-link") which the server plugin's handler passed to enableSession() — re-adding the session between presses, so every toggle read ON and wrote OFF.
A slash command is NOT purely client-side unless NOTHING listens for its name on the server. When a TUI plugin implements a command as a pure toggle, remove/never-add server-side handlers keyed to that command name (command.executed, tui.command.execute, prompt-text matching) — they re-enable behind the toggle. State file should be the single writer of truth.

## [2026-08-25] api: turn-completion events changed — session.idle is gone, use session.text.ended
status: confirmed
source: live-test
evidence: after the 2026-08-25 service update, a full headless turn emitted NO session.idle/message.updated; the lifecycle now ends with session.execution.succeeded, and reply text arrives as session.text.ended with data:{sessionID, assistantMessageID, ordinal, text} (captured off the SSE feed). Also ctx.session.messages({sessionID}) returns count:0 in this build, so fetch-based collection is dead.
Mirroring/turn-end plugins should consume session.text.ended directly. Multiple parts per message share one assistantMessageID distinguished by ordinal — include ordinal in dedup markers.

## [2026-08-25] api: live event stream is GET /api/event (SSE), basic-auth protected
status: confirmed
source: live-test
evidence: curl -N -H "Accept: text/event-stream" -u "opencode:<pw>" http://127.0.0.1:<port>/api/event streams "data: {...}" frames (server.connected heartbeat etc.). /event and /sse serve the web UI HTML instead.
Wire-format questions about events can be answered without code changes by sniffing /api/event while driving a turn via `opencode2 run -s <sid> --format json`.

## [2026-08-25] plugins: editing a plugin does NOT re-run setup() — event loops keep old code until service restart
status: confirmed
source: live-test
evidence: md-link.ts edits at 00:39 kept producing old-handler log lines (inbox.delivered) at 00:44 under the same service; /api/plugin showed the new source path as active while the stale loop ran. Only after killing `opencode2 serve --service` (auto-respawned by next client run) did fresh setup entries appear and new handlers take effect.
"Hot-reload" re-registers the module for NEW contexts but never disposes old setup() closures with running subscriptions. After changing server-plugin behavior, restart the background service (kill it; clients respawn it).

## [2026-08-25] api: GET /api/session/<sid>/message — newest-first, cap 50, two text shapes
status: confirmed
source: live-test
evidence: opencode2 api get /api/session/<sid>/message returned items[0].time.created > items[-1] (newest-first) with exactly 50 items on a long session; message objects vary — some {type:"assistant", text:"..."} flat, others {type:"assistant", content:[{type:"text"|"reasoning", text}]} — both seen within one session.
Consumers must handle both shapes and iterate from index 0 for "latest". Works without auth hassle via `opencode2 api get <path>` (handles port discovery + basic auth itself); plain Bun.spawn of that CLI is a reliable bridge for TUI plugins that lack a working client surface.

## [2026-08-25] plugins: external server plugins receive NO session events on beta-1805x — poll the HTTP API instead
status: confirmed
source: live-test
evidence: after the 2026-08-25 auto-update, hooks.event and ctx.event.subscribe("session.text.ended") (both Stream.runForEach-driven and toAsyncIterable) never fired for session events across 9 server contexts (fs-canary instrumented), while GET /api/event SSE carried them fine; earlier the same build-day ctx.event.subscribe delivered everything. Mirroring was rewritten as a 2.5 s poller over `opencode2 api get /api/session/<sid>/message` + upsert-with-replace, verified end-to-end (catch-up, incremental append, keep-prune, stable checksums).
Do not build session-reactive server plugins on event delivery in this beta. Polling the message endpoint is immune: newest-first list capped ~50, dual text shapes (flat text | content[] parts), upsert-by-id handles in-flight partial replies. Latency = poll interval.

## [2026-08-25] config: opencode2 binary swap/downgrade procedure
status: confirmed
source: live-test
evidence: `npm view @opencode-ai/cli@0.0.0-beta-18050` + `npm pack --min-release-age=0 @opencode-ai/cli-linux-x64@0.0.0-beta-18050` → tarball `package/bin/opencode2` ELF; `install -m 755 … ~/.opencode/bin/opencode2`; `opencode2 --version` → v0.0.0-beta-18050.
The ~/.opencode/bin/opencode2 standalone is shipped as the `@opencode-ai/cli-linux-x64` npm platform package (same version string as `@opencode-ai/cli`). Downgrade/upgrade = npm pack that package at the target version and `install -m 755` over ~/.opencode/bin/opencode2 (existing .bak-<build> convention holds). Gotcha: user's npmrc min-release-age=7 makes npm resolve recently-published betas (<7d) as notarget even for exact versions — one-off `--min-release-age=0` on the pack command only, with explicit human request. Bun BuildIDs can match across versions; verify with sha256sum + `--version`, not file(1).

## [2026-08-25] plugins: custom tools CANNOT deliver image/file parts to the model on beta-1805x
status: confirmed
source: live-test
evidence: transform-registered tool returning {content:[{type:"text"},{type:"image",data:<b64>,mimeType:"image/png"}]} executes WITHOUT error, but the model receives ONLY the text part ("plain string, length 21 … no base64 payload"). Rejected outright with generic "Tool execution failed": {type:"file",mime,url:"file://…"}, {type:"file",mime,url:"<abs path>"}, {type:"file",url:"data:image/png;base64,…"} (all three fail result serialization), plus legacy {output, attachments:[…]}. Plain-string and {content:string} results work; execute-side errors surface as opaque "Tool execution failed" — wrap plugin tool bodies in try/catch returning diagnostics. Render-and-inspect loops must return a PNG PATH and have the agent open it with the native read tool (read presents images to models fine).
Do NOT build custom visual tools expecting inline image returns on this beta. Also: Bun.file(p).base64() does not exist in the bundled runtime — use Buffer.from(await Bun.file(p).arrayBuffer()).toString("base64").

## [2026-08-25] plugins: ctx.tool.hook("execute.after") DOES fire in external server plugins
status: confirmed
source: live-test
evidence: external global plugin registered ctx.tool.hook("execute.after", cb) in setup(); after killing opencode2 serve --service and letting it respawn, two headless-turn bash executions produced {"tool":"shell","status":"completed"} lines appended by the hook to an external log. Contrast with session events (never delivered externally) — TOOL hooks are a live transport for observing built-in tool results server-side on beta-1805x.
Viable basis for Q&A capture / audit plugins: hook fires for at least built-in shell; event carries {tool, status} (+result/error per docs). Requires service restart after editing setup() (hot-reload never re-runs setup).

## [2026-08-27] api: session forms wire protocol — the server↔TUI bridge for custom interactive tools
status: confirmed
source: live-test
evidence: 2026-08-25 built working graded-quiz pair (fazuh.learn-quiz) on it; 2026-08-27 re-probed after beta broke `label`: POST /api/session/:sid/form with `fields:[{key,type,label}]` silently drops `label` (persisted as {key,type,options} only, verified via `ses_fbd7c5dd6ffedKdGWOxUh2MDus` frm_04283bcae001… vs frm_04283beb4001…), while `fields:[{key,type,title,description}]` persists correctly; OpenAPI `GET /openapi.json` `Form.StringField`/`Form.MultiselectField`/`Form.CreatePayload` now require `title`+ optional `description` (no `label` at field level; `Form.Option.label` still valid). Create: POST /api/session/:sid/form {title, fields:[{key, type: "string"|"multiselect"|"boolean"|"integer"|"number", title, description?, options:[{label,value,description?}]}]} → {data:{id:"frm_…"}}; string+options renders as single-select, multiselect as multi. State: GET …/form/:fid/state → {status:"pending"|"answered"|"cancelled", answer:{key:value}}. Reply: POST …/form/:fid/reply {answer:{key:value}} → 204; partial answers (omitting optional fields) accepted; settled forms reject with FormAlreadySettledError. Cancel: POST …/form/:fid/cancel. List: GET /api/session/:sid/form (settled forms drop off). The BUILT-IN TUI renders arbitrary pending session forms generically — a plugin-created form shows up and is answerable with no custom TUI code. Built-in question tool input shape: {questions:[{question, header, options:[{label,description}]}]}.
GOTCHAS: (1) server-plugin ctx has NO form/client API (ctx keys: app,options,agent,aisdk,catalog,command,event,integration,mcp,plugin,reference,skill,storage,tool,websearch,session,shell) — call the forms API via `opencode2 api post <path> -d <json>` subprocess. (2) The headless `opencode2 run` client auto-DISMISSES pending forms ("The user dismissed this question") — answered-path testing must drive sessions via raw HTTP (POST /api/session, POST /api/session/:sid/prompt). (3) The TUI displays raw tool-call arguments while a tool runs: NEVER put a correct answer in a tool's input — split ask/grade into two tools at the answer boundary (quiz_ask/quiz_grade pattern). (4) Backgrounded `opencode2 run` processes die with their parent shell ("Session interrupted: shutdown") — keep the shell waiting on the PID, or drive the whole flow over HTTP. (5) Field `label` → `title`/`description` rename broke `fazuh.learn-quiz` (only form `title: firstLine(question)` rendered; field question vanished, TUI fell back to `key` name like "answer") — fixed 2026-08-27 by mapping `question→title` + `details→description` in `plugins/learn-quiz.ts:182-193`.

## [2026-08-25] plugins: transform-tool execute ctx carries only sessionID; globally loaded plugins' setup ctx points at the server default location
status: confirmed
source: live-test
evidence: learn-viz-tools published PNGs to /home/fazuh/viz instead of the session project after its -g install. Root cause chain: (1) setup()'s ctx.worktree/ctx.directory for a globally loaded plugin resolve to the server's default location ($HOME — the service's global location per /api/plugin), and that value is captured once at setup; (2) the transform-tool execute() second arg carries sessionID (staging dirs keyed ses_… prove it) but NOT worktree/directory — a per-call fallback to tctx values still published to $HOME. Fix: GET /api/session/<sid> → data.location.directory (verified shape), with tctx.worktree/directory kept as first preference for project-local loading.
The ToolContext .d.ts (worktree, directory, abort, metadata, ask) documents the legacy tool() helper's context, NOT the transform-tool execute arg — don't trust it for transform tools. Any globally installed plugin that writes into "the project" must resolve the project per call from the session API.

## [2026-08-25] plugins: project-local (location) plugins live only while a client is attached to that location
status: confirmed
source: live-test
evidence: md-link (project .opencode/plugins) mirror stayed empty across a turn driven purely via raw HTTP (session created with the project's directory, no client ever attached); it also stayed empty after `opencode2 run` exited — the file appeared only while a run/TUI client was alive in that directory, and background timers (2.5 s poller started in setup) stopped producing writes once the last client exited. Re-attaching a client reloads the location plugins and the poller resumes (backfill catches up).
Consequences: background automation in project plugins (pollers, watchers) runs only during TUI/CLI sessions in that project; server-side session creation via HTTP does NOT load location plugins by itself. Anything that must run continuously belongs in the GLOBAL config dir (~/.config/opencode/plugins/), whose plugins load with the service.

## [2026-08-27] plugins: project .opencode local plugins need local node_modules and min-release-age bypass
status: confirmed
source: live-test
evidence: Notes vault .opencode/plugins/notes-plugin.js:6 `import { tool } from "@opencode-ai/plugin"` failed with `ResolveMessage: Cannot find package` (server log `failed to load plugin` @ 2026-08-27T05:43:39Z, PluginModule.load chunk-rdcmrb79:1509); local `.opencode/package.json` pinned 1.4.6 while global/opencode was 1.18.21 and `ls .opencode/node_modules` was empty due to `.opencode/.gitignore` ignoring `node_modules`/`package.json`/`bun.lock`; `bun -e "import {tool} from '@opencode-ai/plugin'"` failed pre-fix and succeeded post-fix; background `opencode` auto-install failed with `NpmInstallFailedError: No matching version found for @opencode-ai/plugin@1.18.21 with a date before 8/20/2026` due to `~/.npmrc min-release-age=7`; `cd .opencode && bun install` + `npm install --min-release-age=0` created `node_modules/@opencode-ai/plugin@1.18.21`, `touch` hot-reloaded, and `opencode --print-logs debug info` at 2026-08-27T05:46:02Z listed `file:///home/fazuh/Workspaces/Notes/.opencode/plugins/notes-plugin.js` without error and `bun -e` tool import succeeded.
Project-local server plugins resolve imports relative to the project `.opencode/` dir via Bun's PluginModule loader and do NOT fallback to `~/.config/opencode/node_modules`. Forking a repo whose `.opencode` deps are gitignored leaves an empty `node_modules`; `opencode` background npm install honors `~/.npmrc min-release-age` and will refuse recent `@opencode-ai/plugin` versions until they age past the window — use `bun install` (ignores the gate) or one-off `npm install --min-release-age=0` (per AGENTS.md exception) inside `.opencode/`, pin the dep to the running `opencode --version`, and `touch` the plugin file to trigger the watched-dir hot-reload (verified: no restart needed, new `opencode` instances load it immediately).

## [2026-08-30] api: headless `run` must use the opencode2 beta, not the pacman build
status: confirmed
source: live-test
evidence: `/usr/bin/opencode run --agent autocommit "..."` (opencode-bin 1.18.25-1) fails with `SQLiteError: no such column: project_id` against `~/.local/share/opencode/opencode.db` (migrated by beta-18684, has `session_v2`); `~/.opencode/bin/opencode2 run ...` against the same repo+db succeeds end-to-end (octask-autocommit-agent.service, journalctl 2026-08-30 16:44). Same failure class seen 2026-08-24 as `no such column: provider` during a beta boot.
The service DB is migrated by the v2 beta binary (`~/.opencode/bin/opencode2`), so ANY headless/CLI invocation must use that same binary. The pacman `/usr/bin/opencode` (1.18.25, older schema) cannot read it and dies with `SQLiteError: no such column: project_id` (earlier instance: `no such column: provider`). Anything that shells out to opencode unattended (systemd timers, scripts) must resolve `~/.opencode/bin/opencode2` explicitly, not `opencode` from PATH.

## [2026-08-31] agents: deny-all permission wildcards hide plugin custom tools from subagent sessions
status: confirmed
source: live-test
evidence: svg-maker subagent (frontmatter: deny `*`/`*`, then allow `write_svg`/`edit_svg`/`render_svg`/`read` by bare name) reported only `read` available and claimed no rendering pipeline exists (session ses_fabf5a03affe3giTHV3apSgB5v, RESULT: NONE). Same-session control: `general` subagent with default permissive permissions called write_svg → render_svg successfully (ses_fabef69c9ffeX8hxPp25G0cO21), and the primary session drove the full trio (PNG verified by look). Plugin: fazuh.viz registers bare-name tools via ctx.tool.transform (plugins/viz/src/index.ts:254).
In subagent sessions, a deny-all wildcard suppresses plugin custom tools entirely, and bare-name allow rules do NOT resurrect them — the permission checker does not match transform-registered custom tools by bare name (or at all), so deny wins and the harness hides the tool instead of failing on call. Fix in use: maker agents run permissive (no deny-all) with scope confinement via system prompt. Symptom signature for future hits: restricted subagent lists ONLY its natively-allowed tools and reports custom tooling as "nonexistent in this environment".

## [2026-09-01] api: interrupt flips a steer-delivered inbox prompt to queue, and it stays unprocessed
status: confirmed
source: live-test
evidence: on ses_fa47972ebffeCaB2vm7tfSPFE4, a prompt POSTed with delivery "steer" while the agent loop ran a stuck chat-mode shell-retry loop; POST /api/session/{id}/interrupt aborted the step ({"interrupted":true}), then GET /api/session/{id}/inbox showed the same msg with delivery flipped to "queue", and it sat there unprocessed across 20+ s of polling; POST .../inbox/{id}/steer returned ConflictError "Pending input is no longer queued", POST .../inbox/{id}/queue re-marked it, DELETE /api/session/{id}/inbox/{id} finally removed it and a fresh prompt processed normally.
After an interrupt, a pending "steer" inbox item is re-labeled "queue" but does not drain on its own (at least when the interrupted step ended in error). A queued item may stick indefinitely — check `GET /api/session/{id}/inbox` after any interrupt, and DELETE the stuck inboxID before sending a new prompt rather than waiting for it to process.

## [2026-09-05] api: session fork works on subagent sessions; switchAgent only lands before the first prompt
status: confirmed
source: live-test
evidence: research subagent ses_f916e1d57ffeVGFlgs4umPLpYj completed a task; `POST /api/session/{id}/fork {"boundary":{"type":"through"}}` (no messageID) returned child ses_f916dd75dffeFsDieoZc97I1d0 with `agent: research` inherited and parent history copied under rewritten message ids (`..._4`, `..._5`, `..._18`); a prompt to the child answered correctly from copied history and knew its own new id. `POST /api/session/{child}/agent {"agent":"implement"}` returned 204 and flipped session metadata + reply tags, BUT on the already-conversed child the model still ran the OLD research system prompt (it reported "still running as research; nothing in my context indicates an agent switch"). Control: fresh fork → switchAgent → FIRST prompt ran the implement system prompt correctly (quoted agents/implement.md job). Parent stayed `research` after the child's switch. `POST /api/session/{id}/wait` is documented but unavailable on the deployed server — polled `GET /api/session/{id}` `.data.outcome` instead (flips to succeeded/failed).
V2 session fork is a history snapshot at an explicit boundary and works for subagent sessions, and switchAgent accepts subagent names — but the agent switch only changes the SYSTEM PROMPT when it happens before the child's first prompt; switching mid-conversation is cosmetic (metadata/tags change, prompt does not). Orchestration rule: fork → switch agent → prompt, in that order, never switch after the first turn. Forks share the parent's working directory — they are not filesystem isolation; parallel writers need worktrees.

## [2026-09-05] tui: beta-19086 local dir plugins need `<plugin-dir>/tui.ts`; the plugins/tui/ scan dir is gone
status: confirmed
source: live-test + bundle-code
evidence: after autoupdate to beta-19086 the md-link/viz TUI commands (ctrl+alt+m, /md-link*, /viz*) vanished with zero errors anywhere (palette, slash list, service log, TUI stderr all silent). Probes with stderr console.error AND file-write markers at shim module top-level + setup() never fired: `plugins/tui/*.ts` shims were never imported — the Aug-28 scan-dir mechanism no longer exists in this build (0 hits for `plugins/tui`/`tui-plugins` in binary strings; whole opencode.log has zero TUI-side plugin-load lines ever — this path logs nothing, even on success). cli.json `"plugins"` with .ts file paths or directory paths loads them SERVER-side only (role=server "loading plugin" lines, incl. same dir loaded via both auto-discovery and the list → duplicate-load risk); TUI side still skipped. Bundle-extracted entrypoint resolver: `return { server: e(["server",""]), tui: e(["tui"]), rpc: e(["rpc"]) }` where for a local dir source e() = `resolve(r.directory, "tui")` — i.e. a file literally named `tui.ts` (or `tui/index`) at the plugin dir ROOT; package.json `exports: {"./tui": ...}` is consulted ONLY for package sources (r.name set). A dir whose tui entry does not resolve returns `{status:"unsupported"}` and is dropped SILENTLY. After creating `plugins/md-link/tui.ts` + `plugins/viz/tui.ts` re-exporting `./src/tui.ts`, the probe TUI imported the module immediately (marker file written, module loaded ✓).
Local dir TUI entrypoint contract on beta-19086: `<plugin-dir>/tui.ts` at the dir root; `src/tui.ts` reachable only via exports is NOT enough. The config-repo `plugins/tui/` scan dir + README (Aug-28 workaround) is DEAD on this build; cli.json plugins is for package specifiers (`plugin add` refuses local paths) and a directory entry there only double-loads the server side.

## [2026-09-05] plugins: beta-19124 drops the legacy Plugin helper export; config plugins must be directories
status: confirmed
source: live-test
evidence: after autoupdate to beta-19124 (2026-09-05 06:55 +0700), discord-notify.ts and plugins/mermaid failed to load with `SyntaxError: Export named 'Plugin' not found in module '@opencode-ai/plugin/dist/index.js'` while plain `{id, setup}` plugins (quiz, viz, md-link) loaded fine; converting `export default Plugin.define({...})` → `export default {id, setup}` restored both (cold restart). Separately, config `plugins` entries with FILE paths log `configured plugin path must be a directory` and are skipped (opencode-llm-proxy/index.js, skill-creator v2.js).
Plain `{id, setup}` is the only portable plugin module shape on beta-19124+; `plugins` config entries must point at plugin DIRECTORIES, not files.

## [2026-09-05] plugins: hot-reload cache-busts only the entry file — nested src/ imports stay stale
status: confirmed
source: live-test
evidence: rewrote plugins/mermaid/src/index.ts and touched the entry index.ts → service re-logged `loading plugin` with a fresh entry `?mtime=` yet STILL failed with the pre-fix `Plugin not found` error; only killing the port-holder service (cold restart) picked up the nested change. Same staleness reproduced reasoning for quiz deploy.
After editing any file a plugin imports BELOW its entry, cold-restart the service — touching the entry file is not enough.
