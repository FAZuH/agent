# octask

CLI to manage systemd user timers for recurring shell commands and scheduled
OpenCode agent runs.

- [Outline](#outline)
- [Installation](#installation)
- [Usage](#usage)

## Outline

`octask` wraps managed `octask-*` systemd user units — one `.service` plus one
`.timer` per task. `add` writes the units, `show` and `logs` inspect them,
`remove` deletes them. Units stay hand-off: edit them freely with any tool.

## Installation

Prebuilt Linux binaries are attached to each release:

```sh
curl -fsSL -o /usr/local/bin/octask \
  https://github.com/FAZuH/octask/releases/latest/download/octask
chmod +x /usr/local/bin/octask
```

Or build from source:

```sh
cargo install --git https://github.com/FAZuH/octask
```

## Usage

```sh
# every day at 02:00
octask add backup --exec 'rsync -a ~/Notes/ ~/Backup/Notes' \
  --oncalendar '*-*-* 02:00:00' --description 'nightly notes backup'

# OpenCode agent on a schedule
octask add autocommit --agent autocommit --prompt 'commit pending changes' \
  --workdir ~/Notes --model litellm/free-pro --dirty-only

octask list
octask show backup
octask logs backup -n 20
```
