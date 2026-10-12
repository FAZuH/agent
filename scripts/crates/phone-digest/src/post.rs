//! Discord digest poster. The agent supplies DATA only; ordering, truncation,
//! mention neutralization and the inline/file split live in `digest-post`.
//! The mention pings when any item is urgent or `--ping` is set.

use anyhow::Error;
use anyhow::Result;
use digest_post::DISCORD_MAX;
use digest_post::Rendered;
use digest_post::clean;
use digest_post::fit;
use digest_post::header;
use digest_post::mention_id;
pub use digest_post::ping_user_id;
pub use digest_post::webhook_roots;
use digest_post::webhook_url;
use serde_json::Map;
use serde_json::Value;

pub const MAX_ITEMS: usize = 100;
pub const TIERS: [(&str, &str); 3] = [
    ("urgent", "🔴 urgent"),
    ("notable", "🟡 notable"),
    ("routine", "🟢 routine"),
];
pub const WEBHOOK_NAMES: [&str; 2] = ["phone-digest.key", "notify.key"];

const USER_AGENT: &str = "octask-phone-digest/1.0";
const CAP_APP: usize = 30;
const CAP_TITLE: usize = 60;
const CAP_GIST: usize = 120;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Item {
    pub app: String,
    pub title: String,
    pub gist: String,
    pub tier: String,
}

/// The digest, under or over Discord's message limit: `# Phone digest`,
/// summary, `<t:<epoch>:R>` and the tier-sorted `- app: title — gist` list
/// inline; past the limit a compact summary carries the full list as a
/// markdown attachment. `mention_chars` reserves room for the `<@id>` line.
pub fn render(items: &[Item], epoch: i64, today: &str, mention_chars: usize) -> Rendered {
    let budget = DISCORD_MAX.saturating_sub(mention_chars);
    let summary = format!("{} notifications", items.len());
    let mut inline = vec![header("Phone digest", &summary, epoch)];
    inline.extend(detail_lines(items));
    let attachment = format!(
        "# Phone digest\n{summary}\n{today}\n{}",
        detail_lines(items).join("\n")
    );
    fit(
        inline.join("\n"),
        header(
            "Phone digest",
            &format!("{summary} (full digest attached)"),
            epoch,
        ),
        format!("phone-digest-{today}.md"),
        attachment,
        budget,
    )
}

/// `## <emoji> <tier>` headers (non-empty tiers only, urgent first) plus
/// `- app: title — gist` markdown list items, so the file preview of an
/// attached digest keeps one entry per line.
pub fn detail_lines(items: &[Item]) -> Vec<String> {
    let mut sorted = items.to_vec();
    sorted.sort_by_key(|item| tier_rank(&item.tier));

    let mut lines = Vec::new();
    let mut last_tier: Option<&str> = None;
    for Item {
        app,
        title,
        gist,
        tier,
    } in &sorted
    {
        if Some(tier.as_str()) != last_tier {
            lines.push(format!("## {}", tier_label(tier)));
            last_tier = Some(tier);
        }
        let mut detail = format!("{app}: {title}");
        if !gist.is_empty() && gist != title {
            detail += &format!(" — {gist}");
        }
        lines.push(format!("- {detail}"));
    }
    lines
}

fn tier_rank(tier: &str) -> usize {
    TIERS
        .iter()
        .position(|(name, _)| *name == tier)
        .unwrap_or(TIERS.len() - 1)
}

fn tier_label(tier: &str) -> &str {
    TIERS
        .iter()
        .find(|(name, _)| *name == tier)
        .map_or(TIERS[TIERS.len() - 1].1, |(_, label)| label)
}

/// `{"items": [...]}` payload to capped items; unknown or missing tier is
/// routine, non-object entries and everything past `MAX_ITEMS` are dropped.
pub fn parse_items(payload: &str) -> Result<Vec<Item>> {
    let value = serde_json::from_str::<Value>(payload).map_err(|_| bad_json())?;
    let list = value
        .get("items")
        .and_then(Value::as_array)
        .ok_or_else(bad_json)?;
    Ok(list
        .iter()
        .take(MAX_ITEMS)
        .filter_map(Value::as_object)
        .map(item)
        .collect())
}

