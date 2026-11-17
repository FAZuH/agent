use owo_colors::OwoColorize;

use crate::model::managed_names;
use crate::model::property;
use crate::sys::PREFIX;
use crate::sys::home;
use crate::sys::next_run;
use crate::sys::ok;
use crate::sys::tildify;
use crate::sys::unit_dir;
use crate::sys::unit_paths;

#[derive(Clone, Debug)]
pub struct TaskView {
    pub name: String,
    pub kind: &'static str,
    pub description: String,
    pub workdir: String,
    pub oncalendar: String,
    pub next: String,
    pub enabled: bool,
    pub active: bool,
    pub failed: bool,
}

fn unit_is(unit: &str, property_name: &str) -> bool {
    ok(
        "systemctl",
        &["--user", property_name, &format!("{PREFIX}{unit}")],
    )
}

pub fn collect() -> Vec<TaskView> {
    let dir = unit_dir();
    managed_names(&dir)
        .into_iter()
        .map(|name| {
            let (service, timer) = unit_paths(&dir, &name);
            let svc = std::fs::read_to_string(&service).unwrap_or_default();
            let tmr = std::fs::read_to_string(&timer).unwrap_or_default();
            let mut description = property(&svc, "Description=");
            if let Some(rest) = description.strip_prefix(&format!("{PREFIX}{name}: ")) {
                description = rest.to_owned();
            }
            let workdir = tildify(&property(&svc, "WorkingDirectory="));
            description = description.replace(&home().to_string_lossy().into_owned(), "~");
            description = tildify(&description);
            TaskView {
                kind: if svc.contains("--agent") {
                    "agent"
                } else {
                    "exec"
                },
                description,
                oncalendar: property(&tmr, "OnCalendar="),
                next: next_run(&name),
                enabled: unit_is(&format!("{name}.timer"), "is-enabled"),
                active: unit_is(&format!("{name}.service"), "is-active"),
                failed: unit_is(&format!("{name}.service"), "is-failed"),
                name,
                workdir,
            }
        })
        .collect()
}

fn trunc(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_owned();
    }
    let mut out: String = s.chars().take(max.saturating_sub(1)).collect();
    out.push('\u{2026}');
    out
}

pub fn glyph(row: &TaskView) -> String {
    if row.failed {
        "[!]".red().to_string()
    } else if row.enabled {
        "[+]".green().to_string()
    } else {
        "[-]".yellow().to_string()
    }
}

pub fn render(rows: &[TaskView]) -> String {
    let mut out = String::new();
    out.push_str(
        &format!(
            "{:<3}  {:<18}  {:<6}  {:<22}  {:<22}  {}",
            "ST", "NAME", "TYPE", "SCHEDULE", "NEXT", "TASK"
        )
        .dimmed()
        .to_string(),
    );
    out.push('\n');
    if rows.is_empty() {
        out.push_str(
            &"  (no tasks; add one with: octask add <name> ...)"
                .dimmed()
                .to_string(),
        );
        out.push('\n');
        return out;
    }
    for row in rows {
        let kind = if row.kind == "agent" {
            row.kind.bright_cyan().to_string()
        } else {
            row.kind.to_owned()
        };
        let desc = if row.description.is_empty() {
            row.workdir.clone()
        } else {
            row.description.clone()
        };
        out.push_str(&format!(
            "{}  {:<18}  {:<6}  {:<22}  {:<22}  {}",
            glyph(row),
            trunc(&row.name, 18),
            kind,
            trunc(&row.oncalendar, 22),
            trunc(&row.next, 16),
            trunc(&desc, 40),
        ));
        out.push('\n');
    }
    out
}

pub fn to_json(rows: &[TaskView]) -> serde_json::Value {
    serde_json::Value::Array(
        rows.iter()
            .map(|r| {
                serde_json::json!({
                    "name": r.name,
                    "kind": r.kind,
                    "description": r.description,
                    "workdir": r.workdir,
                    "oncalendar": r.oncalendar,
                    "next": r.next,
                    "enabled": r.enabled,
                    "active": r.active,
                    "failed": r.failed,
                })
            })
            .collect(),
    )
}
