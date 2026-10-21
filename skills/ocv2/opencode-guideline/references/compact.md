Load this when the user wants to compact an OpenCode v2 session: asks to compact a session (the current one or a fork), a context-watch warning fires on a session you manage, or the @session compaction gate auto-resolves. Trigger the compaction, wait for the summary. Covers POST /api/session/{id}/compact, polling the compaction message, and what compaction does and does not do to history.

---

# Compact an OpenCode v2 session

Compaction appends a `type: compaction` message (`summary` plus `recent` tail).
Later turns see that, not full history. History survives: every message stays
retrievable. Summarization runs on the session's own model (10–60 s typical).

Run `scripts/oc-compact.sh` from this skill's base directory. It triggers,
polls, reports; all calls go through `opencode2 api` (see `references/api.md`).

## 1. Resolve the session

Current session: read `Current conversation session ID` (`ses_…`) from the
environment block. Any other session (a fork you manage, see
`references/sessions.md`): use its `ses_…` id.

## 2. Compact

```sh
scripts/oc-compact.sh ses_XXXXXXXX                    # trigger + wait (≤180 s)
scripts/oc-compact.sh ses_XXXXXXXX --timeout 0        # fire and return
scripts/oc-compact.sh ses_XXXXXXXX --summary /tmp/s.md # also dump the summary
```

Exit codes: `0` completed (or nothing to compact), `1` timeout but still running,
`2` API error.

## 3. What the script wraps

```sh
# Trigger: body required, every field optional
opencode2 api post /api/session/ses_XXXXXXXX/compact --data '{}'
# 200 → {data:{id:"msg_…", sessionID, timeCreated, type:"compaction", payload:{}, delivery:"steer"}}

# Poll the created compaction message (the /wait endpoint is unavailable)
opencode2 api get /api/session/ses_XXXXXXXX/message/msg_XXXXXXXX
# .data.status: null → running → completed | failed
# .data.reason: "manual" | "auto"    .data.summary / .data.recent: markdown
```

## Notes

- **Works on a running session.** Compaction is a steer: it queues behind the
  current turn (`status: null` until the turn ends), then summarizes. An agent
  can steer one into its own live session.
- **Self-compact needs `--timeout 0`.** Your turn holds the session, so a
  synchronous wait never sees the queued steer start. Trigger, end the
  turn; summarization runs while the session idles.
- **Body `id` is an idempotency key** for the new compaction message, NOT a
  history boundary. Reusing an existing `msg_…` id returns `ConflictError:
  Compaction input ID conflicts with an existing durable record`.
- **"Nothing to compact yet"** (`compaction.unavailable`): no new history
  since the last compaction; status ends `failed`. The script treats
  it as success.
- **History survives.** `GET /api/session/{id}/message` keeps returning every
  message after compaction; only the model context changes.
- **Auto compactions exist** (`reason: "auto"`). Check existing compaction
  messages before triggering a manual one.
- The summarization call registers no session `cost`/`tokens` on the
  deployed build. Do not expect it there.
- Session work matters: run @session (persisting before compaction) first so
  state survives in the session doc and checkpoint.
