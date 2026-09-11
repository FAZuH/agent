//! Exit-code contract of the `mail-digest` binary. Only the paths that fail
//! before any webhook is read are exercised here; the posting behaviour is
//! covered by the `mail-digest` crate's own tests.

use std::process::Command;

fn mail_digest(args: &[&str]) -> (Option<i32>, String, String) {
    let output = Command::new(env!("CARGO_BIN_EXE_mail-digest"))
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
fn exits_2_when_the_argument_count_is_wrong() {
    let no_args: &[&str] = &[];
    for args in [no_args, &["{}", "extra"] as &[&str]] {
        let (code, _out, err) = mail_digest(args);
        assert_eq!(code, Some(2), "{args:?}: exit code");
        assert_eq!(err, "usage: mail-digest '<json>'\n", "{args:?}: stderr");
    }
}

#[test]
fn exits_1_when_the_argument_is_not_a_json_object() {
    for bad in ["", "not json", "[1, 2]", "42"] {
        let (code, out, err) = mail_digest(&[bad]);
        assert_eq!(code, Some(1), "{bad:?}: exit code");
        assert_eq!(out, "", "{bad:?}: stdout");
        assert_eq!(
            err, "mail-digest: argument must be a JSON object\n",
            "{bad:?}: stderr"
        );
    }
}
