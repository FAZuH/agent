//! Cheap pre-check gate for the mail digest.
//!
//! A systemd timer runs `mail-digest check --trigger` every 30 minutes. This
//! module asks zele for the newest envelopes in each account, keeps only the
//! ones past the saved watermark, and stores them as compact items in a pending
//! batch. The agent then reads `mail-digest pending` instead of dumping thousands
//! of lines of zele YAML into its context, which is what made the free model
//! time out. The watermark advances only after `mail-digest post` confirms
//! delivery.

use std::collections::BTreeMap;
use std::collections::BTreeSet;
use std::path::Path;
use std::path::PathBuf;
use std::process::Command;

use anyhow::Context;
use anyhow::Result;
use anyhow::bail;
use serde_json::Value;
use serde_json::json;

const WEBHOOK_NAMES: [&str; 1] = ["mail-digest.key"];

/// Envelopes fetched per account by the gate. The agent consumes these from
/// `pending` rather than running `zele mail list` itself.
const ENVELOPE_LIMIT: &str = "50";
/// Cap on compact items handed to the agent, newest first.
const MAX_ITEMS: usize = 50;
/// Default characters of a body returned by `mail-digest body`.
pub const DEFAULT_BODY_LIMIT: usize = 2000;

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Envelope {
    pub id: String,
    pub account: String,
    pub from: String,
    pub subject: String,
    pub snippet: String,
    pub date: String,
    pub flags: String,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Pending {
    pub run_id: String,
    pub max_ids: BTreeMap<String, u64>,
    pub new: usize,
    pub errors: BTreeMap<String, String>,
    pub items: Vec<Envelope>,
    /// Number of agent starts for this batch, used to back off repeated failures.
    pub attempts: u32,
    /// Earliest next agent start. Set after each trigger so a failing agent
    /// cannot be restarted every 30 minutes forever.
    pub next_trigger: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct CheckState {
    pub watermarks: BTreeMap<String, u64>,
    pub pending: Option<Pending>,
    pub last_run: Option<String>,
    pub last_new: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub struct CheckResult {
    pub wake: bool,
    pub new: usize,
    pub run_id: Option<String>,
    pub errors: BTreeMap<String, String>,
}

pub fn state_path() -> Result<PathBuf> {
    Ok(digest_post::home_dir()?
        .join(".config/fazuh-agent/digest/mail-digest")
        .join("check.json"))
}

fn envelope_from_value(value: &Value) -> Envelope {
    Envelope {
        id: value
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned(),
        account: value
            .get("account")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned(),
        from: value
            .get("from")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned(),
        subject: value
            .get("subject")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned(),
        snippet: value
            .get("snippet")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned(),
        date: value
            .get("date")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned(),
        flags: value
            .get("flags")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned(),
    }
}

fn envelope_to_value(env: &Envelope) -> Value {
    json!({
        "id": env.id,
        "account": env.account,
        "from": env.from,
        "subject": env.subject,
        "snippet": env.snippet,
        "date": env.date,
        "flags": env.flags,
    })
}

pub fn load(path: &Path) -> Result<CheckState> {
    let text = match std::fs::read_to_string(path) {
        Ok(text) => text,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(CheckState::default()),
        Err(e) => return Err(e).with_context(|| format!("read {}", path.display())),
    };
    let value: Value =
        serde_json::from_str(&text).with_context(|| format!("parse {}", path.display()))?;
    let mut state = CheckState {
        last_run: value
            .get("last_run")
            .and_then(Value::as_str)
            .map(str::to_owned),
        last_new: value
            .get("last_new")
            .and_then(Value::as_u64)
            .unwrap_or_default() as usize,
        ..CheckState::default()
    };
    if let Some(map) = value.get("watermarks").and_then(Value::as_object) {
        for (account, id) in map {
            if let Some(id) = id.as_u64() {
                state.watermarks.insert(account.clone(), id);
            }
        }
    }
    if let Some(pending) = value.get("pending") {
        let mut parsed = Pending {
            run_id: pending
                .get("run_id")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned(),
            new: pending
                .get("new")
                .and_then(Value::as_u64)
                .unwrap_or_default() as usize,
            ..Pending::default()
        };
        if let Some(map) = pending.get("max_ids").and_then(Value::as_object) {
            for (account, id) in map {
                if let Some(id) = id.as_u64() {
                    parsed.max_ids.insert(account.clone(), id);
                }
            }
        }
        if let Some(map) = pending.get("errors").and_then(Value::as_object) {
            for (account, message) in map {
                parsed.errors.insert(
                    account.clone(),
                    message.as_str().unwrap_or_default().to_owned(),
                );
            }
        }
        if let Some(items) = pending.get("items").and_then(Value::as_array) {
            parsed.items = items.iter().map(envelope_from_value).collect();
        }
        parsed.attempts = pending
            .get("attempts")
            .and_then(Value::as_u64)
            .unwrap_or_default() as u32;
        parsed.next_trigger = pending
            .get("next_trigger")
            .and_then(Value::as_str)
            .map(str::to_owned);
        if !parsed.run_id.is_empty() {
            state.pending = Some(parsed);
        }
    }
    Ok(state)
}

pub fn save(path: &Path, state: &CheckState) -> Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).with_context(|| format!("create {}", parent.display()))?;
    }
    let pending = state.pending.as_ref().map(|p| {
        json!({
            "run_id": p.run_id,
            "max_ids": p.max_ids,
            "new": p.new,
            "errors": p.errors,
            "items": p.items.iter().map(envelope_to_value).collect::<Vec<_>>(),
            "attempts": p.attempts,
            "next_trigger": p.next_trigger,
        })
    });
    let body = json!({
        "watermarks": state.watermarks,
        "pending": pending,
        "last_run": state.last_run,
        "last_new": state.last_new,
    });
    std::fs::write(path, format!("{body}\n")).with_context(|| format!("write {}", path.display()))
}

