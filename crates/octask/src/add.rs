use std::path::Path;

use anyhow::Result;
use anyhow::bail;
use clap::Parser;

use crate::model::DIRTY_PREFIX;
use crate::model::Task;
use crate::model::service_text;
use crate::model::timer_text;
use crate::sys::PREFIX;
use crate::sys::bq;
use crate::sys::failure_report;
use crate::sys::home;
use crate::sys::next_run;
use crate::sys::norm_name;
use crate::sys::ok;
use crate::sys::require_name;
use crate::sys::run;
use crate::sys::run_quiet;
use crate::sys::unit_dir;
use crate::sys::unit_paths;

#[derive(Parser, Clone, Default, Debug)]
pub struct AddArgs {
    #[arg(value_name = "NAME")]
    pub name: String,
    #[arg(long)]
    pub exec: Option<String>,
    #[arg(long)]
    pub agent: Option<String>,
    #[arg(long)]
    pub prompt: Option<String>,
    #[arg(long)]
    pub model: Option<String>,
    #[arg(long)]
    pub dirty_only: bool,
    #[arg(long)]
    pub oncalendar: Option<String>,
    #[arg(long)]
    pub description: Option<String>,
    #[arg(long)]
    pub workdir: Option<String>,
    #[arg(long)]
    pub timeout: Option<String>,
    #[arg(long)]
    pub env: Vec<String>,
    #[arg(long)]
    pub credential: Vec<String>,
    #[arg(long)]
    pub delay: Option<String>,
    #[arg(long)]
    pub persistent: bool,
    #[arg(long)]
    pub no_enable: bool,
    #[arg(long)]
    pub force: bool,
}

const DEFAULT_ONCALENDAR: &str = "*-*-* 00/12:00:00";
const DEFAULT_AGENT_TIMEOUT: &str = "600";
const AGENT_PATH_ENV: &str = "PATH=/usr/local/bin:/usr/bin";

