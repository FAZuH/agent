//! Build the mail digest from agent-supplied data and post it to Discord.
//!
//! Port of `mail-digest-post`. The agent only supplies DATA; this module owns
//! the entire output: grouped by receiver account, tiers ordered urgent →
//! notable → routine inside each account, field truncation, mass-mention
//! neutralization. Unknown tiers become routine. The digest carries the tier
//! as an emoji on each bullet (🔴 urgent / 🟡 notable / 🟢 routine), a
//! `<t:<epoch>:R>` generation line under the header, and a trailing
//! `## ⚠️ errors` section; no blank lines. A digest that fits the inline
//! budget posts as this text; an over-budget digest posts a compact summary
//! line alongside a markdown file attachment carrying the original
//! per-account full text.

use std::collections::BTreeMap;
use std::env;
use std::path::Path;
use std::path::PathBuf;
use std::time::Duration;

use anyhow::Result;
use anyhow::anyhow;
use serde_json::Value;
use ureq::unversioned::multipart::Form;
use ureq::unversioned::multipart::Part;

const MAX_INLINE: usize = 1800;
const USER_AGENT: &str = "octask-mail-digest/1.0";
/// Fallback credential dir when `CREDENTIALS_DIRECTORY` is unset:
/// `~/.secrets/discord` (same lookup order as phone-digest).
fn home_secrets_dir() -> Option<PathBuf> {
    env::var_os("HOME")
        .filter(|home| !home.is_empty())
        .map(|home| PathBuf::from(home).join(".secrets/discord"))
}
const TIER_TITLES: [(&str, &str); 3] = [
    ("urgent", "🔴 Needs attention"),
    ("notable", "🟡 Notable"),
    ("routine", "⚪ Routine"),
];
const TIER_EMOJI: [&str; 3] = ["🔴", "🟡", "🟢"];

/// What the digest will be, before it reaches Discord.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Rendered {
    /// Empty inbox: post this notice instead of a digest.
    Notice(String),
    /// Within budget: post this text inline.
    Inline(String),
    /// Over budget: attach `text` as `filename`, post `summary` alongside.
    File {
        summary: String,
        filename: String,
        text: String,
    },
}

impl Rendered {
    fn char_count(&self) -> usize {
        match self {
            Rendered::Notice(text) | Rendered::Inline(text) => text.chars().count(),
            Rendered::File { text, .. } => text.chars().count(),
        }
    }
}

/// How the post went, enough to write the operator's log line.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Posted {
    Notice { status: u16 },
    Inline { chars: usize, status: u16 },
    File { chars: usize, status: u16 },
}

impl Posted {
    pub fn log_line(&self) -> String {
        match self {
            Posted::Notice { status } => format!("posted inline, http {status}"),
            Posted::Inline { chars, status } => {
                format!("posted inline {chars} chars, http {status}")
            }
            Posted::File { chars, status } => format!("posted file {chars} chars, http {status}"),
        }
    }
}

/// Collapse whitespace, cap to `cap` characters, defuse mass mentions.
fn clean(text: &str, cap: usize) -> String {
    let joined = text.split_whitespace().collect::<Vec<_>>().join(" ");
    joined
        .chars()
        .take(cap)
        .collect::<String>()
        .replace("@everyone", "at-everyone")
        .replace("@here", "at-here")
}

