---
name: scheduled-task
description: Manage scheduled tasks on this machine through systemd user timers ONLY (`systemctl --user`) — add, list, remove, edit, and troubleshoot anything scheduled to run on a schedule. Use this skill whenever the user asks to schedule, run every X, cron, crontab, cron job, recurring task, background job, systemd timer, .timer unit, "on a schedule", backup/sync automation, or asks what is scheduled and when it next runs. Cron requests are translated into systemd user timers. Schedule expressions use OnCalendar syntax, validated with `systemd-analyze calendar` and confirmed with next-run times.
---

# scheduled-task

Manage scheduled tasks on this Arch Linux machine with **per-user systemd
timers** (`systemctl --user`). Do not use crontab, anacron, or system-wide
timers. If the user says "cron job", translate the schedule to an `OnCalendar`
user timer.

## The model

Everything this skill manages uses the shared prefix **`octask-`**:

- Units: `~/.config/systemd/user/octask-<name>.service` (the job) and
  `octask-<name>.timer` (the schedule).
- Discovery: `systemctl --user list-timers 'octask-*' --all` — the prefix is
  the discovery mechanism; never create manually named timer pairs.
- Helper script: **`octask`** — installed on `$PATH` as
  `~/.local/bin/octask` → `~/.config/opencode/skills/scheduled-task/scripts/octask`
  (also runnable by full path from this skill's base directory):

  ```bash
  octask add <name> --exec "<cmd>" [--oncalendar "<expr>"] [--persistent]
             [--description "..."] [--workdir <dir>] [--timeout <sec>]
             [--env "K=V"] [--delay "<span>"] [--no-enable] [--force]
  octask add <name> --agent <id> --prompt "..." --workdir <dir>
             [--model <provider/model>] [--oncalendar "<expr>"]
             [--persistent] [--dirty-only] [--timeout <sec>]
             [--delay "<span>"] [--no-enable] [--force]
  octask remove <name> [--dry-run]
  octask list
  octask enable <name> | disable <name>
  octask status <name> | logs <name> [-n <lines>]
  ```

  Without `--model`, agent runs use the `model:` field from the agent's
  frontmatter. Passing `--model` overrides it (→ `opencode run --model
  <provider/model> --agent <id>`); without it, the server may fall back to
  its catalog default (currently `opencode-go/hy4-preview`), so always set
  `--model` explicitly for cost-controlled unattended runs.

  > **Agent runs are unattended.** The agent cannot answer permission prompts,
  > so it MUST be deny-all-by-default with a narrow allowlist (see
  > [permissions](https://opencode.ai/v2/docs/agents/#permissions)). Use the
  > @scheduled-agent skill to write the restricted agent definition before
  > scheduling with `--agent`.

## First, discover what exists

Never assume. Run `octask list` before adding, editing, or removing anything,
and `systemctl --user list-timers --all --no-pager` for timers NOT managed by
octask (this machine has other user timers). Report what you found: managed
octask units, other timers and their next run, anything inactive or failed
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

2. Validate it: `systemd-analyze calendar "<expr>"` — shows parse + next runs.
3. Add and enable:
   ```bash
   octask add <name> --oncalendar "<expr>" --exec "<command>" --persistent
   ```
   - `octask add` validates the expression again before writing anything, and
     runs `systemd-analyze verify` on the generated units after writing.
   - Prefer `--persistent` so missed runs catch up after the machine was off
     (systemd timers do not catch up without it).
   - Prefer `--delay <span>` (→ `RandomizedDelaySec=`) when several timers
     share a schedule, so they do not fire in the same instant.
4. Confirm: re-run `octask list` and state the NEXT run time to the user.

Schedule hint for "run every N hours": use `00/N:00:00` (fires on the hour,
every N hours). For "once per 12 hours with a stagger" use
`--oncalendar '*-*-* 00/12:00:00' --delay 30min`.

## Removing and editing

- Remove: `octask remove <name>` — stops, disables, deletes both unit files,
  reloads the daemon. Use `--dry-run` first for anything you are unsure about.
- Pause: `octask disable <name>` — stops and disables the timer but keeps the
  units; re-enable later with `octask enable <name>`.
- Edit: simplest is remove + re-add with the new options. Direct unit-file
  edits are fine for one-line changes, but always `systemctl --user
  daemon-reload` after and verify with `octask list`.

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
mean "every N from the left value" (`00/6:00:00` = every 6 h from 00:00; note
this is NOT the same as cron's `*/6`). Validate anything non-trivial with
`systemd-analyze calendar`.

## Success criteria

- You ran discovery first and said what already exists.
- The expression was validated with `systemd-analyze calendar` (or by
  `octask add`, which re-validates) before any unit file was written.
- Units use the `octask-` prefix and live in `~/.config/systemd/user/`.
- After any change you re-listed timers and stated the next run time.
- Destructive steps used `--dry-run` first when anything was ambiguous.
- Agent-scheduled tasks (`--agent`) use a restricted deny-all-by-default
  agent definition, or the run was refused/reported as unsafe.

## Report

Give a short summary after any change, for example:

```
Added octask-backup.timer → octask-backup.service,
OnCalendar=*-*-* 02:00:00, Persistent=true.
Next run: 2026-08-31 02:00:00 WIT (via octask list).
Enabled+started. Confirmed NEXT column.
```
