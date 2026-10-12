//! Golden tests: the Rust render must be byte-identical to the expected
//! output for each fixture input (fixtures under tests/fixtures/).
//!
//! The generation epoch is pinned (1770000000 = 2026-02-02T00:40Z, asserted
//! literally as `<t:1770000000:R>` in every expectation). `UPDATE_GOLDEN=1`
//! rewrites the expectations from the current render.

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

fn update_golden() -> bool {
    std::env::var_os("UPDATE_GOLDEN").is_some()
}

#[test]
fn render_matches_expected_fixtures() {
    for dir in fixture_dirs() {
        let name = dir.file_name().unwrap().to_string_lossy().into_owned();
        let input = fs::read_to_string(dir.join("input.json")).unwrap();
        let expected = fs::read(dir.join("expected-content.txt")).unwrap();
        let rendered = render(&input, TODAY, EPOCH, 0).unwrap_or_else(|e| panic!("{name}: {e:#}"));
        let (text, summary, filename): (Vec<u8>, Option<String>, Option<String>) = match &rendered {
            Rendered::Inline(text) => (text.as_bytes().to_vec(), None, None),
            Rendered::File {
                summary,
                filename,
                text,
            } => (
                text.clone().into_bytes(),
                Some(summary.clone()),
                Some(filename.clone()),
            ),
        };
        if update_golden() {
            fs::write(dir.join("expected-content.txt"), &text).unwrap();
            if let Some(summary) = &summary {
                fs::write(dir.join("expected-summary.txt"), summary).unwrap();
            }
            if let Some(filename) = &filename {
                fs::write(dir.join("expected-filename.txt"), filename).unwrap();
            }
            // mode.txt tracks the current shape so post.rs knows what wire
            // request to expect.
            let mode = if summary.is_some() { "file" } else { "inline" };
            let old_mode = fs::read_to_string(dir.join("mode.txt")).unwrap_or_default();
            if old_mode.trim() != mode && old_mode.trim() != "notice" {
                fs::write(dir.join("mode.txt"), format!("{mode}\n")).unwrap();
            }
            continue;
        }
        assert_eq!(text, expected, "{name}: content");
        match (&summary, &filename) {
            (Some(summary), Some(filename)) => {
                let expected_summary = fs::read(dir.join("expected-summary.txt")).unwrap();
                assert_eq!(summary.as_bytes(), &expected_summary[..], "{name}: summary");
                let expected_filename =
                    fs::read_to_string(dir.join("expected-filename.txt")).unwrap();
                assert_eq!(filename.as_str(), expected_filename, "{name}: filename");
            }
            (None, None) => {}
            other => panic!("{name}: half a file render {other:?}"),
        }
    }
}

#[test]
fn rejects_argument_that_is_not_a_json_object() {
    for bad in ["", "not json", "[1, 2]", "42", "null"] {
        let err = render(bad, TODAY, EPOCH, 0)
            .err()
            .unwrap_or_else(|| panic!("{bad:?}: expected rejection"));
        assert_eq!(
            err.to_string(),
            "argument must be a JSON object",
            "{bad:?}: wrong message"
        );
    }
}
