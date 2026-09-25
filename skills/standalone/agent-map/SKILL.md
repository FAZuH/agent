---
name: agent-map
description: Map and maintain this personal-public agent repository. Use when classifying files, choosing a source directory, authoring or reviewing skills, agents, plugins, commands, or sync scripts, routing agent work, checking repository links, or deploying changes through sync.sh.
---

# Agent Map

Use this skill as the portable map for the agent repository. It explains where
an item belongs, which rules apply, and how a source change reaches a target
configuration.

This skill is repository guidance. It does not contain machine paths,
credentials, local target state, or host commands. Keep those facts in the host
`AGENTS.md` or another host-specific file.

## Source map

- `skills/` contains skills grouped by purpose. Each skill has a
  `SKILL.md` file.
- `agents/` contains agent definitions grouped by role. Each agent has a
  Markdown file.
- `plugins/` contains OpenCode plugins. Keep plugin dependencies in
  `plugins/package.json`.
- `commands/` contains user-facing command definitions.
- `sync.sh` deploys repository items to OpenCode configuration directories.
- `targets.conf` defines named deployment targets. `global` is implicit.
- `tags.conf` defines selective deployment tags.
- `.agent-values.example` documents portable template keys. The local
  `.agent-values` file supplies their values and is not committed.
- `.agent-sync.json` records deployed items and content hashes. It is local
  state and is not committed.
- `README.md` is the public entry point. Keep it portable and free of machine
  details.

## Classify before editing

Use these classes:

- Public repository item: portable instructions, skills, agents, plugins,
  commands, and scripts. Do not include credentials, private paths, host names,
  current installation state, or machine-only values.
- Host-specific item: paths, credentials, local services, installed inventory,
  and commands that only make sense on one machine. Keep this in the host
  `AGENTS.md` or another host-specific file.
- External item: an upstream-owned skill or plugin. Install and update it
  through its owner. Do not hand-edit its installed copy.

If an item fails the portability test, keep its reusable rules in the public
repository and its machine-specific values in the host overlay.

## Choose the source directory

| Item | Source location |
| --- | --- |
| Skill | `skills/<category>/<name>/SKILL.md` |
| Agent | `agents/<category>/<name>.md` |
| Plugin | `plugins/<name>/` |
| Command | `commands/<name>.md` |
| Repository script | `scripts/<name>` |
| Public documentation | `README.md` or `docs/` |

Use the category that matches how the agent reaches the item:

- `orchestration`: large workflows that coordinate other work
- `workflow`: procedures that perform a defined task
- `referential`: rules and conventions loaded by other skills
- `standalone`: standards and guidance consulted directly
- `ocv2`: OpenCode v2 operations

## Repository agents

Agent definitions live under `agents/<category>/<name>.md` and install flat as
`agents/<name>.md`. Keep the category that matches the agent's role:

- `primary`: orchestration, conversation, tutoring, unattended commits, and
  digest agents
- `build`: implementation and verification
- `review`: code review, malware checks, and PII checks
- `research`: repository discovery and external research
- `vision`: image, web, Mermaid, and SVG inspection
- `document`: documentation and session closeout

Keep subagents within the task assigned by the primary agent. They report
blockers instead of silently changing scope. The primary agent owns delegation
and prevents duplicate work.

## Route to the existing guidance

Load the narrowest existing skill that matches the task:

- `workflows` for delegation, task routing, and the standard work procedures
- `session` for `.scratch/` session workspaces and checkpoints
- `finish` for end-of-session cleanup and closeout
- `test-guidelines` for test design
- `gui-test-guidelines` for browser or desktop UI tests
- `opencode-skill-creator` for creating and evaluating skills
- `simple-english` for documentation prose
- `worktree-new` and `worktree-close` for isolated branch work
- `rust-idioms` and `rust-tea` for Rust design and UI architecture
- `notes` for durable tool and OpenCode notes
- `external-skills` for upstream-owned skills
- `skill-doctor` for skill links, names, collisions, and drift
- `readme` for README structure
- `commit-scopes` for commit vocabulary

Do not copy rules from these skills into this map. Keep this skill focused on
repository orientation and boundaries.

## Author a repository item

1. Classify the item as public, host-specific, or external.
2. Choose the source directory from the table above.
3. Write the smallest complete instruction or implementation.
4. Add or update its README entry when the item is public.
5. Run the repository checks that cover the changed file type.
6. Review the diff for private data, stale paths, and broken links.

The item is ready when its source, documentation, and validation agree.

## Deploy with `sync.sh`

The repository is the source of truth. `sync.sh` copies items to targets and
tracks the copied content. Do not hand-edit a target copy.

Preview before writing:

```bash
./sync.sh list
./sync.sh diff -g
./sync.sh push -g --dry-run
```

Deploy a global target:

```bash
./sync.sh push -g
```

Deploy a project target or every configured target:

```bash
./sync.sh push <project-directory>
./sync.sh all push
```

After a push, restart OpenCode so it loads the new copies. Use `diff` before
every deployment when the target state is uncertain. Use `pull` only when the
target contains the changes that belong in the source. Pull skips files with
machine templates.

The manifest protects target state. A stale target is removed only when its
content still matches the recorded hash. Modified target files are kept and
reported. Existing files outside the manifest are left alone.

## Use templates for machine values

Use an uppercase double-brace placeholder only for a value that must differ by
machine. Add the key to `.agent-values.example` and set its value in the local
`.agent-values` file.
`sync.sh` fails when a selected file has an undefined key. `pull` skips
templated files so expanded machine paths do not return to the source.

## Keep the host overlay thin

A host `AGENTS.md` can use this pointer:

```md
## Personal-public agent repository

For repository layout, file classification, authoring rules, validation, and
deployment, read `agent-map`. Keep machine-specific paths, credentials,
installed inventory, and host commands in this file.
```

The host file keeps facts that change per device. This skill keeps rules that
travel with the repository.
