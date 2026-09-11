//! HTTP ingest: `POST /n?app=&title=&text=` with an `X-Token` header, one JSONL
//! line per accepted notification. Query params only, because MacroDroid has no
//! body-encode function.

use std::collections::HashMap;
use std::fs;
use std::fs::OpenOptions;
use std::io::Read;
use std::io::Write;
use std::net::SocketAddr;
use std::os::unix::fs::OpenOptionsExt;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::AtomicBool;
use std::sync::atomic::Ordering;
use std::thread;
use std::time::Duration;

use anyhow::Context;
use anyhow::Result;
use chrono::SecondsFormat;
use chrono::Utc;
use subtle::ConstantTimeEq;
use tiny_http::Header;
use tiny_http::Method;
use tiny_http::Request;
use tiny_http::Response;
use tiny_http::Server;
use tiny_http::StatusCode;

use crate::drain;

pub const DEFAULT_ADDR: &str = "100.64.0.3:8788";

const MAX_BODY_BYTES: u64 = 64_000;
const ROTATE_AFTER_BYTES: u64 = 2_000_000;
const CAP_APP: usize = 120;
const CAP_TITLE: usize = 200;
const CAP_TEXT: usize = 2000;
const ECHO_MARK: &str = "Phone digest";
const BIND_RETRY: Duration = Duration::from_secs(10);
const POLL: Duration = Duration::from_millis(200);

#[derive(Debug, Clone)]
pub struct ServeConfig {
    pub addr: String,
    pub state_dir: PathBuf,
    pub token_file: PathBuf,
}

/// Token plus state directory, shared by every request thread.
pub struct Inbox {
    pub state_dir: PathBuf,
    pub token: String,
}

impl Inbox {
    pub fn new(state_dir: PathBuf, token: String) -> Self {
        Self { state_dir, token }
    }

    fn load(config: &ServeConfig) -> Result<Self> {
        let token = fs::read_to_string(&config.token_file)
            .with_context(|| format!("missing {}", config.token_file.display()))?;
        Ok(Self::new(
            config.state_dir.clone(),
            token.trim().to_string(),
        ))
    }

    pub fn handle(&self, mut request: Request) {
        let method = request.method().clone();
        let reply = match method {
            Method::Get => get_reply(request.url()),
            Method::Post => self.post_reply(&mut request),
            _ => Reply::empty(501),
        };
        reply.send(request);
    }

    fn post_reply(&self, request: &mut Request) -> Reply {
        let url = request.url().to_string();
        let (path, query) = match url.find('?') {
            Some(split) => (url[..split].to_string(), url[split + 1..].to_string()),
            None => (url.clone(), String::new()),
        };
        if path != "/n" {
            return Reply::empty(404);
        }
        let supplied = header(request, "X-Token");
        if !token_ok(&supplied, &self.token) {
            eprintln!("phone-digest: rejected request, bad X-Token");
            return Reply::empty(403);
        }
        let length = request.body_length().unwrap_or(0) as u64;
        if length > MAX_BODY_BYTES {
            return Reply::empty(413);
        }
        read_body(request, length);

        let params = query_params(&query);
        let app = cap(&param(&params, "app"), CAP_APP);
        let title = cap(&param(&params, "title"), CAP_TITLE);
        let text = cap(&param(&params, "text"), CAP_TEXT);
        if title.is_empty() && text.is_empty() {
            return Reply::empty(422);
        }
        if is_echo(&title, &text) {
            return Reply::empty(204);
        }

        let record = json_line(&app, &title, &text);
        match self.append(&record) {
            Ok(()) => {
                println!("phone-digest: stored '{app}' {}B", record.len());
                Reply::empty(204)
            }
            Err(e) => {
                eprintln!("phone-digest: {e:#}");
                Reply::empty(500)
            }
        }
    }

