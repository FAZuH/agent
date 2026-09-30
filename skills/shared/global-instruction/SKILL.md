---
name: global-instruction
description: The common, machine-agnostic operating rules for every session - the skills that must always load, the working habits, shell discipline, and the papercuts contract. Load this first in every session; the host AGENTS.md names it. Use when the user says "global instructions", when a rule's full text is needed rather than the host one-liner, or in any repo whose AGENTS.md points here.
---

# Global Instruction

The machine-agnostic half of the host `AGENTS.md`. That file keeps only what is
true of one host (sudo, the npm supply chain, machine paths, model selection)
and points here for everything else. Nothing below names a path, a credential,
or a host command; that split is the whole reason this skill exists, and
@agent-map is the rule that draws it.

## Mandatory skill load

Load these before the first tool call, every session. The host `AGENTS.md`
carries the pointer and nothing else forces them, so a session that skips this
list is working without the rules.

| Skill | Owns |
|---|---|
| `@ponytail` | The ladder: skip what need not exist, reuse what already exists, stdlib and native before dependencies. |
| `@antislop` | The anti-slop filter for UI, copy, and code-comment work. |
| `@agent-map` | Repository layout, file classification, skill routing, agent roles, delegation, validation, deployment. Keep machine paths, credentials, installed inventory, and host commands in the host `AGENTS.md`, not here. |
| `@comments-discipline` | Whether a comment earns its line, and deleting the ones that do not. |
| `@jev-use` | When a decision is a judgement over enumerable options, ask Jev instead of deliberating: skill choice, control clicks, review order, bounded yes/no claims. |

## Working habits

- Check the current working directory first. Starting every shell call with a
  `cd` to where you already are is noise.
- Use $latex$ for inline latex, and $$latex$$ for a latex block.

## Questions to the user

When you have anything to ask the user, it goes at the bottom of the message,
in a numbered list. Always the bottom-most element: the answer first, then the
report, then the questions, so the last thing on screen is what needs
answering.

```markdown
❓ **Q1** - **<question title>**: <question body, might be multiple paragraphs, including multiple choices>

➡️ <your recommended answer>

---

❓ **Q2** - **<question title>**: <question body>

➡️ <your recommended answer>
```

- Numbering runs `Q1`, `Q2`, … across the message and restarts in the next one.
- Each question is one pointed question with its options, and the `➡️` line is
  your recommended answer with the reason. The recommendation is what lets the
  user reply with one word instead of writing your analysis back.
- Nothing to ask means nothing there: no heading, no `None`, no "let me know".
- When the message ends in a post-task report, that report's own format carries
  the questions — see @post-task.

## Shell discipline

- Serialize writes to the same path. Do not put an `edit`/`write` call and a
  shell read-modify-write for one file in the same parallel batch. A later
  write can silently undo the earlier one.
- Never kill by `pkill -f <pattern>` - the pattern matches the invoking
  wrapper's own cmdline and kills it instead of the victim. Kill the captured
  `$!`/PID and verify with `ps -e -o pid,args | grep -F <exact path>`.
- `git commit` with explicit pathspecs. `git commit -m` commits the whole
  index, which may hold the user's staged work from another concern.
- Write commit messages to a file, then `git commit -F <file>` in its own call.
  Never chain the message-file `rm` into the same command line; it runs before
  git reads it.
- Before editing a repo config file, check it is not a symlink (`ls -l`, or
  `git ls-files -s` for mode 120000). The edit tool writes through the link
  into the shared target; state the resolved target when it matters.

## Papercuts

The `papercuts` CLI ships with this repository's `install.sh`, so the contract
below is part of the install, not an optional habit.

When you hit friction during work - a dead-end tool call, a broken link, a
confusing or undocumented setup step, a flaky command, a stale cache, a
misleading error, a non-obvious gotcha - file it before moving on:

- `papercuts add "<what you were doing > what got in the way (guess at cause/fix is a bonus)>"` - one or two sentences.
- Attach `--cmd` / `--exit` / `--stderr-file` when filing tool failures. Never
  feed raw env dumps.
- Severity: `minor` (default) for annoyances, `major` for time sinks,
  `blocker` for hard walls.
- `papercuts schema` prints the full machine contract: commands, flags, env
  vars, exit codes. `papercuts doctor` validates the log file.

File it in the moment, even though none of these block progress - the backlog
is what shows where the setup needs sanding down. Do not stop working to file.

This is not a bug tracker. A papercut is friction, not a tracked defect.

- Repo store: `.papercuts.jsonl` at the repo root, append-only JSONL. Check
  `git status` / `.gitignore` before assuming it is tracked.
  `papercuts resolve <id>` marks one fixed.
- Global store: `papercuts -g` for friction whose fix lives outside this repo -
  skills, agent definitions, opencode config, tools, agent behavior. Tag
  self-improvement entries with the reserved namespace (`self::skill`,
  `self::agent-def`, `self::tool`, `self::process`); @papercut-sweep sweeps
  them. Repo sanding stays repo-local.
- To clear the backlog: `papercuts list --format md`, then fix the small
  recurring ones first.
