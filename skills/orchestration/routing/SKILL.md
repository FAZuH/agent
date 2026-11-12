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

Write the prompt verbatim to `/tmp/opencode/route-prompt.txt`, then:

```sh
route.py brief --prompt-file /tmp/opencode/route-prompt.txt
```

`route.py doctor` checks the registry, index, and API. Exit codes: 0 ok, 2 error.

## 2. Judge the evidence

Read every candidate:

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

## 3. Choose the action

Resume when the prior session's first prompt matches this task and recent text has not drifted. Start a new session when the work is different, or the old session is a child or archived.

Read `first_user_prompt`, `last_user_prompts`, `last_assistant_excerpts`, and `drift_evidence`. A title is not evidence: titles drift.

## 4. Gate

Default: ask before dispatch. Show the chosen project and session, one line per candidate saying why it fits or why not, and the action (resume or new).

Skip the gate only when the user said auto for this run. An explicit project or session in the prompt still gets a one-line confirmation.

## 5. Dispatch

```sh
route.py dispatch --project PATH --prompt-file PATH \
  [--session ses_...] --agent orchestrator --model provider/model --dry-run
route.py dispatch --project PATH --prompt-file PATH \
  [--session ses_...] --agent orchestrator --model provider/model --yes
```

`--dry-run` prints the plan and changes nothing. `--yes` is required to create or prompt a session. Pass `--model provider/model` to pin a model for a new session; otherwise the server default applies. A resumed session keeps its own model. On resume, check `session_matches_project`.

Never call `session_move`: child sessions stay behind and the TUI does not follow. The router dispatches; the orchestrator does the work.

## 6. Report and propose signals

Report the project, session ID, and `opencode <dir> -s <id>`.

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
| `route.py brief --prompt-file PATH` | Evidence dossier. Read-only. |
| `route.py sessions --project PATH [--query TEXT]` | List top-level sessions. |
| `route.py dispatch ... [--dry-run] [--yes]` | Create or resume a session. |
| `route.py eval --prompts PATH [--json]` | Run the routing eval set. |
| `route.py doctor` | Check registry, index, `opencode2`, API. |

## Limits

- The index covers `roots` only. A project outside them needs a root or an exclusion.
- Session text comes from the local `opencode.db`; the API is the fallback.
- `dispatch` refuses child and archived sessions.
- Matching is lexical. When the words do not separate the candidates, ask.
