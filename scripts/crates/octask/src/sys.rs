use std::io::Read;
use std::path::Path;
use std::path::PathBuf;
use std::process::Command;
use std::process::Stdio;

use anyhow::Context;
use anyhow::Result;
use anyhow::bail;

pub const PREFIX: &str = "octask-";

pub fn home() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/"))
}

pub fn config_home() -> PathBuf {
    match std::env::var_os("XDG_CONFIG_HOME") {
        Some(v) if !v.is_empty() => PathBuf::from(v),
        _ => home().join(".config"),
    }
}

pub fn unit_dir() -> PathBuf {
    config_home().join("systemd/user")
}

/// `octask-<name>.service` / `.timer` paths under `dir`.
pub fn unit_paths(dir: &Path, name: &str) -> (PathBuf, PathBuf) {
    let base = dir.join(format!("{PREFIX}{name}"));
    (base.with_extension("service"), base.with_extension("timer"))
}

pub fn units_exist(dir: &Path, name: &str) -> bool {
    let (service, timer) = unit_paths(dir, name);
    service.exists() || timer.exists()
}

pub fn norm_name(raw: &str) -> String {
    let n = raw.strip_suffix(".timer").unwrap_or(raw);
    let n = n.strip_suffix(".service").unwrap_or(n);
    n.strip_prefix(PREFIX).unwrap_or(n).to_owned()
}

pub fn valid_name(n: &str) -> bool {
    let mut chars = n.chars();
    match chars.next() {
        Some(c) if c.is_ascii_lowercase() || c.is_ascii_digit() => {}
        _ => return false,
    }
    chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '-')
}

pub fn require_name(n: &str) -> Result<()> {
    if n.is_empty() {
        bail!("missing <name>");
    }
    if !valid_name(n) {
        bail!("invalid name '{n}' (use [a-z0-9][a-z0-9_-]*)");
    }
    Ok(())
}

pub fn tildify(p: &str) -> String {
    let h = home().to_string_lossy().into_owned();
    match p.strip_prefix(&h) {
        Some(rest) => format!("~{rest}"),
        None => p.to_owned(),
    }
}

// ---- quoting -------------------------------------------------------------

/// Single-quote for systemd `ExecStart` (no `$` expansion inside).
pub fn sq(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

/// Inverse of [`sq`]: removes the wrapping quotes and restores each `'\''`.
pub fn unsq(s: &str) -> String {
    let inner = s
        .strip_prefix('\'')
        .and_then(|x| x.strip_suffix('\''))
        .unwrap_or(s);
    inner.replace("'\\''", "'")
}

/// Double-quote for the inner bash (agent prompts).
pub fn bq(s: &str) -> String {
    let s = s
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('$', "\\$")
        .replace('`', "\\`");
    format!("\"{s}\"")
}

/// Inverse of [`bq`]: removes the wrapping double quotes and undoes each
/// escape in reverse order so an original backslash-quote restores correctly.
pub fn unbq(s: &str) -> String {
    let inner = s
        .strip_prefix('"')
        .and_then(|x| x.strip_suffix('"'))
        .unwrap_or(s);
    inner
        .replace("\\`", "`")
        .replace("\\$", "$")
        .replace("\\\"", "\"")
        .replace("\\\\", "\\")
}

// ---- processes -----------------------------------------------------------

fn spawn(program: &str, args: &[&str]) -> Result<std::process::Output> {
    Command::new(program)
        .args(args)
        .stdin(Stdio::null())
        .output()
        .with_context(|| format!("failed to run {program}"))
}

/// Runs to completion, dies with the same exit status on failure.
pub fn run(program: &str, args: &[&str]) -> Result<()> {
    let status = Command::new(program)
        .args(args)
        .status()
        .with_context(|| format!("failed to run {program}"))?;
    if !status.success() {
        std::process::exit(status.code().unwrap_or(1));
    }
    Ok(())
}

/// Like [`run`], with stdout discarded (stderr still reaches the terminal).
pub fn run_quiet(program: &str, args: &[&str]) -> Result<()> {
    let status = Command::new(program)
        .args(args)
        .stdout(Stdio::null())
        .status()
        .with_context(|| format!("failed to run {program}"))?;
    if !status.success() {
        std::process::exit(status.code().unwrap_or(1));
    }
    Ok(())
}

/// Locates an executable on `PATH`.
pub fn which(program: &str) -> Option<PathBuf> {
    let paths = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&paths) {
        let cand = dir.join(program);
        if cand.is_file() {
            return Some(cand);
        }
    }
    None
}

/// True when the command exits 0; its output is discarded.
pub fn ok(program: &str, args: &[&str]) -> bool {
    spawn(program, args)
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// stdout of a command, empty when it fails.
pub fn stdout_soft(program: &str, args: &[&str]) -> String {
    spawn(program, args)
        .map(|o| String::from_utf8_lossy(&o.stdout).trim_end().to_owned())
        .unwrap_or_default()
}

/// stdout when the command succeeds, `None` otherwise.
pub fn stdout_opt(program: &str, args: &[&str]) -> Option<String> {
    let out = spawn(program, args).ok()?;
    if out.status.success() {
        Some(String::from_utf8_lossy(&out.stdout).trim_end().to_owned())
    } else {
        None
    }
}

/// Combined stdout+stderr of a failing command, for error reporting.
pub fn failure_report(program: &str, args: &[&str]) -> Option<String> {
    let out = spawn(program, args).ok()?;
    if out.status.success() {
        return None;
    }
    let mut text = String::new();
    text.push_str(&String::from_utf8_lossy(&out.stdout));
    text.push_str(&String::from_utf8_lossy(&out.stderr));
    Some(text)
}

pub fn next_run(name: &str) -> String {
    stdout_soft(
        "systemctl",
        &[
            "--user",
            "show",
            &format!("{PREFIX}{name}.timer"),
            "--property=NextElapseUSecRealtime",
            "--value",
        ],
    )
}

/// Unified-style diff of two files; nothing when they match.
pub fn diff_files(old_path: &Path, new_path: &Path) {
    let old_text = std::fs::read_to_string(old_path).unwrap_or_default();
    let new_text = std::fs::read_to_string(new_path).unwrap_or_default();
    if old_text == new_text {
        return;
    }
    println!("--- {}", old_path.display());
    println!("+++ {}", new_path.display());
    let old: Vec<&str> = old_text.lines().collect();
    let new: Vec<&str> = new_text.lines().collect();
    let mut i = 0;
    let mut j = 0;
    while i < old.len() || j < new.len() {
        match (old.get(i), new.get(j)) {
            (Some(a), Some(b)) if a == b => {
                println!(" {a}");
                i += 1;
                j += 1;
            }
            (Some(a), _) if !new.contains(a) => {
                println!("-{a}");
                i += 1;
            }
            (_, Some(b)) => {
                println!("+{b}");
                j += 1;
            }
            _ => break,
        }
    }
}

pub fn read_string(p: &Path) -> std::io::Result<String> {
    std::fs::read_to_string(p)
}

pub fn stdin_slurp() -> Result<String> {
    let mut buf = String::new();
    std::io::stdin()
        .read_to_string(&mut buf)
        .context("reading stdin")?;
    Ok(buf)
}
