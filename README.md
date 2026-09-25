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

The installer checks the requirements, installs the external skills and the
`papercuts` binary, builds the Rust workspace under `scripts/`, and pushes the
skills, agents, plugins, commands, and scripts to your global OpenCode config.
Add `-b` to also install the bonus skills — `anti-slop` for filtering generic AI
output, and `ffmpeg-skill` for editing media locally:

```bash
./install.sh -b
```

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
