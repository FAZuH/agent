---
name: scheduled-task
description: Manage scheduled tasks on this machine through systemd user timers ONLY (`systemctl --user`), never crontab. Use when the user asks to schedule something, run every X, a cron job, a recurring or background task, a systemd timer, backup/sync automation, or asks what is scheduled and when it next runs. Owns the octask CLI, OnCalendar expressions, and the octask- unit prefix. See @scheduled-agent for unattended agent runs.
---

# scheduled-task

Per-user systemd timers (`systemctl --user`) on this Arch machine. Never
crontab, anacron, or system-wide timers. "cron job" means an `OnCalendar`
user timer.

Timer mechanics live here: the `octask` CLI, the `octask-` unit prefix,
OnCalendar expressions, discovery, editing, removal. The @scheduled-agent
skill owns the restricted agent definition an unattended `--agent` run
requires.

## The model

Everything this skill manages uses the shared prefix **`octask-`**:

- Units: `~/.config/systemd/user/octask-<name>.service` (the job) and
  `octask-<name>.timer` (the schedule).
- Discovery: `systemctl --user list-timers 'octask-*' --all`. The prefix is
  the discovery mechanism; never create manually named timer pairs.
- Helper CLI: **`octask`**, a Rust binary, canonical source at
  `~/Projects/agent/scripts` (GitHub `FAZuH/agent`). Install from a clone with
  `cargo install --path scripts` (lands on `$PATH` as `~/.cargo/bin/octask`):

  ```bash
  octask add <name> --exec "<cmd>" [--oncalendar "<expr>"] [--persistent]
             [--description "..."] [--workdir <dir>] [--timeout <sec>]
             [--env "K=V"] [--delay "<span>"] [--no-enable] [--force]
  octask add <name> --agent <id> --prompt "..." --workdir <dir>
             [--model <provider/model>] [--oncalendar "<expr>"]
             [--persistent] [--dirty-only] [--timeout <sec>]
             [--credential NAME:PATH] [--delay "<span>"]
             [--no-enable] [--force]
  octask edit <name> [--model <p/m> | --no-model] [--prompt "..."]
             [--agent <id>] [--oncalendar "<expr>"] [--description "..."]
             [--workdir <dir>] [--timeout <sec>]
             [--credential NAME:PATH | --clear-credentials]
             [--delay "<span>" | --no-delay] [--persistent | --no-persistent]
             [--dry-run]
  octask show <name>
  octask remove <name> [--dry-run]
  octask list
  octask export [name ...] [--file <path>]
  octask import [--file <path>] [--force] [--no-enable]
  octask enable <name> | disable <name>
  octask status <name> | logs <name> [-n <lines>]
  ```

  Without `--model`, agent runs use the `model:` field from the agent's
  frontmatter. Passing `--model` overrides it. Without either, the server
  falls back to its catalog default, which is not a cheap unattended model.

  > **Agent runs are unattended.** The agent cannot answer permission prompts,
  > so it MUST be deny-all-by-default with a narrow allowlist. Use the
  > @scheduled-agent skill to write the restricted agent definition before
  > scheduling with `--agent`.

## First, discover what exists

Never assume. Before any add/edit/remove, run `octask list` plus
`systemctl --user list-timers --all --no-pager` (catches non-octask timers).
Report: managed units, other timers with next runs, inactive or failed
(`systemctl --user --failed`).

## Adding a scheduled task

1. Decide the schedule and build an `OnCalendar` expression:

   | Expression | Meaning |
   |------------|---------|
   | `*-*-* 02:00:00` | daily at 02:00 |
   | `00/6:00:00` | every 6 hours (00:00, 06:00, …) |
   | `*:0/5` | every 5 minutes |
   | `Mon *-*-* 03:00:00` | Mondays at 03:00 |
   | `*-*-* 00/12:00:00` | twice a day, every 12 hours |

