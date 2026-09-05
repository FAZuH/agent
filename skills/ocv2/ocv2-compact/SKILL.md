---
name: ocv2-compact
description: >-
  Compact an OpenCode v2 session — trigger compaction and wait for the
  summary. Use when the user asks to compact a session (the current one or a
  fork), a context-watch warning fires on a session you manage, or the
  prepare-compact gate auto-resolves. Covers POST /api/session/{id}/compact,
  polling the compaction message, and what compaction does and does not do to
  history.
---

# Compact an OpenCode v2 session

Compaction appends a `type: compaction` message holding a model-generated
`summary` plus a `recent` tail; subsequent turns see that instead of the full
history. History is NOT deleted — every message stays retrievable. The
summarization is a model call on the session's own model (10–60 s typical).

Run `scripts/oc-compact.sh` from this skill's base directory — it triggers,
polls, and reports; all calls go through `opencode2 api` (see @ocv2-api).

## 1. Resolve the session

Read `Current conversation session ID` from the environment block (`ses_…`)
to compact the current session. For any other session — a fork you manage
(@ocv2-sessions) — use its `ses_…` id.

## 2. Compact

```sh
scripts/oc-compact.sh ses_XXXXXXXX                    # trigger + wait (≤180 s)
scripts/oc-compact.sh ses_XXXXXXXX --timeout 0        # fire and return
scripts/oc-compact.sh ses_XXXXXXXX --summary /tmp/s.md # also dump the summary
```

Exit codes: `0` completed (or nothing to compact) · `1` timeout, still
running · `2` API error.

## 3. What the script wraps

```sh
# Trigger — body required, every field optional
opencode2 api post /api/session/ses_XXXXXXXX/compact --data '{}'
# 200 → {data:{id:"msg_…", sessionID, timeCreated, type:"compaction", payload:{}, delivery:"steer"}}

# Poll the created compaction message (the /wait endpoint is unavailable)
opencode2 api get /api/session/ses_XXXXXXXX/message/msg_XXXXXXXX
# .data.status: null → running → completed | failed
# .data.reason: "manual" | "auto"    .data.summary / .data.recent: markdown
```

## Notes

- **Works on a running session.** The compact is a steer: it queues behind the
  current turn (`status: null` until the turn ends), then summarizes. An agent
  can steer a compaction into its own live session.
- **Body `id` is an idempotency key** for the new compaction message — NOT a
  history boundary. Reusing an existing `msg_…` id returns `ConflictError:
  Compaction input ID conflicts with an existing durable record`.
- **"Nothing to compact yet"** (`compaction.unavailable`) — no new history
  since the last completed compaction; status ends `failed`. The script treats
  it as success.
- **History survives.** `GET /api/session/{id}/message` keeps returning every
  message after compaction; only the model context changes.
- **Auto compactions exist** (`reason: "auto"`) — v2 can compact on its own;
  check existing compaction messages before triggering a manual one.
- The summarization call did not register in session `cost`/`tokens` on the
  deployed build — do not expect it there.
- Before compacting any session whose work matters: run @prepare-compact
  first so state survives in the session doc and checkpoint.
