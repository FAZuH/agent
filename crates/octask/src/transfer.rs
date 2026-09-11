use std::io::IsTerminal;

use anyhow::Result;
use anyhow::bail;
use clap::Parser;
use serde_json::Value;
use serde_json::json;

use crate::add::AddArgs;
use crate::add::install;
use crate::model::Task;
use crate::model::load_task;
use crate::model::managed_names;
use crate::sys::norm_name;
use crate::sys::ok;
use crate::sys::require_name;
use crate::sys::stdin_slurp;
use crate::sys::unit_dir;

#[derive(Parser, Clone, Default, Debug)]
pub struct ExportArgs {
    #[arg(value_name = "NAME")]
    pub names: Vec<String>,
    #[arg(long)]
    pub file: Option<String>,
}

#[derive(Parser, Clone, Default, Debug)]
pub struct ImportArgs {
    #[arg(long)]
    pub file: Option<String>,
    #[arg(long)]
    pub force: bool,
    #[arg(long)]
    pub no_enable: bool,
}

pub fn task_to_json(t: &Task, enabled: bool) -> Value {
    json!({
        "name": t.name,
        "type": if t.is_agent { "agent" } else { "exec" },
        "agent": t.agent,
        "model": t.model,
        "prompt": t.prompt,
        "dirty_only": t.dirty,
        "exec": t.exec,
        "workdir": t.workdir,
        "oncalendar": t.oncalendar,
        "delay": t.delay,
        "persistent": t.persistent,
        "timeout": t.timeout,
        "description": t.description,
        "env": t.envs,
        "credentials": t.creds,
        "enabled": enabled,
    })
}

pub fn export(args: &ExportArgs) -> Result<()> {
    let dir = unit_dir();
    let requested: Vec<String> = if args.names.is_empty() {
        let names = managed_names(&dir);
        if names.is_empty() {
            bail!("export: no tasks found (octask list)");
        }
        names
    } else {
        args.names.clone()
    };

    let mut seen: Vec<String> = Vec::new();
    let mut tasks: Vec<Value> = Vec::new();
    for n in &requested {
        let name = norm_name(n);
        require_name(&name)?;
        if seen.contains(&name) {
            continue;
        }
        seen.push(name.clone());
        if !crate::sys::units_exist(&dir, &name) {
            bail!("export: no units found for 'octask-{name}' (octask list)");
        }
        let t = load_task(&dir, &name)?;
        let enabled = ok(
            "systemctl",
            &["--user", "is-enabled", &format!("octask-{name}.timer")],
        );
        tasks.push(task_to_json(&t, enabled));
    }

    let doc = json!({ "version": 1, "tasks": tasks });
    let body = serde_json::to_string_pretty(&doc)?;
    match &args.file {
        Some(f) => {
            std::fs::write(f, body + "\n")?;
            println!("exported {} task(s) -> {f}", seen.len());
        }
        None => println!("{body}"),
    }
    Ok(())
}

pub fn add_args_from_json(t: &Value, force: bool, no_enable: bool) -> Result<AddArgs> {
    let s = |k: &str| {
        t.get(k)
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned()
    };
    let b = |k: &str| t.get(k).and_then(Value::as_bool).unwrap_or(false);
    let list = |k: &str| -> Result<Vec<String>> {
        let Some(arr) = t.get(k).and_then(Value::as_array) else {
            return Ok(Vec::new());
        };
        arr.iter()
            .map(|v| {
                v.as_str()
                    .map(str::to_owned)
                    .ok_or_else(|| anyhow::anyhow!("import: '{k}' must be a list of strings"))
            })
            .collect()
    };

    let name = norm_name(&s("name"));
    require_name(&name)?;
    let no_enable = no_enable || !b("enabled");
    let kind = {
        let k = s("type");
        if k.is_empty() { "exec".to_owned() } else { k }
    };

    let mut a = AddArgs {
        name,
        force,
        no_enable,
        ..AddArgs::default()
    };
    if kind == "agent" {
        a.agent = Some(s("agent"));
        a.prompt = Some(s("prompt"));
        a.workdir = Some(s("workdir"));
        let model = s("model");
        if !model.is_empty() {
            a.model = Some(model);
        }
        a.dirty_only = b("dirty_only");
    } else {
        if kind != "exec" {
            bail!("import: task '{}' has unknown type '{kind}'", s("name"));
        }
        a.exec = Some(s("exec"));
        let workdir = s("workdir");
        if !workdir.is_empty() {
            a.workdir = Some(workdir);
        }
    }

    let oncalendar = s("oncalendar");
    if !oncalendar.is_empty() {
        a.oncalendar = Some(oncalendar);
    }
    let timeout = s("timeout");
    if !timeout.is_empty() {
        a.timeout = Some(timeout);
    }
    let delay = s("delay");
    if !delay.is_empty() {
        a.delay = Some(delay);
    }
    a.persistent = b("persistent");

    let mut desc = s("description");
    let model = s("model");
    if kind == "agent" && !model.is_empty() {
        let suffix = format!(" [{model}]");
        if let Some(stripped) = desc.strip_suffix(&suffix) {
            desc = stripped.to_owned();
        }
    }
    if !desc.is_empty() {
        a.description = Some(desc);
    }

    for e in list("env")? {
        if e == "PATH=/usr/local/bin:/usr/bin" && kind == "agent" {
            continue;
        }
        a.env.push(e);
    }
    a.credential = list("credentials")?;

    Ok(a)
}

pub fn import(args: &ImportArgs) -> Result<()> {
    let raw = match &args.file {
        Some(f) => std::fs::read_to_string(f)
            .map_err(|_| anyhow::anyhow!("import: file not found: {f}"))?,
        None => {
            if std::io::stdin().is_terminal() {
                bail!("import: no --file and stdin is a terminal (pipe JSON or pass --file)");
            }
            stdin_slurp()?
        }
    };

    let doc: Value =
        serde_json::from_str(&raw).map_err(|_| anyhow::anyhow!("import: invalid JSON"))?;
    let tasks = match &doc {
        Value::Object(o) => o.get("tasks").cloned().unwrap_or_else(|| doc.clone()),
        _ => doc.clone(),
    };
    let Value::Array(items) = &tasks else {
        bail!("import: expected {{\"version\": 1, \"tasks\": [...]}}");
    };
    for t in items {
        let named = t.get("name").and_then(Value::as_str).unwrap_or_default();
        if named.is_empty() {
            bail!("import: every task needs a name");
        }
    }

    let dir = unit_dir();
    for t in items {
        let iname = norm_name(t.get("name").and_then(Value::as_str).unwrap_or_default());
        require_name(&iname)?;
        if crate::sys::units_exist(&dir, &iname) && !args.force {
            bail!(
                "import: {}/octask-{iname}.service already exists (use --force to overwrite)",
                dir.display()
            );
        }
    }

    let mut count = 0;
    for t in items {
        let a = add_args_from_json(t, args.force, args.no_enable)?;
        install(&a, None)?;
        count += 1;
    }
    println!("imported {count} task(s)");
    Ok(())
}
