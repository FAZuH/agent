//! Integration tests: drive `execute` against a local sink and assert the
//! wire request matches the golden fixtures (new-format expectations, with
//! the generation epoch pinned).
//!
//! These read the environment, the filesystem and loopback, so everything that
//! depends on `CREDENTIALS_DIRECTORY` runs sequentially inside one test.

use std::fs;
use std::path::PathBuf;
use std::sync::mpsc;

use mail_digest::execute;
use serde_json::Value;

const TODAY: &str = "2026-09-12";
const EPOCH: i64 = 1770000000;

struct Captured {
    method: String,
    url: String,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
}

impl Captured {
    fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.as_str())
    }
}

/// A local sink that answers `status` to every request and reports them.
fn spawn_sink(status: u16) -> (String, mpsc::Receiver<Captured>) {
    let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
    let addr = match server.server_addr() {
        tiny_http::ListenAddr::IP(addr) => addr,
        other => panic!("expected a TCP sink, got {other:?}"),
    };
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        for request in server.incoming_requests() {
            let mut request = request;
            let mut body = Vec::new();
            request.as_reader().read_to_end(&mut body).unwrap();
            let captured = Captured {
                method: request.method().to_string(),
                url: request.url().to_string(),
                headers: request
                    .headers()
                    .iter()
                    .map(|h| {
                        (
                            h.field.as_str().as_str().to_ascii_lowercase(),
                            h.value.to_string(),
                        )
                    })
                    .collect(),
                body,
            };
            if tx.send(captured).is_err() {
                break;
            }
            let _ = request.respond(tiny_http::Response::empty(status));
        }
    });
    (format!("http://{addr}/hook"), rx)
}

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

/// Split a multipart body into its parts: `(header lines, content bytes)`.
fn multipart(body: &[u8], boundary: &str) -> Vec<(Vec<String>, Vec<u8>)> {
    let mut delimiter = b"--".to_vec();
    delimiter.extend_from_slice(boundary.as_bytes());
    let mut chunks: Vec<&[u8]> = Vec::new();
    let mut rest = body;
    while let Some(pos) = rest.windows(delimiter.len()).position(|w| w == delimiter) {
        chunks.push(&rest[..pos]);
        rest = &rest[pos + delimiter.len()..];
    }
    chunks.push(rest);
    chunks
        .into_iter()
        .skip(1)
        .filter(|chunk| !chunk.starts_with(b"--"))
        .map(|chunk| {
            let chunk = chunk.strip_prefix(b"\r\n".as_slice()).unwrap_or(chunk);
            let head_end = chunk
                .windows(4)
                .position(|w| w == b"\r\n\r\n")
                .expect("multipart part without header separator");
            let content = &chunk[head_end + 4..];
            let content = content.strip_suffix(b"\r\n".as_slice()).unwrap_or(content);
            (
                String::from_utf8_lossy(&chunk[..head_end])
                    .lines()
                    .map(str::to_string)
                    .collect(),
                content.to_vec(),
            )
        })
        .collect()
}

#[test]
fn posts_match_expected_fixtures() {
    let temp = tempfile::tempdir().unwrap();
    let credentials = temp.path().join("credentials");
    let key = credentials.join("discord").join("mail-digest.key");
    fs::create_dir_all(key.parent().unwrap()).unwrap();
    // SAFETY: the only code in this binary that reads CREDENTIALS_DIRECTORY is
    // the loop below, and it is sequential. No other test here posts.
    unsafe { std::env::set_var("CREDENTIALS_DIRECTORY", &credentials) };

    for dir in fixture_dirs() {
        let name = dir.file_name().unwrap().to_string_lossy().into_owned();
        let input = fs::read_to_string(dir.join("input.json")).unwrap();
        let mode = fs::read_to_string(dir.join("mode.txt")).unwrap();
        let expected = fs::read(dir.join("expected-content.txt")).unwrap();
        let expected_stdout = fs::read_to_string(dir.join("expected-stdout.txt")).unwrap();

        let (url, rx) = spawn_sink(204);
        fs::write(&key, format!("{url}\nsecond line is not the webhook\n")).unwrap();

        let posted = execute(&input, TODAY, EPOCH).unwrap_or_else(|e| panic!("{name}: {e:#}"));
        assert_eq!(
            posted.log_line(),
            expected_stdout.trim_end_matches('\n'),
            "{name}: log line"
        );

        let request = rx.recv().unwrap();
        assert_eq!(request.method, "POST", "{name}: method");
        assert_eq!(request.url, "/hook", "{name}: path");
        assert_eq!(
            request.header("user-agent"),
            Some("octask-mail-digest/1.0"),
            "{name}: user agent"
        );

        match mode.trim() {
            "notice" | "inline" => {
                assert_eq!(
                    request.header("content-type"),
                    Some("application/json"),
                    "{name}: content type"
                );
                let payload: Value = serde_json::from_slice(&request.body).unwrap();
                assert_eq!(
                    payload["content"].as_str().unwrap().as_bytes(),
                    &expected[..],
                    "{name}: posted content"
                );
                assert_eq!(payload.as_object().unwrap().len(), 1, "{name}: fields");
            }
            "file" => {
                let content_type = request.header("content-type").unwrap();
                let boundary = content_type
                    .strip_prefix("multipart/form-data; boundary=")
                    .unwrap_or_else(|| panic!("{name}: unexpected content type {content_type}"));
                let parts = multipart(&request.body, boundary);
                assert_eq!(parts.len(), 2, "{name}: part count");

                assert_eq!(
                    parts[0].0,
                    [r#"Content-Disposition: form-data; name="payload_json""#.to_string()],
                    "{name}: payload_json headers"
                );
                let summary: Value = serde_json::from_slice(&parts[0].1).unwrap();
                let expected_summary = fs::read(dir.join("expected-summary.txt")).unwrap();
                assert_eq!(
                    summary["content"].as_str().unwrap().as_bytes(),
                    &expected_summary[..],
                    "{name}: payload_json"
                );

                let filename = fs::read_to_string(dir.join("expected-filename.txt")).unwrap();
                assert_eq!(
                    parts[1].0,
                    [
                        format!(
                            r#"Content-Disposition: form-data; name="files[0]"; filename="{filename}""#
                        ),
                        "Content-Type: text/markdown".to_string(),
                    ],
                    "{name}: file part headers"
                );
                assert_eq!(parts[1].1, expected, "{name}: attached text");
            }
            other => panic!("{name}: unknown mode {other}"),
        }
    }

    let (url, _rx) = spawn_sink(500);
    fs::write(&key, format!("{url}\n")).unwrap();
    let input = r#"{"items":[{"account":"gmail","sender":"S","subject":"U","gist":"G"}]}"#;
    let Err(error) = execute(input, TODAY, EPOCH) else {
        panic!("a 500 response must fail the post");
    };
    assert!(
        !error.to_string().is_empty(),
        "the failure must carry a reason"
    );
}
