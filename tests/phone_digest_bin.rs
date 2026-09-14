//! Exit/stdout contract of the `phone-digest post` subcommand for paths that
//! fail before any webhook is read. The ingest/drain/render behaviour is
//! covered by the `phone-digest` crate's own tests.

use std::process::Command;

fn phone_digest(args: &[&str]) -> (Option<i32>, String, String) {
    let output = Command::new(env!("CARGO_BIN_EXE_phone-digest"))
        .args(args)
        .output()
        .expect("the binary must run");
    (
        output.status.code(),
        String::from_utf8_lossy(&output.stdout).into_owned(),
        String::from_utf8_lossy(&output.stderr).into_owned(),
    )
}

#[test]
fn post_accepts_the_ping_flag_around_the_positional_json() {
    for args in [
        &["post", r#"{ "items": [] }"#, "--ping"] as &[&str],
        &["post", "--ping", r#"{ "items": [] }"#],
    ] {
        let (code, out, err) = phone_digest(args);
        assert_eq!(code, Some(0), "{args:?}: exit code");
        assert_eq!(out, "no items, nothing posted\n", "{args:?}: stdout");
        assert_eq!(err, "", "{args:?}: stderr");
    }
}

#[test]
fn post_still_rejects_bad_json_with_the_ping_flag() {
    let (code, out, err) = phone_digest(&["post", "not json", "--ping"]);
    assert_eq!(code, Some(1));
    assert_eq!(out, "");
    assert_eq!(err, "phone-digest: argument must be {\"items\": [...]} JSON\n");
}
