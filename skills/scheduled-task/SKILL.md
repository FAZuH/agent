---
name: scheduled-task
description: Manage scheduled tasks on this machine through classic user crontab AND systemd timers (both per-user and system-wide). Use this skill whenever the user asks to set up, list, edit, remove, or troubleshoot anything scheduled to run on a schedule — cron, crontab, cron jobs, scheduled jobs, recurring tasks, "run every X", background jobs that repeat, systemd .timer units, timer-based automation, or asks "is this running on a schedule?" or how to schedule a backup/sync/script. This includes explaining and validating the 5 cron time fields, building a `*/5 * * * *` style schedule expression, and computing next-run times (using `crontab -l`, `systemctl list-timers`, `next` probing, and `systemd-analyze calendar`). Prefer this over generic scheduling advice; also use it when deciding whether a task belongs in cron vs a systemd timer.
---

# scheduled-task

Manage scheduled tasks on this Arch Linux machine. Two scheduling systems exist here, and you must figure out which one a given task uses (or should use) before acting:

1. **Classic user crontab** (`crontab`) — plain `*/5 * * * * cmd` lines.
2. **systemd timers** — `.timer` + `.service` unit pairs, either per-user (`systemctl --user`) or system-wide (`systemctl`).

This machine also uses **anacron** for some cron entries (a crontab line may invoke `anacron` with a custom config) — see the "Anacron" section before assuming a plain crontab schedule is the whole story.

## First, find out what actually exists

Never assume. OpenCode can serve the user badly by guessing which scheduler is in use. Run this discovery set and read the output:

```bash
crontab -l 2>&1                    # user crontab entries
ls -la /etc/cron* 2>/dev/null      # system cron dirs, if any
systemctl list-timers --all --no-pager        # system timers
systemctl --user list-timers --all --no-pager # per-user timers
systemctl list-timers --all --no-pager --state=inactive 2>/dev/null
systemctl --user list-timers --all --no-pager --state=inactive 2>/dev/null
```

Report concisely what you found: how many cron entries, which user/system timers exist and their activate targets, and whether anything is inactive (a crippled config the user may have forgotten). Distinguish entry types — a crontab line that starts with a time like `0 * * * *` is a classic entry; a line that shells out to `anacron` is an anacron-managed job (see the anacron note).

## Which scheduler should the task use?

Recommend the right tool rather than blindly using whatever the user said. General guidance:

- **User-level recurring app tasks** (screenlogs, media syncs, personal scripts) → **per-user systemd timers** (`systemctl --user`) is the cleanest modern option, especially if the task starts X or needs the user session.
- **Shorter/more frequent jobs** (minutes) or things you already have in crontab → crontab is fine.
- **System-level maintenance** (backups, log rotation, arch sync) → system systemd timers.

If the user has an existing journal (many jobs already in cron) and just wants one more, prefer consistency. Don't force a migration unless one already started — but do mention the option when adding something new and clearly better as a --user timer.

## Cron: explaining and validating syntax

The 5 (optionally 6) fields of a standard cron line are, in order:

| Field | Allowed values |
|-------|----------------|
| minute | 0–59 |
| hour | 0–23 |
| day of month | 1–31 |
| month | 1–12 (or JAN–DEC) |
| day of week | 0–7 (0 and 7 both mean Sunday, or SUN–SAT) |

Common syntax elements:

- **`*`** — every value in the field.
- **`*/N`** — every N (e.g. `*/5` = every 5 minutes / units).
- **`a-b`** — range.
- **`a,b,c`** — list.
- **`a-b/N`** — step over a range.
- Note the gotcha: when **both** day-of-month and day-of-week are restricted (not `*`), the job runs when EITHER matches (OR logic). When only one is restricted, the other acts as `*`.

Validate a proposed expression before writing it. Good rule of thumb for a common schedule: `*/5 * * * *` is every 5 minutes, `0 * * * *` is top of every hour, `0 2 * * *` is 2:00 AM daily, `0 3 * * 1` is 3:00 AM every Monday.

