# Router

`route.py` routes a prompt with no named project to the project and session
that should own it. It returns evidence, not a verdict. The `router` agent
reads the evidence, confirms the destination with the user, then dispatches the
target session.

## Flow

```text
prompt
  → project index (git repos under the registry roots)
  → project evidence (path, repo URL, name, content paths, descriptions)
  → session evidence (titles, then real prompts and answers)
  → dossier (compact first; full on demand)
  → router judgement
  → handoff prompt
  → user gate
  → dispatch (new or resumed session)
```

The index is cached at `~/.cache/fazuh-agent/projects.json` and rebuilt when
older than `signals.index_max_age_hours`. The registry is
`~/.config/fazuh-agent/route-projects.json`; `route.py init` creates it.

## Evidence

| Signal | Source | Weight |
|---|---|---|
| `path` | Prompt names the project path | Direct |
| `repo_url` | Prompt links the project's origin URL | Direct |
| `name_phrase` | Prompt contains the full repo name | Direct |
| `alias` | Registry alias appears in the prompt | Direct |
| `repo_name`, `path_token` | Token or prefix match on the name/path | `unique`, `shared`, or `generic` |
| `content` | An identifier from the prompt appears in a tracked file path | `unique` |
| `description`, `scratch` | README, AGENTS.md, workspace title match | `shared` |
| `session_text` | Recent user prompts and assistant answers match | `unique` at 2+ user matches, else `shared` |
| `session_title` | A top-level or child session title matches a rare term | `unique` when strong |

`brief --compact` omits full session lists and token arrays. It keeps the prompt,
the top three project candidates, up to eight `session_candidates`, references,
and warnings. Use the full `brief` when a candidate needs every excerpt.

Specificity comes from how many indexed projects use the term. A term in more
than `signals.generic_term_projects` projects is generic. The registry's
`signals.generic_terms` list also marks words that never count, even when the
corpus is small. Generic-only candidates are dropped.

Prefix matching requires the shorter token to be at least 4 characters and at
least 60% of the longer one: `postfix` matches `postfixctl`; `graf` does not
match `grafana`.

## Session matching

Project-local sessions are listed from the API. Global session search reads
`session_v2` and `session_message` from `~/.local/share/opencode/opencode.db`.
`route.py sessions --query TEXT` searches titles first, then message text; add
`--detail` to see each session's first and recent user prompts.

- Titles locate sessions. A title word must be rare enough: document frequency
  at most `signals.title_term_df_limit`.
- Titles drift. The dossier carries the session's first prompt, last three user
  prompts, last two assistant excerpts, and a drift check that looks for paths
  naming a different git repo.
- `user_match` words come from the session's own user prompts; `assistant_match`
  words come only from its answers. User matches outrank assistant matches.
- Child sessions are searched because they hold context, but they are never
  offered for resume.
- Sessions run by the `router` agent are skipped: a dispatcher is not a
  destination.
- Archived sessions are ignored.
- Resuming is refused for child or archived sessions.

`session_candidates` is the short list the router reads first. It merges the top
project's local sessions with `related_sessions` from the project's parent
directories and title search. `relation` is `repo` when the session directory is
the project, `parent` when it sits one or two directories above it, and `title`
when only the title search found it. A `parent` session is a valid resume target
even when the destination repo is a subdirectory and the session directory is
not a git repo. `resumable` is false for child sessions.

`related_sessions` searches the project's parent directories and title search
for context that lives one level up, such as a migration session started in the
course directory instead of the repo.

## Gate and dispatch

The default gate is a user question: chosen project, session, action, and one
line of reasoning per candidate. It can also offer `report only` when the prompt
is discovery: the router answers with the candidates and pending work, and
dispatches nothing. Auto mode skips the gate only when the user asked for auto.

Before dispatch, the router writes a handoff prompt to
`/tmp/opencode/route-handoff.txt`: the task, the decision so far, the next
action, and the files or paths to start from. The target receives the handoff
prompt, not the original discovery prompt and not the dossier.

`route.py dispatch` accepts `--dry-run` (plan only) and requires `--yes` to
create or prompt a session.

- A new session needs `--project`, must sit inside a git repo, defaults to
  `--agent orchestrator`, and uses the server's model unless `--model` is passed.
- A resumed session needs only `--session`. It uses the session's own directory,
  needs no git repo, and keeps its agent, model, and title. `--agent`,
  `--model provider/model[#variant]`, and `--title` switch those fields only when
  passed explicitly.
- The plan reports the actual `agent`, `model`, `title`, and `sessionID`, plus
  the `open` command.

It never calls `session_move`: v2 keeps child sessions in the old directory and
the TUI does not follow.

## Permissions

The router reads anywhere, runs the route CLI plus read-only filters (`head`,
`tail`, `jq`, `wc`, `echo`), asks with `question`, loads only the `routing`
skill, and reaches Hindsight through Code Mode for signal proposals. It cannot
edit outside `/tmp/opencode`. Shell rules match each command in a pipeline or
list, so the procedure invokes `route.py` as one command and redirects its
dossier to a file.

## Eval

`route.py eval --prompts PATH` runs a JSONL prompt set against the live index
and session database. Each row can carry `expected_project` and
`expected_session`; the report shows `match`, `miss`, `ask`, and the session
match.

The prompt set is machine-local because it names real projects and paths.
Keep it outside the repo and pass its path explicitly.

## Signal proposals

The router files a Hindsight entry after a user override or a misroute:

- `document_id: router-signal-<slug>`
- tags `type:friction`, `scope:router`, `status:proposed`, `machine:<host>`
- the prompt, the wrong candidate, the missing signal, and the suggested fix

Update `route-projects.json` only from confirmed proposals. This keeps the
signal config current without hard-coding one-off guesses.

## Commands

```sh
route.py init
route.py index [--refresh]
route.py brief --compact --prompt-file PATH
route.py brief --prompt-file PATH
route.py sessions --project PATH [--query TEXT] [--detail]
route.py dispatch --project PATH --prompt-file PATH [--agent NAME] [--model PROVIDER/MODEL[#VARIANT]]
                  [--title TITLE] [--dry-run] [--yes]
route.py dispatch --prompt-file PATH --session ID [--agent NAME] [--model PROVIDER/MODEL[#VARIANT]]
                  [--title TITLE] [--dry-run] [--yes]
route.py eval --prompts PATH [--json]
route.py doctor
```

Tests: `python3 scripts/route_test.py`.

## Files

- `scripts/route.py`: CLI and dossier builder
- `scripts/route_test.py`: unit tests
- `~/.config/fazuh-agent/router-eval.jsonl`: machine-local eval prompts
- `agents/primary/router.md`: router agent
- `skills/orchestration/routing/SKILL.md`: routing procedure
- `~/.config/fazuh-agent/route-projects.json`: registry
- `~/.cache/fazuh-agent/projects.json`: project index
- `~/.local/state/fazuh-agent/routes.jsonl`: dispatch ledger (hashes, no prompt text)
