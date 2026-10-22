---
name: agent-talk
description: Message another running agent session over the OpenCode v2 API and read its answer. Use when a worker must answer a question mid-task, when a worker's report would otherwise never reach you, or when two agents hand work back and forth.
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

- `steer` (default): redirects the target's running turn now.
- `queue`: runs after the target's current turn ends.

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
- A queued message waits for the target's current turn; a steer cuts into it.
  Pick by urgency, not by reflex.
- Poll `GET /api/session/{id}` for `.data.outcome` (`succeeded` / `failed` /
  `interrupted`) instead of guessing whether the target finished.
