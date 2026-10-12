//! Shared Discord digest plumbing: field cleaning, credential lookup, the
//! 2000-char budget, and posting a rendered digest as message text or as a
//! markdown attachment. Both digest binaries own their own format; this
//! module owns everything below it.

use std::env;
use std::fs;
use std::path::Path;
use std::path::PathBuf;
use std::time::Duration;

use anyhow::Result;
use anyhow::anyhow;
use serde_json::Value;
use ureq::unversioned::multipart::Form;
use ureq::unversioned::multipart::Part;

/// Discord's per-message character limit: past this a digest goes out as an
/// attachment instead.
pub const DISCORD_MAX: usize = 2000;

/// Collapse whitespace, cap to `cap` characters, defuse mass mentions.
pub fn clean(text: &str, cap: usize) -> String {
    text.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(cap)
        .collect::<String>()
        .replace("@everyone", "at-everyone")
        .replace("@here", "at-here")
}

/// Webhook credential roots, in lookup order: `$CREDENTIALS_DIRECTORY/discord`
/// first (when set), then `~/.config/fazuh-agent/secrets/discord`.
pub fn webhook_roots(credentials_dir: Option<&Path>, home: &Path) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Some(dir) = credentials_dir.filter(|dir| !dir.as_os_str().is_empty()) {
        roots.push(dir.join("discord"));
    }
    roots.push(home.join(".config/fazuh-agent/secrets/discord"));
    roots
}

/// Discord user id to ping: line 2 of `notify.key` under the same roots as
/// the webhook. None when no `notify.key` carries an id. A root whose
/// `notify.key` lacks a second line stops the search (matches the original
/// per-digest behaviour).
pub fn ping_user_id(credentials_dir: Option<&Path>, home: &Path) -> Option<String> {
    for root in webhook_roots(credentials_dir, home) {
        let Ok(content) = fs::read_to_string(root.join("notify.key")) else {
            continue;
        };
        let id = content.lines().nth(1)?.trim();
        if !id.is_empty() {
            return Some(id.to_string());
        }
    }
    None
}

/// First webhook URL found under the env-driven roots: the first line of the
/// first existing file among `names` (in name order, root order outermost).
pub fn webhook_url(names: &[&str]) -> Result<String> {
    let credentials = env::var_os("CREDENTIALS_DIRECTORY");
    let home = home_dir()?;
    for root in webhook_roots(credentials.as_deref().map(Path::new), &home) {
        for name in names {
            let path = root.join(name);
            if path.is_file() {
                let first = fs::read_to_string(&path)
                    .map_err(|e| anyhow!(e).context(format!("read {}", path.display())))?;
                let url = first.lines().next().unwrap_or_default().trim().to_string();
                if !url.is_empty() {
                    return Ok(url);
                }
            }
        }
    }
    Err(anyhow!("no Discord webhook found ({})", names.join(" / ")))
}

/// Env-driven [`ping_user_id`]: `CREDENTIALS_DIRECTORY` then home.
pub fn mention_id() -> Option<String> {
    let credentials = env::var_os("CREDENTIALS_DIRECTORY");
    ping_user_id(credentials.as_deref().map(Path::new), &home_dir().ok()?)
}

pub fn home_dir() -> Result<PathBuf> {
    env::var_os("HOME")
        .filter(|home| !home.is_empty())
        .map(PathBuf::from)
        .ok_or_else(|| anyhow!("HOME is not set"))
}

/// What the digest will be, before it reaches Discord.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Rendered {
    /// Post this text as the message.
    Inline(String),
    /// Post `summary` as the message, attach `text` as `filename`.
    File {
        summary: String,
        filename: String,
        text: String,
    },
}

impl Rendered {
    pub fn char_count(&self) -> usize {
        match self {
            Rendered::Inline(text) => text.chars().count(),
            Rendered::File { text, .. } => text.chars().count(),
        }
    }
}

/// The shared message head: static title, then the caller's summary line,
/// then the generation timestamp.
pub fn header(title: &str, summary: &str, epoch: i64) -> String {
    format!("# {title}\n{summary}\n<t:{epoch}:R>")
}

