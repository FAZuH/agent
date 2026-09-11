//! Golden tests: the Rust render must be byte-identical to the expected
//! new-format output for each fixture input (fixtures under tests/fixtures/).
//!
//! The generation epoch is pinned (1770000000 = 2026-02-02T00:40Z, asserted
//! literally as `<t:1770000000:R>` in every expectation).

use std::fs;
use std::path::PathBuf;

use mail_digest::Rendered;
use mail_digest::render;

const TODAY: &str = "2026-09-12";
const EPOCH: i64 = 1770000000;

fn fixture_dirs() -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> =
        fs::read_dir(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/cases"))
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .filter(|path| path.is_dir())
            .collect();
    dirs.sort();
    dirs
}

#[test]
fn render_matches_expected_fixtures() {
    for dir in fixture_dirs() {
        let name = dir.file_name().unwrap().to_string_lossy().into_owned();
        let input = fs::read_to_string(dir.join("input.json")).unwrap();
        let mode = fs::read_to_string(dir.join("mode.txt")).unwrap();
        let expected = fs::read(dir.join("expected-content.txt")).unwrap();
        let rendered = render(&input, TODAY, EPOCH).unwrap_or_else(|e| panic!("{name}: {e:#}"));
        match (mode.trim(), &rendered) {
            ("notice", Rendered::Notice(text)) | ("inline", Rendered::Inline(text)) => {
                assert_eq!(text.as_bytes(), &expected[..], "{name}: text");
            }
            (
                "file",
                Rendered::File {
                    summary,
                    filename,
                    text,
                },
            ) => {
                assert_eq!(text.as_bytes(), &expected[..], "{name}: attached text");
                let expected_summary = fs::read(dir.join("expected-summary.txt")).unwrap();
                assert_eq!(summary.as_bytes(), &expected_summary[..], "{name}: summary");
                let expected_filename =
                    fs::read_to_string(dir.join("expected-filename.txt")).unwrap();
                assert_eq!(filename, &expected_filename, "{name}: filename");
            }
            (mode, rendered) => panic!("{name}: mode {mode:?} but rendered {rendered:?}"),
        }
    }
}

#[test]
fn rejects_argument_that_is_not_a_json_object() {
    for bad in ["", "not json", "[1, 2]", "42", "null"] {
        let err = render(bad, TODAY, EPOCH)
            .err()
            .unwrap_or_else(|| panic!("{bad:?}: expected rejection"));
        assert_eq!(
            err.to_string(),
            "argument must be a JSON object",
            "{bad:?}: wrong message"
        );
    }
}