Use `crontab`'/s own parser where possible to validate a full appended line before committing:

```bash
echo "*/5 * * * * /usr/bin/foo" | crontab -   # DOES commit — see warning below
```

**Warning — commit carefully.** `crontab -` replaces the ENTIRE crontab from stdin. It is far safer to write to a temp file, validate, then install, and to back up first:

```bash
crontab -l > /tmp/crontab.bak          # backup
# ... edit /tmp/newcrontab ...
crontab /tmp/newcrontab                # install validated file
```

Show the user a `diff` of old vs new before installing. If you only need to validate an expression without touching reality, use `systemd-analyze calendar "*/5 * * * *"` for timers, or a crontab-specific checker if available. When editing with the interactive `crontab -e` is impossible (non-interactive shell), always go the file route above.

## Systemd timers

A timer needs two units: a `<name>.timer` (the schedule) and a `<name>.service` (the job). For **per-user**, files live in `~/.config/systemd/user/` and use `systemctl --user ...`. For **system-wide**, files live in `/etc/systemd/system/` and use `systemctl ...` (which requires `sudo -A`).

Example per-user daily backup timer:

`~/.config/systemd/user/backup.timer`:
```
[Unit]
Description=Daily backup

[Timer]
OnCalendar=*-*-* 02:00:00
Persistent=true

[Install]
WantedBy=timers.target
```

`~/.config/systemd/user/backup.service`:
```
[Unit]
Description=Daily backup job

[Service]
Type=oneshot
ExecStart=/home/<USER>/.local/bin/backup
```

> [!NOTE]
> Replace `<USER>` with actual user

Then:
```bash
systemctl --user daemon-reload
systemctl --user enable --now backup.timer
systemctl --user list-timers
```

`OnCalendar=` takes a calendar expression very close to cron (e.g. `*-*-* 02:00:00`, `Mon *-*-* 03:00:00`, `*:0/5` for every 5 minutes). Use `systemd-analyze calendar "<expr>"` to validate and see the next fire time.

For **system** timers, repeat with `systemctl` (no `--user`) and `sudo -A <cmd>` for the file write / enable, per this repo's safety rules (`sudo -A`, never plain `sudo`).

## Next-run and verification

- **cron**: run `crontab -l` and, where feasible, compute the next fire time by hand from the fields (or use a helper). There is no built-in "next run" for cronie; reason it out from the schedule and `date`, showing your work briefly.
- **timers**: `systemctl --user list-timers` / `systemctl list-timers` shows `NEXT` immediately. For a precise next-fire of an OnCalendar, use `systemd-analyze calendar "<cal>"`.
- After adding/editing anything, re-list to confirm and tell the user the next scheduled run.

## The anacron note

Anacron catches up on jobs that were missed while the machine was off (cron itself does not run missed jobs). That's why this machine might have an anacron entry in crontab (observed line: `0 * * * * anacron -t ~/.config/anacron/anacrontab -S .../spool`). If a cron entry shells out to `anacron`, respect that it's anacron-managed — the real schedule lives in the anacrontab file, and "run missed job on next boot" is expected behavior, not a bug. Do not blindly rewrite it into a bare crontab time.

## Success criteria

- You identified which scheduler each task uses (cron vs timer, user vs system) and said so.
- You produced a valid schedule expression (cron or `OnCalendar`), validated it, and can state the next run time.
- For edits/removals you backed up or diffed before installing, and confirmed live state after.
- You used `sudo -A` (never bare `sudo`) for any system-level change.

## Report

Give a short summary after any change, for example:

```
Added per-user timer backup.timer → backup.service, OnCalendar=*-*-* 02:00:00.
Next run: 2026-08-03 02:00:00 WIB (via systemctl --user list-timers).
Enabled+started. Confirmed NEXT column.
```
```
