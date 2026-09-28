---
name: app-paths
description: Resolve per-application directory paths (config, data, cache, state) through one precedence ladder — CLI flag > env var > config file > platform default. Use when writing or reviewing code that locates a config file, stores app data, picks a cache directory, or needs config/env/CLI overrides for a path. Covers the dirs and directories crates, XDG semantics, and injecting paths in tests instead of writing to the real home directory.
license: MIT
---

# App paths

Never hand-roll a path like `~/.myapp` or `$HOME/.config/myapp`. Resolve every
directory once at startup, through one ladder, and pass the result down.

## The ladder

Highest wins:

1. **CLI flag** — `--data-dir /mnt/big`
2. **Env var** — `MYAPP_DATA_DIR=/mnt/big`
3. **Config file** — `data_dir = "/mnt/big"` in the config file
4. **Platform default** — from the OS convention

Two different namespaces meet here, and conflating them is the usual bug:

- `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_CACHE_HOME`, `XDG_STATE_HOME` are
  **global per-user** variables. The platform crate already honours them. Do
  not read them yourself, and do not invent your own spelling of them.
- `MYAPP_*` are **per-application** overrides, and they are yours to define.
  This is the layer that lets a user redirect one app without touching the rest.

## Which directory holds what

| Kind | Platform default | Holds | Disposable |
|---|---|---|---|
| config | `config_dir` | settings, credentials, tokens | no — often read-only in practice |
| data | `data_dir` | durable user data worth backing up | no |
| cache | `cache_dir` | anything reconstructable | yes — the user may delete it |
| state | `state_dir` | logs, history, last-run markers | no, but not worth backing up |

Cache is a promise: a user deleting the cache directory must never lose data.
If putting a file in `cache_dir` would lose something, that file belongs in
`data_dir`.

## Resolve once, inject everywhere

Call the platform crate **once**, in startup, and hand a struct to everything
else. A call site that calls `dirs::data_dir()` directly silently ignores every
override above, and makes the value untestable.

```rust
use std::path::PathBuf;

#[derive(Debug, Clone)]
pub struct Paths {
    pub config: PathBuf,
    pub data: PathBuf,
    pub cache: PathBuf,
    pub state: PathBuf,
}

fn first(candidates: [Option<PathBuf>; 4]) -> Option<PathBuf> {
    candidates.into_iter().flatten().next()
}

impl Paths {
    pub fn resolve(cli: &Cli, env: &Env, file: &FileConfig) -> Result<Self, PathError> {
        let base = directories::ProjectDirs::from("", "", "myapp");

        // config_dir can only come from CLI or env. The config file that
        // would name it does not exist until we have already found it.
        let config = first([
            cli.config_dir.clone(),
            env.path("MYAPP_CONFIG_DIR"),
            None,
            base.as_ref().and_then(|b| b.config_dir().map(PathBuf::from)),
        ])
        .ok_or(PathError::NoConfigDir)?;

        // Every other kind may also be named in the config file, because
        // config_dir is resolved by now and the file has been read.
        let data = first([
            cli.data_dir.clone(),
            env.path("MYAPP_DATA_DIR"),
            file.data_dir.clone(),
            base.as_ref().and_then(|b| b.data_dir().map(PathBuf::from)),
        ])
        .ok_or(PathError::NoDataDir)?;

        let cache = first([
            cli.cache_dir.clone(),
            env.path("MYAPP_CACHE_DIR"),
            file.cache_dir.clone(),
            base.as_ref().and_then(|b| b.cache_dir().map(PathBuf::from)),
        ])
        .ok_or(PathError::NoCacheDir)?;

        // ... same shape for state.
    }
}
```

Array order *is* the precedence, so the ladder is readable in one glance and
cannot drift from the docs.

## Rules

- **The chicken-and-egg rule.** `config_dir` is overridable by CLI and env
  only. Anything overridable by the config file must be a *different*
  directory, or be resolved after the file is read.
- **Normalise before use.** Expand a leading `~` and make the path absolute.
  A relative `--data-dir .` must not resolve against whatever directory the
  process happened to start in.
- **Create lazily.** Build a directory on first write, not at startup. Startup
  should not litter a machine for a command that turns out to be `--help`.
- **Secrets in `config_dir` are mode 0600.** Config is the one kind that
  routinely holds credentials. `data_dir` is for things the user expects to
  find and read.
- **Do not put absolute paths in the config file that the platform must
  supply.** Only override what the user asked to override.

## Tests never touch the real home

A test that resolves the real `data_dir` writes into the developer's actual
account, and passes on a machine that happens to have write access. Build a
`Paths` from a temp directory instead:

```rust
let paths = Paths {
    config: tmp.join("config"),
    data: tmp.join("data"),
    cache: tmp.join("cache"),
    state: tmp.join("state"),
};
```

This only works because startup returns a plain struct. That is the real
reason for the injection, more than convenience.

## Naming the env vars

Convert a Rust field name to its variable with `heck`, so the mapping is one
call and never a hand-written string that drifts from the field:

```rust
use heck::ToShoutySnakeCase;

"data_dir".to_shouty_snake_case();     // "DATA_DIR"
```

The two crates for reading them:

- `figment` — layered config with real precedence and provenance, so an error
  can name the source that supplied a bad value. `Env::prefixed("MYAPP_")`
  plus `Toml::file(...)`; `merge` replaces, `join` only fills gaps. Its `Jail`
  sandboxes env and filesystem for tests.
- `envy` — the small option. `envy::prefixed("MYAPP_").from_env::<Config>()`.
  Deserialize-only, so it cannot report where a value came from.

## Reference

- `dirs` — <https://crates.io/crates/dirs>. The low-level crate: free
  functions like `config_dir`, `data_dir`, `cache_dir`, `state_dir`, each
  returning the bare base with no per-app subdirectory. Reach for it when you
  want a base directory and are content to append the application name
  yourself, or when you want a directory kind the `directories` crate does not
  expose.
- `directories` — <https://crates.io/crates/directories>. Same author, adds
  `ProjectDirs`, which appends the per-app subdirectory using each platform's
  own convention. Prefer this for anything user-facing.