/// Account addresses from `zele whoami`, in the order zele reports them.
pub fn parse_accounts(text: &str) -> Vec<String> {
    text.lines()
        .filter_map(|line| line.trim().strip_prefix("- email:"))
        .map(str::trim)
        .filter(|email| email.contains('@'))
        .map(str::to_owned)
        .collect()
}

/// The newest thread id from `zele mail list --limit 1`, as (id, numeric part).
pub fn parse_top_id(text: &str) -> Option<(String, u64)> {
    let id = text
        .lines()
        .filter_map(|line| line.trim().strip_prefix("- id:"))
        .map(str::trim)
        .find(|value| !value.is_empty())?
        .to_owned();
    let number = id.rsplit(':').next()?.parse::<u64>().ok()?;
    Some((id, number))
}

fn yaml_value(raw: &str) -> String {
    let value = raw.trim();
    if value.len() >= 2 && value.starts_with('\'') && value.ends_with('\'') {
        value[1..value.len() - 1].replace("''", "'")
    } else if value.len() >= 2 && value.starts_with('"') && value.ends_with('"') {
        value[1..value.len() - 1].to_owned()
    } else {
        value.to_owned()
    }
}

fn clip(value: String, max: usize) -> String {
    value.chars().take(max).collect()
}

/// Parse zele's YAML envelope list into compact items. zele repeats the subject
/// as the snippet on short mail, so both are kept but clipped to bound size.
pub fn parse_envelopes(text: &str, account: &str) -> Vec<Envelope> {
    let mut out = Vec::new();
    let mut current: Option<Envelope> = None;
    for line in text.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("- id:") {
            if let Some(env) = current.take() {
                out.push(env);
            }
            let id = yaml_value(rest);
            if id.is_empty() {
                continue;
            }
            current = Some(Envelope {
                id,
                account: account.to_owned(),
                from: String::new(),
                subject: String::new(),
                snippet: String::new(),
                date: String::new(),
                flags: String::new(),
            });
            continue;
        }
        let Some(env) = current.as_mut() else {
            continue;
        };
        if let Some(v) = trimmed.strip_prefix("from:") {
            env.from = clip(yaml_value(v), 100);
        } else if let Some(v) = trimmed.strip_prefix("subject:") {
            env.subject = clip(yaml_value(v), 160);
        } else if let Some(v) = trimmed.strip_prefix("snippet:") {
            env.snippet = clip(yaml_value(v), 160);
        } else if let Some(v) = trimmed.strip_prefix("date:") {
            env.date = clip(yaml_value(v), 40);
        } else if let Some(v) = trimmed.strip_prefix("flags:") {
            env.flags = clip(yaml_value(v), 40);
        }
    }
    if let Some(env) = current {
        out.push(env);
    }
    out
}

fn envelope_num(env: &Envelope) -> u64 {
    env.id
        .rsplit(':')
        .next()
        .and_then(|number| number.parse().ok())
        .unwrap_or_default()
}

