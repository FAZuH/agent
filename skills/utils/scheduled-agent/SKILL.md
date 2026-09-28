---
name: scheduled-agent
description: Schedule an unattended OpenCode agent run on a systemd user timer, and write the restricted deny-all-by-default agent definition it needs. Use when the user asks to run an agent automatically, on a timer, headlessly, or to set up `opencode run` automation. Timer mechanics (the octask CLI, OnCalendar, listing, removal) live in the @scheduled-task skill.
---

# scheduled-agent

Run an OpenCode agent unattended on a systemd user timer. Two pieces are
needed: (1) a **restricted agent definition** that is safe to run without a
human, and (2) a **timer** that invokes `opencode run --agent <id>`. Live
example on this machine: `notes-autocommit.timer` running the `autocommit`
agent (see "Reference implementation").

This skill owns the agent definition and the verification of an unattended
run. The @scheduled-task skill owns the timer mechanics: the `octask` CLI,
OnCalendar expressions, listing, editing, and removal. It also owns the
`octask-` unit prefix both skills share.

## Step 1: write the restricted agent definition

Unattended runs can never answer permission prompts, so the agent MUST be
deny-all-by-default with a narrow allowlist (V2 ordered-array `permissions`:
broad `*` deny first, narrow allows after, see
[permissions](https://opencode.ai/v2/docs/agents/#permissions)).

Create a Markdown agent file:

- Project/vault-scoped agent → `<project>/.opencode/agents/<name>.md`
- Available in every project → `~/.config/opencode/agents/<name>.md`

Template (V2 `permissions` ordered-array format, last matching rule wins:
broad deny FIRST, exceptions AFTER):

```md
---
description: <one line: what it does unattended>
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

- **`mode: primary`** is required: `opencode run --agent <id>` selects the
  agent as the session's main agent, and `subagent`-mode agents cannot be
  selected.
- **Last matching rule wins.** Broad `"*"` deny goes first, narrow allows
  after, and specific denies (e.g. `git push*`) last of all.
- **`ask` is unusable unattended**, no human answers it. Treat every rule you
  would write as `ask` as `deny`.
- Shell resources match **raw command text** (`~`/`$HOME` are NOT expanded for
  `shell`; they ARE expanded for `read`/`edit` resources). Match the literal
  command, e.g. `git *`.
- Deny destructive commands explicitly after the broad allow: `git push*`,
  `git reset*`, `git checkout*`, `git clean*`.
- Keep the `model` cheap and `steps` low, unattended runs must fail cheap.
- **Gates run in auto only if you configure it.** A headless run cannot
  answer `question` forms, so they get auto-dismissed and any gate that fires
  makes the gated action not happen. The run mode comes only from the user:
  bake "run in auto mode" into the agent's system prompt when you want
  `normal`/`subagent` gates to skip (`always` gates still fire and will fail
  the action, so configure the permissions to make that impossible instead).
  If you leave it out, that is a configuration problem on your side, not
  something the run detects. See the @gate skill.
- **Binary selection matters**: the script prefers `~/.opencode/bin/opencode2`
  (the v2 beta that owns the service DB). Older builds (e.g. `/usr/bin/opencode`
  1.18.x) fail against the migrated DB with `no such column: project_id`. If
  `opencode run` dies with that error, the wrong binary is being used.
- The body (system prompt) must state the narrow task and explicitly forbid
  everything else ("You may edit only X. Never push. Exit if nothing to do.").

## Step 2: schedule the run

Timer mechanics live in @scheduled-task (the `octask` CLI, OnCalendar
expressions, discovery, removal). Load it for those. The agent-run form:

```bash
octask add <name> \
  --agent <agent-id> \
  --prompt "<instruction for the run>" \
  --workdir <project dir> \
  --model opencode/muse-spark-1.2-contributor-free \
  --oncalendar '*-*-* 00/12:00:00' \
  --persistent --dirty-only --delay 30min
```

`--dirty-only` skips the run when the worktree is clean, which is what an
autocommit-style task wants. Pass `--model` explicitly: without it the run
falls back to the agent's `model:` frontmatter and then the server's catalog
default, which is not a cheap unattended model.

## Step 3: verify BEFORE trusting it

1. One manual run: `systemctl --user start octask-<name>.service`, then watch
   it with `octask logs <name> -f`.
2. Check the agent actually did the right thing (and nothing else). A timer
   reaching `Finished`, exit 0, or a clean tree can mask an instant failure
   (e.g. `Invalid API key` when a contributor-free model needs interactive
   auth), so read the run's output, not just the exit status.
3. `octask list` to confirm the timer is enabled and note the NEXT run.
4. Only then leave it enabled.

## Reference implementation

`~/.config/systemd/user/notes-autocommit.{timer,service}` runs the
`autocommit` agent (defined in `~/.config/opencode/agents/autocommit.md`)
against `~/Projects/notes` every 12 hours with `--dirty-only` semantics:
skip when `git status --porcelain` is empty, otherwise commit pending changes.
Use it as the pattern for new autocommit-style schedules.

## Success criteria

- Agent definition is deny-all-by-default with a narrow allowlist, documented
  `mode: primary`, cheap model, low `steps`, and destructive commands denied.
- One manual run completed successfully and its side effects were inspected
  before the schedule was left enabled.

## Report

```
Scheduled octask-notes-commit: agent autocommit in ~/Projects/notes,
OnCalendar=*-*-* 00/12:00:00 +30min stagger, Persistent, dirty-only.
Manual run OK (1 commit created). Next run: 2026-08-31 00:07 WIT.
```
