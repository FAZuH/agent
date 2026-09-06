---
name: external-skills
description: Install, update, list, or remove upstream-owned (External class) agent skills via the `skills` CLI into `~/.agents/skills`. Use when the user asks to install, add, update, or remove a third-party skill, mentions `npx skills add`, or names a GitHub skill repo to set up.
---

# External Skills

Manage upstream-owned skills (the External class in @fazuh-agent): install,
update, list, remove. These live in `~/.agents/skills/` and are owned
upstream — updated through the CLI, never hand-edited.

## Rule 0 — check the CLI first

Flags drift. Before any install, run `npx skills --help` and use what it
reports. Known-good forms (long = short): `--global` = `-g`,
`--agent` = `-a`, `--skill` = `-s`, `--yes` = `-y`.

## Install

Global, for OpenCode (the default — available in every session):

```bash
npx skills add <owner/repo> --global --agent opencode --yes
```

Variants:

```bash
npx skills add <owner/repo> --global --agent opencode --yes --skill <name>  # one skill from a multi-skill repo
npx skills add <owner/repo> --global --agent opencode --yes --skill '*'     # every skill in the repo
npx skills add <owner/repo> --global --agent opencode --list                # preview what a repo offers, install nothing
```

Project-level (omit `--global`) only when the skill is repo-specific.
Never install the same repo global AND project-level — OpenCode registers
the same ids twice.

## Update, list, remove

```bash
npx skills list --global --agent opencode      # verify an install
npx skills update <name> --global --yes        # refresh one skill upstream
npx skills remove <name> --global --agent opencode --yes
```

## Hard rules

- **Never hand-edit `~/.agents/skills/`.** Install target only. Fix by
  reinstalling/updating, or propose the change upstream.
- **Config roots shadow it.** If @skill-doctor flags a `collision` between
  `~/.config/opencode/skills/<name>` and `~/.agents/skills/<name>`, the
  config copy wins and the npx copy is dead weight — remove the shadowed
  npx copy.
- After install or update, restart OpenCode so the new copies are picked up.

## Fallback — CLI rejects the repo (`No valid skills found`)

The CLI strictly parses `SKILL.md` frontmatter. An upstream `description:`
with unquoted colons (`requests: cut, trim, …`) is invalid YAML, so the
install reports `Skipped …/SKILL.md — YAML parse error` and installs
nothing (exit code stays 0 — check the output, not the code). When that
happens:

```bash
git clone --depth 1 https://github.com/<owner>/<repo> /tmp/opencode/<repo>
mkdir -p ~/.agents/skills/<skill>
cp /tmp/opencode/<repo>/SKILL.md ~/.agents/skills/<skill>/
cp -r /tmp/opencode/<repo>/scripts /tmp/opencode/<repo>/references ~/.agents/skills/<skill>/
```

Then verify: `opencode2 api get /api/skill | grep -o '"id":"<skill>"'`,
plus `python3 ~/.agents/skills/<skill>/scripts/<tool>.py --help`.
A manual copy is invisible to `npx skills list/update` — once upstream
quotes the description, re-run the CLI install to bring it under
management. Caveat: OpenCode serves the skill's `content` but drops an
unparseable `description`, so it may not auto-trigger on mention
until upstream fixes the frontmatter — invoke it by name meanwhile.
