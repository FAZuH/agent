---
name: long-horizon
description: >-
  Keep multi-hour or overnight work moving while the orchestrator session
  idles: scaffold a resume-safe rig — supervisor that health-gates and
  restarts workers, external heartbeat that wakes the idle orchestrator via
  the session API, sentinel files with a Discord watcher, progress-file
  resume protocol, clean stand-down and re-arm. Use when the user says "run
  this overnight", "keep going while I sleep", "don't 100% stop, detect
  progress", asks for a watchdog or keep-alive, or before launching any
  unattended fleet of forked children or long background jobs.
---

# Long-horizon runs

Keep work moving for hours while the orchestrator session idles, the network
drops, or the service restarts. The session is the weak link: an idle LLM
session does not keep running, and goal auto-continue is not trustworthy for
long runs. Move liveness **outside** the session.

> **Load the @following-procedures skill first.** It defines how you run this
> numbered procedure: point-and-call narration, live deviation logging, and a
> fixed post-run report.

Always follow the rules in the *Rules* section at the bottom.

## The rig — four pieces

1. **Resume-safe workers.** Every long job writes a progress file
   (step/candidate-level) and a sentinel on terminal state:
   `*_EXHAUSTED.txt` (space done) or `*_FOUND.txt` (hit). Restart = re-run;
   the worker skips what the progress file records. Launch detached:
   `setsid nohup <worker> >> run.log 2>&1 < /dev/null & disown` — in-session
   background tool calls get reaped, and bgrun units die with the service.
2. **Supervisor** (`scripts/supervisor.sh`). A dumb loop: health-gate
   (N-of-M pings), restart dead workers, skip exhausted tracks, stop on a
   FOUND sentinel, exit when all tracks are done. Logs every spawn with its
   PID so a double-spawn is forensically decidable.
3. **Heartbeat** (`scripts/heartbeat.sh`). External watchdog that wakes the
   orchestrator with `POST /api/session/<id>/prompt` (steer delivery =
   queued until idle) on: child outcome transitions, child stalls, sentinel
   file events, rig-unit death, and a keep-alive timer. State dir + `STOP`
   marker; keep-alives are suppressed while a previous wake is still pending
   (queued wakes arrive as a burst).
4. **Watcher** (`scripts/found_watcher.sh`). Sentinel → Discord. Reads the
   webhook from a secrets file at runtime; never prints it.

## Procedure

1. **Decide state and sentinels.** Pick the state dir
   (`/tmp/opencode/<name>/`), the workspace, the sentinel names, and the
   worker progress-file format. Done when: you can name the exact file each
   event writes.
2. **Write the workers.** Progress file + sentinels + resume-on-restart.
   Done when: `kill` then re-run resumes without repeating work — test it.
3. **Start the supervisor detached.** Done when: its log shows one
   `spawned <name> pid=<pid>` line per worker.
4. **Configure and start the heartbeat.** Edit the CONFIG block, then run
   `heartbeat.sh --test` once. Done when: the test wake arrives and the
   orchestrator acts on it.
5. **Compose wake prompts self-contained.** Wake reason + standing rules
   re-injected + "act on the reason, update the session record, end your
   turn". The session may read each wake with fresh context after
   compaction. Done when: the wake prompt alone would produce correct
   behavior.
6. **Stand down in order.** Supervisor first (it would resurrect workers),
   then workers (kill by explicit PID), then heartbeat
   (`touch <state>/STOP`). Progress files stay for a future resume. Done
   when: `pgrep` finds no rig process and `bgrun list` shows no rig unit.
7. **Re-arm after a restart.** bgrun units and setsid children may die with
   the service. Check `pgrep` + the unit list; restart supervisor, then
   heartbeat — the state dir survives, so markers and `children.txt` do not
   need rebuilding.

## Fleet children

Forked children (see @forkflow) plug into the heartbeat through
`children.txt` (one sessionID per line). Completion markers must be keyed by
dispatch generation — a stale `.done` suppresses a re-dispatched child's
finish-wake. Stall = no new child message for ~45 min; re-notify hourly.
Cross-session resume via a handoff doc (status + pointers + pinned
acceptance + next step) composes with this rig.

## Rules

- Never trust goal auto-continue or in-session backgrounding for liveness;
  the watchdog is a separate process.
- Every wake prompt carries the standing rules; never assume session memory.
- Stand-down order is supervisor → workers → heartbeat.
- Kill by explicit PID; in `pgrep -f` patterns use a bracket (`[w]orker.py`)
  and keep the bare name out of the same command line — `pkill -f`
  self-matches the invoking shell.
- Crash-class or destructive payloads belong to offline harnesses only; the
  rig never points them at live systems.

## Dependency graph

- step1
- step2 -> step1
- step3 -> step2
- step4 -> step3
- step5 -> step1
- step6 -> step3, step4
- step7 -> step3, step4
