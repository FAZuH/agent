---
name: ocv2-fork
description: Fork an OpenCode v2 session and control the fork — switch agent & model, verify, send prompts, and wait blocking. Use when the user says "fork this session", "fork before this message", "switch the model/agent in the fork", or wants to verify a fork/model/agent change and talk to the new session.
---

# Fork & control an OpenCode v2 session

Fork creates a child session by copying projected history through or before a message boundary. The new session is independent — you then switch its agent/model, verify, and talk to it via the session API. All calls go through `opencode2 api` (handles auth to the background service).

## 1. Resolve the source session

Read `Current conversation session ID` from the environment block — `ses_…`. Ask if missing.

## 2. Fork

`POST /api/session/{sessionID}/fork` — `v2.session.fork`. Requires `boundary`.

```sh
# Fork entire history (server resolves to last message; simplest)
opencode2 api post /api/session/ses_XXXXXXXX/fork --data '{"boundary":{"type":"through"}}'

# Fork through a specific message (explicit)
opencode2 api post /api/session/ses_XXXXXXXX/fork --data '{"boundary":{"type":"through","messageID":"msg_XXXXXXXX"}}'

# Fork before a specific message (exclude it)
opencode2 api post /api/session/ses_XXXXXXXX/fork --data '{"boundary":{"type":"before","messageID":"msg_XXXXXXXX"}}'
```

Response `200`:
```json
{"data":{"id":"ses_NEW","fork":{"sessionID":"ses_OLD","boundary":{"type":"through","messageID":"msg_…"}},"agent":"…","model":{…}}}
```

Save `ses_NEW`. Message IDs are from `GET /api/session/{id}/message` — newest first; use the target `msg_…` for `before`.

## 3. Switch agent / model (optional, in the fork)

Agent and model are per-session. Switch the **fork**, not the parent.

```sh
# Agent — chat vs build etc.
opencode2 api post /api/session/ses_NEW/agent --data '{"agent":"chat"}'   # or "build", "orchestrator", etc.
# 204 on success — no body

# Model
opencode2 api post /api/session/ses_NEW/model --data '{"model":{"providerID":"opencode","id":"ling-3.0-flash-fin-free"}}'
# 204 — variant is optional; {id,providerID} required
# Example edge model: --data '{"model":{"providerID":"opencode","id":"muse-spark-1.2-contributor-free","variant":"xhigh"}}'
```

Both produce system messages in the fork: `type: agent-switched` (`agent`, `previous`) and `type: model-switched` (`model`, `previous`) / `type: model-selected` in older builds. `chat` mode is discussion-only — it has no `shell`/`edit` tools; prompts that expect shell calls will fail with `Unknown tool: shell`.

## 4. Verify

```sh
opencode2 api get /api/session/ses_NEW
# Check .data.agent and .data.model.id/providerID/variant

opencode2 api get /api/session/ses_NEW/message | head -c 4000
# Look for the agent-switched/model-switched messages at the top
```

## 5. Talk to the fork

```sh
opencode2 api post /api/session/ses_NEW/prompt --data '{"text":"Hello from the fork — confirm your session ID, agent, and model."}'
# 200 → {data:{id:msg_…,sessionID, type:user, delivery:steer|queue}}
```

Then **wait blocking** (prefer over polling):

```sh
opencode2 api post /api/session/ses_NEW/wait
# POST /api/session/{sessionID}/wait — v2.session.wait, waits until agent loop is idle, 204 when done
```

After wait, read the reply:

```sh
opencode2 api get /api/session/ses_NEW/message/msg_XXXXXXXX   # the assistant reply
# or
opencode2 api get /api/session/ses_NEW/message | head -c 6000
```

If you need the message ID, it is the newest `type: assistant` after wait. In `chat` mode, instruct the model not to use tools: `"Just answer from your environment, no tools needed."`

## Notes

- Only projected history is copied. `through` includes the boundary message; `before` excludes it. Using `{"type":"through"}` without `messageID` is valid — server fills the last `msg_…` (live-verified: returned `msg_05b8678fe001TF8ShnW5CvM6vA`).
- Switching does not affect the parent. Child sessions are not moved by `POST /api/session/{id}/move`; spawn fresh subagents after a move.
- Verify via `GET /api/session/{id}` is authoritative; `GET /api/project/current` may return `/` from a detached shell — rely on the system-update environment block after move.
- Inbox: a prompt sent while the session is busy goes to `GET /api/session/{id}/inbox` with `delivery: steer|queue`. `queue` is the default after interrupt; `steer` is queued but waits for idle. Use `POST /api/session/{id}/interrupt` to abort a stuck `chat` shell loop, then `DELETE /api/session/{id}/inbox/{inboxID}` to drop a stuck queued item.
