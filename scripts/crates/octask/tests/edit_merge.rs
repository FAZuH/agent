use octask::edit::EditArgs;
use octask::edit::description_for_add;
use octask::edit::merged_add_args;
use octask::model::Task;

fn agent_task() -> Task {
    let notes = std::env::var("HOME").unwrap() + "/Notes";
    Task {
        description: format!("agent autocommit in {notes} [litellm/free-pro]"),
        name: "notes".into(),
        is_agent: true,
        agent: "autocommit".into(),
        model: "litellm/free-pro".into(),
        prompt: "commit notes".into(),
        dirty: true,
        workdir: notes,
        oncalendar: "*-*-* 00/12:00:00".into(),
        timeout: "600".into(),
        envs: vec!["PATH=/usr/local/bin:/usr/bin".into(), "FOO=bar".into()],
        ..Task::default()
    }
}

fn exec_task() -> Task {
    Task {
        name: "ping".into(),
        description: "echo hi".into(),
        exec: "echo hi".into(),
        oncalendar: "daily".into(),
        ..Task::default()
    }
}

fn edit_args(f: impl FnOnce(&mut EditArgs)) -> EditArgs {
    let mut a = EditArgs {
        name: "notes".into(),
        ..EditArgs::default()
    };
    f(&mut a);
    a
}

#[test]
fn description_override_wins() {
    let t = agent_task();
    let a = edit_args(|e| e.description = Some("custom".into()));
    let merged = merged_add_args(&a, &t, true);
    assert_eq!(merged.description.as_deref(), Some("custom"));
}

#[test]
fn auto_description_is_rebuilt_not_carried() {
    let mut t = agent_task();
    t.description = format!("agent {} in {}", t.agent, t.workdir);
    let a = edit_args(|_| {});
    let merged = merged_add_args(&a, &t, true);
    assert_eq!(
        merged.description, None,
        "auto description must be rebuilt by add"
    );
}

#[test]
fn custom_agent_description_keeps_model_suffix_stripped() {
    let mut t = agent_task();
    t.description = "nightly vault commit [litellm/free-pro]".into();
    let a = edit_args(|_| {});
    let merged = merged_add_args(&a, &t, true);
    assert_eq!(merged.description.as_deref(), Some("nightly vault commit"));
    assert_eq!(description_for_add(Some("kept"), &t), "kept");
}

#[test]
fn exec_description_passes_through() {
    let t = exec_task();
    let a = edit_args(|_| {});
    let merged = merged_add_args(&a, &t, true);
    assert_eq!(merged.description.as_deref(), Some("echo hi"));
}

#[test]
fn model_flags_merge() {
    let t = agent_task();
    let set = edit_args(|e| e.model = Some("other/model".into()));
    assert_eq!(
        merged_add_args(&set, &t, true).model.as_deref(),
        Some("other/model")
    );

    let unset = edit_args(|e| e.no_model = true);
    let merged = merged_add_args(&unset, &t, true);
    assert_eq!(merged.model, None);
    assert_eq!(
        merged.description, None,
        "auto description is rebuilt by add from agent+workdir"
    );
}

#[test]
fn agent_path_env_is_readded_by_add_not_carried() {
    let t = agent_task();
    let a = edit_args(|_| {});
    let merged = merged_add_args(&a, &t, true);
    assert!(
        !merged
            .env
            .iter()
            .any(|e| e == "PATH=/usr/local/bin:/usr/bin")
    );
    assert_eq!(merged.env, vec!["FOO=bar".to_string()]);
}

#[test]
fn credentials_merge_by_name_with_new_wins() {
    let mut t = agent_task();
    t.creds = vec!["A:/old".into(), "B:/keep".into()];
    let a = edit_args(|e| e.credential = vec!["A:/new".into()]);
    let merged = merged_add_args(&a, &t, true);
    assert_eq!(
        merged.credential,
        vec!["B:/keep".to_string(), "A:/new".to_string()]
    );

    let clear = edit_args(|e| {
        e.clear_credentials = true;
        e.credential = vec!["A:/new".into()];
    });
    let merged = merged_add_args(&clear, &t, true);
    assert_eq!(merged.credential, vec!["A:/new".to_string()]);
}

#[test]
fn toggles_merge() {
    let mut t = agent_task();
    t.persistent = false;
    t.delay = "5min".into();

    let a = edit_args(|e| {
        e.no_delay = true;
        e.persistent = true;
    });
    let m = merged_add_args(&a, &t, true);
    assert!(!m.persistent.eq(&false));
    assert!(m.persistent);
    assert_eq!(m.delay, None);

    let b = edit_args(|e| e.no_persistent = true);
    assert!(!merged_add_args(&b, &t, true).persistent);

    let c = edit_args(|e| e.delay = Some("10min".into()));
    assert_eq!(
        merged_add_args(&c, &t, true).delay.as_deref(),
        Some("10min")
    );
}

#[test]
fn disabled_timer_stays_disabled() {
    let t = agent_task();
    let a = edit_args(|_| {});
    assert!(merged_add_args(&a, &t, false).no_enable);
    assert!(!merged_add_args(&a, &t, true).no_enable);
}

#[test]
fn exec_task_rejects_agent_flags() {
    let t = exec_task();
    let a = edit_args(|e| e.prompt = Some("no".into()));
    assert!(merged_add_args(&a, &t, true).agent.is_none());
    assert_eq!(
        merged_add_args(&a, &t, true).exec.as_deref(),
        Some("echo hi")
    );
}
