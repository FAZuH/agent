use std::path::Path;
use std::path::PathBuf;

use anyhow::Result;
use anyhow::bail;

use crate::model::load_task;
use crate::model::managed_names;
use crate::sys::PREFIX;
use crate::sys::home;
use crate::sys::next_run;
use crate::sys::norm_name;
use crate::sys::ok;
use crate::sys::read_string;
use crate::sys::require_name;
use crate::sys::run;
use crate::sys::stdout_soft;
use crate::sys::tildify;
use crate::sys::unit_dir;
use crate::sys::unit_paths;
use crate::sys::units_exist;

fn timer_unit(name: &str) -> String {
    format!("{PREFIX}{name}.timer")
}

fn require_units(dir: &Path, verb: &str, name: &str) -> Result<()> {
    if !units_exist(dir, name) {
        bail!("{verb}: no units found for '{PREFIX}{name}' (octask list)");
    }
    Ok(())
}

fn one_name(name: &str) -> Result<String> {
    let name = norm_name(name);
    require_name(&name)?;
    Ok(name)
}

pub fn remove(name: &str, dry_run: bool) -> Result<()> {
    let name = one_name(name)?;
    let dir = unit_dir();
    let (service, timer) = unit_paths(&dir, &name);
    let units: Vec<PathBuf> = vec![timer.clone(), service.clone()]
        .into_iter()
        .filter(|f| f.exists())
        .collect();

    if units.is_empty() {
        println!("octask: no units found for '{PREFIX}{name}' (nothing to do)");
        return Ok(());
    }

    if dry_run {
        println!("dry-run: would stop+disable {}, delete:", timer_unit(&name));
        for f in &units {
            println!("  {}", f.display());
        }
        return Ok(());
    }

    let unit = timer_unit(&name);
    ok("systemctl", &["--user", "stop", &unit]);
    ok("systemctl", &["--user", "disable", &unit]);
    for f in &units {
        let _ = std::fs::remove_file(f);
    }
    run("systemctl", &["--user", "daemon-reload"]).ok();
    ok(
        "systemctl",
        &[
            "--user",
            "reset-failed",
            &unit,
            &format!("{PREFIX}{name}.service"),
        ],
    );
    println!("removed {PREFIX}{name} ({{timer,service}})");
    Ok(())
}

pub fn list() -> Result<()> {
    let dir = unit_dir();
    println!("== managed timers ({PREFIX}*) ==");
    let timers = stdout_soft(
        "systemctl",
        &[
            "--user",
            "list-timers",
            &format!("{PREFIX}*"),
            "--all",
            "--no-pager",
        ],
    );
    if !timers.is_empty() {
        println!("{timers}");
    }

    println!();
    println!("== managed tasks ==");
    let names = managed_names(&dir);
    if names.is_empty() {
        println!("  (none — nothing managed by octask yet)");
        return Ok(());
    }
    let home_str = home().to_string_lossy().into_owned();
    for name in names {
        let (service, _) = unit_paths(&dir, &name);
        let svc = read_string(&service).unwrap_or_default();
        let tag = if svc.contains("--agent") {
            "agent"
        } else {
            "task"
        };
        let workdir = first_property(&svc, "WorkingDirectory=").unwrap_or_default();
        let mut desc = first_property(&svc, "Description=").unwrap_or_default();
        if let Some(rest) = desc.strip_prefix(&format!("{PREFIX}{name}: ")) {
            desc = rest.to_owned();
        }
        desc = desc.replace(&home_str, "~");
        if desc.chars().count() > 88 {
            desc = desc.chars().take(87).collect::<String>();
            desc.push('…');
        }
        let wd_short = tildify(&workdir);
        let suffix =
            if !workdir.is_empty() && !format!(" {desc} ").contains(&format!(" {wd_short} ")) {
                format!("  ({wd_short})")
            } else {
                String::new()
            };
        let shown = if desc.is_empty() {
            "(no description)"
        } else {
            &desc
        };
        println!("  [{tag}] {name} — {shown}{suffix}");
    }
    Ok(())
}

fn first_property(content: &str, key: &str) -> Option<String> {
    content
        .lines()
        .find_map(|l| l.strip_prefix(key).map(|v| v.to_owned()))
}

pub fn enable(name: &str) -> Result<()> {
    let name = one_name(name)?;
    let dir = unit_dir();
    require_units(&dir, "enable", &name)?;
    run("systemctl", &["--user", "daemon-reload"])?;
    run(
        "systemctl",
        &["--user", "enable", "--now", &timer_unit(&name)],
    )?;
    let next = next_run(&name);
    let next = if next.is_empty() { "unknown" } else { &next };
    println!("enabled {} — next run: {next}", timer_unit(&name));
    Ok(())
}

pub fn disable(name: &str) -> Result<()> {
    let name = one_name(name)?;
    let dir = unit_dir();
    require_units(&dir, "disable", &name)?;
    run(
        "systemctl",
        &["--user", "disable", "--now", &timer_unit(&name)],
    )?;
    println!(
        "disabled {} (units kept — re-enable with: octask enable {name})",
        timer_unit(&name)
    );
    Ok(())
}

pub fn status(name: &str) -> Result<()> {
    let name = one_name(name)?;
    let dir = unit_dir();
    require_units(&dir, "status", &name)?;
    run(
        "systemctl",
        &[
            "--user",
            "status",
            &timer_unit(&name),
            &format!("{PREFIX}{name}.service"),
            "--no-pager",
        ],
    )
}

pub fn logs(name: &str, lines: u32) -> Result<()> {
    let name = one_name(name)?;
    run(
        "journalctl",
        &[
            "--user",
            "-u",
            &format!("{PREFIX}{name}.service"),
            "-n",
            &lines.to_string(),
            "--no-pager",
        ],
    )
}

pub fn show(name: &str) -> Result<()> {
    let name = one_name(name)?;
    let dir = unit_dir();
    require_units(&dir, "show", &name)?;
    let t = load_task(&dir, &name)?;
    if t.is_agent {
        println!("task: {name} (agent)");
        println!("agent: {}", t.agent);
        println!(
            "model: {}",
            if t.model.is_empty() {
                "(default)"
            } else {
                &t.model
            }
        );
        println!("prompt: {}", t.prompt);
    } else {
        println!("task: {name} (exec)");
        println!("exec: {}", t.exec);
    }
    if !t.workdir.is_empty() {
        println!("workdir: {}", t.workdir);
    }
    println!("oncalendar: {}", t.oncalendar);
    if !t.delay.is_empty() {
        println!("delay: {}", t.delay);
    }
    println!("persistent: {}", t.persistent as u8);
    if !t.timeout.is_empty() {
        println!("timeout: {}", t.timeout);
    }
    if t.dirty {
        println!("dirty-only: 1");
    }
    println!("description: {}", t.description);
    for e in &t.envs {
        println!("env: {e}");
    }
    for c in &t.creds {
        println!("credential: {c}");
    }
    let next = next_run(&name);
    if !next.is_empty() {
        println!("next run: {next}");
    }
    Ok(())
}
