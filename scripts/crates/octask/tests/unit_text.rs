use octask::model::Task;
use octask::model::service_text;
use octask::model::timer_text;

#[test]
fn service_text_matches_bash_output() {
    let t = Task {
        name: "backup".into(),
        description: "agent autocommit in ~/Notes [litellm/free-pro]".into(),
        workdir: "/home/u/Notes".into(),
        envs: vec!["PATH=/usr/local/bin:/usr/bin".into(), "FOO=bar".into()],
        creds: vec!["MAILCRED:/home/u/.secrets/mail".into()],
        timeout: "600".into(),
        exec: "~/.opencode/bin/opencode2 run --agent autocommit \"go\"".into(),
        ..Task::default()
    };
    let svc = service_text(&t);
    let expected = "\
[Unit]
Description=agent autocommit in ~/Notes [litellm/free-pro]

[Service]
Type=oneshot
WorkingDirectory=/home/u/Notes
Environment=PATH=/usr/local/bin:/usr/bin
Environment=FOO=bar
LoadCredential=MAILCRED:/home/u/.secrets/mail
TimeoutStartSec=600
ExecStart=/usr/bin/bash -c '~/.opencode/bin/opencode2 run --agent autocommit \"go\"'
";
    assert_eq!(svc, expected);
}

#[test]
fn timer_text_matches_bash_output() {
    let t = Task {
        name: "backup".into(),
        description: "nightly notes commit".into(),
        oncalendar: "*-*-* 02:00:00".into(),
        delay: "5min".into(),
        persistent: true,
        ..Task::default()
    };
    let expected = "\
[Unit]
Description=nightly notes commit (timer)

[Timer]
OnCalendar=*-*-* 02:00:00
RandomizedDelaySec=5min
Persistent=true

[Install]
WantedBy=timers.target
";
    assert_eq!(timer_text(&t), expected);
}

#[test]
fn optional_unit_fields_are_omitted_when_unset() {
    let t = Task {
        name: "ping".into(),
        description: "ping".into(),
        oncalendar: "daily".into(),
        ..Task::default()
    };
    let svc = service_text(&t);
    assert!(!svc.contains("WorkingDirectory"));
    assert!(!svc.contains("TimeoutStartSec"));
    assert!(!svc.contains("Environment="));
    assert!(!svc.contains("LoadCredential="));
    let tmr = timer_text(&t);
    assert!(!tmr.contains("RandomizedDelaySec"));
    assert!(!tmr.contains("Persistent"));
}
