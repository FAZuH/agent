use std::collections::BTreeSet;
use std::path::Path;
use std::path::PathBuf;

use anyhow::Result;
use anyhow::bail;
use owo_colors::OwoColorize;

use crate::model::load_task;
use crate::model::managed_names;
use crate::state;
use crate::sys::PREFIX;
use crate::sys::next_run;
use crate::sys::norm_name;
use crate::sys::ok;
use crate::sys::require_name;
use crate::sys::run as sys_run;
use crate::sys::stdout_soft;
use crate::sys::tildify;
use crate::sys::unit_dir;
use crate::sys::unit_paths;
use crate::sys::units_exist;
use crate::view;

fn timer_unit(name: &str) -> String {
    format!("{PREFIX}{name}.timer")
}

fn service_unit(name: &str) -> String {
    format!("{PREFIX}{name}.service")
}

pub fn require_units(dir: &Path, verb: &str, name: &str) -> Result<()> {
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

fn is_enabled(name: &str) -> bool {
    ok("systemctl", &["--user", "is-enabled", &timer_unit(name)])
}

fn systemctl_show(unit: &str, prop: &str) -> String {
    stdout_soft(
        "systemctl",
        &[
            "--user",
            "show",
            &format!("{PREFIX}{unit}"),
            &format!("--property={prop}"),
            "--value",
        ],
    )
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
    sys_run("systemctl", &["--user", "daemon-reload"]).ok();
    ok(
        "systemctl",
        &["--user", "reset-failed", &unit, &service_unit(&name)],
    );
    println!("removed {PREFIX}{name} ({{timer,service}})");
    Ok(())
}

pub fn list(json: bool) -> Result<()> {
    let rows = view::collect();
    if json {
        println!("{}", serde_json::to_string_pretty(&view::to_json(&rows))?);
        return Ok(());
    }
    print!("{}", view::render(&rows));
    let enabled = rows.iter().filter(|r| r.enabled).count();
    let failed = rows.iter().filter(|r| r.failed).count();
    println!(
        "{}",
        format!(
            "{} task(s): {} enabled, {} disabled, {} failed",
            rows.len(),
            enabled,
            rows.len() - enabled,
            failed
        )
        .dimmed()
    );
    Ok(())
}

/// Enable or disable one task, or every managed task when `name` is None.
pub fn set_enabled(name: Option<String>, enable: bool, dry_run: bool) -> Result<()> {
    let dir = unit_dir();
    let names: Vec<String> = match name {
        Some(name) => vec![one_name(&name)?],
        None => managed_names(&dir),
    };
    if names.is_empty() {
        println!("no managed tasks to change");
        return Ok(());
    }
    let verb = if enable { "enable" } else { "disable" };
    if enable && !dry_run {
        sys_run("systemctl", &["--user", "daemon-reload"])?;
    }

    let mut changed = 0;
    for name in names {
        if !units_exist(&dir, &name) {
            println!("{name}: no units (skipped)");
            continue;
        }
        if is_enabled(&name) == enable {
            println!("{}", format!("{name}: already {verb}d").dimmed());
            continue;
        }
        if dry_run {
            println!("dry-run: would {verb} {}", timer_unit(&name));
        } else {
            let tail = if enable {
                ("enable", "--now")
            } else {
                ("disable", "--now")
            };
            sys_run("systemctl", &["--user", tail.0, tail.1, &timer_unit(&name)])?;
            println!("{verb}d {}", timer_unit(&name));
        }
        changed += 1;
    }
    if dry_run {
        println!("dry-run: {changed} task(s) would change");
    } else {
        println!("{changed} task(s) changed");
    }
    Ok(())
}

pub fn pause() -> Result<()> {
    let rows = view::collect();
    let enabled: Vec<String> = rows
        .iter()
        .filter(|r| r.enabled)
        .map(|r| r.name.clone())
        .collect();
    state::save(
        &state::state_path(),
        &state::PauseState {
            enabled: enabled.clone(),
        },
    )?;
    set_enabled(None, false, false)?;
    println!(
        "paused {} task(s); resume with: octask resume",
        enabled.len()
    );
    Ok(())
}

pub fn resume() -> Result<()> {
    let path = state::state_path();
    let Some(saved) = state::load(&path)? else {
        bail!("no paused state (octask pause first)");
    };
    let wanted: BTreeSet<String> = saved.enabled.into_iter().collect();
    let names = managed_names(&unit_dir());
    for name in &names {
        let target = wanted.contains(name);
        if is_enabled(name) != target {
            let tail = if target {
                ("enable", "--now")
            } else {
                ("disable", "--now")
            };
            sys_run("systemctl", &["--user", tail.0, tail.1, &timer_unit(name)])?;
        }
    }
    state::clear(&path)?;
    println!(
        "resumed {} task(s) from {} managed",
        wanted.len(),
        names.len()
    );
    Ok(())
}

pub fn run(name: &str) -> Result<()> {
    let name = one_name(name)?;
    let dir = unit_dir();
    require_units(&dir, "run", &name)?;
    sys_run(
        "systemctl",
        &["--user", "start", "--no-block", &service_unit(&name)],
    )?;
    println!("started {}", service_unit(&name));
    Ok(())
}

pub fn status(name: &str, json: bool) -> Result<()> {
    let name = one_name(name)?;
    let dir = unit_dir();
    require_units(&dir, "status", &name)?;
    if json {
        println!(
            "{}",
            serde_json::to_string_pretty(&serde_json::json!({
                "name": name,
                "enabled": is_enabled(&name),
                "timer_active": systemctl_show(&format!("{name}.timer"), "ActiveState"),
                "service_active": systemctl_show(&format!("{name}.service"), "ActiveState"),
                "result": systemctl_show(&format!("{name}.service"), "Result"),
                "next_run": next_run(&name),
            }))?
        );
        return Ok(());
    }
    sys_run(
        "systemctl",
        &[
            "--user",
            "status",
            &timer_unit(&name),
            &service_unit(&name),
            "--no-pager",
        ],
    )
}

pub fn logs(name: &str, lines: u32, follow: bool) -> Result<()> {
    let name = one_name(name)?;
    let mut args: Vec<String> = vec![
        "--user".into(),
        "-u".into(),
        service_unit(&name),
        "-n".into(),
        lines.to_string(),
        "--no-pager".into(),
    ];
    if follow {
        args.push("-f".into());
    }
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    sys_run("journalctl", &refs)
}

pub fn show(name: &str, json: bool) -> Result<()> {
    let name = one_name(name)?;
    let dir = unit_dir();
    require_units(&dir, "show", &name)?;
    let t = load_task(&dir, &name)?;
    let next = next_run(&name);
    if json {
        println!(
            "{}",
            serde_json::to_string_pretty(&serde_json::json!({
                "name": t.name,
                "kind": if t.is_agent { "agent" } else { "exec" },
                "agent": t.agent,
                "model": t.model,
                "prompt": t.prompt,
                "exec": t.exec,
                "workdir": t.workdir,
                "oncalendar": t.oncalendar,
                "delay": t.delay,
                "persistent": t.persistent,
                "timeout": t.timeout,
                "dirty_only": t.dirty,
                "description": t.description,
                "envs": t.envs,
                "credentials": t.creds,
                "enabled": is_enabled(&name),
                "next_run": next,
            }))?
        );
        return Ok(());
    }
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
    if !next.is_empty() {
        println!("next run: {next}");
    }
    Ok(())
}

pub fn cleanup(dry_run: bool, include_history: bool) -> Result<()> {
    let dir = unit_dir();
    let names: BTreeSet<String> = managed_names(&dir).into_iter().collect();
    let mut stale: Vec<PathBuf> = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            let Some(file) = path.file_name().and_then(|n| n.to_str()) else {
                continue;
            };
            if !file.starts_with(PREFIX) {
                continue;
            }
            let keep = names.iter().any(|name| {
                file == format!("{PREFIX}{name}.timer") || file == format!("{PREFIX}{name}.service")
            });
            if !keep {
                stale.push(path);
            }
        }
    }

    let state_dir = state::state_dir();
    let mut artifacts: Vec<PathBuf> = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&state_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            let Some(file) = path.file_name().and_then(|n| n.to_str()) else {
                continue;
            };
            if file == "pause.json" {
                continue;
            }
            if !include_history && path.is_dir() && file == "history" {
                continue;
            }
            artifacts.push(path);
        }
    }
    stale.sort();
    artifacts.sort();

    if stale.is_empty() && artifacts.is_empty() {
        println!("nothing to clean");
        return Ok(());
    }
    for path in stale.iter().chain(artifacts.iter()) {
        if dry_run {
            println!("dry-run: would remove {}", tildify(&path.to_string_lossy()));
        } else if path.is_dir() {
            let _ = std::fs::remove_dir_all(path);
        } else {
            let _ = std::fs::remove_file(path);
        }
    }
    println!(
        "{}",
        format!(
            "{} {}",
            stale.len() + artifacts.len(),
            if dry_run {
                "artifact(s) would be removed"
            } else {
                "artifact(s) removed"
            }
        )
        .dimmed()
    );
    Ok(())
}
