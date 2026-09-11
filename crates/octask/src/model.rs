use std::path::Path;

use anyhow::Result;
use anyhow::bail;

use crate::sys::PREFIX;
use crate::sys::norm_name;
use crate::sys::read_string;
use crate::sys::unbq;
use crate::sys::unit_paths;
use crate::sys::unsq;

pub const DIRTY_PREFIX: &str = "if [ -z \"$(git status --porcelain)\" ]; then exit 0; fi; exec ";

/// Everything one managed task carries, as parsed from (or written to) its
/// unit files.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Task {
    pub name: String,
    pub is_agent: bool,
    pub agent: String,
    pub model: String,
    pub prompt: String,
    pub dirty: bool,
    pub exec: String,
    pub workdir: String,
    pub oncalendar: String,
    pub delay: String,
    pub persistent: bool,
    pub timeout: String,
    pub description: String,
    pub envs: Vec<String>,
    pub creds: Vec<String>,
}

pub fn service_text(t: &Task) -> String {
    let mut s = String::new();
    s.push_str("[Unit]\n");
    s.push_str(&format!("Description={}\n", t.description));
    s.push('\n');
    s.push_str("[Service]\n");
    s.push_str("Type=oneshot\n");
    if !t.workdir.is_empty() {
        s.push_str(&format!("WorkingDirectory={}\n", t.workdir));
    }
    for e in &t.envs {
        s.push_str(&format!("Environment={e}\n"));
    }
    for c in &t.creds {
        s.push_str(&format!("LoadCredential={c}\n"));
    }
    if !t.timeout.is_empty() {
        s.push_str(&format!("TimeoutStartSec={}\n", t.timeout));
    }
    s.push_str(&format!(
        "ExecStart=/usr/bin/bash -c {}\n",
        crate::sys::sq(&t.exec)
    ));
    s
}

pub fn timer_text(t: &Task) -> String {
    let mut s = String::new();
    s.push_str("[Unit]\n");
    s.push_str(&format!("Description={} (timer)\n", t.description));
    s.push('\n');
    s.push_str("[Timer]\n");
    s.push_str(&format!("OnCalendar={}\n", t.oncalendar));
    if !t.delay.is_empty() {
        s.push_str(&format!("RandomizedDelaySec={}\n", t.delay));
    }
    if t.persistent {
        s.push_str("Persistent=true\n");
    }
    s.push('\n');
    s.push_str("[Install]\n");
    s.push_str("WantedBy=timers.target\n");
    s
}

fn property(content: &str, key: &str) -> String {
    content
        .lines()
        .find_map(|l| l.strip_prefix(key).map(|v| v.to_owned()))
        .unwrap_or_default()
}

fn properties(content: &str, key: &str) -> Vec<String> {
    content
        .lines()
        .filter_map(|l| l.strip_prefix(key).map(|v| v.to_owned()))
        .collect()
}

/// Parses a task's units under `dir`. Mirrors the bash `load_task`: dies when
/// a unit is missing or the ExecStart shape is unrecognized.
pub fn load_task(dir: &Path, name: &str) -> Result<Task> {
    let (service, timer) = unit_paths(dir, name);
    let svc = read_string(&service)
        .map_err(|_| anyhow::anyhow!("edit: no service unit for '{PREFIX}{name}' (octask list)"))?;
    let tmr = read_string(&timer).map_err(|_| {
        anyhow::anyhow!("edit: no timer unit for '{PREFIX}{name}' (re-add the task)")
    })?;

    let mut t = Task {
        name: name.to_owned(),
        description: property(&svc, "Description="),
        workdir: property(&svc, "WorkingDirectory="),
        timeout: property(&svc, "TimeoutStartSec="),
        envs: properties(&svc, "Environment="),
        creds: properties(&svc, "LoadCredential="),
        oncalendar: property(&tmr, "OnCalendar="),
        delay: property(&tmr, "RandomizedDelaySec="),
        persistent: tmr.lines().any(|l| l == "Persistent=true"),
        ..Task::default()
    };

    let execstart = property(&svc, "ExecStart=");
    if execstart.is_empty() {
        bail!(
            "edit: {} has no ExecStart (re-add the task)",
            service.display()
        );
    }
    if !execstart.starts_with("/usr/bin/bash -c '") {
        bail!("edit: unexpected ExecStart format (re-add the task)");
    }
    let rest = &execstart["/usr/bin/bash -c ".len()..];
    let inner = unsq(rest);

    if inner.contains(" run --agent ") || inner.contains(" run --model ") {
        t.is_agent = true;
    }

    if t.is_agent {
        let mut inner = inner.as_str();
        if let Some(stripped) = inner.strip_prefix(DIRTY_PREFIX) {
            t.dirty = true;
            inner = stripped;
        }
        if let Some(tok) = last_flag_token(inner, "--model") {
            t.model = tok;
        }
        match last_flag_token(inner, "--agent") {
            Some(a) => t.agent = a,
            None => bail!("edit: could not parse --agent (re-add the task)"),
        }
        let Some(first) = inner.find('"') else {
            bail!("edit: could not parse prompt (re-add the task)");
        };
        let Some(last) = inner[first..].rfind('"') else {
            bail!("edit: could not parse prompt (re-add the task)");
        };
        t.prompt = unbq(&inner[first..=first + last]);
    } else {
        t.exec = inner;
    }
    Ok(t)
}

/// Greedy extraction like bash `sed -n 's/.* --model \([^ ][^ ]*\).*/\1/p'`:
/// the last occurrence of `--flag ` and the token up to the next space.
fn last_flag_token(cmd: &str, flag: &str) -> Option<String> {
    let needle = format!(" {flag} ");
    let start = cmd.rfind(&needle)? + needle.len();
    let end = cmd[start..]
        .find(' ')
        .map(|i| start + i)
        .unwrap_or(cmd.len());
    Some(cmd[start..end].to_owned())
}

/// Lists names of every managed task, sorted, from the timer files.
pub fn managed_names(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|f| f.starts_with(PREFIX) && f.ends_with(".timer"))
        .map(|f| norm_name(&f))
        .collect();
    names.sort();
    names
}
