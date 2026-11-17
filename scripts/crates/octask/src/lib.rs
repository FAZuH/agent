pub mod add;
pub mod basic;
pub mod edit;
pub mod model;
pub mod state;
pub mod sys;
pub mod transfer;
pub mod tui;
pub mod view;

use anyhow::Result;
use anyhow::bail;
use clap::Parser;
use clap::Subcommand;

use crate::add::AddArgs;
use crate::edit::EditArgs;
use crate::transfer::ExportArgs;
use crate::transfer::ImportArgs;

#[derive(Debug, Parser)]
#[command(
    name = "octask",
    version,
    about = "unified CLI for managed octask-* systemd user timers"
)]
pub struct Cli {
    #[command(subcommand)]
    pub cmd: Option<Cmd>,
}

#[derive(Debug, Subcommand)]
pub enum Cmd {
    /// interactive task dashboard (same as running `octask` with no arguments)
    Tui,
    /// add a task (recurring exec command or scheduled agent run)
    Add(AddArgs),
    /// change an existing task's units
    Edit(EditArgs),
    /// parsed task values
    Show {
        name: String,
        #[arg(long)]
        json: bool,
    },
    /// stop, disable and delete the task's units
    Remove {
        name: String,
        #[arg(long)]
        dry_run: bool,
    },
    /// managed timers and tasks
    List {
        #[arg(long)]
        json: bool,
    },
    /// JSON backup of one, several, or all tasks
    Export(ExportArgs),
    /// recreate tasks from export JSON
    Import(ImportArgs),
    /// enable a task's timer, or `--all`
    Enable {
        name: Option<String>,
        #[arg(long)]
        all: bool,
        #[arg(long)]
        dry_run: bool,
    },
    /// disable a task's timer (units kept), or `--all`
    Disable {
        name: Option<String>,
        #[arg(long)]
        all: bool,
        #[arg(long)]
        dry_run: bool,
    },
    /// disable all timers and remember which were enabled
    Pause,
    /// restore the timers that were enabled before `octask pause`
    Resume,
    /// start a task's service now, without waiting for its timer
    Run { name: String },
    /// timer + service status
    Status {
        name: String,
        #[arg(long)]
        json: bool,
    },
    /// recent service journal lines
    Logs {
        name: String,
        #[arg(short = 'n', default_value_t = 50)]
        lines: u32,
        #[arg(short = 'f', long)]
        follow: bool,
    },
    /// remove orphaned octask artifacts
    Cleanup {
        #[arg(long)]
        dry_run: bool,
        #[arg(long)]
        include_history: bool,
    },
}

fn one_or_all(name: Option<String>, all: bool) -> Result<Option<String>> {
    match (name, all) {
        (Some(name), false) => Ok(Some(name)),
        (None, true) => Ok(None),
        (Some(_), true) => bail!("give a NAME or --all, not both"),
        (None, false) => bail!("give a NAME or --all"),
    }
}

pub fn dispatch(cmd: Cmd) -> Result<()> {
    match cmd {
        Cmd::Tui => tui::run(),
        Cmd::Add(a) => add::add(&a),
        Cmd::Edit(e) => edit::edit(&e),
        Cmd::Show { name, json } => basic::show(&name, json),
        Cmd::Remove { name, dry_run } => basic::remove(&name, dry_run),
        Cmd::List { json } => basic::list(json),
        Cmd::Export(e) => transfer::export(&e),
        Cmd::Import(i) => transfer::import(&i),
        Cmd::Enable { name, all, dry_run } => {
            basic::set_enabled(one_or_all(name, all)?, true, dry_run)
        }
        Cmd::Disable { name, all, dry_run } => {
            basic::set_enabled(one_or_all(name, all)?, false, dry_run)
        }
        Cmd::Pause => basic::pause(),
        Cmd::Resume => basic::resume(),
        Cmd::Run { name } => basic::run(&name),
        Cmd::Status { name, json } => basic::status(&name, json),
        Cmd::Logs {
            name,
            lines,
            follow,
        } => basic::logs(&name, lines, follow),
        Cmd::Cleanup {
            dry_run,
            include_history,
        } => basic::cleanup(dry_run, include_history),
    }
}

pub fn run() {
    let cli = Cli::parse();
    let cmd = cli.cmd.unwrap_or(Cmd::Tui);
    if let Err(e) = dispatch(cmd) {
        eprintln!("octask: {e:#}");
        std::process::exit(1);
    }
}
