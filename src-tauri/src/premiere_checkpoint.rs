use std::{fs::{self, File, OpenOptions}, io::{Read, Write}, path::Path};
use serde_json::json;
use uuid::Uuid;

const MAX_PROJECT_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const MAX_BACKUP_FILES: usize = 1000;
const MAX_BACKUP_BYTES: u64 = 20 * 1024 * 1024 * 1024;

/// Fail closed. Never overwrite a checkpoint, remove an old backup, or load a
/// large project into RAM. The returned path remains compatible with callers.
pub fn create_checkpoint(source: &Path, timestamp_ms: u64) -> Result<String, String> {
    if !source.is_absolute() || !source.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case("prproj")) {
        return Err("Save the active Premiere project to an absolute .prproj path before editing.".into());
    }
    let source = fs::canonicalize(source).map_err(|e| format!("Premiere project is unavailable: {e}"))?;
    let mut input = File::open(&source).map_err(|e| format!("Could not open Premiere project: {e}"))?;
    let before = input.metadata().map_err(|e| format!("Could not inspect Premiere project: {e}"))?;
    if !before.is_file() || before.len() == 0 || before.len() > MAX_PROJECT_BYTES {
        return Err("Premiere checkpoint requires a non-empty project of at most 2 GiB.".into());
    }
    let parent = source.parent().ok_or("Premiere project has no parent directory.")?;
    let directory = parent.join("Shuvi Backups");
    fs::create_dir_all(&directory).map_err(|e| format!("Could not create backup folder: {e}"))?;
    let directory = fs::canonicalize(&directory).map_err(|e| format!("Could not resolve backup folder: {e}"))?;
    if directory.parent() != Some(parent) {
        return Err("Premiere backup folder must resolve directly beside the project.".into());
    }
    let mut count = 0;
    let mut bytes = 0_u64;
    for (index, entry) in fs::read_dir(&directory).map_err(|e| format!("Could not inspect backups: {e}"))?.enumerate() {
        if index >= 10000 { return Err("Backup folder exceeds the 10,000-entry scan limit; review it before editing.".into()); }
        let entry = entry.map_err(|e| format!("Could not inspect backup entry: {e}"))?;
        if entry.path().extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case("prproj")) {
            count += 1;
            bytes = bytes.saturating_add(entry.metadata().map_err(|e| format!("Could not inspect backup size: {e}"))?.len());
        }
    }
    if count >= MAX_BACKUP_FILES || bytes.saturating_add(before.len()) > MAX_BACKUP_BYTES {
        return Err("Backup retention limit reached (1,000 projects or 20 GiB). Review/archive old backups before editing; Shuvi has deleted nothing.".into());
    }
    let stem = source.file_stem().and_then(|v| v.to_str()).unwrap_or("PremiereProject");
    let checkpoint_id = Uuid::new_v4().simple().to_string();
    let backup = directory.join(format!("{stem}.shuvi-{timestamp_ms}-{checkpoint_id}.prproj"));
    let metadata_path = backup.with_extension("checkpoint.json");
    let mut output = OpenOptions::new().write(true).create_new(true).open(&backup)
        .map_err(|e| format!("Could not reserve checkpoint: {e}"))?;
    let mut metadata_created = false;
    let result = (|| -> Result<(), String> {
        let copied = std::io::copy(&mut (&mut input).take(before.len() + 1), &mut output)
            .map_err(|e| format!("Could not copy checkpoint: {e}"))?;
        output.sync_all().map_err(|e| format!("Could not flush checkpoint: {e}"))?;
        let after = fs::metadata(&source).map_err(|e| format!("Could not recheck project: {e}"))?;
        if copied != before.len() || after.len() != before.len() || before.modified().ok() != after.modified().ok() {
            return Err("Project changed while being backed up; no edit was sent. Save and retry.".into());
        }
        let metadata = serde_json::to_vec_pretty(&json!({
            "schema_version": 1, "checkpoint_id": checkpoint_id, "created_at_ms": timestamp_ms,
            "source_path": source, "backup_path": backup, "bytes": copied,
            "retention": "manual_archive_no_automatic_deletion"
        })).map_err(|e| format!("Could not serialize checkpoint metadata: {e}"))?;
        let mut file = OpenOptions::new().write(true).create_new(true).open(&metadata_path)
            .map_err(|e| format!("Could not reserve checkpoint metadata: {e}"))?;
        metadata_created = true;
        file.write_all(&metadata).and_then(|_| file.sync_all())
            .map_err(|e| format!("Could not persist checkpoint metadata: {e}"))?;
        Ok(())
    })();
    drop(output);
    if let Err(error) = result {
        // Remove only the new incomplete copy, never an existing checkpoint.
        let _ = fs::remove_file(&backup);
        if metadata_created { let _ = fs::remove_file(&metadata_path); }
        return Err(error);
    }
    Ok(backup.display().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Fixture(std::path::PathBuf);
    impl Fixture {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("shuvi-checkpoint-test-{}", Uuid::new_v4()));
            fs::create_dir(&path).unwrap(); Self(path)
        }
    }
    impl Drop for Fixture { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); } }
    #[test]
    fn copies_without_overwriting_and_records_metadata() {
        let fixture = Fixture::new();
        let source = fixture.0.join("demo.prproj");
        fs::write(&source, b"project fixture").unwrap();
        let first = create_checkpoint(&source, 123).unwrap();
        let second = create_checkpoint(&source, 123).unwrap();
        assert_ne!(first, second);
        assert_eq!(fs::read(&first).unwrap(), b"project fixture");
        assert!(Path::new(&first).with_extension("checkpoint.json").is_file());
        assert_eq!(fs::read(&source).unwrap(), b"project fixture");
    }
    #[test]
    fn refuses_missing_empty_relative_and_non_project_sources() {
        let fixture = Fixture::new();
        let empty = fixture.0.join("empty.prproj");
        fs::write(&empty, []).unwrap();
        assert!(create_checkpoint(&empty, 1).is_err());
        assert!(create_checkpoint(&fixture.0.join("missing.prproj"), 1).is_err());
        assert!(create_checkpoint(Path::new("relative.prproj"), 1).is_err());
        let media = fixture.0.join("video.mp4");
        fs::write(&media, b"media").unwrap();
        assert!(create_checkpoint(&media, 1).is_err());
    }
    #[test]
    fn retention_limit_preserves_existing_backups() {
        let fixture = Fixture::new();
        let source = fixture.0.join("demo.prproj");
        fs::write(&source, b"project").unwrap();
        let directory = fixture.0.join("Shuvi Backups");
        fs::create_dir(&directory).unwrap();
        for index in 0..MAX_BACKUP_FILES {
            fs::write(directory.join(format!("old-{index}.prproj")), b"old").unwrap();
        }
        assert!(create_checkpoint(&source, 1).unwrap_err().contains("retention limit"));
        assert_eq!(fs::read_dir(directory).unwrap().count(), MAX_BACKUP_FILES);
    }
}
