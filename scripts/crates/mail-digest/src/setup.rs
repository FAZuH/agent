//! `setup` command: create the mail-check timer and its on-demand digest
//! agent. Re-running replaces both units so the shape stays current.

use std::path::PathBuf;
use std::process::Command;

use anyhow::Context;
use anyhow::Result;
use anyhow::bail;
use clap::Parser;

pub const CHECK_TASK: &str = "mail-check";
pub const AGENT_TASK: &str = "mail-digest";
pub const AGENT: &str = "mail-digest";
pub const DEFAULT_ONCALENDAR: &str = "*-*-* *:00,30:00";
pub const DEFAULT_PROMPT: &str = "Read the staged mail with DIGEST_BIN pending. Classify the \
     compact items into urgent|notable|routine, read a bounded body with DIGEST_BIN body only \
     when needed, and post once with DIGEST_BIN '<json>'.";

#[derive(Parser)]
pub struct SetupArgs {
    /// model for the unattended run, e.g. opencode/hy4-flash-free
    #[arg(long)]
    pub model: Option<String>,
    /// check schedule override (systemd OnCalendar expression)
    #[arg(long)]
    pub oncalendar: Option<String>,
    /// digest run prompt override
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
    Ok(home.join(".config/fazuh-agent/digest").join(AGENT_TASK))
}

fn run_octask(args: &[String]) -> Result<()> {
    let status = Command::new("octask")
        .args(args)
        .status()
        .context("setup: failed to run octask (is it installed?)")?;
    if !status.success() {
        bail!(
            "setup: octask failed with exit {}",
            status.code().unwrap_or(1)
        );
    }
    Ok(())
}

fn replace(name: &str, add: &[String]) -> Result<()> {
    run_octask(&["remove".to_owned(), name.to_owned()])?;
    run_octask(add)
}

pub fn run_setup(args: &SetupArgs) -> Result<()> {
    let model = args
        .model
        .clone()
        .filter(|m| !m.trim().is_empty())
        .unwrap_or_else(|| "commandcode/deepseek/deepseek-v4.1-flash".to_owned());
    let workdir = args.workdir.clone().unwrap_or(default_workdir()?);
    let oncalendar = args
        .oncalendar
        .clone()
        .unwrap_or_else(|| DEFAULT_ONCALENDAR.to_owned());
    let digest_bin = digest_post::home_dir()?.join(".cargo/bin/mail-digest");
    let prompt = args
        .prompt
        .clone()
        .unwrap_or_else(|| DEFAULT_PROMPT.replace("DIGEST_BIN", &digest_bin.to_string_lossy()));

    // The digest agent has no timer: mail-check starts it only when new mail
    // arrives. This is what keeps quiet days at zero LLM spend.
    replace(
        AGENT_TASK,
        &[
            "add".to_owned(),
            AGENT_TASK.to_owned(),
            "--agent".to_owned(),
            AGENT.to_owned(),
            "--prompt".to_owned(),
            prompt,
            "--workdir".to_owned(),
            workdir.to_string_lossy().into_owned(),
            "--model".to_owned(),
            model,
            "--no-enable".to_owned(),
        ],
    )?;

    replace(
        CHECK_TASK,
        &[
            "add".to_owned(),
            CHECK_TASK.to_owned(),
            "--exec".to_owned(),
            "mail-digest check --trigger".to_owned(),
            "--oncalendar".to_owned(),
            oncalendar,
            "--persistent".to_owned(),
        ],
    )?;

    println!("created {CHECK_TASK} timer and {AGENT_TASK} on-demand agent");
    Ok(())
}
