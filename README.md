<div align="center">

# agent

**My personal OpenCode setup: skills, agents, plugins, commands, and global instructions, installed with one script.**

</div>

<hr>

<div align="center">
● <a href="#installation">Installation</a> ﻿ ● <a href="#usage">Usage</a> ﻿ ● <a href="#docs">Docs</a> ﻿ ● <a href="#license">License</a>
</div>

## Installation

### Requirements

- OpenCode v2 on your `PATH`.
- `git`, `cargo`, `npx`, `rsync`, `python3`, `jq`, and `gh`. The `jq` scripts
  back the OpenCode v2 skills; `gh` backs every PR, issue, and release skill.
- `ffmpeg` only for the bonus install.

`install.sh` checks these commands. It never installs operating-system packages
and never calls `sudo`, so install anything missing first and rerun it.

It also reports the tools a skill calls on some paths only (`mmdc`,
`pandoc`, `pdflatex`, `xelatex`, `pdftotext`, `pdftoppm`,
`pdfinfo`, `rga`, `uv`, `clamscan`, `bun`, `opencode2`), with the package that
provides each. Those are notes, not failures: every skill that uses one has a
documented fallback, so the install continues.

### Check first

```bash
./install.sh --check
```

Prints every required command, optional package, and installed artifact as
`[ok]` or `[MISSING]`, then exits. Installs nothing, writes nothing, and exits
`1` when a required item is missing, so it is safe to run on a new machine
before installing.

### Install

```bash
git clone https://github.com/FAZuH/agent.git
cd agent
./install.sh
```

It installs every item below.

From this repository, with no upstream:

- `skills/`, `agents/`, `plugins/`, `commands/`, and `instructions/` as symlinks
  in `~/.config/opencode/` that point into the deployed clone.
- Every executable file in `scripts/` into
  `${XDG_DATA_HOME:-$HOME/.local/share}/fazuh-agent/bin/`, then symlinked into
  `~/.local/bin/`.
- The Rust package `agent`, giving you `octask`, `phone-digest`, and
  `mail-digest`.
- `.agent-values`, created from `.agent-values.example` on the first run.

In these managed directories a symlink belongs to the repository and a real file
or directory belongs to this machine. Never hand-edit a deployed copy in the
live config. Change the repository and deploy again.

The install also adds `~/.config/opencode/instructions/*.md` to the
`instructions` array in `~/.config/opencode/opencode.json`, so every file in
`instructions/` loads in every session, on any project. The glob is the entry:
a new instruction file needs no config change, only a deploy. The two always-on
skills, `terse` and `antislop-copywriting`, are linked into that directory from
their deployed `SKILL.md`, so their bodies load without a `skill` call.

