---
name: ocv2-sessions
description: >-
  Fork an OpenCode v2 session and control the fork, switching its agent and
  model, verifying, sending prompts, and polling the outcome. Use when the
  user says "fork this session", "fork before this message", "switch the
  model/agent in the fork", or wants to verify a fork change and talk to the
  new session.
---

# Fork & control an OpenCode v2 session

Fork copies projected history through or before a boundary into an independent
child. Then switch its agent/model, verify, talk via the session API. All calls
go through `opencode2 api` (see @ocv2-api).

## Scripts (preferred)

`scripts/` wraps every call below; prefer it over raw `opencode2 api`.
stdout carries the result (safe for `$(...)`), progress goes to
stderr. Exits 0 on success, 2 on usage/API errors
(`oc-wait` exits 1 on failed/timeout):

- `oc-fork.sh SESSION [--through MSG | --before MSG]` → child `ses_…` (§2)
- `oc-set.sh SESSION [--agent NAME] [--model PROVIDER/ID[:VARIANT]]` (§3)
- `oc-status.sh SESSION` → one-line JSON: agent, model, outcome, tokens (§4)
- `oc-msgs.sh SESSION [--last N] [--full MSG_ID]` → compact table or one message (§4)
- `oc-prompt.sh SESSION TEXT | --file FILE` → user `msg_…` (§5)
- `oc-wait.sh SESSION [--timeout SECS]` → polls `.data.outcome` (§5)

Message lists go through a tempfile: piped
`opencode2 api` output truncates at 256 KiB, cutting real history.

## 1. Resolve the source session

Read `Current conversation session ID` from the environment block: `ses_…`. Ask if missing.

## 2. Fork

`POST /api/session/{sessionID}/fork`: `v2.session.fork`. Requires `boundary`.

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

Save `ses_NEW`. IDs come from `GET /api/session/{id}/message` (newest first); use target `msg_…` for `before`.

## 3. Switch agent / model (optional, in the fork)

Agent and model are per-session. Switch the **fork**, not the parent.

```sh
# Agent: chat vs build etc.
opencode2 api post /api/session/ses_NEW/agent --data '{"agent":"chat"}'   # or "build", "orchestrator", etc.
# 204 on success, no body

# Model
opencode2 api post /api/session/ses_NEW/model --data '{"model":{"providerID":"opencode","id":"ling-3.0-flash-fin-free"}}'
# 204, variant is optional; {id,providerID} required
# Example edge model: --data '{"model":{"providerID":"opencode","id":"muse-spark-1.2-contributor-free","variant":"xhigh"}}'
```

Both produce system messages in the fork: `type: agent-switched` (`agent`, `previous`) and `type: model-switched` (`model`, `previous`) / `type: model-selected` in older builds. `chat` mode is discussion-only and has no `shell`/`edit` tools, so shell-expecting prompts fail with `Unknown tool: shell`.

## 4. Verify

```sh
opencode2 api get /api/session/ses_NEW
# Check .data.agent and .data.model.id/providerID/variant

opencode2 api get /api/session/ses_NEW/message | head -c 4000
# Look for the agent-switched/model-switched messages at the top
```

## 5. Talk to the fork

```sh
opencode2 api post /api/session/ses_NEW/prompt --data '{"text":"Hello from the fork. Confirm your session ID, agent, and model."}'
# 200 → {data:{id:msg_…,sessionID, type:user, delivery:steer|queue}}
```

Then wait. The blocking endpoint may be unavailable, so poll outcome on failure:

```sh
opencode2 api post /api/session/ses_NEW/wait
# If unavailable, poll GET /api/session/ses_NEW and read .data.outcome.
```

After wait, read the reply:

```sh
opencode2 api get /api/session/ses_NEW/message/msg_XXXXXXXX   # the assistant reply
# or
opencode2 api get /api/session/ses_NEW/message | head -c 6000
```

Message ID is the newest `type: assistant` after wait. In `chat` mode, add: `"Just answer from your environment, no tools needed."`

## Notes

- Only projected history is copied. `through` includes the boundary message; `before` excludes it. Using `{"type":"through"}` without `messageID` is valid (the server fills the last `msg_…`, live-verified: returned `msg_05b8678fe001TF8ShnW5CvM6vA`).
- Switching does not affect the parent. Child sessions are not moved by `POST /api/session/{id}/move`; spawn fresh subagents after a move.
- Verify via `GET /api/session/{id}` is authoritative; `GET /api/project/current` may return `/` from a detached shell, so rely on the system-update environment block after move.
- Inbox: a prompt sent while busy lands in `GET /api/session/{id}/inbox` with `delivery: steer|queue`. `queue` is the default after interrupt; `steer` waits for idle. `POST /api/session/{id}/interrupt` aborts a stuck `chat` shell loop, then `DELETE /api/session/{id}/inbox/{inboxID}` drops a stuck queued item.
- Resumed sessions do NOT notify the parent: RESUME means steer/queue a prompt into an existing `ses_…` instead of spawning fresh, and the parent gets no completion notification. The `subagent` tool's "you will be notified when it completes" covers only newly-spawned sessions. Detect idle by **polling `GET /api/session/{sessionID}`** for `.data.outcome` (and `.data.time.idle`); it flips to `succeeded` / `failed` when the loop stops. Resume when the same unit of work continues across a model/quota switch, then poll.
- For warm delegation policy and the required fork → switch → first-prompt order, use @forkflow.

## Memory

OpenCode v2 findings live in Hindsight bank `coding-agent::faz-lab`, tagged
`topic:opencode-v2`. `recall` a quirk before answering from scratch; `retain`
a new finding after it live-verifies. If the hindsight tools are absent,
continue without memory.