fn zele_bin() -> PathBuf {
    if let Some(bin) = std::env::var_os("ZELE_BIN").filter(|v| !v.is_empty()) {
        return PathBuf::from(bin);
    }
    let npm_global = digest_post::home_dir()
        .unwrap_or_else(|_| PathBuf::from("/"))
        .join(".npm-global/bin/zele");
    if npm_global.is_file() {
        return npm_global;
    }
    PathBuf::from("zele")
}

fn zele(args: &[&str]) -> Result<String> {
    let output = Command::new(zele_bin())
        .args(args)
        .output()
        .with_context(|| "run zele (set ZELE_BIN if it is not on PATH)")?;
    if !output.status.success() {
        bail!(
            "zele {} failed: {}",
            args.join(" "),
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

fn new_run_id() -> String {
    format!(
        "{}-{}",
        chrono::Utc::now().format("%Y%m%dT%H%M%S"),
        std::process::id()
    )
}

/// Exponential delay before the next agent start: 1, 2, 4, 8 then a 16h cap.
fn backoff_hours(attempt: u32) -> i64 {
    2u64.pow(attempt.saturating_sub(1).min(4)) as i64
}

/// Verify the webhook and that zele has at least one authenticated account.
/// Called before any agent run so a broken config fails without LLM spend.
pub fn preflight() -> Result<Value> {
    digest_post::webhook_url(&WEBHOOK_NAMES).context("no mail digest webhook (mail-digest.key)")?;
    let accounts = parse_accounts(&zele(&["whoami"])?);
    if accounts.is_empty() {
        bail!("zele has no authenticated accounts");
    }
    Ok(json!({ "ok": true, "accounts": accounts.len() }))
}

/// Compare the newest mail in each account with the saved watermark and stage
/// the new envelopes for the agent. Does not advance the watermark; that
/// happens after a successful post.
pub fn check(trigger: bool) -> Result<CheckResult> {
    preflight()?;
    let path = state_path()?;
    let mut state = load(&path)?;
    let accounts = parse_accounts(&zele(&["whoami"])?);
    if accounts.is_empty() {
        bail!("zele has no authenticated accounts");
    }

    let mut new = 0usize;
    let mut errors = BTreeMap::new();
    let mut observed: BTreeMap<String, u64> = BTreeMap::new();
    let mut fresh: Vec<Envelope> = Vec::new();

    for account in &accounts {
        match zele(&[
            "mail",
            "list",
            "--limit",
            ENVELOPE_LIMIT,
            "--account",
            account,
        ]) {
            Ok(text) => {
                let envelopes = parse_envelopes(&text, account);
                let seen = state.watermarks.get(account).copied().unwrap_or_default();
                let max_num = envelopes.iter().map(envelope_num).max().unwrap_or_default();
                observed.insert(account.clone(), max_num);
                let account_new: Vec<Envelope> = envelopes
                    .into_iter()
                    .filter(|env| envelope_num(env) > seen)
                    .collect();
                new += account_new.len();
                fresh.extend(account_new);
            }
            Err(e) => {
                errors.insert(account.clone(), format!("{e:#}"));
            }
        }
    }

    // A pending digest that never posted must be retried, otherwise a failed
    // agent run loses that batch of mail. A failed run backs off exponentially
    // so a broken agent is not restarted every 30 minutes forever.
    let has_pending = state.pending.is_some();
    let mut wake = new > 0 || has_pending;
    if let Some(next) = state
        .pending
        .as_ref()
        .and_then(|pending| pending.next_trigger.as_deref())
        .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
    {
        if chrono::Utc::now() < next {
            wake = false;
        }
    }

    if new > 0 || !errors.is_empty() {
        let run_id = state
            .pending
            .as_ref()
            .map(|p| p.run_id.clone())
            .unwrap_or_else(new_run_id);
        let mut max_ids = state
            .pending
            .as_ref()
            .map(|p| p.max_ids.clone())
            .unwrap_or_else(|| state.watermarks.clone());
        for (account, number) in &observed {
            let entry = max_ids.entry(account.clone()).or_insert(*number);
            *entry = (*entry).max(*number);
        }

        // Keep items from a previous failed run and add newly seen ones,
        // deduped by (account, id), newest first and capped for the LLM context.
        let mut items: Vec<Envelope> = state
            .pending
            .as_ref()
            .map(|p| p.items.clone())
            .unwrap_or_default();
        let mut keys: BTreeSet<(String, String)> = items
            .iter()
            .map(|env| (env.account.clone(), env.id.clone()))
            .collect();
        for env in fresh {
            if keys.insert((env.account.clone(), env.id.clone())) {
                items.push(env);
            }
        }
        items.sort_by(|a, b| envelope_num(b).cmp(&envelope_num(a)));
        items.truncate(MAX_ITEMS);

        let count = state.pending.as_ref().map_or(new, |p| p.new.max(new));
        let (attempts, next_trigger) = state
            .pending
            .as_ref()
            .map(|p| (p.attempts, p.next_trigger.clone()))
            .unwrap_or_default();
        state.pending = Some(Pending {
            run_id: run_id.clone(),
            max_ids,
            new: count,
            errors: errors.clone(),
            items,
            attempts,
            next_trigger,
        });
        save(&path, &state)?;
    }

    println!(
        "{}",
        json!({
            "wake": wake,
            "new": new,
            "run_id": state.pending.as_ref().map(|p| p.run_id.as_str()),
            "errors": errors,
        })
    );

    if trigger && wake {
        if let Some(pending) = state.pending.as_mut() {
            pending.attempts += 1;
            let hours = backoff_hours(pending.attempts);
            pending.next_trigger =
                Some((chrono::Utc::now() + chrono::Duration::hours(hours)).to_rfc3339());
            save(&path, &state)?;
        }
        let status = Command::new("octask")
            .args(["run", "mail-digest"])
            .status()
            .context("trigger octask run mail-digest")?;
        if !status.success() {
            bail!("octask run mail-digest exited {status}");
        }
    }

    Ok(CheckResult {
        wake,
        new,
        run_id: state.pending.map(|p| p.run_id),
        errors,
    })
}

/// Called by `post` after Discord accepts the message. Advances watermarks so
/// the same mail is not reported again and clears the pending batch.
pub fn advance(run_id: Option<&str>) -> Result<()> {
    advance_at(&state_path()?, run_id)
}

fn advance_at(path: &Path, run_id: Option<&str>) -> Result<()> {
    let mut state = load(path)?;
    let Some(pending) = state.pending.clone() else {
        return Ok(());
    };
    if run_id.is_none_or(|id| id != pending.run_id) {
        return Ok(());
    }
    for (account, number) in pending.max_ids {
        let entry = state.watermarks.entry(account).or_insert(number);
        *entry = (*entry).max(number);
    }
    state.last_new = pending.new;
    state.last_run = Some(chrono::Utc::now().to_rfc3339());
    state.pending = None;
    save(path, &state)
}

/// The staged batch for the digest agent: compact items it can classify without
/// pulling raw zele YAML into its context.
pub fn pending() -> Result<Value> {
    let state = load(&state_path()?)?;
    Ok(match state.pending {
        Some(p) => json!({
            "run_id": p.run_id,
            "new": p.new,
            "accounts": p.max_ids.keys().collect::<Vec<_>>(),
            "errors": p.errors,
            "items": p.items.iter().map(envelope_to_value).collect::<Vec<_>>(),
            "attempts": p.attempts,
            "next_trigger": p.next_trigger,
        }),
        None => json!({ "run_id": null, "new": 0, "accounts": [], "errors": {}, "items": [] }),
    })
}

/// A bounded body read for the agent. Full zele bodies can be long; returning
/// only the first `limit` chars keeps the agent's context small.
pub fn body(id: &str, account: &str, limit: usize) -> Result<String> {
    let text = zele(&["mail", "read", id, "--account", account])?;
    Ok(text.chars().take(limit).collect())
}

/// Operator health snapshot for `mail-digest doctor`.
pub fn doctor() -> Result<Value> {
    let state = load(&state_path()?)?;
    let receipts = digest_post::receipts_path()?;
    let count = std::fs::read_to_string(&receipts)
        .map(|text| text.lines().count())
        .unwrap_or_default();
    Ok(json!({
        "watermarked_accounts": state.watermarks.len(),
        "pending": state.pending.is_some(),
        "pending_new": state.pending.as_ref().map(|p| p.new).unwrap_or_default(),
        "pending_items": state.pending.as_ref().map(|p| p.items.len()).unwrap_or_default(),
        "attempts": state.pending.as_ref().map(|p| p.attempts).unwrap_or_default(),
        "next_trigger": state.pending.as_ref().and_then(|p| p.next_trigger.clone()),
        "last_run": state.last_run,
        "last_new": state.last_new,
        "receipts": count,
    }))
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::backoff_hours;
    use super::parse_accounts;
    use super::parse_envelopes;
    use super::parse_top_id;

    #[test]
    fn failure_backoff_grows_then_caps() {
        assert_eq!(
            (1..=7).map(backoff_hours).collect::<Vec<_>>(),
            [1, 2, 4, 8, 16, 16, 16]
        );
    }

    #[test]
    fn accounts_come_from_zele_whoami_lines() {
        let text = "summary: 2 account(s)\nitems:\n  - email: admin@example.com\n    type: imap\n  - email: personal@example.com\n";
        assert_eq!(
            parse_accounts(text),
            ["admin@example.com", "personal@example.com"]
        );
    }

    #[test]
    fn top_id_reads_the_numeric_thread_suffix() {
        let text = "items:\n  - id: INBOX:1764\n    flags: unread\n";
        assert_eq!(parse_top_id(text), Some(("INBOX:1764".to_owned(), 1764)));
    }

    #[test]
    fn top_id_rejects_missing_or_non_numeric_ids() {
        assert_eq!(parse_top_id("items: []"), None);
        assert_eq!(parse_top_id("  - id: INBOX:abc"), None);
    }

    #[test]
    fn envelopes_parse_and_unquote_compact_fields() {
        let text = "summary: 2 threads (inbox)\nitems:\n  - id: INBOX:1764\n    flags: unread, reply\n    from: ci-bot <ci@example.com>\n    subject: 'Re: it''s a fix'\n    snippet: 'Re: it''s a fix'\n    date: 31m ago\n    messages: 1\n  - id: INBOX:2\n    flags: ''\n    from: admin@example.com\n    subject: plain\n    date: Nov 4\n";
        let envs = parse_envelopes(text, "admin@example.com");
        assert_eq!(envs.len(), 2);
        assert_eq!(envs[0].id, "INBOX:1764");
        assert_eq!(envs[0].subject, "Re: it's a fix");
        assert_eq!(envs[0].from, "ci-bot <ci@example.com>");
        assert_eq!(envs[0].flags, "unread, reply");
        assert_eq!(envs[1].id, "INBOX:2");
        assert_eq!(envs[1].flags, "");
    }

    #[test]
    fn envelope_fields_are_clipped() {
        let long = "x.".repeat(200);
        let text = format!("items:\n  - id: INBOX:1\n    subject: '{long}'\n");
        let envs = parse_envelopes(&text, "a@b.c");
        assert_eq!(envs[0].subject.chars().count(), 160);
    }

    #[test]
    fn state_round_trips_watermarks_pending_and_items() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("check.json");
        let pending = super::Pending {
            run_id: "run-1".into(),
            max_ids: [("a@b.c".to_owned(), 42)].into_iter().collect(),
            new: 2,
            errors: [("x@y.z".to_owned(), "bad token".to_owned())]
                .into_iter()
                .collect(),
            items: vec![super::Envelope {
                id: "INBOX:42".into(),
                account: "a@b.c".into(),
                from: "someone@example.com".into(),
                subject: "hello".into(),
                snippet: "hello".into(),
                date: "just now".into(),
                flags: "unread".into(),
            }],
            attempts: 2,
            next_trigger: Some("2026-11-18T02:00:00+00:00".into()),
        };
        let state = super::CheckState {
            watermarks: [("a@b.c".to_owned(), 40)].into_iter().collect(),
            pending: Some(pending.clone()),
            last_run: None,
            last_new: 3,
        };
        super::save(&path, &state).unwrap();
        assert_eq!(super::load(&path).unwrap(), state);
    }

    #[test]
    fn missing_state_is_empty() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(
            super::load(&dir.path().join("nope.json")).unwrap(),
            super::CheckState::default()
        );
    }

    #[test]
    fn advance_clears_pending_and_raises_watermarks() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("check.json");
        let state = super::CheckState {
            watermarks: [("a@b.c".to_owned(), 40)].into_iter().collect(),
            pending: Some(super::Pending {
                run_id: "run-1".into(),
                max_ids: [("a@b.c".to_owned(), 44)].into_iter().collect(),
                new: 4,
                errors: BTreeMap::new(),
                items: Vec::new(),
                attempts: 0,
                next_trigger: None,
            }),
            last_run: None,
            last_new: 0,
        };
        super::save(&path, &state).unwrap();
        super::advance_at(&path, Some("run-1")).unwrap();
        let after = super::load(&path).unwrap();
        assert_eq!(after.watermarks.get("a@b.c"), Some(&44));
        assert!(after.pending.is_none());
        assert_eq!(after.last_new, 4);
    }
}