From an upstream, installed through the
[`skills`](https://github.com/vercel-labs/skills) CLI into `~/.agents/skills/`.
Never hand-edit these copies; update them from their owner. The CLI takes
upstream `HEAD` and cannot pin a ref, so these move on their own.

- [mattpocock/skills](https://github.com/mattpocock/skills): 18 engineering
  skills: `ask-matt`, `code-review`, `codebase-design`, `diagnosing-bugs`,
  `domain-modeling`, `grill-with-docs`, `implement`,
  `improve-codebase-architecture`, `prototype`, `research`,
  `resolving-merge-conflicts`, `setup-matt-pocock-skills`, `tdd`, `to-spec`,
  `to-tickets`, `triage`, `wayfinder`, `wizard`.
- [mattpocock/skills](https://github.com/mattpocock/skills): 7 productivity
  skills: `grill-me`, `grilling`, `handoff`, `teach`, `to-questionnaire`,
  `wait-what`, `writing-for-agents`.
- [Agents365-ai/365-skills](https://github.com/Agents365-ai/365-skills):
  `mermaid-skill`.
- [AminBlg/SimpleEnglish](https://github.com/AminBlg/SimpleEnglish):
  `simple-english`.
- [FAZuH/bgrun](https://github.com/FAZuH/bgrun): the `bgrun` skill and the
  `bgrun` CLI, which runs a command as a systemd user unit.
- [vercel/board](https://github.com/vercel/board): the `board` skill for
  channels, threads, tasks, and waits. Loaded on demand, not in every session.

Add `-b` to also install the bonus items: `anti-slop` for filtering generic AI
output, `ffmpeg-skill` for editing media locally, and REA for reverse
engineering and authorized security work:

```bash
./install.sh -b
```

Both skills come from an upstream:

- [miqdadbadjuber/anti-slop](https://github.com/miqdadbadjuber/anti-slop): 6
  skills: `antislop`, `antislop-code`, `antislop-copywriting`, `antislop-human`,
  `antislop-layoutmobile`, `antislop-ui`.
- [kajisho5/ffmpeg-skill](https://github.com/kajisho5/ffmpeg-skill):
  `ffmpeg-skill`, copied by hand and checked with its own doctor script.

REA is an npm package with its own installer, so the bonus install runs
`rea setup --client opencode --yes` at the pinned version. Setup registers
REA's local MCP server in OpenCode's config and installs the
`reverse-engineer-anything` skill into `~/.agents/skills`. The MCP entry lives
in OpenCode's config, which `sync.sh` does not manage; `uninstall.sh
--external-skills` reverses setup with `rea uninstall`. Native binary analysis
additionally needs an existing Hopper, Ghidra, or IDA install; static
JavaScript, Electron, and .NET inspection need none of them.

- [morluto/rea](https://github.com/morluto/rea): reverse engineer binaries,
  apps, and runtime behavior through a local MCP server. Guides and case
  studies: [rea.tools](https://rea.tools/).

### Pinned versions

`install.sh` pins everything it fetches outside the `skills` CLI: the CLI's and
REA's npm versions, and the bgrun and ffmpeg-skill commits. The
pin block sits at the top of `install.sh`. To move one, load the `update-pins`
skill: it checks each remote, shows the diff between the pinned and current
commit, and only edits after you approve. `uninstall.sh` mirrors the npm pins
because a newer CLI cannot remove what it did not write.

### Uninstall

```bash
./uninstall.sh --dry-run   # preview the cleanup
./uninstall.sh
```

The default removes the sync-managed skills, agents, plugins, commands,
instructions, and scripts, and uninstalls the local `agent` Cargo package. It
keeps OpenCode, the external skills, operating-system packages, and the
checkout. It also keeps the global config's `instructions` entry, so a reinstall
needs no re-wiring. Add `--external-packages` to remove `bgrun` too,
`--external-skills` to remove the external skills listed under Install, or
`--instructions` to drop the entry.

## Usage

```bash
./install.sh                 # once
git switch deploy            # local promotion branch
./sync.sh deploy             # promote and link
```

Commit reviewed work to the local `deploy` branch, then run `./sync.sh deploy`.
The tool fetches that branch into a clone at
`${XDG_DATA_HOME:-$HOME/.local/share}/fazuh-agent/config`. The clone's origin is
this checkout, so no remote push is needed. `main` is not the promotion source.

`sync.sh` updates the clone and reconciles links in the global config. `list`
shows managed links beside private entries, `diff` compares the clone with the
promoted branch, and `remove` unlinks managed items. Use `-t` to filter by
`tags.conf`, `-n` for a dry run, and `-f` to adopt colliding real entries. Run
`./sync.sh --help` for the full command set.

`sync.sh deploy -n` materializes the promoted `deploy` ref in a temporary tree.
Its table shows what promotion ships, not what the working tree holds. A
collision makes the dry run exit non-zero.

When `plugins/package.json` exists, deploy runs `bun install --frozen-lockfile`
in the clone's `plugins/` directory. A missing bun or a failed install stops
deploy before any plugin is linked. With no `package.json`, deploy skips this
step.

On a real deploy, the tool checks
`${XDG_DATA_HOME:-$HOME/.local/share}/fazuh-agent/backups/`. If that directory
holds no `opencode-*.tar.gz`, the tool creates one tar of `~/.config/opencode`
there before any config, bin, or pointer write. A dry run creates no tar. To
roll back, restore that archive:

```bash
tar -C ~/.config -xzf <archive>
```

The tool also moves displaced entries under `backups/<timestamp>/`. Those files
are a secondary aid. Use the tar for rollback.

The live `~/.config/opencode/commands/imagescan` directory has no repository
copy and no manifest entry, so link pruning leaves it in place. Remove it once
during migration:

```bash
rm -rf ~/.config/opencode/commands/imagescan
```

`plugins/prompt/src/settings-wiring.test.ts` needs no removal. It is tracked and
byte-identical, so deploy adopts it by hash match.

The config directory keeps a `.agent-repo` pointer to this editable checkout for
update tooling. The tool records the clone path under the XDG data directory.

No deploy step restarts OpenCode. Two limits remain:

- A new instruction link is not in a running server's glob snapshot until the
  config changes next.
- Plugin `setup()` re-runs on edit without a restart, but old closures keep
  firing until restart.

## Docs

- [Skills](docs/skills.md): all 55 skills, one line each
- [Skill Guide](docs/skill-guide.md): which skills to load at each phase of a change
- [Agents](docs/agents.md): all 10 agent definitions, by role
- [Plugins](docs/plugins.md): the OpenCode plugins, plus the command definitions in `commands/`
- [Jev](docs/jev.md): the decision-model plugin: what it guarantees, what it costs, how to point it at another provider
- [Commit and Changelog](docs/dev/commit-changelog.md): how this repository writes commits and changelog entries
- [Commit Scopes](docs/dev/commit-scopes.md): the closed vocabulary of Conventional Commit scopes
- [Gate Classes and Auto Mode](docs/adr/0001-gate-classes-and-auto-mode.md): why approval gates are split into classes
- [Jev Port Notes](docs/dev/jev-port-notes.md): the jev build record: live results, the v2 plugin contract, what is still unproven

## License

MIT
