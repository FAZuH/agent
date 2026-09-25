//! serve → drain round trip against a real localhost socket, replaying the
//! curl contract the cutover will use.

use std::fs;
use std::io::Read;
use std::io::Write;
use std::net::SocketAddr;
use std::net::TcpStream;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::time::Duration;

use phone_digest::drain::drain;
use phone_digest::ingest::ServeConfig;
use phone_digest::ingest::spawn;

const TOKEN: &str = "0123456789abcdef0123456789abcdef";
const STORED: &str =
    "POST /n?app=com.example.chat&title=Hello%20there&text=Meeting%20at%2010%3A00 HTTP/1.1";
const ECHO: &str =
    "POST /n?app=com.example.discord&title=Phone%20digest%202026-09-12&text=hi HTTP/1.1";

fn config(dir: &Path) -> ServeConfig {
    ServeConfig {
        addr: "127.0.0.1:0".to_string(),
        state_dir: dir.join("phone-inbox"),
        token_file: dir.join("ingest.token"),
    }
}

/// One request per connection, body discarded, response read to EOF
/// (`Connection: close`), like curl does.
fn send(addr: SocketAddr, request_line: &str, token: Option<&str>, body: &str) -> (u16, String) {
    let token_header = token
        .map(|token| format!("X-Token: {token}\r\n"))
        .unwrap_or_default();
    let raw = format!(
        "{request_line}\r\nHost: ingest\r\n{token_header}Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len(),
    );
    let mut stream = TcpStream::connect(addr).expect("connect");
    stream
        .set_read_timeout(Some(Duration::from_secs(10)))
        .expect("read timeout");
    stream.write_all(raw.as_bytes()).expect("write");
    let mut response = String::new();
    stream.read_to_string(&mut response).expect("read response");
    let (head, body) = response
        .split_once("\r\n\r\n")
        .unwrap_or((response.as_str(), ""));
    let status: u16 = head
        .split_whitespace()
        .nth(1)
        .and_then(|code| code.parse().ok())
        .unwrap_or(0);
    (status, body.to_string())
}

#[test]
fn serve_round_trip_then_drain() {
    let dir = tempfile::tempdir().expect("tempdir");
    let config = config(dir.path());
    fs::write(&config.token_file, format!("{TOKEN}\n")).expect("token file");

    let handle = spawn(&config).expect("server starts");
    let addr = handle.addr;

    // health probe
    let (status, body) = send(addr, "GET /healthz HTTP/1.1", Some(TOKEN), "");
    assert_eq!(status, 200);
    assert_eq!(body, "ok\n");

    // wrong token → 403, nothing stored
    let (status, body) = send(addr, "POST /n?app=a&title=t HTTP/1.1", Some("nope"), "");
    assert_eq!((status, body.as_str()), (403, ""));

    // missing token → 403
    let (status, _) = send(addr, "POST /n?app=a&title=t HTTP/1.1", None, "");
    assert_eq!(status, 403);

    // unknown path → 404
    let (status, _) = send(addr, "POST /other?app=a&title=t HTTP/1.1", Some(TOKEN), "");
    assert_eq!(status, 404);

    // oversized body → 413
    let (status, _) = send(
        addr,
        "POST /n?app=a&title=t HTTP/1.1",
        Some(TOKEN),
        &"x".repeat(64_001),
    );
    assert_eq!(status, 413);

    // empty title and text → 422
    let (status, _) = send(addr, "POST /n?app=a HTTP/1.1", Some(TOKEN), "");
    assert_eq!(status, 422);

    // echo of our own digest → 204, not stored
    let (status, _) = send(addr, ECHO, Some(TOKEN), "");
    assert_eq!(status, 204);

    // a real notification → 204, stored
    let (status, _) = send(addr, STORED, Some(TOKEN), "");
    assert_eq!(status, 204);

    handle.shutdown();

    // exactly one JSONL record, in the Python key order, at mode 0600
    let inbox = config.state_dir.join("inbox.jsonl");
    let mode = fs::metadata(&inbox)
        .expect("inbox exists")
        .permissions()
        .mode();
    assert_eq!(mode & 0o777, 0o600);
    let contents = fs::read_to_string(&inbox).expect("read inbox");
    assert!(
        contents.starts_with("{\"ts\": \""),
        "ts must be the first key: {contents}"
    );
    assert!(
        contents
            .contains("\", \"app\": \"com.example.chat\", \"title\": \"Hello there\", \"text\": \"Meeting at 10:00\"}\n"),
        "unexpected record: {contents}"
    );
    let record: serde_json::Value = serde_json::from_str(contents.trim()).expect("valid jsonl");
    let ts = record["ts"].as_str().expect("ts is a string");
    assert_eq!(ts.len(), 25, "ISO-8601 UTC seconds: {ts}");
    assert!(ts.ends_with("+00:00"), "UTC offset seconds: {ts}");

    // drain prints the record and parks it under drained/ at mode 0600
    let drained = drain(&config.state_dir).expect("drain");
    assert_eq!(drained, contents);
    assert!(!inbox.exists(), "inbox must be renamed away");

    let parked: Vec<_> = fs::read_dir(config.state_dir.join("drained"))
        .expect("drained dir")
        .collect::<Result<_, _>>()
        .expect("read drained dir");
    assert_eq!(parked.len(), 1);
    let mode = fs::metadata(parked[0].path())
        .expect("parked file")
        .permissions()
        .mode();
    assert_eq!(mode & 0o777, 0o600);

    // the inbox is gone now: a second drain is silent and parks nothing
    assert_eq!(drain(&config.state_dir).expect("drain again"), "");
    let parked: Vec<_> = fs::read_dir(config.state_dir.join("drained"))
        .expect("drained dir")
        .collect::<Result<_, _>>()
        .expect("read drained dir");
    assert_eq!(parked.len(), 1);
}

#[test]
fn serve_refuses_to_start_without_the_token_file() {
    let dir = tempfile::tempdir().expect("tempdir");
    let error = spawn(&config(dir.path())).expect_err("missing token file");
    assert!(
        error
            .to_string()
            .contains(&dir.path().join("ingest.token").display().to_string()),
        "error must name the token file: {error}"
    );
}
