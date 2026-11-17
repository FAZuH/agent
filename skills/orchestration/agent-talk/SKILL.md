---
name: agent-talk
description: >-
  Message another running agent session over the OpenCode v2 API and read its
  answer. Triggers: a worker must answer mid-task, a report would otherwise
  never reach you, agents handing work back and forth.
---

# agent-talk

Two agents talk by prompting each other's session. Every agent session is an
OpenCode v2 session id (`ses_…`); a prompt sent to another session's id runs
a turn there.

## Address a session

```sh
opencode2 api get "/api/session?parentID=ses_PARENT"   # your own children
opencode2 api get /api/session/ses_TARGET               # any known id
```

Query params go inline in the path. `--param` is ignored for GET: `--param
limit=2` returned the default 50 rows, `?limit=2` returned 2.

## Send

```sh
opencode2 api post /api/session/ses_TARGET/prompt --data '{"text":"...","delivery":"steer"}'
```

- `steer` (default): runs after the target's current turn ends. Measured on
  2.2.7: a steer sent 6.4s into an 8.7s turn let that turn finish before the
  steer ran, so it does not abort anything.
- `queue`: the same timing in the same probe. Neither mode cuts into a running
  turn; only `POST /api/session/{id}/interrupt` aborts one.

Answers `{"data":{"id":"msg_…","delivery":"steer"}}`.

## Read the answer

```sh
opencode2 api get /api/session/ses_TARGET/message
```

Newest first. Assistant text: `.content[] | select(.type=="text") | .text`.

## Wait, poll, stop

```sh
opencode2 api post /api/experimental/session/ses_TARGET/wait   # 204 when idle
opencode2 api post /api/session/ses_TARGET/interrupt          # {"interrupted":true}
opencode2 api get  /api/session/ses_TARGET                    # .data.outcome, .data.time.idle
```

`/api/session/{id}/wait` without the `experimental` prefix is 404.

## Reply back

A worker cannot push a report into your context. Give it your session id and
have it post back:

```
Reply by POSTing your answer to /api/session/ses_PARENT/prompt
```

The message reaches you as a user message in your session, and you answer it
in your next turn.

## Rules

- One writer per file, always. A second agent editing the same file is a
  conflict, not a channel.
- Send a question, not a plan. The target owns its own task.
- Both modes wait for the target's current turn; `steer` is the host default
  and neither one interrupts. Abort with `/interrupt` instead.
  Pick by urgency, not by reflex.
- Poll `GET /api/session/{id}` for `.data.outcome` (`succeeded` / `failed` /
  `interrupted`) instead of guessing whether the target finished.