2. Validate it: `systemd-analyze calendar "<expr>"` shows parse and next runs.
3. Add and enable:
   ```bash
   octask add <name> --oncalendar "<expr>" --exec "<command>" --persistent
   ```
   - `octask add` validates the expression again before writing anything, and
     runs `systemd-analyze verify` on the generated units after writing.
   - Prefer `--persistent` so missed runs catch up after the machine was off
     (timers do not catch up without it).
   - Prefer `--delay <span>` (→ `RandomizedDelaySec=`) when several timers
     share a schedule, so they do not fire in the same instant.
4. Confirm: re-run `octask list` and state the NEXT run time to the user.

Schedule hint for "run every N hours": use `00/N:00:00` (fires on the hour,
every N hours). For "once per 12 hours with a stagger" use
`--oncalendar '*-*-* 00/12:00:00' --delay 30min`.

## Removing and editing

- Remove: `octask remove <name>` stops, disables, deletes both unit files, and
  reloads the daemon. Use `--dry-run` first for anything you are unsure about.
- Pause: `octask disable <name>` stops and disables the timer but keeps the
  units; re-enable later with `octask enable <name>`.
- Inspect: `octask show <name>` prints parsed task values (agent, model,
  prompt, schedule, and so on) plus next run.
- Edit: `octask edit <name> [options]` changes agent flags (`--model`,
  `--no-model`, `--prompt`, `--agent`), schedule (`--oncalendar`, `--delay` /
  `--no-delay`, `--persistent` / `--no-persistent`), `--dirty-only` /
  `--no-dirty-only`, `--description`, `--workdir`, `--timeout`; common fields
  also work on `--exec` tasks. Preserves custom `--env` and the timer's enabled
  state. Use `--dry-run` first to diff without writing.
  `--no-dirty-only` is the way out of a dirty-only task whose directory stopped
  being a git repository; without it every edit fails, `--dry-run` included.

## Export / import

- `octask export [name ...] [--file <path>]` writes a JSON backup of one,
  several, or all tasks (no names = all) to stdout, or to `--file`.
- `octask import [--file <path>] [--force] [--no-enable]` recreates tasks
  from exported JSON (`--file` or stdin). It replays through `octask add` so
  all validation still applies, refuses to overwrite without `--force`, and
  preserves the exported enabled state unless `--no-enable`.

## Troubleshooting

- Did it run? `octask logs <name>` (or `octask logs <name> -n 200`)
- Why failed? `octask status <name>` (timer + service status)
- Not firing? Check the timer is loaded and enabled: `octask list`; check the
  service is not in `systemctl --user --failed`; remember `Persistent=true`
  only matters with a valid last-trigger timestamp.
- After editing unit files by hand: `systemctl --user daemon-reload`.

## OnCalendar reference

`OnCalendar=` is close to cron but explicit: `DayOfWeek Year-Month-Day
Hour:Minute:Second`, e.g. `*-*-* 02:00:00` or `Mon *-*-* 03:00:00`. Slashes
mean "every N from the left value" (`00/6:00:00` is every 6 h from 00:00, not
cron's `*/6`). Validate anything non-trivial with `systemd-analyze calendar`.

## Success criteria

- Discovery ran first and you said what already exists.
- The expression was validated with `systemd-analyze calendar` (or by
  `octask add`, which re-validates) before any unit file was written.
- Units use the `octask-` prefix under `~/.config/systemd/user/`.
- After any change you re-listed timers and stated the next run.
- Ambiguous destructive steps used `--dry-run` first.
- `--agent` tasks use a restricted deny-all-by-default agent definition, or
  the run was refused/reported unsafe.

## Report

Give a short summary after any change, for example:

```
Added octask-backup.timer → octask-backup.service,
OnCalendar=*-*-* 02:00:00, Persistent=true.
Next run: 2026-08-31 02:00:00 WIT (via octask list).
Enabled+started. Confirmed NEXT column.
```
