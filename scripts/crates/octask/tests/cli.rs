use clap::Parser;
use octask::Cli;
use octask::Cmd;

#[test]
fn no_subcommand_is_tui() {
    let cli = Cli::parse_from(["octask"]);
    assert!(cli.cmd.is_none());
}

#[test]
fn enable_all_flag_parses() {
    let cli = Cli::parse_from(["octask", "enable", "--all"]);
    match cli.cmd {
        Some(Cmd::Enable { name, all, dry_run }) => {
            assert!(name.is_none());
            assert!(all);
            assert!(!dry_run);
        }
        other => panic!("unexpected command: {other:?}"),
    }
}

#[test]
fn list_json_and_logs_follow_parse() {
    assert!(matches!(
        Cli::parse_from(["octask", "list", "--json"]).cmd,
        Some(Cmd::List { json: true })
    ));
    match Cli::parse_from(["octask", "logs", "digest", "-f"]).cmd {
        Some(Cmd::Logs { follow, lines, .. }) => {
            assert!(follow);
            assert_eq!(lines, 50);
        }
        other => panic!("unexpected command: {other:?}"),
    }
}

#[test]
fn pause_resume_and_run_parse() {
    assert!(matches!(
        Cli::parse_from(["octask", "pause"]).cmd,
        Some(Cmd::Pause)
    ));
    assert!(matches!(
        Cli::parse_from(["octask", "resume"]).cmd,
        Some(Cmd::Resume)
    ));
    assert!(matches!(
        Cli::parse_from(["octask", "run", "digest"]).cmd,
        Some(Cmd::Run { .. })
    ));
}
