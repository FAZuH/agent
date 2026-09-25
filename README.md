<div align="center">

# agent

**My personal OpenCode setup: skills, agents, plugins, and commands, installed with one script.**

</div>

<hr>

<div align="center">
● <a href="#installation">Installation</a> ﻿ ● <a href="#usage">Usage</a> ﻿ ● <a href="#docs">Docs</a> ﻿ ● <a href="#license">License</a>
</div>

## Installation

### Requirements

- OpenCode v2 on your `PATH`.
- `git`, `cargo`, `npx`, `rsync`, and `python3`.
- `ffmpeg` only for the bonus install.

`install.sh` checks these commands. It never installs operating-system packages
and never calls `sudo`, so install anything missing first and rerun it.

### Install

```bash
git clone https://github.com/FAZuH/agent.git
cd agent
./install.sh
```

It installs every item below.

From this repository, with no upstream:

- `skills/`, `agents/`, `plugins/`, and `commands/` into `~/.config/opencode/`.
- Every executable file in `scripts/` into `~/.local/bin/`.
- The Rust package `agent`, giving you `octask`, `phone-digest`, and
  `mail-digest`.
- `.agent-values`, created from `.agent-values.example` on the first run.

From an upstream, installed through the
[`skills`](https://github.com/vercel-labs/skills) CLI into `~/.agents/skills/`.
Never hand-edit these copies; update them from their owner.

- [mattpocock/skills](https://github.com/mattpocock/skills) — 18 engineering
  skills: `ask-matt`, `code-review`, `codebase-design`, `diagnosing-bugs`,
  `domain-modeling`, `grill-with-docs`, `implement`,
  `improve-codebase-architecture`, `prototype`, `research`,
  `resolving-merge-conflicts`, `setup-matt-pocock-skills`, `tdd`, `to-spec`,
  `to-tickets`, `triage`, `wayfinder`, `wizard`.
- [mattpocock/skills](https://github.com/mattpocock/skills) — 6 productivity
  skills: `grill-me`, `grilling`, `handoff`, `to-questionnaire`, `wait-what`,
  `writing-for-agents`.
- [Agents365-ai/365-skills](https://github.com/Agents365-ai/365-skills) —
  `mermaid-skill`.
- [AminBlg/SimpleEnglish](https://github.com/AminBlg/SimpleEnglish) —
  `simple-english`.
- [FAZuH/papercuts](https://github.com/FAZuH/papercuts) — the `papercuts` CLI,
  installed with `cargo install`.
- [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail) — the
  `plugins/ponytail/upstream` submodule, and the `fazuh.ponytail` plugin that
  wraps it.

Add `-b` to also install the bonus skills — `anti-slop` for filtering generic AI
output, and `ffmpeg-skill` for editing media locally:

```bash
./install.sh -b
```

Both come from an upstream:

- [miqdadbadjuber/anti-slop](https://github.com/miqdadbadjuber/anti-slop) — 6
  skills: `antislop`, `antislop-code`, `antislop-copywriting`, `antislop-human`,
  `antislop-layoutmobile`, `antislop-ui`.
- [kajisho5/ffmpeg-skill](https://github.com/kajisho5/ffmpeg-skill) —
  `ffmpeg-skill`, copied by hand and checked with its own doctor script.

### Uninstall

```bash
./uninstall.sh --dry-run   # preview the cleanup
./uninstall.sh
```

The default removes the sync-managed skills, agents, plugins, commands, and
scripts, and uninstalls the local `agent` Cargo package. It keeps OpenCode,
`papercuts`, the external skills, operating-system packages, and the checkout.
Add `--external-packages` to remove `papercuts` too, or `--external-skills` to
remove the external skills listed under Install.

## Usage

```bash
./install.sh          # once
./sync.sh push -g     # after every change
```

`sync.sh` copies the repository items into the OpenCode config. Run
`./sync.sh --help` for selective tags, project targets, and templates. OpenCode
v2 hot-reloads most of the changes, so restart it only when a changed component
does not appear or a plugin is not loaded.

## Docs

- [Skills](docs/skills.md) — all 58 skills, one line each
- [Skill Guide](docs/skill-guide.md) — which skills to load at each phase of a change
- [Agents](docs/agents.md) — all 17 agent definitions, by role
- [Plugins](docs/plugins.md) — the four OpenCode plugins, plus the command definitions in `commands/`
- [Commit and Changelog](docs/dev/commit-changelog.md) — how this repository writes commits and changelog entries
- [Commit Scopes](docs/dev/commit-scopes.md) — the closed vocabulary of Conventional Commit scopes
- [Gate Classes and Auto Mode](docs/adr/0001-gate-classes-and-auto-mode.md) — why approval gates are split into classes

## License

MIT
