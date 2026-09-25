use std::fs;
use std::path::Path;

use octask::model::Task;
use octask::model::load_task;
use octask::model::service_text;
use octask::model::timer_text;
use octask::sys::bq;
use octask::sys::norm_name;
use octask::sys::require_name;
use octask::sys::sq;
use octask::sys::unbq;
use octask::sys::unsq;
use octask::sys::valid_name;

fn write_fixture(dir: &Path, name: &str, task: &Task) {
    fs::write(
        dir.join(format!("octask-{name}.service")),
        service_text(task),
    )
    .unwrap();
    fs::write(dir.join(format!("octask-{name}.timer")), timer_text(task)).unwrap();
}

#[test]
fn quoting_round_trips_nasty_text() {
    let nasty = "it's a \"test\" $HOME `id` \\ done";
    assert_eq!(unsq(&sq(nasty)), nasty);
    assert_eq!(unbq(&bq(nasty)), nasty);
}

#[test]
fn nested_quoting_round_trips_apostrophes() {
    let nasty = "don't \"break\" $THIS `id` \\ ok";
    assert_eq!(unbq(&bq(nasty)), nasty);
    let exec = format!("/bin/oc run --agent a {}", bq(nasty));
    assert_eq!(unsq(&sq(&exec)), exec);
}

#[test]
fn name_normalization_accepts_bare_and_full_unit_names() {
    assert_eq!(norm_name("daily"), "daily");
    assert_eq!(norm_name("octask-daily"), "daily");
    assert_eq!(norm_name("octask-daily.timer"), "daily");
    assert_eq!(norm_name("octask-daily.service"), "daily");
}

#[test]
fn name_validation_rejects_bad_shapes() {
    assert!(valid_name("a0"));
    assert!(valid_name("a-b_c"));
    assert!(!valid_name(""));
    assert!(!valid_name("-a"));
    assert!(!valid_name("A"));
    assert!(!valid_name("a.b"));
    require_name("ok-name").unwrap();
    assert!(require_name("Bad").is_err());
}

#[test]
fn exec_task_round_trips_through_its_units() {
    let dir = tempfile::tempdir().unwrap();
    let task = Task {
        name: "ping".into(),
        description: "echo hi".into(),
        exec: "echo hi".into(),
        oncalendar: "daily".into(),
        timeout: "30".into(),
        ..Task::default()
    };
    write_fixture(dir.path(), "ping", &task);
    let t = load_task(dir.path(), "ping").unwrap();
    assert!(!t.is_agent);
    assert_eq!(t.exec, "echo hi");
    assert_eq!(t.timeout, "30");
    assert_eq!(t.oncalendar, "daily");
    assert_eq!(t.description, "echo hi");
}

#[test]
fn agent_task_round_trips_prompt_with_quotes_and_dollars() {
    let dir = tempfile::tempdir().unwrap();
    let prompt = "commit \"my\" notes; echo $HOME && it's `fine` \\ ok";
    let exec = format!(
        "/bin/opencode2 run --model litellm/free-pro --agent autocommit {}",
        bq(prompt)
    );
    let task = Task {
        name: "notes".into(),
        is_agent: true,
        agent: "autocommit".into(),
        model: "litellm/free-pro".into(),
        prompt: prompt.into(),
        dirty: true,
        exec: format!("{}{exec}", octask::model::DIRTY_PREFIX),
        workdir: "/home/u/Notes".into(),
        oncalendar: "*-*-* 00/12:00:00".into(),
        description: "agent autocommit in ~/Notes [litellm/free-pro]".into(),
        timeout: "600".into(),
        envs: vec!["PATH=/usr/local/bin:/usr/bin".into()],
        ..Task::default()
    };
    write_fixture(dir.path(), "notes", &task);
    let t = load_task(dir.path(), "notes").unwrap();
    assert!(t.is_agent);
    assert!(t.dirty);
    assert_eq!(t.agent, "autocommit");
    assert_eq!(t.model, "litellm/free-pro");
    assert_eq!(t.prompt, prompt);
    assert_eq!(t.envs, vec!["PATH=/usr/local/bin:/usr/bin".to_string()]);
}

#[test]
fn load_task_reports_missing_units() {
    let dir = tempfile::tempdir().unwrap();
    let err = load_task(dir.path(), "ghost").unwrap_err().to_string();
    assert!(
        err.starts_with("edit: no service unit for 'octask-ghost'"),
        "{err}"
    );
}

#[test]
fn load_task_rejects_foreign_execstart() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(
        dir.path().join("octask-x.service"),
        "[Unit]\nDescription=x\n\n[Service]\nType=oneshot\nExecStart=/bin/true\n",
    )
    .unwrap();
    fs::write(
        dir.path().join("octask-x.timer"),
        "[Timer]\nOnCalendar=daily\n",
    )
    .unwrap();
    let err = load_task(dir.path(), "x").unwrap_err().to_string();
    assert_eq!(err, "edit: unexpected ExecStart format (re-add the task)");
}
