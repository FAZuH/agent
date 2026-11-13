---
name: routing
description: >-
  Route a prompt with no named project to the project and session that should
  own it: build an evidence dossier, judge fit, confirm with the user, dispatch
  an orchestrator session. Triggers: where does this go, which project or
  session, continue this work elsewhere, route this prompt.
---

# routing

`route.py` collects evidence. You decide. A score never dispatches on its own.

## 1. Build the dossier

Write the prompt verbatim to `/tmp/opencode/route-prompt.txt`, then dump the
compact dossier to a file:

```sh
route.py brief --compact --prompt-file /tmp/opencode/route-prompt.txt > /tmp/opencode/route-brief.json
```

Read `/tmp/opencode/route-brief.json`. It carries the prompt, the top three
project candidates, up to eight `session_candidates`, references, and warnings.
Run the full `brief` (without `--compact`) only when the compact output leaves a
real question open. Run `route.py` as one command: never pipe it, and never chain
it with `;` or `&&`. Permission rules match every command in a pipeline or list,
so a trailing `| head` or `; echo $?` is denied.

`route.py doctor` checks the registry, index, and API. Exit codes: 0 ok, 2 error.

## 2. Judge the evidence

Read `session_candidates` first, then the project candidates:

| Signal | Meaning |
|---|---|
| `path`, `repo_url`, `name_phrase`, `alias` | Names the destination. Outranks everything. |
| `unique` | Fits one project. |
| `shared` | Fits a few projects. |
| `generic` | Fits many. Not evidence. |
| `session_text` | Real user prompts and assistant answers match. |
| `session_title` | Locates an old session only. Read its dossier before trusting it. |
| `drift` | Recent text names another repo. The session moved. |
| `references` | External URLs. Context, never the destination. |

A candidate fits when its evidence explains this prompt. Terms like `fix`, `config`, `skill`, `sync`, `agent`, and `module` explain nothing on their own. If the top two tie, or every candidate is shared or generic, ask.

Inside `session_candidates`, `relation` says where the session lives:

| Relation | Meaning |
|---|---|
| `repo` | The session directory is the project. |
| `parent` | The session sits one or two directories above the project. Valid resume target, common for course or workspace sessions. |
| `title` | Found by title search. A lead only; read the dossier first. |

`user_match` lists prompt words the session's own user prompts contain.
`assistant_match` lists words only its answers contain. Prefer `user_match`: an
assistant can mention a term without the task being about it. `resumable` is
false for child sessions. Sessions run by the `router` agent are skipped: a
dispatcher is not a destination.

## 3. Choose the action

Resume when the prior session's first prompt matches this task and recent text has not drifted. Start a new session when the work is different, or the old session is a child or archived. A `parent` session is a valid resume target even when the destination repo is a subdirectory.

Read `first_user_prompt`, `last_user_prompts`, `last_assistant_excerpts`, and `drift_evidence`. A title is not evidence: titles drift.

Write the handoff prompt to `/tmp/opencode/route-handoff.txt`: the task, the decision so far, the next action, and the files or paths to start from. This is what the target receives. Never replay the discovery prompt, and never paste the whole dossier.

## 4. Gate

Default: ask before dispatch with the `question` tool. Show the chosen project and session, one line per candidate saying why it fits or why not, and the action (resume or new). Offer `report only` when the prompt is discovery: answer with the candidate sessions and pending work, and dispatch nothing. Skip the gate only when the user said auto for this run. An explicit project or session in the prompt still gets a one-line confirmation.

## 5. Dispatch

```sh
# New session: --project is required.
route.py dispatch --project PATH --prompt-file /tmp/opencode/route-handoff.txt \
  [--agent orchestrator] [--model provider/model] [--title TITLE] --dry-run

# Resume: omit --project; the session's own directory is used.
route.py dispatch --prompt-file /tmp/opencode/route-handoff.txt --session ses_... \
  [--agent NAME] [--model provider/model] [--title TITLE] --dry-run
```

Repeat with `--yes` after the gate. `--dry-run` prints the plan and changes
nothing. `--yes` is required to create or prompt a session.

- A new session defaults to `orchestrator` and the server's model.
- A resumed session keeps its own agent, model, and title. Pass `--agent` only
  to switch the agent, `--model provider/model[#variant]` only to switch the
  model, and `--title` only to rename it.
- A resumed session needs no git repo: its directory may be a parent folder.
- Report the actual `agent`, `model`, `title`, and `sessionID` from the plan, and
  `open` for the command that opens it.

Never call `session_move`: child sessions stay behind and the TUI does not follow. The router dispatches; the orchestrator does the work.

## 6. Report and propose signals

Report the project, session ID, and `opencode <dir> -s <id>`. If the user chose
report only, report the candidates and pending work; do not dispatch.

After a user override or a misroute, file a Hindsight proposal:

- `retain` with `document_id: router-signal-<slug>`
- tags `type:friction`, `scope:router`, `status:proposed`, `machine:<host>`
- include the prompt, the wrong candidate, the missing signal, and the suggested fix

The registry is `~/.config/fazuh-agent/route-projects.json`:

| Key | Effect |
|---|---|
| `projects.<path>.aliases` | Strong phrases for that project. |
| `projects.<path>.keywords` | Weaker phrases. |
| `projects.<path>.description` | Extra description text. |
| `projects.<path>.exclude` | Keep a repo out of the index. |
| `signals.generic_terms` | Words that never count as evidence. |
| `signals.session_stopwords` | Words ignored in session text. |
| `signals.title_term_df_limit` | How common a title word may be before it stops locating sessions. |
| `roots`, `max_depth`, `exclude` | Which repos the index walks. |

Update the registry only from confirmed proposals.

## Commands

| Command | Use |
|---|---|
| `route.py init` | Create the registry. |
| `route.py index [--refresh]` | Build or refresh the project index. |
| `route.py brief --compact --prompt-file PATH` | Compact evidence dossier. Read-only. |
| `route.py brief --prompt-file PATH` | Full dossier with every session excerpt. |
| `route.py sessions --project PATH [--query TEXT] [--detail]` | List top-level sessions; `--query` searches titles and message text. |
| `route.py dispatch ... [--dry-run] [--yes]` | Create or resume a session. |
| `route.py eval --prompts PATH [--json]` | Run the routing eval set. |
| `route.py doctor` | Check registry, index, `opencode2`, API. |

## Limits

- The index covers `roots` only. A project outside them needs a root or an exclusion.
- Session text comes from the local `opencode.db`; the API is the fallback.
- `dispatch` refuses child and archived sessions.
- `dispatch` needs `--project` for a new session and refuses a new session outside a git repo. A resume skips both checks.
- Matching is lexical. When the words do not separate the candidates, ask.