    fn append(&self, record: &str) -> Result<()> {
        crate::ensure_private_dir(&self.state_dir)?;
        let inbox = self.state_dir.join(drain::INBOX_FILE);
        if fs::metadata(&inbox).is_ok_and(|meta| meta.len() > ROTATE_AFTER_BYTES) {
            fs::rename(&inbox, self.state_dir.join("inbox.jsonl.old"))
                .with_context(|| format!("rotate {}", inbox.display()))?;
        }
        // mode on create only: no chmod race, an existing file keeps its mode
        let mut file = OpenOptions::new()
            .append(true)
            .create(true)
            .mode(0o600)
            .open(&inbox)
            .with_context(|| format!("open {}", inbox.display()))?;
        file.write_all(record.as_bytes())
            .with_context(|| format!("write {}", inbox.display()))?;
        Ok(())
    }
}

/// Bind and serve forever, retrying a failed bind every 10 s: the tailnet may
/// not be up yet when the service starts.
pub fn serve(config: &ServeConfig) -> Result<()> {
    let inbox = Arc::new(Inbox::load(config)?);
    loop {
        match bind(&config.addr) {
            Ok(server) => {
                println!("phone-digest: listening on {}", config.addr);
                serve_loop(&server, &inbox, &AtomicBool::new(false));
                return Ok(());
            }
            Err(e) => {
                println!("phone-digest: bind {}: {e:#}, retry in 10s", config.addr);
                thread::sleep(BIND_RETRY);
            }
        }
    }
}

pub fn bind(addr: &str) -> Result<Server> {
    Server::http(addr).map_err(|e| anyhow::anyhow!(e.to_string()))
}

/// Handle requests until `stop` is set or the listener fails.
pub fn serve_loop(server: &Server, inbox: &Inbox, stop: &AtomicBool) {
    while !stop.load(Ordering::Relaxed) {
        match server.recv_timeout(POLL) {
            Ok(Some(request)) => inbox.handle(request),
            Ok(None) => {}
            Err(_) => return,
        }
    }
}

/// Bind once and serve from a background thread; `Handle::shutdown` stops it.
pub fn spawn(config: &ServeConfig) -> Result<Handle> {
    let inbox = Arc::new(Inbox::load(config)?);
    let server = Arc::new(bind(&config.addr)?);
    let addr = server
        .server_addr()
        .to_ip()
        .with_context(|| format!("not an IP listener: {}", config.addr))?;
    let stop = Arc::new(AtomicBool::new(false));
    let (loop_server, loop_inbox, loop_stop) = (server, inbox, stop.clone());
    let thread = thread::spawn(move || serve_loop(&loop_server, &loop_inbox, &loop_stop));
    Ok(Handle {
        addr,
        stop,
        thread: Some(thread),
    })
}

#[derive(Debug)]
pub struct Handle {
    pub addr: SocketAddr,
    stop: Arc<AtomicBool>,
    thread: Option<thread::JoinHandle<()>>,
}

impl Handle {
    pub fn shutdown(mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

impl Drop for Handle {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
    }
}

fn get_reply(url: &str) -> Reply {
    if url == "/healthz" {
        Reply::new(200, b"ok\n")
    } else {
        Reply::empty(404)
    }
}

struct Reply {
    code: u16,
    body: &'static [u8],
}

impl Reply {
    fn empty(code: u16) -> Self {
        Self { code, body: b"" }
    }

    fn new(code: u16, body: &'static [u8]) -> Self {
        Self { code, body }
    }

