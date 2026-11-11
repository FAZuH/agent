use octask::model::Task;
use octask::transfer::add_args_from_json;
use octask::transfer::task_to_json;
use serde_json::json;

fn fixture_task() -> Task {
    Task {
        name: "notes".into(),
        is_agent: true,
        agent: "autocommit".into(),
        model: "litellm/free-pro".into(),
        prompt: "commit notes".into(),
        dirty: true,
        workdir: "/home/u/Notes".into(),
        oncalendar: "*-*-* 00/12:00:00".into(),
        persistent: true,
        timeout: "600".into(),
        description: "agent autocommit in ~/Notes [litellm/free-pro]".into(),
        envs: vec!["PATH=/usr/local/bin:/usr/bin".into(), "FOO=bar".into()],
        creds: vec!["MAILCRED:/home/u/.secrets/mail".into()],
        ..Task::default()
    }
}

#[test]
fn export_document_has_version_and_sorted_keys() {
    let v = task_to_json(&fixture_task(), true);
    let keys: Vec<&str> = v.as_object().unwrap().keys().map(String::as_str).collect();
    let mut sorted = keys.clone();
    sorted.sort_unstable();
    assert_eq!(
        keys, sorted,
        "keys must be sorted like python sort_keys=True"
    );
}

#[test]
fn import_replays_exported_task_through_add_args() {
    let doc = json!({ "version": 1, "tasks": [task_to_json(&fixture_task(), true)] });
    let t = &doc["tasks"][0];
    let a = add_args_from_json(t, false, false).unwrap();
    assert_eq!(a.name, "notes");
    assert_eq!(a.agent.as_deref(), Some("autocommit"));
    assert_eq!(a.prompt.as_deref(), Some("commit notes"));
    assert_eq!(a.workdir.as_deref(), Some("/home/u/Notes"));
    assert_eq!(a.model.as_deref(), Some("litellm/free-pro"));
    assert!(a.dirty_only);
    assert!(a.persistent);
    assert_eq!(a.timeout.as_deref(), Some("600"));
    assert_eq!(a.oncalendar.as_deref(), Some("*-*-* 00/12:00:00"));
    assert_eq!(
        a.description.as_deref(),
        Some("agent autocommit in ~/Notes")
    );
    assert_eq!(a.env, vec!["FOO=bar".to_string()]);
    assert_eq!(
        a.credential,
        vec!["MAILCRED:/home/u/.secrets/mail".to_string()]
    );
    assert!(!a.no_enable, "enabled=1 must stay enabled");
}

#[test]
fn import_preserves_disabled_state() {
    let t = task_to_json(&fixture_task(), false);
    let a = add_args_from_json(&t, false, false).unwrap();
    assert!(a.no_enable);
}

#[test]
fn import_exec_task_defaults_and_type_check() {
    let a = add_args_from_json(
        &json!({ "name": "ping", "exec": "echo hi", "workdir": "/tmp" }),
        true,
        true,
    )
    .unwrap();
    assert_eq!(a.exec.as_deref(), Some("echo hi"));
    assert_eq!(a.workdir.as_deref(), Some("/tmp"));
    assert_eq!(a.agent, None, "type defaults to exec when absent");
    assert!(a.force);
    assert!(a.no_enable);

    let err = add_args_from_json(&json!({ "name": "x", "type": "cron" }), true, true)
        .unwrap_err()
        .to_string();
    assert_eq!(err, "import: task 'x' has unknown type 'cron'");
}

#[test]
fn import_requires_name_and_rejects_bad_names() {
    let err = add_args_from_json(&json!({ "exec": "x" }), true, true).unwrap_err();
    assert_eq!(err.to_string(), "missing <name>", "{err}");

    let err =
        add_args_from_json(&json!({ "name": "Bad Name", "exec": "x" }), true, true).unwrap_err();
    assert!(err.to_string().contains("invalid name"), "{err}");
}

#[test]
fn export_import_round_trip_is_stable() {
    let t = fixture_task();
    let doc = task_to_json(&t, true);
    let a = add_args_from_json(&doc, true, false).unwrap();
    assert_eq!(a.name, t.name);
    assert_eq!(a.prompt.as_deref(), Some(t.prompt.as_str()));
    assert_eq!(a.agent.as_deref(), Some(t.agent.as_str()));
}
