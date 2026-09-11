//! Rust port of the three phone digest scripts: `phone-notify-ingest`
//! (`serve`), `phone-inbox-drain` (`drain`) and `phone-digest-post` (`post`).

pub mod drain;
pub mod ingest;
pub mod post;

use std::env;
use std::fs;
use std::io::Write;
use std::os::unix::fs::DirBuilderExt;
use std::path::Path;
use std::path::PathBuf;

use anyhow::Context;
use anyhow::Result;
use clap::Args;
use clap::Parser;
use clap::Subcommand;

use crate::ingest::ServeConfig;

#[derive(Parser)]
#[command(
    name = "phone-digest",
    version,
    about = "Android notification ingest, inbox drain and Discord digest poster"
)]
pub struct Cli {
    #[command(subcommand)]
    pub cmd: Cmd,
}

#[derive(Subcommand)]
pub enum Cmd {
    /// run the tailnet notification ingest server (was phone-notify-ingest)
    Serve(ServeArgs),
    /// print the inbox to stdout and park it under drained/ (was phone-inbox-drain)
    Drain(DrainArgs),
    /// post a notification digest to Discord (was phone-digest-post)
    Post(PostArgs),
}

#[derive(Args)]
pub struct ServeArgs {
    /// address to bind, overrides PHONE_INGEST_ADDR
    #[arg(long)]
    pub addr: Option<String>,
    /// state directory, default ~/.local/state/phone-inbox
    #[arg(long)]
    pub state_dir: Option<PathBuf>,
    /// token file, default ~/.secrets/phone-ingest.token
    #[arg(long)]
    pub token_file: Option<PathBuf>,
}

#[derive(Args)]
pub struct DrainArgs {
    /// state directory, default ~/.local/state/phone-inbox
    #[arg(long)]
    pub state_dir: Option<PathBuf>,
}

#[derive(Args)]
pub struct PostArgs {
    /// {"items": [{"app": str, "title": str, "gist": str, "tier": str}]}
    pub json: String,
}

pub fn run() -> Result<()> {
    let cli = Cli::parse();
    match cli.cmd {
        Cmd::Serve(args) => ingest::serve(&serve_config(&args)?),
        Cmd::Drain(args) => {
            let contents = drain::drain(&state_dir(args.state_dir)?)?;
            print_drained(&contents)
        }
        Cmd::Post(args) => post::post(&args.json),
    }
}

fn serve_config(args: &ServeArgs) -> Result<ServeConfig> {
    Ok(ServeConfig {
        addr: args
            .addr
            .clone()
            .or_else(|| env::var("PHONE_INGEST_ADDR").ok())
            .unwrap_or_else(|| ingest::DEFAULT_ADDR.to_string()),
        state_dir: state_dir(args.state_dir.clone())?,
        token_file: match &args.token_file {
            Some(file) => file.clone(),
            None => home_dir()?.join(".secrets/phone-ingest.token"),
        },
    })
}

fn state_dir(explicit: Option<PathBuf>) -> Result<PathBuf> {
    match explicit {
        Some(dir) => Ok(dir),
        None => Ok(home_dir()?.join(".local/state/phone-inbox")),
    }
}

pub fn home_dir() -> Result<PathBuf> {
    env::var_os("HOME")
        .filter(|home| !home.is_empty())
        .map(PathBuf::from)
        .with_context(|| "HOME is not set")
}

/// Create a state directory at mode 0700, like `Path.mkdir(mode=0o700,
/// parents=True, exist_ok=True)`: the mode goes to the syscall, so there is no
/// window where a fresh directory is world-readable.
pub fn ensure_private_dir(path: &Path) -> Result<()> {
    fs::DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(path)
        .with_context(|| format!("create dir {}", path.display()))
}

fn print_drained(contents: &str) -> Result<()> {
    let stdout = std::io::stdout();
    let mut lock = stdout.lock();
    lock.write_all(contents.as_bytes())?;
    lock.flush().map_err(Into::into)
}
