//! `setup` command: create the octask agent timer for this digest, or
//! replace the model on the existing one (`octask edit`).

use std::path::PathBuf;
use std::process::Command;

use anyhow::Context;
use anyhow::Result;
use anyhow::bail;
use clap::Parser;

pub const TASK: &str = "mail-digest";
pub const AGENT: &str = "mail-digest";
pub const DEFAULT_ONCALENDAR: &str = "*-*-* 07:00:00";
pub const DEFAULT_PROMPT: &str =
    "Post the daily mail digest to Discord following the agent procedure.";

#[derive(Parser)]
pub struct SetupArgs {
    /// model for the unattended run, e.g. opencode/mimo-v2.6-flash-free
    #[arg(long)]
    pub model: Option<String>,
    /// schedule override (systemd OnCalendar expression)
    #[arg(long)]
    pub oncalendar: Option<String>,
    /// run-prompt override
    #[arg(long)]
    pub prompt: Option<String>,
    /// task workdir, default ~/.config/fazuh-agent/digest/mail-digest
    #[arg(long)]
    pub workdir: Option<PathBuf>,
}

fn default_workdir() -> Result<PathBuf> {
    let home = std::env::var_os("HOME")
        .filter(|home| !home.is_empty())
        .map(PathBuf::from)
        .context("HOME is not set")?;
    Ok(home.join(".config/fazuh-agent/digest").join(TASK))
}

fn run_octask(args: &[String]) -> Result<()> {
    let status = Command::new("octask")
        .args(args)
        .status()
        .context("setup: failed to run octask (is it installed?)")?;
    if !status.success() {
        bail!("setup: octask failed with exit {}", status.code().unwrap_or(1));
    }
    Ok(())
}

pub fn run_setup(args: &SetupArgs) -> Result<()> {
    let model = args.model.clone().unwrap_or_default();
    if model.is_empty() {
        bail!("setup: --model is required");
    }
    let workdir = args.workdir.clone().unwrap_or(default_workdir()?);
    let oncalendar = args
        .oncalendar
        .clone()
        .unwrap_or_else(|| DEFAULT_ONCALENDAR.to_owned());
    let prompt = args
        .prompt
        .clone()
        .unwrap_or_else(|| DEFAULT_PROMPT.to_owned());

    let exists = Command::new("octask")
        .arg("show")
        .arg(TASK)
        .output()
        .map(|out| out.status.success())
        .unwrap_or(false);
    if exists {
        let mut edit = vec!["edit".to_owned(), TASK.to_owned(), "--model".to_owned(), model];
        if args.oncalendar.is_some() {
            edit.push("--oncalendar".to_owned());
            edit.push(oncalendar);
        }
        if args.prompt.is_some() {
            edit.push("--prompt".to_owned());
            edit.push(prompt);
        }
        if args.workdir.is_some() {
            edit.push("--workdir".to_owned());
            edit.push(workdir.to_string_lossy().into_owned());
        }
        run_octask(&edit)
    } else {
        run_octask(&[
            "add".to_owned(),
            TASK.to_owned(),
            "--agent".to_owned(),
            AGENT.to_owned(),
            "--prompt".to_owned(),
            prompt,
            "--workdir".to_owned(),
            workdir.to_string_lossy().into_owned(),
            "--model".to_owned(),
            model,
            "--oncalendar".to_owned(),
            oncalendar,
            "--persistent".to_owned(),
        ])
    }
}
