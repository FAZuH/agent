use std::path::Path;

use anyhow::Result;
use anyhow::bail;
use clap::Parser;

use crate::add::AddArgs;
use crate::add::install;
use crate::model::load_task;
use crate::sys::unit_dir;

#[derive(Parser, Clone, Default, Debug)]
pub struct EditArgs {
    #[arg(value_name = "NAME")]
    pub name: String,
    #[arg(long)]
    pub model: Option<String>,
    #[arg(long)]
    pub no_model: bool,
    #[arg(long)]
    pub prompt: Option<String>,
    #[arg(long)]
    pub agent: Option<String>,
    #[arg(long)]
    pub oncalendar: Option<String>,
    #[arg(long)]
    pub description: Option<String>,
    #[arg(long)]
    pub workdir: Option<String>,
    #[arg(long)]
    pub timeout: Option<String>,
    #[arg(long)]
    pub delay: Option<String>,
    #[arg(long)]
    pub no_delay: bool,
    #[arg(long)]
    pub persistent: bool,
    #[arg(long)]
    pub no_persistent: bool,
    #[arg(long)]
    pub credential: Vec<String>,
    #[arg(long)]
    pub clear_credentials: bool,
    #[arg(long)]
    pub dry_run: bool,
}

/// The auto-generated agent description, before add appends the model suffix.
/// Bash writes the full workdir path (its `~` replacement is a no-op there).
fn auto_description(agent: &str, workdir: &str) -> String {
    format!("agent {agent} in {workdir}")
}

/// What `edit` hands to add as `--description`: the explicit override, or the
/// current description with its model suffix (and the auto form) stripped so
/// add rebuilds the parts it owns.
pub fn description_for_add(explicit: Option<&str>, cur: &crate::model::Task) -> String {
    if let Some(d) = explicit {
        return d.to_owned();
    }
    if cur.is_agent {
        let mut base = cur.description.clone();
        if !cur.model.is_empty() {
            let suffix = format!(" [{}]", cur.model);
            if let Some(stripped) = base.strip_suffix(&suffix) {
                base = stripped.to_owned();
            }
        }
        if base == auto_description(&cur.agent, &cur.workdir) {
            return String::new();
        }
        return base;
    }
    cur.description.clone()
}

pub fn merged_add_args(args: &EditArgs, cur: &crate::model::Task, was_enabled: bool) -> AddArgs {
    let mut a = AddArgs {
        name: cur.name.clone(),
        force: true,
        ..AddArgs::default()
    };

    let new_workdir = args.workdir.clone().unwrap_or_else(|| cur.workdir.clone());
    let new_timeout = args.timeout.clone().unwrap_or_else(|| cur.timeout.clone());
    let mut new_model = cur.model.clone();
    if let Some(m) = &args.model {
        new_model = m.clone();
    }
    if args.no_model {
        new_model.clear();
    }
    let new_delay = if args.delay.is_some() || args.no_delay {
        args.delay.clone().unwrap_or_default()
    } else {
        cur.delay.clone()
    };
    let new_persistent = if args.persistent {
        true
    } else if args.no_persistent {
        false
    } else {
        cur.persistent
    };

    if cur.is_agent {
        a.agent = Some(args.agent.clone().unwrap_or_else(|| cur.agent.clone()));
        a.prompt = Some(args.prompt.clone().unwrap_or_else(|| cur.prompt.clone()));
        a.workdir = Some(new_workdir);
        if !new_model.is_empty() {
            a.model = Some(new_model);
        }
        a.dirty_only = cur.dirty;
    } else {
        a.exec = Some(cur.exec.clone());
        if !new_workdir.is_empty() {
            a.workdir = Some(new_workdir);
        }
    }

    let desc = description_for_add(args.description.as_deref(), cur);
    if !desc.is_empty() {
        a.description = Some(desc);
    }
    a.oncalendar = Some(
        args.oncalendar
            .clone()
            .unwrap_or_else(|| cur.oncalendar.clone()),
    );
    if !new_timeout.is_empty() {
        a.timeout = Some(new_timeout);
    }
    if !new_delay.is_empty() {
        a.delay = Some(new_delay);
    }
    a.persistent = new_persistent;

    for e in &cur.envs {
        if e == "PATH=/usr/local/bin:/usr/bin" && cur.is_agent {
            continue;
        }
        a.env.push(e.clone());
    }

    if !args.clear_credentials {
        a.credential = cur.creds.clone();
    }
    let mut creds = a.credential.clone();
    for nc in &args.credential {
        let nn = nc.split(':').next().unwrap_or(nc);
        creds.retain(|c| c.split(':').next() != Some(nn));
        creds.push(nc.clone());
    }
    a.credential = creds;

    if !was_enabled {
        a.no_enable = true;
    }
    a
}

pub fn edit(args: &EditArgs) -> Result<()> {
    if args.model.is_some() && args.no_model {
        bail!("edit: --model and --no-model conflict");
    }
    let name = crate::sys::norm_name(&args.name);
    crate::sys::require_name(&name)?;
    let dir = unit_dir();
    if !crate::sys::units_exist(&dir, &name) {
        bail!("edit: no units found for 'octask-{name}' (octask list)");
    }
    let cur = load_task(&dir, &name)?;

    if !cur.is_agent
        && (args.prompt.is_some() || args.agent.is_some() || args.model.is_some() || args.no_model)
    {
        bail!(
            "edit: --prompt/--agent/--model apply only to agent tasks ('{name}' is an --exec task)"
        );
    }

    let was_enabled = crate::sys::ok(
        "systemctl",
        &["--user", "is-enabled", &format!("octask-{name}.timer")],
    );
    let add_args = merged_add_args(args, &cur, was_enabled);

    if args.dry_run {
        let root = Path::new("/tmp/opencode");
        std::fs::create_dir_all(root)?;
        let tmp = tempfile::Builder::new()
            .prefix("octask-edit.")
            .tempdir_in(root)?;
        let tmp_path = tmp.path();
        let mut quiet = install(&add_args, Some(tmp_path))?;
        quiet.clear();
        let (real_service, real_timer) = crate::sys::unit_paths(&dir, &name);
        for real in [real_service, real_timer] {
            let gen_path = tmp_path.join(real.file_name().unwrap());
            crate::sys::diff_files(&real, &gen_path);
        }
        println!("dry-run: no changes written");
        return Ok(());
    }

    install(&add_args, None)?;
    println!("edited octask-{name}");
    Ok(())
}
