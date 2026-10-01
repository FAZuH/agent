---
name: global-instruction
description: The common, machine-agnostic operating rules for every session: the skills that must always load, the working habits, shell discipline, and the papercuts contract. Load this first in every session; the host AGENTS.md names it. Use when the user says "global instructions", when a rule's full text is needed rather than the host one-liner, or in any repo whose AGENTS.md points here.
---

# Global Instruction

Common rules for every session, on any machine. The host AGENTS.md keeps only
what is true of one host (paths, credentials, installed commands) and points
here for the rest.

## Mandatory skill load

Load these before the first tool call, every session:

| Skill | Owns |
|---|---|
| `@ponytail` | The ladder: skip what need not exist, reuse what exists, stdlib and native before dependencies. |
| `@antislop` | The anti-slop filter for UI, copy, and code comments. |
| `@agent-map` | Repo layout, file classification, skill routing, delegation. |
| `@comments-discipline` | Whether a comment earns its line. |
| `@jev-use` | A judgement over enumerable options goes to Jev, not to deliberation. |
| `@prompt-user` | The bottom of a message that needs the user: 🏁 procedures, ❓ questions. |

## Working habits

- Check the current working directory first.
- Use $latex$ for inline latex, and $$latex$$ for a latex block.

## Shell discipline

- Serialize writes to one path: never batch an edit with a shell
  read-modify-write of the same file; the later write can undo the earlier one.
- Never kill with `pkill -f <pattern>`: the pattern matches the invoking
  wrapper's own cmdline. Kill the captured PID, then verify with
  `ps -e -o pid,args | grep -F <exact path>`.
- `git commit` with explicit pathspecs. `git commit -m` commits the whole index,
  which may hold staged work from another concern.
- Write commit messages to a file, then `git commit -F <file>` in its own call.
  Never chain the message-file `rm` into that command line.
- Before editing a repo config file, check it is not a symlink. The edit tool
  writes through the link into the shared target.

## Papercuts

The `papercuts` CLI ships with this repository's `install.sh`. When you hit
friction (a dead-end tool call, a broken link, a confusing setup step, a flaky
command, a misleading error), file it before moving on:

- `papercuts add "<what you were doing > what got in the way>"`, one or two
  sentences. Attach `--cmd` / `--exit` / `--stderr-file` for tool failures.
  Never feed raw env dumps.
- Severity: `minor` by default, `major` for time sinks, `blocker` for walls.
- File in the moment; do not stop working. This is friction, not a bug tracker.
- Repo store: `.papercuts.jsonl` at the repo root, append-only. Check
  `git status` before assuming it is tracked. `papercuts resolve <id>` marks
  one fixed.
- Global store: `papercuts -g`, tagged `self::skill` / `self::agent-def` /
  `self::tool` / `self::process`; @papercut-sweep sweeps them. Repo sanding
  stays repo-local.
- `papercuts schema` prints the machine contract; `papercuts doctor` validates
  the log file. Clear the backlog with `papercuts list --format md`.
