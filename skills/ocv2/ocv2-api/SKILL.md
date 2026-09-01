---
name: ocv2-api
description: Use `opencode2 api` to call the OpenCode v2 HTTP API and where its docs live. Use when the user says "call the API", "opencode2 api", "where are the API docs", "how do I fork/switch model via API", or pastes an OpenAPI path and needs the exact `opencode2 api` invocation and auth/docs gotchas.
---

# opencode2 api & the v2 HTTP API docs

`opencode2 api` is the authenticated wrapper around the v2 HttpApi. It targets the background service (`--service`) and handles auth; raw `curl` needs manual basic auth.

## Command

```
opencode2 api [flags] <operation | method path...>

operation | method path  string  OpenAPI operationId (v2.session.fork) OR HTTP method + path (get /api/session)
flags:
  -d, --data   string  Request body (JSON string)
  -H, --header string  Request header  name:value
      --param  key=value  Path/query param
      --standalone   Use a private server instead of the background service
      --server string  Connect to a specific server URL
```

Operation and method-path forms are interchangeable:

```sh
opencode2 api get /api/session
opencode2 api post /api/session/ses_XXX/fork --data '{"boundary":{"type":"through"}}'
opencode2 api v2.session.list                          # operationId form
```

Exit code `0` is success. `204` endpoints return empty body; `200` returns `{"data":…}`. Only `-d`/`-H` are accepted — do not pass curl flags like `-s` or `-X`.

## Docs

- **Human docs:** `https://opencode.ai/v2/docs/api` — resource tables (session ~40 ops, plugin, agent, etc.) and auth notes.
  ```sh
  # Markdown (preferred for agents)
  curl -s -H "Accept: text/markdown" https://opencode.ai/v2/docs/api
  # Or via webfetch with format markdown
  ```
- **Machine spec:** `https://opencode.ai/v2/openapi.json` — OpenAPI 3.1, 138 operations / 229 schemas, operationIds `v2.*`.
  ```sh
  curl -s https://opencode.ai/v2/openapi.json | python3 -c "import json,sys; d=json.load(sys.stdin); print(json.dumps(d['paths']['/api/session/{sessionID}/fork'], indent=2))"
  ```
- **Local discovery:** `opencode2 api get /api/session` etc. are live-probed; `GET /api/plugin` on a plain `opencode2 serve` returns `data: []` even when plugins load (only the service supervisor populates it — see `ocv2-pluginhealth`).

## Common session calls (all require `opencode2 api`)

```sh
opencode2 api get /api/session                          # list sessions
opencode2 api get /api/session/ses_XXX                  # get session (agent, model, fork)
opencode2 api get /api/session/ses_XXX/message          # list messages (newest first)
opencode2 api get /api/session/ses_XXX/message/msg_XXX  # get one message
opencode2 api post /api/session/ses_XXX/fork --data '{"boundary":{"type":"through"}}'
opencode2 api post /api/session/ses_XXX/agent --data '{"agent":"chat"}'
opencode2 api post /api/session/ses_XXX/model --data '{"model":{"providerID":"opencode","id":"ling-3.0-flash-fin-free"}}'
opencode2 api post /api/session/ses_XXX/prompt --data '{"text":"…"}'
opencode2 api post /api/session/ses_XXX/wait            # block until idle (prefer over polling messages)
opencode2 api post /api/session/ses_XXX/move --data '{"directory":"/abs/path"}'
opencode2 api post /api/session/ses_XXX/interrupt       # abort running step
opencode2 api get /api/session/ses_XXX/inbox            # pending inputs
opencode2 api get /api/plugin                           # plugin health (service only)
opencode2 api get /api/model                            # list models
```

## Auth (when not using `opencode2 api`)

`opencode2 api` needs no extra auth against the service. Against a standalone server, use **basic auth**:

```sh
curl -s -u "opencode:$PASSWORD" http://127.0.0.1:PORT/api/plugin
```

Password is printed at `opencode2 serve` startup (`server password …`). Bearer/`x-opencode-password` return `401` with empty body — empty responses are usually auth/port, not missing data.

## Large responses

Session message lists can exceed the shell tool's output limit (>250KB on long sessions) — the JSON gets truncated mid-string and `python3 json.load` dies with `Unterminated string`. Never pipe a big `message` list into python. Instead:

- `GET /api/session/{id}/message/{msgID}` — single message, always small
- `grep -o '"id":"msg[^"]*"'` — extract just IDs from the list
- `--param limit=N` on list endpoints to bound the page

## Gotchas

1. **Service vs plain serve:** `GET /api/plugin` and `/api/command` are empty on a plain `serve` even when healthy; verify via the service (`opencode2 api …` without `--standalone`) or with `?location.directory=`.
2. **Project discovery needs git:** without `.git` at/above CWD, location resolves to `project: global` and project config is skipped silently — check `location.project.directory` in `/api/plugin` responses.
3. **Config key `plugins`:** v1 `plugin` is auto-translated; new entries should use `"plugins"`; both may coexist.
4. **Boundary forms:** `POST /api/session/{id}/fork` requires `{"boundary":{"type":"through"}}` or `{"type":"before","messageID":"msg_…"}`. `through` without `messageID` is valid — server fills the last message (live-verified). `before` without `messageID` is `InvalidRequestError`.
5. **Model ref:** `{"model":{"providerID":"opencode","id":"…"}}` — `variant` optional, `id`+`providerID` required.

## Related

- `ocv2-fork` — full fork→switch→verify→talk→wait flow
- `ocv2-move` — `POST /api/session/{id}/move` for changing project directory
- `ocv2-pluginhealth` — `GET /api/plugin` diagnosis
- `ocv2-findings` — durable log of live-verified v2 quirks
