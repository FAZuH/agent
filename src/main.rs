use anyhow::Result;
use clap::Parser;
use clap::Subcommand;
use octask::add::AddArgs;
use octask::add::{self};
use octask::basic;
use octask::edit::EditArgs;
use octask::edit::{self};
use octask::transfer::ExportArgs;
use octask::transfer::ImportArgs;
use octask::transfer::{self};

#[derive(Parser)]
#[command(
    name = "octask",
    version,
    about = "unified CLI for managed octask-* systemd user timers"
)]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// add a task (recurring exec command or scheduled agent run)
    Add(AddArgs),
    /// change an existing task's units
    Edit(EditArgs),
    /// parsed task values
    Show { name: String },
    /// stop, disable and delete the task's units
    Remove {
        name: String,
        #[arg(long)]
        dry_run: bool,
    },
    /// managed timers and tasks
    List,
    /// JSON backup of one, several, or all tasks
    Export(ExportArgs),
    /// recreate tasks from export JSON
    Import(ImportArgs),
    /// enable a task's timer
    Enable { name: String },
    /// disable a task's timer (units kept)
    Disable { name: String },
    /// timer + service status
    Status { name: String },
    /// recent service journal lines
    Logs {
        name: String,
        #[arg(short = 'n', default_value_t = 50)]
        lines: u32,
    },
}

fn dispatch(cmd: Cmd) -> Result<()> {
    match cmd {
        Cmd::Add(a) => add::add(&a),
        Cmd::Edit(e) => edit::edit(&e),
        Cmd::Show { name } => basic::show(&name),
        Cmd::Remove { name, dry_run } => basic::remove(&name, dry_run),
        Cmd::List => basic::list(),
        Cmd::Export(e) => transfer::export(&e),
        Cmd::Import(i) => transfer::import(&i),
        Cmd::Enable { name } => basic::enable(&name),
        Cmd::Disable { name } => basic::disable(&name),
        Cmd::Status { name } => basic::status(&name),
        Cmd::Logs { name, lines } => basic::logs(&name, lines),
    }
}

fn main() {
    let cli = Cli::parse();
    if let Err(e) = dispatch(cli.cmd) {
        eprintln!("octask: {e:#}");
        std::process::exit(1);
    }
}
