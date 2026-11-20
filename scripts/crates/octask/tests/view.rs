use octask::view::TaskView;
use octask::view::glyph;
use octask::view::render;
use octask::view::to_json;

fn row(name: &str, enabled: bool, failed: bool) -> TaskView {
    TaskView {
        name: name.into(),
        kind: "agent",
        description: "check mail".into(),
        workdir: "~/Work/Notes".into(),
        oncalendar: "*-*-* 09:00:00".into(),
        next: "Tue 2026-11-17 09:00:00 WIT".into(),
        enabled,
        active: false,
        failed,
    }
}

#[test]
fn json_has_all_view_fields() {
    let rows = vec![row("digest", true, false)];
    let value = to_json(&rows);
    let item = &value[0];
    assert_eq!(item["name"], "digest");
    assert_eq!(item["kind"], "agent");
    assert_eq!(item["enabled"], true);
    assert_eq!(item["failed"], false);
    assert_eq!(item["oncalendar"], "*-*-* 09:00:00");
}

#[test]
fn render_marks_enabled_disabled_and_failed() {
    let rows = vec![
        row("on", true, false),
        row("off", false, false),
        row("bad", true, true),
    ];
    let text = render(&rows);
    assert!(text.contains("on"));
    assert!(text.contains("off"));
    assert!(text.contains("[+]"));
    assert!(text.contains("[-]"));
    assert!(text.contains("[!]"));
}

#[test]
fn glyph_prefers_failed_over_enabled() {
    let failed = row("x", true, true);
    let plain = row("y", true, false);
    assert_ne!(glyph(&failed), glyph(&plain));
}

#[test]
fn empty_render_explains_how_to_add() {
    let text = render(&[]);
    assert!(text.contains("octask add"));
}