fn item(fields: &Map<String, Value>) -> Item {
    Item {
        app: clean(&field(fields, "app"), CAP_APP),
        title: clean(&field(fields, "title"), CAP_TITLE),
        gist: clean(&field(fields, "gist"), CAP_GIST),
        tier: fields
            .get("tier")
            .and_then(Value::as_str)
            .filter(|tier| TIERS.iter().any(|(name, _)| name == tier))
            .unwrap_or("routine")
            .to_string(),
    }
}

fn field(fields: &Map<String, Value>, key: &str) -> String {
    fields.get(key).map(py_str).unwrap_or_default()
}

/// `str(value)` as Python's `clean` would render it.
fn py_str(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        Value::Null => "None".to_string(),
        Value::Bool(true) => "True".to_string(),
        Value::Bool(false) => "False".to_string(),
        other => other.to_string(),
    }
}

fn bad_json() -> Error {
    Error::msg("argument must be {\"items\": [...]} JSON")
}

pub fn post(payload: &str, ping: bool) -> Result<()> {
    let items = parse_items(payload)?;
    if items.is_empty() {
        println!("no items, nothing posted");
        return Ok(());
    }

    let epoch = chrono::Utc::now().timestamp();
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    // explicit --ping with no id is an error the agent must see; an
    // urgent-only auto-ping degrades to no mention so the digest still posts
    let ping_id = if ping {
        Some(
            mention_id()
                .ok_or_else(|| Error::msg("no Discord user id to ping (line 2 of notify.key)"))?,
        )
    } else if items.iter().any(|item| item.tier == "urgent") {
        mention_id()
    } else {
        None
    };
    let mention_chars = ping_id.as_ref().map_or(0, |id| id.chars().count() + 3); // <@id>\n
    let rendered = render(&items, epoch, &today, mention_chars);
    let webhook = webhook_url(&WEBHOOK_NAMES)?;
    let posted = digest_post::post(&webhook, &rendered, ping_id.as_deref(), USER_AGENT)?;
    println!("{}", posted.log_line());
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::Path;
    use std::path::PathBuf;

    use anyhow::Result;
    use digest_post::Rendered;
    use digest_post::clean;

    use super::Item;
    use super::WEBHOOK_NAMES;
    use super::parse_items;
    use super::ping_user_id;
    use super::render;
    use super::webhook_roots;

    fn items(json: &str) -> Vec<Item> {
        parse_items(json).expect("parses")
    }

    fn inline(items: &[Item]) -> String {
        match render(items, 1770000000, "2026-09-12", 0) {
            Rendered::Inline(text) => text,
            other => panic!("expected inline, got {other:?}"),
        }
    }

    #[test]
    fn caps_fields_and_neutralize_mentions() -> Result<()> {
        let parsed = items(
            r#"{"items": [{"app": "  com.example \n app", "title": "x", "gist": "y", "tier": "urgent"}]}"#,
        );
        assert_eq!(parsed[0].app, "com.example app");

        let long = items(&format!(
            r#"{{"items": [{{"app": "{}", "title": "{}", "gist": "{}"}}]}}"#,
            "a".repeat(50),
            "b".repeat(90),
            "c".repeat(200),
        ));
        assert_eq!(long[0].app.chars().count(), 30);
        assert_eq!(long[0].title.chars().count(), 60);
        assert_eq!(long[0].gist.chars().count(), 120);
        Ok(())
    }

    #[test]
    fn mass_mentions_are_defused() {
        assert_eq!(clean("@everyone look here", 60), "at-everyone look here");
        assert_eq!(clean("ping @here now", 60), "ping at-here now");
        // truncation happens first, so the cut mention stays cut and still
        // gets defused: 10 chars of "@everyone@" is "@everyone@"
        assert_eq!(clean("@everyone@here", 10), "at-everyone@");
    }

    #[test]
    fn unknown_or_missing_tier_is_routine() {
        let parsed = items(
            r#"{"items": [{"app": "a", "title": "t", "tier": "BOGUS"}, {"app": "b", "title": "u", "tier": 5}, {"app": "c", "title": "v"}]}"#,
        );
        assert_eq!(
            parsed.iter().map(|i| i.tier.as_str()).collect::<Vec<_>>(),
            ["routine", "routine", "routine"]
        );
    }

    #[test]
    fn non_object_items_are_dropped() -> Result<()> {
        let parsed = parse_items(r#"{"items": ["nope", 3, {"app": "a", "title": "t"}]}"#)?;
        assert_eq!(parsed.len(), 1);
        Ok(())
    }

    #[test]
    fn bad_payloads_are_rejected() {
        for payload in ["not json", "{}", "[]", r#"{"items": {}}"#, r#""items""#] {
            let error = parse_items(payload).expect_err("rejects {payload}");
            assert_eq!(
                error.to_string(),
                "argument must be {\"items\": [...]} JSON"
            );
        }
    }

    #[test]
    fn empty_items_render_nothing_to_post() -> Result<()> {
        assert!(parse_items(r#"{"items": []}"#)?.is_empty());
        Ok(())
    }

    #[test]
    fn tiers_are_ordered_urgent_notable_routine() {
        let parsed = items(
            r#"{"items": [
                 {"app": "r1", "title": "t", "tier": "routine"},
                 {"app": "n1", "title": "t", "tier": "notable"},
                 {"app": "r2", "title": "t", "tier": "routine"},
                 {"app": "u1", "title": "t", "tier": "urgent"}
               ]}"#,
        );
        let text = inline(&parsed);
        let lines: Vec<&str> = text.lines().collect();
        assert_eq!(
            lines,
            [
                "# Phone digest",
                "4 notifications",
                "<t:1770000000:R>",
                "## 🔴 urgent",
                "- u1: t",
                "## 🟡 notable",
                "- n1: t",
                "## 🟢 routine",
                "- r1: t",
                "- r2: t",
            ]
        );
    }

    #[test]
    fn empty_tier_sections_are_omitted() {
        let parsed = items(r#"{"items": [{"app": "a", "title": "t", "tier": "routine"}]}"#);
        assert_eq!(
            inline(&parsed),
            "# Phone digest\n1 notifications\n<t:1770000000:R>\n## 🟢 routine\n- a: t"
        );
    }

    #[test]
    fn gist_is_dropped_when_it_repeats_the_title() {
        let parsed = items(
            r#"{"items": [{"app": "a", "title": "same", "gist": "same"}, {"app": "b", "title": "t", "gist": ""}, {"app": "c", "title": "t2", "gist": "more"}]}"#,
        );
        let text = inline(&parsed);
        assert!(text.contains("- a: same\n"), "{text:?}");
        assert!(text.contains("- b: t\n"), "{text:?}");
        assert!(text.contains("- c: t2 — more"));
    }

    #[test]
    fn past_the_discord_limit_it_becomes_an_attachment() {
        let mut payload = String::from("{\"items\": [");
        for n in 0..24 {
            if n > 0 {
                payload.push(',');
            }
            payload.push_str(&format!(
                "{{\"app\": \"app{n}\", \"title\": \"{}\", \"gist\": \"{}\", \"tier\": \"routine\"}}",
                "t".repeat(60),
                "g".repeat(120),
            ));
        }
        payload.push_str("]}");
        let parsed = items(&payload);
        let Rendered::File {
            summary,
            filename,
            text,
        } = render(&parsed, 1770000000, "2026-09-12", 0)
        else {
            panic!("24 long items must overflow the inline budget");
        };
        assert_eq!(
            summary,
            "# Phone digest\n24 notifications (full digest attached)\n<t:1770000000:R>"
        );
        assert_eq!(filename, "phone-digest-2026-09-12.md");
        let lines: Vec<&str> = text.lines().collect();
        assert_eq!(
            &lines[..4],
            [
                "# Phone digest",
                "24 notifications",
                "2026-09-12",
                "## 🟢 routine"
            ]
        );
        let bullets = lines.iter().filter(|line| line.starts_with("- ")).count();
        assert_eq!(bullets, 24);
        assert!(!text.contains("\n\n"), "blank line in attachment");
    }

    #[test]
    fn the_mention_budget_shrinks_the_inline_body() {
        let parsed = items(
            r#"{"items": [{"app": "a", "title": "t", "tier": "routine"}, {"app": "b", "title": "u", "tier": "routine"}]}"#,
        );
        let small = match render(&parsed, 1770000000, "2026-09-12", 0) {
            Rendered::Inline(text) => text,
            other => panic!("expected inline, got {other:?}"),
        };
        // the same body with a mention reserved still fits
        assert!(matches!(
            render(&parsed, 1770000000, "2026-09-12", 20),
            Rendered::Inline(_)
        ));
        assert!(small.chars().count() < 1980);
    }

    #[test]
    fn over_100_items_are_dropped_and_counted() {
        let mut payload = String::from("{\"items\": [");
        for n in 0..103 {
            if n > 0 {
                payload.push(',');
            }
            payload.push_str(&format!("{{\"app\": \"a{n}\", \"title\": \"t\"}}"));
        }
        payload.push_str("]}");
        let parsed = items(&payload);
        assert_eq!(parsed.len(), 100);
        assert!(
            inline(&parsed).starts_with("# Phone digest\n100 notifications\n<t:1770000000:R>\n"),
            "unexpected header"
        );
        let bullets = inline(&parsed)
            .lines()
            .filter(|line| line.starts_with("- "))
            .count();
        assert_eq!(bullets, 100);
    }

    #[test]
    fn webhook_roots_are_searched_in_python_order() {
        let home = Path::new("/home/tester");
        assert_eq!(
            webhook_roots(None, home),
            vec![PathBuf::from(
                "/home/tester/.config/fazuh-agent/secrets/discord"
            )]
        );
        assert_eq!(
            webhook_roots(
                Some(Path::new("/run/credentials/phone-digest.service")),
                home
            ),
            vec![
                PathBuf::from("/run/credentials/phone-digest.service/discord"),
                PathBuf::from("/home/tester/.config/fazuh-agent/secrets/discord"),
            ]
        );
        // same names, same order
        assert_eq!(WEBHOOK_NAMES, ["phone-digest.key", "notify.key"]);
    }

    #[test]
    fn ping_user_id_reads_line_2_of_notify_key() -> Result<()> {
        let dir = tempfile::tempdir()?;
        let home = dir.path();
        fs::create_dir_all(home.join(".config/fazuh-agent/secrets/discord"))?;
        fs::write(
            home.join(".config/fazuh-agent/secrets/discord/notify.key"),
            "https://discord.com/api/webhooks/a\n123456789\ngarbage\n",
        )?;
        assert_eq!(
            ping_user_id(None, home),
            Some("123456789".to_string()),
            "no credentials dir: home notify.key line 2"
        );
        assert_eq!(ping_user_id(None, Path::new("/nonexistent")), None);

        // first root with a non-empty id wins
        let creds = dir.path().join("creds");
        fs::create_dir_all(creds.join("discord"))?;
        fs::write(creds.join("discord/notify.key"), "url\n987654321\n")?;
        assert_eq!(
            ping_user_id(Some(&creds), home),
            Some("987654321".to_string())
        );

        // an empty line-2 id falls through to the next root
        let empty = dir.path().join("empty");
        fs::create_dir_all(empty.join("discord"))?;
        fs::write(empty.join("discord/notify.key"), "url\n   \n")?;
        assert_eq!(
            ping_user_id(Some(&empty), home),
            Some("123456789".to_string())
        );
        Ok(())
    }
}
