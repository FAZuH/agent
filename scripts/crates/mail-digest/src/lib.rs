//! Build the mail digest from agent-supplied data and post it to Discord.
//!
//! The agent only supplies DATA; this module owns the entire output: grouped
//! by receiver account, tiers ordered urgent → notable → routine inside each
//! account, field truncation, mass-mention neutralization. Unknown tiers
//! become routine. The post is a static `# Mail digest` title, a summary
//! line, the `<t:<epoch>:R>` generation line, then per-account bullets
//! (tier emoji 🔴 urgent / 🟡 notable / 🟢 routine) and a trailing
//! `## ⚠️ errors` section; no blank lines. Past Discord's 2000-char limit
//! the post becomes a compact summary alongside a markdown file attachment
//! carrying the per-account full text. The mention pings when any item is
//! urgent or the agent passed `--ping`.

pub mod setup;

use std::collections::BTreeMap;

use anyhow::Result;
use anyhow::anyhow;
use digest_post::DISCORD_MAX;
pub use digest_post::Posted;
pub use digest_post::Rendered;
use digest_post::clean;
use digest_post::field_str;
use digest_post::fit;
use digest_post::header;
use digest_post::mention_id;
use digest_post::webhook_url;
use serde_json::Value;

const USER_AGENT: &str = "octask-mail-digest/1.0";
const WEBHOOK_NAMES: [&str; 1] = ["mail-digest.key"];
const TIER_TITLES: [(&str, &str); 3] = [
    ("urgent", "🔴 Needs attention"),
    ("notable", "🟡 Notable"),
    ("routine", "⚪ Routine"),
];
const TIER_EMOJI: [&str; 3] = ["🔴", "🟡", "🟢"];

/// The `str(...)` coercion of whatever JSON value a field holds.
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

/// Per-account attachment blocks with `### <tier>` sub-headers and
/// `- <sender> — <subject> (<gist>)` markdown list items — real list syntax
/// so Discord's markdown file preview keeps one entry per line. A repeated
/// sender nests as an indented `  - ↳ <subject> (<gist>)`.
fn attachment_block(mail: &[Mail]) -> Vec<String> {
    let mut lines = Vec::new();
    let mut last_tier: Option<usize> = None;
    let mut last_sender: Option<&str> = None;
    for m in mail {
        if last_tier != Some(m.tier) {
            lines.push(format!("### {}", TIER_TITLES[m.tier].1));
            last_tier = Some(m.tier);
            last_sender = None;
        }
        if last_sender == Some(m.sender.as_str()) {
            lines.push(format!("  - ↳ {} ({})", m.subject, m.gist));
        } else {
            lines.push(format!("- {} — {} ({})", m.sender, m.subject, m.gist));
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

fn counts_line(accounts: &BTreeMap<String, Vec<Mail>>) -> String {
    let n: usize = accounts.values().map(Vec::len).sum();
    format!("{n} mails across {} accounts", accounts.len())
}

fn attachment_text(
    accounts: &BTreeMap<String, Vec<Mail>>,
    errors: &[(String, String)],
    today: &str,
) -> String {
    let mut lines = vec![
        "# Mail digest".to_string(),
        counts_line(accounts),
        today.to_string(),
    ];
    for (account, mail) in accounts {
        lines.push(format!("## {account} ({})", mail.len()));
        lines.extend(attachment_block(mail));
    }
    if !errors.is_empty() {
        lines.push("## Errors".to_string());
        lines.extend(
            errors
                .iter()
                .map(|(alias, message)| format!("- ⚠️ {alias}: {message}")),
        );
    }
    lines.join("\n")
}

/// Any item with the urgent tier: auto-pings even without `--ping`.
fn has_urgent(arg: &str) -> bool {
    serde_json::from_str::<Value>(arg).is_ok_and(|data| {
        data.get("items")
            .and_then(Value::as_array)
            .is_some_and(|items| {
                items
                    .iter()
                    .any(|item| item.get("tier").and_then(Value::as_str) == Some("urgent"))
            })
    })
}

/// Turn the agent's JSON into the digest.
///
/// `today` is the `YYYY-MM-DD` stamp used in the attachment name and body;
/// `epoch` is the generation instant in seconds, rendered as the
/// `<t:<epoch>:R>` line. `mention_chars` reserves room for the `<@id>` line
/// inside the inline budget.
pub fn render(arg: &str, today: &str, epoch: i64, mention_chars: usize) -> Result<Rendered> {
    let data: Value =
        serde_json::from_str(arg).map_err(|_| anyhow!("argument must be a JSON object"))?;
    if !data.is_object() {
        return Err(anyhow!("argument must be a JSON object"));
    }
    let budget = DISCORD_MAX.saturating_sub(mention_chars);

    let Grouped { accounts, errors } = group(&data);
    let summary = counts_line(&accounts);
    if accounts.values().map(Vec::len).sum::<usize>() == 0 && errors.is_empty() {
        let notice = format!(
            "{}\n📬 no mail in the last 24h.",
            header("Mail digest", &summary, epoch)
        );
        return Ok(Rendered::Inline(notice));
    }

    let mut lines = vec![header("Mail digest", &summary, epoch)];
    for (account, mail) in &accounts {
        lines.push(format!("## {account}"));
        lines.extend(digest_block(mail));
    }
    lines.extend(error_lines(&errors));
    let inline = lines.join("\n");

    let attached = format!("{summary} (full digest attached)");
    let mut file_summary = header("Mail digest", &attached, epoch);
    for line in error_lines(&errors) {
        file_summary.push('\n');
        file_summary.push_str(&line);
    }
    Ok(fit(
        inline,
        file_summary,
        format!("mail-digest-{today}.md"),
        attachment_text(&accounts, &errors, today),
        budget,
    ))
}

/// Render and post, returning how it went. Split out so tests can pin the
/// date, the generation epoch, and point the webhook at a sink. Pings when
/// any item is urgent or `ping` (`--ping`) is set; the mention is prepended
/// to the posted content/summary. A missing ping id fails an explicit
/// `--ping` (the agent asked for a ping it cannot deliver) but silently
/// drops an urgent-only auto-ping: the digest still posts.
pub fn execute(arg: &str, today: &str, epoch: i64, ping: bool) -> Result<Posted> {
    let ping_id = if ping {
        Some(
            mention_id()
                .ok_or_else(|| anyhow!("no Discord user id to ping (line 2 of notify.key)"))?,
        )
    } else if has_urgent(arg) {
        mention_id()
    } else {
        None
    };
    let mention_chars = ping_id.as_ref().map_or(0, |id| id.chars().count() + 3); // <@id>\n
    let rendered = render(arg, today, epoch, mention_chars)?;
    let webhook = webhook_url(&WEBHOOK_NAMES)?;
    digest_post::post(&webhook, &rendered, ping_id.as_deref(), USER_AGENT)
}

/// The `mail-digest` entry point: render with the current date and generation
/// instant, post, log. Pings when any item is urgent or `--ping` is passed.
pub fn run(arg: &str, ping: bool) -> Result<()> {
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let epoch = chrono::Utc::now().timestamp();
    let posted = execute(arg, &today, epoch, ping)?;
    println!("{}", posted.log_line());
    Ok(())
}
