---
name: ocv2-models
description: Pick a free OpenCode v2 model when the session model's provider account is dry (402 Insufficient account funds) or the user asks for one. Use when a turn dies with "Insufficient account funds", the user says "pick a model" or "use a free model", or asks what models opencode2 offers. A `## ocv2-models` section in AGENTS.md is the override point.
---

# ocv2-models: free model discovery and switching

## 1. AGENTS.md preference first

Check for a `## ocv2-models` section. **Priority: local project `AGENTS.md`
beats global `~/.config/opencode/AGENTS.md`.** Named model: use it after
verifying it is still listed below; stale falls through with a note. Neither
file has the section: pick from step 3.

## 2. List free models

```sh
export PATH="$HOME/.opencode/bin:$PATH"
opencode2 models | rg -i free
```

`opencode2 models` prints `provider/model[:variant]` (~112 entries on beta-19187); the `free` filter is the current free tier. Always re-run, the list changes. Example (2026-09-06):

```
cline/z-ai/glm-5.2:free
litellm/flash-free-pro-vision
litellm/free-pro
litellm/free-pro-vision
opencode/ling-3.0-flash-fin-free
opencode/mimo-v2.5-free
opencode/muse-spark-1.2-contributor-free
opencode/muse-spark-1.3-contributor-free
opencode/nemotron-3-ultra-free
opencode/nemotron-3.5-lightning-free
tokenrouter/z-ai/glm-5.3-free
```

The catalog is local, not the API's list: `opencode/space-bunny-free` is
accepted by `POST /api/session` and runs, yet `opencode2 models` on the same
install does not show it. A user-named model absent here still applies: apply
it and read back the error, never silently substitute.

## 3. Pick

- Task needs image input → a `*vision*` entry (`litellm/free-pro-vision`, `litellm/flash-free-pro-vision`).
- Otherwise prefer `litellm/*` for chat turns: direct provider, live-verified 2026-09-06 (`free-pro-vision` probed normally, cost 0).
- **Subagent/delegated turns need tool use: `litellm/free-pro` does NOT have it.** It routes to `z-ai/glm-5.2:free`, filtered out for tool compatibility; subagents die with 404 "Filter by Tool Compatibility" (live-verified 2026-09-22). `tokenrouter/z-ai/glm-5.3-free` listed but had no channel that day. Working subagent pick: `opencode/nemotron-3-ultra-free` (live-verified 2026-09-22, full tool use across multi-step delegation).
- State pick plus reason in one line. Do not interview; the AGENTS.md section is the override.

## 4. Apply

Model is per-session and sticky; prompt-body `providerID`/`modelID` keys are IGNORED (finding 2026-09-06). Use the model endpoint:

```sh
# 204 on success
opencode2 api post /api/session/<sid>/model -d '{"model":{"providerID":"litellm","id":"free-pro-vision"}}'
# verify
opencode2 api get /api/session/<sid> | grep -o '"model":{[^}]*}'
```

Or the ocv2-sessions wrapper: `~/.config/opencode/skills/ocv2-sessions/scripts/oc-set.sh <sid> --model litellm/free-pro-vision`.
Headless: `opencode2 run -m litellm/free-pro-vision "..."` (flag format `provider/model#variant`).

## 5. 402 recovery

`Upstream request failed: Insufficient account funds` (402) repeated on assistant messages means the session model's provider account is dry, not a plugin or harness bug. Switch (step 4) and re-prompt; failed messages stay in history with `finish: error`.

## 6. Other model failures

- `opencode2 auth list` can hang with "Model catalog initialization timed out" regardless of version; never use it for discovery, `opencode2 models` (step 2) works.
- A child session on a free tier can hit the daily-limit 429 mid-run. Switch that child live (`POST /api/session/<sid>/model`, step 4) instead of restarting the work.
