---
name: ocv2-models
description: Pick a free OpenCode v2 model when the default model's account is dry (402 Insufficient account funds) or the user asks for a free model. Use when a turn dies with "Insufficient account funds", the user says "pick a model", "use a free model", "switch the model", or asks what models opencode2 offers. Lists free models with `opencode2 models | rg -i free`, checks the AGENTS.md `## ocv2-models` preference, and switches the live session via the model endpoint.
---

# ocv2-models — free model discovery & switching

## 1. AGENTS.md preference first

Look for a `## ocv2-models` section. **Priority: the local project `AGENTS.md` wins over the global `~/.config/opencode/AGENTS.md`.** If it names a model, use it (verify it still exists in the list below; if stale, fall through and say so). If neither file has the section, pick from the list in step 3.

## 2. List free models

```sh
export PATH="$HOME/.opencode/bin:$PATH"
opencode2 models | rg -i free
```

`opencode2 models` prints every model as `provider/model[:variant]` (~112 entries on beta-19187); the `free` filter is the current free tier. Always re-run — the list changes. Example output (2026-09-06):

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

## 3. Pick

- Task needs image input → a `*vision*` entry (`litellm/free-pro-vision`, `litellm/flash-free-pro-vision`).
- Otherwise prefer `litellm/*` — direct provider, live-verified 2026-09-06 (`free-pro-vision` answered a probe turn normally, cost 0).
- State the pick and the reason in one line. Don't interview; the AGENTS.md section is the override point.

## 4. Apply

Model is per-session and sticky from creation; the prompt body's `providerID`/`modelID` keys are IGNORED (finding 2026-09-06) — use the model endpoint:

```sh
# 204 on success
opencode2 api post /api/session/<sid>/model -d '{"model":{"providerID":"litellm","id":"free-pro-vision"}}'
# verify
opencode2 api get /api/session/<sid> | grep -o '"model":{[^}]*}'
```

Or the ocv2-sessions wrapper: `~/.config/opencode/skills/ocv2-sessions/scripts/oc-set.sh <sid> --model litellm/free-pro-vision`.
Headless: `opencode2 run -m litellm/free-pro-vision "..."` (flag format `provider/model#variant`).

## 5. 402 recovery

`Upstream request failed: Insufficient account funds` (402) repeated on assistant messages = the session model's provider account is dry — not a plugin or harness bug. Switch (step 4) and re-prompt; failed messages stay in history with `finish: error`.
