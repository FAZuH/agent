//! Discord digest poster. The agent supplies DATA only; ordering, truncation,
//! mention neutralization and chunking live here.

use std::env;
use std::fs;
use std::path::Path;
use std::path::PathBuf;
use std::time::Duration;

use anyhow::Error;
use anyhow::Result;
use serde_json::Map;
use serde_json::Value;
use ureq::Agent;

pub const MAX_CHARS: usize = 1800;
pub const MAX_ITEMS: usize = 100;
pub const TIERS: [(&str, &str); 3] = [
    ("urgent", "🔴 urgent"),
    ("notable", "🟡 notable"),
    ("routine", "🟢 routine"),
];
pub const WEBHOOK_NAMES: [&str; 2] = ["phone-digest.key", "notify.key"];

const CAP_APP: usize = 30;
const CAP_TITLE: usize = 60;
const CAP_GIST: usize = 120;
const POST_TIMEOUT: Duration = Duration::from_secs(30);
const USER_AGENT: &str = "octask-phone-digest/1.0";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Item {
    pub app: String,
    pub title: String,
    pub gist: String,
    pub tier: String,
}

/// One Discord message per element: `# Phone digest — N notifications` plus
/// the `<t:<epoch>:R>` generation line open the FIRST chunk only, tier
/// sections follow, `(cont.)` headers resume later chunks — all counted in
/// characters like Python's `len(str)`. Never splits a line, so a tier
/// header always lands whole.
pub fn render_chunks(items: &[Item], epoch: i64) -> Vec<String> {
    let header = format!(
        "# Phone digest — {} notifications\n<t:{epoch}:R>",
        items.len()
    );
    const CONT: &str = "# Phone digest (cont.)";
    let mut chunks: Vec<String> = Vec::new();
    let mut current = vec![header.clone()];
    let mut size = header.chars().count();
    for line in detail_lines(items) {
        let len = line.chars().count();
        if size + len + 1 > MAX_CHARS && current.len() > 1 {
            chunks.push(current.join("\n"));
            current = vec![CONT.to_string()];
            size = CONT.chars().count();
        }
        size += len + 1;
        current.push(line);
    }
    chunks.push(current.join("\n"));
    chunks
}

/// `## <emoji> <tier>` headers (non-empty tiers only, urgent first) plus
/// `app: title — gist` bullets.
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
        lines.push(format!("• {detail}"));
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

/// Collapse whitespace, truncate to `cap` characters, then defuse mass
/// mentions — the Python order, so a truncated `@everyone@` stays cut.
pub fn clean(text: &str, cap: usize) -> String {
    crate::ingest::cap(text, cap)
        .replace("@everyone", "at-everyone")
        .replace("@here", "at-here")
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

/// Webhook credential roots, in lookup order: `$CREDENTIALS_DIRECTORY/discord`
/// first (when set), then `~/.secrets/discord`.
pub fn webhook_roots(credentials_dir: Option<&Path>, home: &Path) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Some(dir) = credentials_dir.filter(|dir| !dir.as_os_str().is_empty()) {
        roots.push(dir.join("discord"));
    }
    roots.push(home.join(".secrets/discord"));
    roots
}

fn webhook_url() -> Result<String> {
    let credentials = env::var_os("CREDENTIALS_DIRECTORY");
    for root in webhook_roots(credentials.as_deref().map(Path::new), &crate::home_dir()?) {
        for name in WEBHOOK_NAMES {
            let path = root.join(name);
            if path.is_file() {
                let first = fs::read_to_string(&path)
                    .map_err(|e| Error::new(e).context(format!("read {}", path.display())))?;
                return Ok(first.lines().next().unwrap_or_default().trim().to_string());
            }
        }
    }
    Err(Error::msg(
        "no Discord webhook found (phone-digest.key / notify.key)",
    ))
}

pub fn post(payload: &str) -> Result<()> {
    let items = parse_items(payload)?;
    if items.is_empty() {
        println!("no items, nothing posted");
        return Ok(());
    }

    let epoch = chrono::Utc::now().timestamp();
    let chunks = render_chunks(&items, epoch);
    let webhook = webhook_url()?;
    let agent: Agent = Agent::config_builder()
        .timeout_global(Some(POST_TIMEOUT))
        .build()
        .into();
    for chunk in &chunks {
        let status = send_chunk(&agent, &webhook, chunk)?;
        println!("posted {} chars, http {status}", chunk.chars().count());
    }
    Ok(())
}

fn send_chunk(agent: &Agent, webhook: &str, content: &str) -> Result<u16> {
    let body = serde_json::json!({ "content": content }).to_string();
    let response = agent
        .post(webhook)
        .header("Content-Type", "application/json")
        .header("User-Agent", USER_AGENT)
        .send(body)
        .map_err(|e| Error::new(e).context("post failed"))?;
    Ok(response.status().as_u16())
}

#[cfg(test)]
mod tests {
    use std::path::Path;
    use std::path::PathBuf;

    use anyhow::Result;

    use super::Item;
    use super::WEBHOOK_NAMES;
    use super::clean;
    use super::parse_items;
    use super::render_chunks;
    use super::webhook_roots;

    fn items(json: &str) -> Vec<Item> {
        parse_items(json).expect("parses")
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
        let chunks = render_chunks(&parsed, 1770000000);
        assert_eq!(chunks.len(), 1);
        let lines: Vec<&str> = chunks[0].lines().collect();
        assert_eq!(
            lines,
            [
                "# Phone digest — 4 notifications",
                "<t:1770000000:R>",
                "## 🔴 urgent",
                "• u1: t",
                "## 🟡 notable",
                "• n1: t",
                "## 🟢 routine",
                "• r1: t",
                "• r2: t",
            ]
        );
    }

