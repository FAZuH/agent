---
name: global-instruction
description: The common, machine-agnostic operating rules for every session: the skills that must always load, the working habits, shell discipline, and the friction contract. Load this first in every session; the host AGENTS.md names it. Use when the user says "global instructions", when a rule's full text is needed rather than the host one-liner, or in any repo whose AGENTS.md points here.
---

# Global Instruction

Rules for every session, on any machine. The host AGENTS.md keeps host-only facts (paths, credentials, installed commands) and points here for the rest.

## Mandatory skill load

Load these before the first tool call, every session:

| Skill | Owns |
|---|---|
| `@antislop-copywriting` | The anti-slop filter for writing in general. |
| `@agent-map` | Skill routing. |
| `@terse` | Terse docs and comments: keep only what earns its place. |

## Working habits

These are items you must do in specific situations.

- Check the current working directory first.
- For latex, follow @presenting-latex.
- @presenting-latex : Writing latex
- @prompt-user : Asking follow-up questions or telling the user to do something. This does not apply to @learn quizzes. The user will most likely ignore your prompts to the user if you do not follow this exact format.
- Hindsight memory is the default memory, not an occasional extra.
  - `recall` before planning, diagnosing, or answering anything about prior work, a tool's behavior, or this user's setup. Assume a learned fact may already exist; a cheap recall beats a re-derivation.
  - `retain` anything likely to be asked again, once verified: decisions and outcomes after review passes, tool/service quirks after a live check, research answers, user corrections and preferences.
  - Skip one-off task trivia; a polluted bank buries the good facts.
  - If the hindsight MCP tools are absent, continue without memory. Docs: @hindsight-docs.

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

## Friction

File friction before moving on (dead-end tool call, broken link, confusing setup,
flaky command, misleading error). Defer environment improvements to the end of
the session instead of fixing them mid-task. The store is Hindsight: one bank,
every project and node.

- File with `retain`: one or two sentences (`"<doing> > <blocked-by>"`),
  `document_id: "friction-<short-slug>"`, tags `type:friction`,
  `severity:minor|major|blocker`, `machine:<hostname>`, `status:open`, plus
  `project:<repo>` for repo friction or `scope:skill|agent-def|tool|process`
  for fixes that outlive one repo.
- Severity: `minor`, `major` for time sinks, `blocker` for walls.
- List open: `recall` by query, then keep only results whose `tags` include
  `type:friction` and `status:open`. The server-side tag filter is unreliable
  (measured 2026-10-13); tags ride on every result, so filter client-side.
- Resolved: `retain` again with the same `document_id` and a `status:resolved`
  tag (`update_mode: "upsert"`). Never a duplicate.
- File in the moment, keep working. Friction, not a bug tracker. @friction-sweep
  acts on open entries; repo code friction gets fixed in normal work.
