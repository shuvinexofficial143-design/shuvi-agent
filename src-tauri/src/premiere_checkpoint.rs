use std::{fs::{self, File, OpenOptions}, io::{Read, Write}, path::Path};
use serde_json::json;
use uuid::Uuid;

const MAX_PROJECT_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const MAX_BACKUP_FILES: usize = 1000;
const MAX_BACKUP_BYTES: u64 = 20 * 1024 * 1024 * 1024;
const FNV_OFFSET: u64 = 0xcbf29ce484222325;
const FNV_PRIME: u64 = 0x100000001b3;

fn fingerprint_reader<R: Read>(reader: &mut R, limit: u64) -> Result<(u64,u64),String> {
    let mut total=0_u64;
    let mut hash=FNV_OFFSET;
    let mut buffer=[0_u8;64*1024];
    loop {
        let remaining=limit.saturating_sub(total);
        if remaining==0 {break;}
        let size=buffer.len().min(remaining as usize);
        let read=reader.read(&mut buffer[..size]).map_err(|e|format!("Could not read checkpoint bytes: {e}"))?;
        if read==0 {break;}
        total=total.saturating_add(read as u64);
        for byte in &buffer[..read] {
            hash^=*byte as u64;
            hash=hash.wrapping_mul(FNV_PRIME);
        }
    }
    Ok((total,hash))
}

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
        let mut copied=0_u64;
        let mut fingerprint=FNV_OFFSET;
        let mut buffer=[0_u8;64*1024];
        let mut limited=(&mut input).take(before.len()+1);
        loop {
            let read=limited.read(&mut buffer).map_err(|e|format!("Could not copy checkpoint: {e}"))?;
            if read==0 {break;}
            output.write_all(&buffer[..read]).map_err(|e|format!("Could not copy checkpoint: {e}"))?;
            copied=copied.saturating_add(read as u64);
            for byte in &buffer[..read] {
                fingerprint^=*byte as u64;
                fingerprint=fingerprint.wrapping_mul(FNV_PRIME);
            }
        }
        output.sync_all().map_err(|e| format!("Could not flush checkpoint: {e}"))?;
        let after = fs::metadata(&source).map_err(|e| format!("Could not recheck project: {e}"))?;
        if copied != before.len() || after.len() != before.len() || before.modified().ok() != after.modified().ok() {
            return Err("Project changed while being backed up; no edit was sent. Save and retry.".into());
        }
        let metadata = serde_json::to_vec_pretty(&json!({
            "schema_version": 2, "checkpoint_id": checkpoint_id, "created_at_ms": timestamp_ms,
            "source_path": source, "backup_path": backup, "bytes": copied,
            "content_fingerprint_fnv1a64": format!("{fingerprint:016x}"),
            "fingerprint_scope": "accidental_corruption_detection_not_cryptographic_authentication",
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

pub fn verify_checkpoint(checkpoint:&Path,expected_source:&Path)->Result<serde_json::Value,String>{
    if !checkpoint.is_absolute() || !expected_source.is_absolute()
        || !checkpoint.extension().and_then(|e|e.to_str()).is_some_and(|e|e.eq_ignore_ascii_case("prproj"))
        || !expected_source.extension().and_then(|e|e.to_str()).is_some_and(|e|e.eq_ignore_ascii_case("prproj")) {
        return Err("Checkpoint verification requires absolute .prproj paths.".into());
    }
    let checkpoint=fs::canonicalize(checkpoint).map_err(|e|format!("Checkpoint is unavailable: {e}"))?;
    let source=fs::canonicalize(expected_source).map_err(|e|format!("Original project is unavailable: {e}"))?;
    if checkpoint==source {return Err("Checkpoint must be a distinct project copy.".into());}
    let directory=checkpoint.parent().ok_or("Checkpoint has no parent directory.")?;
    if directory.file_name().and_then(|v|v.to_str())!=Some("Shuvi Backups")
        || directory.parent()!=source.parent() {
        return Err("Checkpoint is not in the expected sibling Shuvi Backups folder.".into());
    }
    let metadata_path=checkpoint.with_extension("checkpoint.json");
    let raw=fs::read(&metadata_path).map_err(|e|format!("Checkpoint metadata is unavailable: {e}"))?;
    if raw.len()>16*1024 {return Err("Checkpoint metadata exceeds limit.".into());}
    let metadata:serde_json::Value=serde_json::from_slice(&raw).map_err(|e|format!("Invalid checkpoint metadata: {e}"))?;
    if metadata.get("schema_version").and_then(serde_json::Value::as_u64)!=Some(2) {
        return Err("Checkpoint predates recovery-verifiable fingerprint metadata.".into());
    }
    let source_path=metadata.get("source_path").and_then(serde_json::Value::as_str).ok_or("Checkpoint source path missing.")?;
    let backup_path=metadata.get("backup_path").and_then(serde_json::Value::as_str).ok_or("Checkpoint backup path missing.")?;
    if fs::canonicalize(source_path).ok().as_deref()!=Some(source.as_path())
        || fs::canonicalize(backup_path).ok().as_deref()!=Some(checkpoint.as_path()) {
        return Err("Checkpoint metadata path binding changed.".into());
    }
    let info=fs::metadata(&checkpoint).map_err(|e|format!("Could not inspect checkpoint: {e}"))?;
    let expected_bytes=metadata.get("bytes").and_then(serde_json::Value::as_u64).ok_or("Checkpoint byte count missing.")?;
    if !info.is_file() || info.len()==0 || info.len()>MAX_PROJECT_BYTES || info.len()!=expected_bytes {
        return Err("Checkpoint size no longer matches its creation receipt.".into());
    }
    let expected_fingerprint=metadata.get("content_fingerprint_fnv1a64").and_then(serde_json::Value::as_str)
        .filter(|v|v.len()==16).ok_or("Checkpoint fingerprint missing.")?;
    let mut input=File::open(&checkpoint).map_err(|e|format!("Could not open checkpoint for verification: {e}"))?;
    let (read,fingerprint)=fingerprint_reader(&mut input,info.len().saturating_add(1))?;
    if read!=info.len() || format!("{fingerprint:016x}")!=expected_fingerprint {
        return Err("Checkpoint content fingerprint changed after creation.".into());
    }
    Ok(json!({
        "verified":true,
        "schema_version":2,
        "checkpoint_path":checkpoint,
        "source_path":source,
        "bytes":info.len(),
        "fingerprint":"fnv1a64",
        "cryptographic_authentication":false
    }))
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
    fn verifies_new_checkpoint_binding_and_fingerprint() {
        let fixture=Fixture::new();
        let source=fixture.0.join("demo.prproj");
        fs::write(&source,b"project fixture").unwrap();
        let checkpoint=create_checkpoint(&source,456).unwrap();
        let verified=verify_checkpoint(Path::new(&checkpoint),&source).unwrap();
        assert_eq!(verified["verified"],true);
        fs::write(&checkpoint,b"tampered").unwrap();
        assert!(verify_checkpoint(Path::new(&checkpoint),&source).is_err());
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