/// Full `octask add`: validates, builds the run command, writes units under
/// `dir` (the real unit dir when `None`), reloads systemd, self-checks and
/// enables. Returns the lines that would go to stdout.
pub fn install(args: &AddArgs, dir: Option<&Path>) -> Result<Vec<String>> {
    let dir = dir.map_or_else(unit_dir, Path::to_path_buf);
    let mut out = Vec::new();

    let name = norm_name(&args.name);
    require_name(&name)?;

    let exec_cmd_in = args.exec.clone().unwrap_or_default();
    let agent_in = args.agent.clone().unwrap_or_default();
    let prompt_in = args.prompt.clone().unwrap_or_default();
    let model = args.model.clone().unwrap_or_default();

    let mut is_agent = false;
    if !agent_in.is_empty() || !prompt_in.is_empty() {
        is_agent = true;
        if agent_in.is_empty() {
            bail!("add: --agent is required with --prompt");
        }
        if prompt_in.is_empty() {
            bail!("add: --prompt is required with --agent");
        }
        if args.workdir.is_none() {
            bail!("add: --workdir is required for agent runs");
        }
        if !exec_cmd_in.is_empty() {
            bail!("add: --exec cannot be combined with --agent/--prompt");
        }
    } else if exec_cmd_in.is_empty() {
        bail!("add: --exec is required (or use --agent/--prompt)");
    }

    let oncalendar = args
        .oncalendar
        .clone()
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| DEFAULT_ONCALENDAR.to_owned());

    let workdir = args.workdir.clone().unwrap_or_default();

    // ---- validation before writing anything ------------------------------
    if !ok("systemd-analyze", &["calendar", &oncalendar]) {
        if let Some(rep) = failure_report("systemd-analyze", &["calendar", &oncalendar]) {
            for line in rep.lines().take(3) {
                eprintln!("{line}");
            }
        }
        bail!("add: invalid OnCalendar expression: {oncalendar}");
    }
    if !workdir.is_empty() && !Path::new(&workdir).is_dir() {
        bail!("add: --workdir does not exist: {workdir}");
    }
    let timeout_in = args.timeout.clone().unwrap_or_default();
    if !timeout_in.is_empty() && !timeout_in.chars().all(|c| c.is_ascii_digit()) {
        bail!("add: --timeout must be seconds");
    }
    let delay = args.delay.clone().unwrap_or_default();
    if !delay.is_empty() && !ok("systemd-analyze", &["timespan", &delay]) {
        bail!("add: invalid --delay timespan: {delay}");
    }
    for c in &args.credential {
        let Some((cname, cpath)) = c.split_once(':') else {
            bail!("add: --credential must be NAME:PATH, got: {c}");
        };
        let name_ok = !cname.is_empty()
            && cname
                .chars()
                .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '.' | '-'));
        if !name_ok {
            bail!("add: bad credential name '{cname}' (use [A-Za-z0-9_.-])");
        }
        if !Path::new(cpath).exists() {
            bail!("add: credential source does not exist: {cpath}");
        }
    }

    let mut envs = args.env.clone();
    let mut exec_cmd = exec_cmd_in;
    let mut timeout = timeout_in;
    let mut description = args.description.clone().unwrap_or_default();

    // ---- agent-mode pre-flights ------------------------------------------
    if is_agent {
        if !ok("git", &["-C", &workdir, "rev-parse", "--git-dir"]) {
            if args.dirty_only {
                bail!("add: not a git repository: {workdir} (--dirty-only requires git)");
            }
            eprintln!("octask: warning: {workdir} is not a git repository");
        }
        if args.dirty_only && !ok("git", &["--version"]) {
            bail!("add: git not found (--dirty-only requires it)");
        }
        let oc_bin = prefer_opencode2()?;
        out.push(format!("binary: {}", oc_bin.display()));
        let mut agent_found = false;
        for f in [
            crate::sys::config_home().join(format!("opencode/agents/{agent_in}.md")),
            Path::new(&workdir).join(format!(".opencode/agents/{agent_in}.md")),
        ] {
            if f.is_file() {
                agent_found = true;
                out.push(format!("agent def: {}", f.display()));
                break;
            }
        }
        if !agent_found {
            eprintln!("octask: WARNING: no agent definition found for '{agent_in}'");
            eprintln!(
                "  (checked {} and {})",
                crate::sys::config_home().join("opencode/agents").display(),
                Path::new(&workdir).join(".opencode/agents").display()
            );
            eprintln!("  the run will fail until the agent exists — create it before enabling");
        }
        let quoted = bq(&prompt_in);
        exec_cmd = if model.is_empty() {
            format!("{} run --agent {agent_in} {quoted}", oc_bin.display())
        } else {
            format!(
                "{} run --model {model} --agent {agent_in} {quoted}",
                oc_bin.display()
            )
        };
        if args.dirty_only {
            exec_cmd = format!("{DIRTY_PREFIX}{exec_cmd}");
        }
        if timeout.is_empty() {
            timeout = DEFAULT_AGENT_TIMEOUT.to_owned();
        }
        envs.push(AGENT_PATH_ENV.to_owned());
        if description.is_empty() {
            // Bash writes the full path here: its `${workdir/#$HOME/~}` is a
            // no-op because the unescaped `~` replacement re-expands to $HOME.
            description = format!("agent {agent_in} in {workdir}");
        }
        if !model.is_empty() {
            description = format!("{description} [{model}]");
        }
    } else {
        if !model.is_empty() {
            eprintln!("octask: warning: --model is ignored for --exec tasks");
        }
        if description.is_empty() {
            description = exec_cmd.clone();
        }
    }

    // ---- refuse to clobber ------------------------------------------------
    let (service, timer) = unit_paths(&dir, &name);
    if !args.force {
        for f in [&service, &timer] {
            if f.exists() {
                bail!(
                    "add: {} already exists (use --force to overwrite)",
                    f.display()
                );
            }
        }
    }

    let task = Task {
        name,
        is_agent,
        agent: agent_in,
        model,
        prompt: prompt_in,
        dirty: args.dirty_only,
        exec: exec_cmd,
        workdir,
        oncalendar,
        delay,
        persistent: args.persistent,
        timeout,
        description,
        envs,
        creds: args.credential.clone(),
    };

    if let Some(parent) = service.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&service, service_text(&task))?;
    std::fs::write(&timer, timer_text(&task))?;

    run("systemctl", &["--user", "daemon-reload"])?;

    // ---- self-check the generated units -----------------------------------
    let svc = service.to_string_lossy().into_owned();
    let tmr = timer.to_string_lossy().into_owned();
    if let Some(rep) = failure_report("systemd-analyze", &["verify", &svc, &tmr]) {
        eprintln!("{rep}");
        let _ = std::fs::remove_file(&service);
        let _ = std::fs::remove_file(&timer);
        bail!(
            "add: generated units failed systemd-analyze verify (removed); check quoting of --exec/--prompt"
        );
    }

    if args.no_enable {
        out.push(format!(
            "added {PREFIX}{} (not enabled): {}.{{service,timer}}",
            task.name,
            dir.join(format!("{PREFIX}{}", task.name)).display()
        ));
        out.push(format!("enable later: octask enable {}", task.name));
        return Ok(out);
    }

    run_quiet(
        "systemctl",
        &[
            "--user",
            "enable",
            "--now",
            &format!("{PREFIX}{}.timer", task.name),
        ],
    )?;
    let next = next_run(&task.name);
    out.push(format!(
        "added {PREFIX}{}: {}.{{service,timer}}",
        task.name,
        dir.join(format!("{PREFIX}{}", task.name)).display()
    ));
    let mut sched = format!("OnCalendar={}", task.oncalendar);
    if !task.delay.is_empty() {
        sched.push_str(&format!(" (delay up to {})", task.delay));
    }
    if task.persistent {
        sched.push_str(", persistent");
    }
    out.push(format!("  schedule: {sched}"));
    if !task.workdir.is_empty() {
        out.push(format!("  workdir:  {}", task.workdir));
    }
    out.push(format!("  next run: {next} (octask list)"));
    Ok(out)
}

fn prefer_opencode2() -> Result<std::path::PathBuf> {
    let beta = home().join(".opencode/bin/opencode2");
    if beta.is_file() {
        return Ok(beta);
    }
    crate::sys::which("opencode").ok_or_else(|| anyhow::anyhow!("add: no opencode binary found"))
}

pub fn add(args: &AddArgs) -> Result<()> {
    for l in install(args, None)? {
        println!("{l}");
    }
    Ok(())
}
