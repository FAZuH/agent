---
name: scheduled-agent
description: Schedule unattended OpenCode agent runs on systemd user timers — run an agent headlessly on a schedule (auto-commit vaults, periodic reviews, digests). Use when the user asks to run an agent automatically, on a timer, unattended, periodically (e.g. "auto-commit every 12 hours", "run the reviewer nightly"), or to set up headless `opencode run` automation. Includes writing the restricted least-privilege agent definition (deny-all-by-default permissions) that such runs require. Uses the octask- unit prefix; pairs with the scheduled-task skill for listing/removal.
---

# scheduled-agent

Run an OpenCode agent unattended on a systemd user timer. Two pieces are
needed: (1) a **restricted agent definition** that is safe to run without a
human, and (2) a **timer** that invokes `opencode run --agent <id>`. Live
example on this machine: `notes-autocommit.timer` running the `autocommit`
agent (see "Reference implementation").

Everything scheduled uses the `octask-` prefix (same namespace as the
`scheduled-task` skill) — `octask list`, `octask remove`, `octask
enable`/`disable`, and `octask logs` manage these runs too.

## Step 1 — write the restricted agent definition

Unattended runs can never answer permission prompts. The agent MUST be
deny-all-by-default with a narrow allowlist, or it is not safe to schedule.

Create a Markdown agent file:

- Project/vault-scoped agent → `<project>/.opencode/agents/<name>.md`
- Available in every project → `~/.config/opencode/agents/<name>.md`

Template (V2 `permissions` ordered-array format, last matching rule wins —
broad deny FIRST, exceptions AFTER):

```md
---
description: <one line — what it does unattended>
model: <cheap model, e.g. opencode/muse-spark-1.2-contributor-free>
mode: primary
steps: 30
permissions:
  - action: "*"
    resource: "*"
    effect: deny
  - action: read
    resource: "*"
    effect: allow
  - action: glob
    resource: "*"
    effect: allow
  - action: list
    resource: "*"
    effect: allow
  - action: grep
    resource: "*"
    effect: allow
  - action: edit
    resource: "<the ONLY path(s) it may write>"
    effect: allow
  - action: shell
    resource: "<narrow command patterns, e.g. git *>"
    effect: allow
  - action: shell
    resource: "git push*"
    effect: deny
---

<narrow system prompt: the exact task, its inputs/outputs,
the allowlist it must stay within, and when to exit without acting.>
```

Rules and gotchas:

- **`mode: primary`** is required — `opencode run --agent <id>` selects the
  agent as the session's main agent; `subagent`-mode agents cannot be
  selected.
- **Last matching rule wins.** Broad `"*"` deny goes first, narrow allows
  after, and specific denies (e.g. `git push*`) last of all.
- **`ask` is unusable unattended** — no human answers it. Treat every rule you
  would write as `ask` as `deny`.
- Shell resources match **raw command text** (`~`/`$HOME` are NOT expanded for
  `shell`; they ARE expanded for `read`/`edit` resources). Match the literal
  command, e.g. `git *`.
- Deny destructive commands explicitly after the broad allow: `git push*`,
  `git reset*`, `git checkout*`, `git clean*`.
- Keep the `model` cheap and `steps` low — unattended runs must fail cheap.
- **Binary selection matters**: the script prefers `~/.opencode/bin/opencode2`
  (the v2 beta that owns the service DB). Older builds (e.g. `/usr/bin/opencode`
  1.18.x) fail against the migrated DB with `no such column: project_id`. If
  `opencode run` dies with that error, the wrong binary is being used.
- The body (system prompt) must state the narrow task and explicitly forbid
  everything else ("You may edit only X. Never push. Exit if nothing to do.").

## Step 2 — schedule the run

Use the unified `octask` CLI (on `$PATH` as `~/.local/bin/octask`, or from
`~/.config/opencode/skills/scheduled-task/scripts/octask`):

```bash
octask add <name> \
  --agent <agent-id> \
  --prompt "<instruction for the run>" \
  --workdir <project dir> \
  --oncalendar '*-*-* 00/12:00:00' \
  --persistent --dirty-only --delay 30min
```

Options: `--oncalendar` (default every 12 h), `--persistent` (catch up after
the machine was off — prefer it), `--dirty-only` (skip the run when the git
worktree is clean), `--delay <span>` (→ `RandomizedDelaySec=`, staggers runs
that share a schedule), `--timeout <sec>` (default 600), `--no-enable`
(create without enabling), `--force` (overwrite).

The script pre-flights: workdir exists and is a git repo, `opencode` binary
resolution (`~/.opencode/bin/opencode2` preferred, PATH fallback), and the
agent definition exists (`~/.config/opencode/agents/<id>.md` or
`<workdir>/.opencode/agents/<id>.md`) — it warns loudly if not. It also runs
`systemd-analyze verify` on the generated units. The service runs with a
trimmed `PATH=/usr/local/bin:/usr/bin` and `WorkingDirectory`.

## Step 3 — verify BEFORE trusting it

1. One manual run: `systemctl --user start octask-<name>.service` — watch it:
   `octask logs <name> -f` (or `journalctl --user -u octask-<name>.service -n 50 -f`)
2. Check the agent actually did the right thing (and nothing else).
3. `octask list` → confirm the timer is enabled and note the NEXT run.
4. Only then leave it enabled.

## Reference implementation

`~/.config/systemd/user/notes-autocommit.{timer,service}` runs the
`autocommit` agent (defined in `~/.config/opencode/agents/autocommit.md`)
against `~/Workspaces/Notes` every 12 hours with `--dirty-only` semantics:
skip when `git status --porcelain` is empty, otherwise commit pending changes.
Use it as the pattern for new autocommit-style schedules.

## Success criteria

- Agent definition is deny-all-by-default with a narrow allowlist, documented
  `mode: primary`, cheap model, low `steps`, and destructive commands denied.
- The timer used the `octask-` prefix and a validated OnCalendar expression.
- One manual run completed successfully and its side effects were inspected
  before the schedule was left enabled.
- `Persistent=true` decision was made deliberately (catch-up or not).

## Report

```
Scheduled octask-notes-commit: agent autocommit in ~/Workspaces/Notes,
OnCalendar=*-*-* 00/12:00:00 +30min stagger, Persistent, dirty-only.
Manual run OK (1 commit created). Next run: 2026-08-31 00:07 WIT.
```