/// Inline when `inline` fits `budget` characters, else the file form with
/// `summary` as the posted message and `attachment` as the file body.
pub fn fit(
    inline: String,
    summary: String,
    filename: String,
    attachment: String,
    budget: usize,
) -> Rendered {
    if inline.chars().count() <= budget {
        Rendered::Inline(inline)
    } else {
        Rendered::File {
            summary: summary.chars().take(budget).collect(),
            filename,
            text: attachment,
        }
    }
}

/// How the post went, enough to write the operator's log line.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Posted {
    Inline { chars: usize, status: u16 },
    File { chars: usize, status: u16 },
}

impl Posted {
    pub fn log_line(&self) -> String {
        match self {
            Posted::Inline { chars, status } => {
                format!("posted inline {chars} chars, http {status}")
            }
            Posted::File { chars, status } => format!("posted file {chars} chars, http {status}"),
        }
    }
}

/// Post a rendered digest, prepending the `<@id>` mention when `ping_id` is
/// set. `user_agent` identifies the calling digest binary.
pub fn post(
    webhook: &str,
    rendered: &Rendered,
    ping_id: Option<&str>,
    user_agent: &str,
) -> Result<Posted> {
    let mention = ping_id.map(|id| format!("<@{id}>\n")).unwrap_or_default();
    let (chars, status) = match rendered {
        Rendered::Inline(text) => {
            let content = format!("{mention}{text}");
            let chars = content.chars().count();
            (chars, post_json(webhook, &content, user_agent)?)
        }
        Rendered::File {
            summary,
            filename,
            text,
        } => {
            let content = format!("{mention}{summary}");
            let chars = content.chars().count();
            (
                chars,
                post_file(webhook, &content, filename, text, user_agent)?,
            )
        }
    };
    Ok(match rendered {
        Rendered::Inline(_) => Posted::Inline { chars, status },
        Rendered::File { .. } => Posted::File { chars, status },
    })
}

fn post_json(webhook: &str, content: &str, user_agent: &str) -> Result<u16> {
    let body = serde_json::to_vec(&serde_json::json!({ "content": content }))?;
    let response = ureq::post(webhook)
        .config()
        .timeout_global(Some(Duration::from_secs(30)))
        .build()
        .header("User-Agent", user_agent)
        .content_type("application/json")
        .send(body)?;
    Ok(response.status().as_u16())
}

fn post_file(
    webhook: &str,
    summary: &str,
    filename: &str,
    text: &str,
    user_agent: &str,
) -> Result<u16> {
    let payload = serde_json::to_vec(&serde_json::json!({ "content": summary }))?;
    let form = Form::new()
        .part("payload_json", Part::bytes(&payload))
        .part(
            "files[0]",
            Part::bytes(text.as_bytes())
                .file_name(filename)
                .mime_str("text/markdown")?,
        );
    let response = ureq::post(webhook)
        .config()
        .timeout_global(Some(Duration::from_secs(60)))
        .build()
        .header("User-Agent", user_agent)
        .send(form)?;
    Ok(response.status().as_u16())
}

/// The `<@id>` mention line, or an empty string: what a post needs before its
/// text when pinging. Errors when pinging but no id is configured.
pub fn mention(ping: bool) -> Result<String> {
    if !ping {
        return Ok(String::new());
    }
    let id =
        mention_id().ok_or_else(|| anyhow!("no Discord user id to ping (line 2 of notify.key)"))?;
    Ok(format!("<@{id}>\n"))
}

/// Characters left for the digest body once the mention line is reserved.
pub fn budget_after_mention(mention_line: &str) -> usize {
    DISCORD_MAX.saturating_sub(mention_line.chars().count())
}

/// Turn an arbitrary JSON field into its `str(...)` coercion, then clean it.
pub fn field_str(value: &Value) -> String {
    match value {
        Value::Null => "None".to_string(),
        Value::Bool(true) => "True".to_string(),
        Value::Bool(false) => "False".to_string(),
        Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}
