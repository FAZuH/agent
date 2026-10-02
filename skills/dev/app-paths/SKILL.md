---
name: app-paths
description: >-
  Resolve per-application directory paths (config, data, cache, state)
  through one precedence ladder: CLI flag > env var > config file > platform
  default. Use when writing or reviewing code that locates a config file,
  stores app data, picks a cache directory, or needs config/env/CLI
  overrides for a path. Covers the dirs and directories crates, XDG
  semantics, and injecting paths in tests instead of writing to the real
  home directory.
license: MIT
---

# App paths

Never hand-roll a path like `~/.myapp` or `$HOME/.config/myapp`. Resolve every
directory once at startup, through one ladder, and pass the result down.

## The ladder

Highest wins:

1. **CLI flag**: `--data-dir /mnt/big`
2. **Env var**: `MYAPP_DATA_DIR=/mnt/big`
3. **Config file**: `data_dir = "/mnt/big"` in the config file
4. **Platform default**: from the OS convention

Two namespaces meet here; conflating them is the usual bug:

- `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_CACHE_HOME`, `XDG_STATE_HOME` are
  **global per-user**. The platform crate already honours them. Never read them yourself, never invent your own spelling.
- `MYAPP_*` are **per-application** overrides. Yours to define: redirect one app without touching the rest.

## Which directory holds what

| Kind | Platform default | Holds | Disposable |
|---|---|---|---|
| config | `config_dir` | settings, credentials, tokens | no, often read-only in practice |
| data | `data_dir` | durable user data worth backing up | no |
| cache | `cache_dir` | anything reconstructable | yes, the user may delete it |
| state | `state_dir` | logs, history, last-run markers | no, but not worth backing up |

Cache is a promise: deleting it must never lose data. Doubt means `data_dir`.

## Resolve once, inject everywhere

Call the platform crate **once**, at startup, and hand the struct down. A call site calling `dirs::data_dir()` directly ignores every override and is untestable.

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

        // cache and state repeat the same four-slot shape.
    }
}
```

Array order *is* the precedence: readable in one glance, cannot drift from the docs.

## Rules

- **The chicken-and-egg rule.** `config_dir` is overridable by CLI and env
  only. Anything overridable by the config file must be a *different*
  directory, or be resolved after the file is read.
- **Normalise before use.** Expand leading `~`, make absolute.
  Relative `--data-dir .` must not resolve against the startup directory.
- **Create lazily.** Build on first write, not at startup. Startup must not litter the machine for `--help`.
- **Secrets in `config_dir` are mode 0600.** Config routinely holds credentials. `data_dir` holds what the user expects to read.
- **Do not put absolute paths in the config file that the platform must
  supply.** Override only what the user asked to override.

## Tests never touch the real home

A test resolving the real `data_dir` writes into the developer's account. Build a
`Paths` from temp instead:

```rust
let paths = Paths {
    config: tmp.join("config"),
    data: tmp.join("data"),
    cache: tmp.join("cache"),
    state: tmp.join("state"),
};
```

Injection works because startup returns a plain struct. Testability is the point, not convenience.

## Naming the env vars

Map field names with `heck`: one call, never a hand-written string that drifts:

```rust
use heck::ToShoutySnakeCase;

"data_dir".to_shouty_snake_case();     // "DATA_DIR"
```

The two crates for reading them:

- `figment`: layered config with real precedence and provenance, so an error
  names the bad source. `Env::prefixed("MYAPP_")`
  plus `Toml::file(...)`; `merge` replaces, `join` fills gaps. `Jail`
  sandboxes env and filesystem for tests.
- `envy`: the small option. `envy::prefixed("MYAPP_").from_env::<Config>()`.
  Deserialize-only, no provenance.

## Reference

- `dirs`: <https://crates.io/crates/dirs>. Low level: bare bases (`config_dir`, `data_dir`, `cache_dir`, `state_dir`), no per-app subdirectory. Use when you append the app name yourself, or need a kind `directories` lacks.
- `directories`: <https://crates.io/crates/directories>. Same author, adds
  `ProjectDirs` with per-app subdirectories per platform convention. Prefer for user-facing paths.