    #[test]
    fn empty_tier_sections_are_omitted() {
        let parsed = items(r#"{"items": [{"app": "a", "title": "t", "tier": "routine"}]}"#);
        let text = render_chunks(&parsed, 1770000000).join("\n");
        assert_eq!(
            text,
            "# Phone digest — 1 notifications\n<t:1770000000:R>\n## 🟢 routine\n• a: t"
        );
    }

    #[test]
    fn gist_is_dropped_when_it_repeats_the_title() {
        let parsed = items(
            r#"{"items": [{"app": "a", "title": "same", "gist": "same"}, {"app": "b", "title": "t", "gist": ""}, {"app": "c", "title": "t2", "gist": "more"}]}"#,
        );
        let chunks = render_chunks(&parsed, 1770000000);
        assert!(chunks[0].contains("• a: same\n"), "{:?}", chunks[0]);
        assert!(chunks[0].contains("• b: t\n"), "{:?}", chunks[0]);
        assert!(chunks[0].contains("• c: t2 — more"));
    }

    #[test]
    fn chunks_split_at_1800_chars_with_a_continuation_header() {
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
        let chunks = render_chunks(&parsed, 1770000000);
        assert!(chunks.len() > 1, "expected a split, got {}", chunks.len());
        for chunk in &chunks {
            assert!(
                chunk.chars().count() <= 1800,
                "chunk is {} chars",
                chunk.chars().count()
            );
            assert!(!chunk.contains("\n\n"), "blank line in chunk: {chunk:?}");
        }
        assert!(chunks[1].starts_with("# Phone digest (cont.)\n"));
        assert!(!chunks[1].contains("<t:"), "ts line leaked into chunk 2");
        assert!(!chunks[0].contains("(cont.)"));
        // every bullet survives exactly once
        let bullets = chunks
            .iter()
            .flat_map(|chunk| chunk.lines())
            .filter(|line| line.starts_with('•'))
            .count();
        assert_eq!(bullets, 24);
    }

    #[test]
    fn header_and_timestamp_only_on_first_chunk() {
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
        let chunks = render_chunks(&parsed, 1770000000);
        assert!(chunks.len() > 1, "expected a split, got {}", chunks.len());
        assert_eq!(
            chunks[0].lines().take(2).collect::<Vec<_>>(),
            ["# Phone digest — 24 notifications", "<t:1770000000:R>"]
        );
        for chunk in &chunks[1..] {
            assert_eq!(chunk.lines().next().unwrap(), "# Phone digest (cont.)");
            assert!(!chunk.contains("# Phone digest — 24"));
            assert!(!chunk.contains("<t:1770000000:R>"));
        }
    }

    #[test]
    fn a_tier_header_can_start_a_continuation_chunk() {
        // Long bullets force a split inside the urgent section; every line,
        // section headers included, must land whole in exactly one chunk.
        let mut payload = String::from("{\"items\": [");
        for n in 0..20 {
            if n > 0 {
                payload.push(',');
            }
            payload.push_str(&format!(
                "{{\"app\": \"u{n}\", \"title\": \"{}\", \"gist\": \"{}\", \"tier\": \"urgent\"}}",
                "t".repeat(60),
                "g".repeat(120),
            ));
        }
        payload.push_str(r#",{"app": "r1", "title": "short", "tier": "routine"}]}"#);
        let parsed = items(&payload);
        let chunks = render_chunks(&parsed, 1770000000);
        assert!(chunks.len() > 1, "expected a split, got {}", chunks.len());
        let all = chunks.join("\n");
        let lines: Vec<&str> = all.lines().collect();
        assert_eq!(
            lines.iter().filter(|l| **l == "## 🔴 urgent").count(),
            1,
            "section header duplicated or cut: {chunks:#?}"
        );
        assert_eq!(lines.iter().filter(|l| **l == "## 🟢 routine").count(), 1);
        for chunk in &chunks {
            assert!(chunk.chars().count() <= 1800, "chunk too long");
            for line in chunk.lines() {
                assert!(
                    line.starts_with("# ")
                        || line.starts_with("<t:")
                        || line.starts_with("## ")
                        || line.starts_with('•'),
                    "ragged fragment line: {line:?}"
                );
            }
        }
        // the routine bullet is not orphaned from its header by a split
        let owner = chunks
            .iter()
            .position(|c| c.contains("## 🟢 routine"))
            .expect("routine header");
        assert!(chunks[owner].contains("• r1: short"));
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
        let chunks = render_chunks(&parsed, 1770000000);
        assert!(
            chunks[0].starts_with("# Phone digest — 100 notifications\n<t:1770000000:R>\n"),
            "unexpected header: {:?}",
            chunks[0]
        );
        let bullets = chunks
            .iter()
            .flat_map(|chunk| chunk.lines())
            .filter(|line| line.starts_with('•'))
            .count();
        assert_eq!(bullets, 100);
    }

    #[test]
    fn webhook_roots_are_searched_in_python_order() {
        let home = Path::new("/home/fazuh");
        assert_eq!(
            webhook_roots(None, home),
            vec![PathBuf::from("/home/fazuh/.secrets/discord")]
        );
        assert_eq!(
            webhook_roots(
                Some(Path::new("/run/credentials/phone-digest.service")),
                home
            ),
            vec![
                PathBuf::from("/run/credentials/phone-digest.service/discord"),
                PathBuf::from("/home/fazuh/.secrets/discord"),
            ]
        );
        // same names, same order
        assert_eq!(WEBHOOK_NAMES, ["phone-digest.key", "notify.key"]);
    }
}