    fn send(self, request: Request) {
        let response = Response::new(
            StatusCode(self.code),
            server_headers(),
            self.body,
            Some(self.body.len()),
            None,
        );
        let _ = request.respond(response);
    }
}

fn server_headers() -> Vec<Header> {
    Header::from_bytes(&b"Server"[..], &b"phone-ingest/1"[..])
        .map(|header| vec![header])
        .unwrap_or_default()
}

fn header(request: &Request, name: &'static str) -> String {
    request
        .headers()
        .iter()
        .find(|header| header.field.equiv(name))
        .map_or_else(String::new, |header| header.value.as_str().to_owned())
}

/// Constant-time token compare; length is the only thing it leaks.
pub fn token_ok(supplied: &str, expected: &str) -> bool {
    supplied.as_bytes().ct_eq(expected.as_bytes()).into()
}

fn read_body(request: &mut Request, length: u64) {
    let mut sink = Vec::new();
    let _ = request.as_reader().take(length).read_to_end(&mut sink);
}

fn query_params(query: &str) -> HashMap<String, String> {
    form_urlencoded::parse(query.as_bytes())
        .map(|(key, value)| (key.into_owned(), value.into_owned()))
        .collect()
}

fn param(params: &HashMap<String, String>, key: &str) -> String {
    params.get(key).cloned().unwrap_or_default()
}

/// Collapse runs of whitespace, then truncate to `max` characters.
pub fn cap(value: &str, max: usize) -> String {
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(max)
        .collect()
}

/// The digest arrives on the phone as a Discord notification; dropping it is
/// the only thing that stops the loop. Matches Python's `(title + text)` check.
pub fn is_echo(title: &str, text: &str) -> bool {
    format!("{title}{text}").contains(ECHO_MARK)
}

pub fn now_ts() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Secs, false)
}

/// `{"ts","app","title","text"}` — key order and non-ASCII bytes as json.dumps
/// (ensure_ascii=False) writes them.
pub fn json_line(app: &str, title: &str, text: &str) -> String {
    format!(
        "{{\"ts\": \"{ts}\", \"app\": {a}, \"title\": {t}, \"text\": {x}}}\n",
        ts = now_ts(),
        a = json_string(app),
        t = json_string(title),
        x = json_string(text),
    )
}

fn json_string(value: &str) -> String {
    serde_json::Value::String(value.to_owned()).to_string()
}

#[cfg(test)]
mod tests {
    use super::cap;
    use super::is_echo;
    use super::json_line;
    use super::token_ok;

    #[test]
    fn cap_collapses_whitespace_then_truncates() {
        assert_eq!(cap("  hello\t\nworld ", 100), "hello world");
        assert_eq!(cap("a   b  c", 100), "a b c");
        assert_eq!(cap("", 120), "");
        assert_eq!(cap("abcdefghij", 3), "abc");
        // truncation counts characters, not bytes
        assert_eq!(cap("héllo wörld", 6), "héllo ");
        assert_eq!(cap(&"x".repeat(500), 120).chars().count(), 120);
    }

    #[test]
    fn echo_drop_covers_title_and_text() {
        assert!(is_echo("📱 Phone digest 2026-09-12", ""));
        assert!(is_echo("Chat", "read the Phone digest below"));
        // Python concatenates title+text before searching
        assert!(is_echo("Phone dig", "est"));
        assert!(!is_echo("Chat", "hi"));
        assert!(!is_echo("phone digest", "hi"));
    }

    #[test]
    fn token_check_accepts_only_the_exact_token() {
        assert!(token_ok("s3cret", "s3cret"));
        assert!(!token_ok("s3cre", "s3cret"));
        assert!(!token_ok("s3cret1", "s3cret"));
        assert!(!token_ok("wrong", "s3cret"));
        assert!(token_ok("", ""));
        assert!(!token_ok("", "s3cret"));
    }

    #[test]
    fn record_keeps_python_key_order_and_escapes() {
        let line = json_line("com.example", "a\"b", "c\n");
        assert!(
            line.starts_with("{\"ts\": \""),
            "ts must be the first key: {line}"
        );
        assert!(line.contains(
            "\", \"app\": \"com.example\", \"title\": \"a\\\"b\", \"text\": \"c\\n\"}\n"
        ));
        // non-ASCII is written raw, like ensure_ascii=False
        assert!(json_line("é", "", "").contains("\"app\": \"é\""));
    }
}