/// The script's `str(...)` coercion of whatever JSON value a field holds.
fn field_str(value: &Value) -> String {
    match value {
        Value::Null => "None".to_string(),
        Value::Bool(true) => "True".to_string(),
        Value::Bool(false) => "False".to_string(),
        Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

fn field(obj: &serde_json::Map<String, Value>, key: &str, cap: usize) -> String {
    clean(&obj.get(key).map(field_str).unwrap_or_default(), cap)
}

fn tier_index(value: Option<&Value>) -> usize {
    TIER_TITLES
        .iter()
        .position(|(name, _)| Some(*name) == value.and_then(Value::as_str))
        .unwrap_or(TIER_TITLES.len() - 1)
}

#[derive(Debug)]
struct Mail {
    tier: usize,
    sender: String,
    subject: String,
    gist: String,
}

/// Account-grouped, tier-sorted mails plus fetch errors.
#[derive(Debug)]
struct Grouped {
    accounts: BTreeMap<String, Vec<Mail>>,
    errors: Vec<(String, String)>,
}

/// Accounts in name order, mails tier-sorted inside each account, errors as
/// `(alias, message)` pairs in insertion order.
fn group(data: &Value) -> Grouped {
    let mut accounts: BTreeMap<String, Vec<Mail>> = BTreeMap::new();
    let items = data.get("items").and_then(Value::as_array);
    for item in items.unwrap_or(&Vec::new()) {
        let Some(obj) = item.as_object() else {
            continue;
        };
        let account = field(obj, "account", 30);
        let key = if account.is_empty() {
            "(unknown)".to_string()
        } else {
            account
        };
        let tier = tier_index(obj.get("tier"));
        let sender = field(obj, "sender", 60);
        let subject = field(obj, "subject", 80);
        let gist = field(obj, "gist", 140);
        accounts.entry(key).or_default().push(Mail {
            tier,
            sender,
            subject,
            gist,
        });
    }
    for mail in accounts.values_mut() {
        mail.sort_by_key(|m| m.tier);
    }

    let mut errors = Vec::new();
    if let Some(error_map) = data.get("errors").and_then(Value::as_object) {
        for (alias, message) in error_map {
            errors.push((clean(alias, 30), clean(&field_str(message), 100)));
        }
    }
    Grouped { accounts, errors }
}

/// Digest bullets, as Discord markdown. A run of consecutive mails from one
/// sender is a `- <sender>` parent with indented `  - <emoji> <gist>` children;
/// a sender with one mail in the run stays a flat `- <emoji> <sender> — <gist>`.
fn digest_block(mail: &[Mail]) -> Vec<String> {
    let mut lines = Vec::new();
    let mut rest = mail;
    while !rest.is_empty() {
        let run_end = rest[1..]
            .iter()
            .position(|m| m.sender != rest[0].sender)
            .map_or(rest.len(), |p| p + 1);
        let (run, tail) = rest.split_at(run_end);
        if run.len() == 1 {
            lines.push(format!(
                "- {} {} — {}",
                TIER_EMOJI[run[0].tier], run[0].sender, run[0].gist
            ));
        } else {
            lines.push(format!("- {}", run[0].sender));
            lines.extend(
                run.iter()
                    .map(|m| format!("  - {} {}", TIER_EMOJI[m.tier], m.gist)),
            );
        }
        rest = tail;
    }
    lines
}

/// The detailed body of the original `mail-digest-post`: per-account blocks
/// with tier sub-headers, `• sender — subject (gist)` bullets. Used only as
/// the attached markdown over the inline budget.
fn attachment_block(mail: &[Mail]) -> Vec<String> {
    let mut lines = Vec::new();
    let mut last_tier: Option<usize> = None;
    let mut last_sender: Option<&str> = None;
    for m in mail {
        if last_tier != Some(m.tier) {
            lines.push(format!("**{}**", TIER_TITLES[m.tier].1));
            last_tier = Some(m.tier);
            last_sender = None;
        }
        if last_sender == Some(m.sender.as_str()) {
            lines.push(format!("  ↳ {} ({})", m.subject, m.gist));
        } else {
            lines.push(format!("• {} — {} ({})", m.sender, m.subject, m.gist));
            last_sender = Some(&m.sender);
        }
    }
    lines
}

/// The trailing `## ⚠️ errors` section, empty when there are no errors.
fn error_lines(errors: &[(String, String)]) -> Vec<String> {
    if errors.is_empty() {
        return Vec::new();
    }
    let mut lines = vec!["## ⚠️ errors".to_string()];
    lines.extend(
        errors
            .iter()
            .map(|(alias, message)| format!("- {alias}: {message}")),
    );
    lines
}

fn attachment_text(
    accounts: &BTreeMap<String, Vec<Mail>>,
    errors: &[(String, String)],
    n: usize,
    k: usize,
    today: &str,
) -> String {
    let mut lines = vec![format!(
        "# 📬 Mail digest {today} — {n} mails across {k} accounts"
    )];
    for (account, mail) in accounts {
        lines.push(format!("\n## {account} ({})", mail.len()));
        lines.extend(attachment_block(mail));
    }
    if !errors.is_empty() {
        lines.push("\n## Errors".to_string());
        lines.extend(
            errors
                .iter()
                .map(|(alias, message)| format!("- ⚠️ {alias}: {message}")),
        );
    }
    lines.join("\n")
}

/// Turn the agent's JSON into the digest.
///
/// `today` is the `YYYY-MM-DD` stamp used in the attachment name and body;
/// `epoch` is the generation instant in seconds, rendered as the
/// `<t:<epoch>:R>` line.
pub fn render(arg: &str, today: &str, epoch: i64) -> Result<Rendered> {
    let data: Value =
        serde_json::from_str(arg).map_err(|_| anyhow!("argument must be a JSON object"))?;
    if !data.is_object() {
        return Err(anyhow!("argument must be a JSON object"));
    }

    let Grouped { accounts, errors } = group(&data);
    let n = accounts.values().map(Vec::len).sum::<usize>();
    let k = accounts.len();

    let mut lines = vec![
        format!("# Mail digest — {n} mails across {k} accounts"),
        format!("<t:{epoch}:R>"),
    ];
    if n == 0 && errors.is_empty() {
        lines.push("📬 no mail in the last 24h.".to_string());
        return Ok(Rendered::Notice(lines.join("\n")));
    }
    for (account, mail) in &accounts {
        lines.push(format!("## {account}"));
        lines.extend(digest_block(mail));
    }
    lines.extend(error_lines(&errors));
    let digest = lines.join("\n");

    if digest.chars().count() <= MAX_INLINE {
        return Ok(Rendered::Inline(digest));
    }
    let counts = accounts
        .iter()
        .map(|(account, mail)| format!("{account} ({})", mail.len()))
        .collect::<Vec<_>>()
        .join(", ");
    let mut summary = format!(
        "# Mail digest — {n} mails across {k} accounts (full digest attached): {counts}\n<t:{epoch}:R>"
    );
    for line in error_lines(&errors) {
        summary.push('\n');
        summary.push_str(&line);
    }
    Ok(Rendered::File {
        summary: summary.chars().take(MAX_INLINE).collect(),
        filename: format!("mail-digest-{today}.md"),
        text: attachment_text(&accounts, &errors, n, k, today),
    })
}

/// Digest webhook: systemd credential dir when present
/// (`LoadCredential=discord:<dir>`), else the on-disk store.
fn webhook_url() -> Result<String> {
    let candidate: Option<PathBuf> = match env::var("CREDENTIALS_DIRECTORY") {
        Ok(dir) if !dir.is_empty() => {
            let path = Path::new(&dir).join("discord").join("mail-digest.key");
            path.is_file().then_some(path)
        }
        _ => None,
    };
    let path = candidate
        .or_else(|| home_secrets_dir().map(|dir| dir.join("mail-digest.key")))
        .ok_or_else(|| anyhow!("no webhook key file: set CREDENTIALS_DIRECTORY or HOME"))?;
    let content = std::fs::read_to_string(&path)?;
    Ok(content
        .lines()
        .next()
        .ok_or_else(|| anyhow!("empty webhook key file {}", path.display()))?
        .trim()
        .to_string())
}

/// Discord user id to ping (`--ping`): line 2 of `notify.key`, next to the
/// webhook key file. `None` when the file or the line is missing.
pub fn ping_user_id() -> Option<String> {
    let path = env::var_os("CREDENTIALS_DIRECTORY")
        .map(PathBuf::from)
        .map(|dir| dir.join("discord").join("notify.key"))
        .or_else(|| home_secrets_dir().map(|dir| dir.join("notify.key")))?;
    let content = std::fs::read_to_string(path).ok()?;
    let id = content.lines().nth(1)?.trim();
    (!id.is_empty()).then(|| id.to_string())
}

fn post_json(webhook: &str, content: &str, secs: u64) -> Result<u16> {
    let body = serde_json::to_vec(&serde_json::json!({ "content": content }))?;
    let response = ureq::post(webhook)
        .config()
        .timeout_global(Some(Duration::from_secs(secs)))
        .build()
        .header("User-Agent", USER_AGENT)
        .content_type("application/json")
        .send(body)?;
    Ok(response.status().as_u16())
}

fn post_file(webhook: &str, summary: &str, filename: &str, text: &str) -> Result<u16> {
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
        .header("User-Agent", USER_AGENT)
        .send(form)?;
    Ok(response.status().as_u16())
}

/// Render and post, returning how it went. Split out so tests can pin the
/// date, the generation epoch, and point the webhook at a sink. `ping`
/// prepends a `<@id>` mention to the posted content/summary.
pub fn execute(arg: &str, today: &str, epoch: i64, ping: bool) -> Result<Posted> {
    let rendered = render(arg, today, epoch)?;
    let webhook = webhook_url()?;
    let chars = rendered.char_count();
    let posted = match &rendered {
        Rendered::Notice(text) => Posted::Notice {
            status: post_json(&webhook, &prefix_ping(text, ping)?, 30)?,
        },
        Rendered::Inline(text) => Posted::Inline {
            chars,
            status: post_json(&webhook, &prefix_ping(text, ping)?, 30)?,
        },
        Rendered::File {
            summary,
            filename,
            text,
        } => Posted::File {
            chars,
            status: post_file(&webhook, &prefix_ping(summary, ping)?, filename, text)?,
        },
    };
    Ok(posted)
}

/// Prepend the Discord mention when pinging; pass the text through when not.
fn prefix_ping(text: &str, ping: bool) -> Result<String> {
    if !ping {
        return Ok(text.to_string());
    }
    let id = ping_user_id()
        .ok_or_else(|| anyhow!("no Discord user id to ping (line 2 of notify.key)"))?;
    Ok(format!("<@{id}>\n{text}"))
}

/// The `mail-digest` entry point: render with the current date and generation
/// instant, post, log. `ping` prepends a user mention (agent-originated mail).
pub fn run(arg: &str, ping: bool) -> Result<()> {
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let epoch = chrono::Utc::now().timestamp();
    let posted = execute(arg, &today, epoch, ping)?;
    println!("{}", posted.log_line());
    Ok(())
}
