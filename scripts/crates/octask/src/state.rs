use std::io::ErrorKind;
use std::path::Path;
use std::path::PathBuf;

use anyhow::Context;
use anyhow::Result;

use crate::sys::config_home;

const STATE_FILE: &str = "pause.json";

/// Which timers were enabled when `octask pause` ran.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct PauseState {
    pub enabled: Vec<String>,
}

pub fn state_dir() -> PathBuf {
    config_home().join("octask")
}

pub fn state_path() -> PathBuf {
    state_dir().join(STATE_FILE)
}

pub fn load(path: &Path) -> Result<Option<PauseState>> {
    let text = match std::fs::read_to_string(path) {
        Ok(text) => text,
        Err(e) if e.kind() == ErrorKind::NotFound => return Ok(None),
        Err(e) => {
            return Err(e).with_context(|| format!("reading {}", path.display()));
        }
    };
    let value: serde_json::Value =
        serde_json::from_str(&text).with_context(|| format!("parsing {}", path.display()))?;
    let enabled = value
        .get("enabled")
        .and_then(|v| v.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|v| v.as_str())
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default();
    Ok(Some(PauseState { enabled }))
}

pub fn save(path: &Path, state: &PauseState) -> Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("creating {}", parent.display()))?;
    }
    let mut enabled = state.enabled.clone();
    enabled.sort();
    enabled.dedup();
    let json = serde_json::json!({ "enabled": enabled });
    std::fs::write(path, format!("{json}\n")).with_context(|| format!("writing {}", path.display()))
}

pub fn clear(path: &Path) -> Result<()> {
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e).with_context(|| format!("removing {}", path.display())),
    }
}
