//! Atomic drain: print `inbox.jsonl` to stdout and park it under `drained/`
//! for a week.

use std::fs;
use std::fs::Permissions;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::time::Duration;
use std::time::SystemTime;
use std::time::UNIX_EPOCH;

use anyhow::Context;
use anyhow::Result;

pub const INBOX_FILE: &str = "inbox.jsonl";
pub const RETENTION_DAYS: u64 = 7;

/// Drained contents, empty when there was nothing to drain.
pub fn drain(state_dir: &Path) -> Result<String> {
    let drained = state_dir.join("drained");
    crate::ensure_private_dir(&drained)?;
    prune(&drained)?;

    let inbox = state_dir.join(INBOX_FILE);
    if !fs::metadata(&inbox).is_ok_and(|meta| meta.len() > 0) {
        return Ok(String::new());
    }

    let parked = drained.join(format!("{}.jsonl", epoch()));
    fs::rename(&inbox, &parked)
        .with_context(|| format!("rename {} to {}", inbox.display(), parked.display()))?;
    let contents =
        fs::read_to_string(&parked).with_context(|| format!("read {}", parked.display()))?;
    fs::set_permissions(&parked, Permissions::from_mode(0o600))
        .with_context(|| format!("chmod {}", parked.display()))?;
    Ok(contents)
}

/// Drop parked files older than the retention window (by mtime).
fn prune(drained: &Path) -> Result<()> {
    let horizon = SystemTime::now() - Duration::from_secs(RETENTION_DAYS * 86_400);
    let entries =
        fs::read_dir(drained).with_context(|| format!("read dir {}", drained.display()))?;
    for entry in entries {
        let path = entry?.path();
        if !path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.ends_with(".jsonl"))
        {
            continue;
        }
        if fs::metadata(&path)
            .and_then(|meta| meta.modified())
            .is_ok_and(|mtime| mtime < horizon)
        {
            let _ = fs::remove_file(&path);
        }
    }
    Ok(())
}

fn epoch() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

#[cfg(test)]
mod tests {
    use std::fs::FileTimes;
    use std::fs::OpenOptions;
    use std::os::unix::fs::PermissionsExt;
    use std::time::Duration;
    use std::time::SystemTime;

    use anyhow::Result;

    use super::drain;

    #[test]
    fn missing_or_empty_inbox_drains_nothing() -> Result<()> {
        let dir = tempfile::tempdir()?;
        assert_eq!(drain(dir.path())?, "");
        std::fs::write(dir.path().join("inbox.jsonl"), "")?;
        assert_eq!(drain(dir.path())?, "");
        Ok(())
    }

    #[test]
    fn drain_parks_the_inbox_and_returns_its_contents() -> Result<()> {
        let dir = tempfile::tempdir()?;
        std::fs::write(dir.path().join("inbox.jsonl"), "{\"app\":\"a\"}\n")?;

        assert_eq!(drain(dir.path())?, "{\"app\":\"a\"}\n");
        assert!(!dir.path().join("inbox.jsonl").exists());

        let parked: Vec<_> =
            std::fs::read_dir(dir.path().join("drained"))?.collect::<std::io::Result<Vec<_>>>()?;
        assert_eq!(parked.len(), 1);
        assert!(
            parked[0]
                .path()
                .file_name()
                .expect("file name")
                .to_string_lossy()
                .ends_with(".jsonl")
        );
        let mode = std::fs::metadata(parked[0].path())?.permissions().mode();
        assert_eq!(mode & 0o777, 0o600);
        Ok(())
    }

    #[test]
    fn drain_prunes_parked_files_past_the_retention_window() -> Result<()> {
        let dir = tempfile::tempdir()?;
        let drained = dir.path().join("drained");
        std::fs::create_dir_all(&drained)?;
        let stale = drained.join("123.jsonl");
        std::fs::write(&stale, "x")?;
        OpenOptions::new().write(true).open(&stale)?.set_times(
            FileTimes::new().set_modified(SystemTime::now() - Duration::from_secs(8 * 86_400)),
        )?;
        let fresh = drained.join("456.jsonl");
        std::fs::write(&fresh, "y")?;

        // inbox is missing, so nothing drains — but the prune still ran
        assert_eq!(drain(dir.path())?, "");
        assert!(!stale.exists());
        assert!(fresh.exists());
        Ok(())
    }
}
