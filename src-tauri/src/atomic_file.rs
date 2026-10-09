//! Transactional replacement for approved local text edits (A10).
//! No mutation occurs until the complete staged file is flushed to disk.
//! A unique same-directory backup preserves the previous bytes for recovery.
//! This is a *local* safeguard, not a protection against an actively malicious
//! same-user process racing the destination path.
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
};
use uuid::Uuid;

fn is_link_or_reparse(metadata:&std::fs::Metadata)->bool{
    if metadata.file_type().is_symlink(){return true;}
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT:u32=0x400;
        if metadata.file_attributes()&FILE_ATTRIBUTE_REPARSE_POINT!=0{return true;}
    }
    false
}
fn ensure_real_directory_ancestors(parent:&Path)->Result<(),String>{
    for ancestor in parent.ancestors(){
        if ancestor.as_os_str().is_empty(){continue;}
        let metadata=fs::symlink_metadata(ancestor)
            .map_err(|error|format!("Could not inspect file directory ancestor: {error}"))?;
        if !metadata.is_dir()||is_link_or_reparse(&metadata){
            return Err("File directory path contains a non-directory, link or reparse point.".into());
        }
    }
    Ok(())
}

fn source_fingerprint(path: &Path, label: &str) -> Result<([u8; 32], u64), String> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| format!("Could not inspect {label} target: {error}"))?;
    if is_link_or_reparse(&metadata) || !metadata.is_file() {
        return Err(format!("{label} target must be a regular non-link file."));
    }
    let mut opened = File::open(path)
        .map_err(|error| format!("Could not read {label} target for verification: {error}"))?;
    if !opened.metadata().map_err(|error| error.to_string())?.is_file() {
        return Err(format!("{label} target is not a regular file."));
    }
    let mut hash = Sha256::new();
    let mut len = 0u64;
    let mut buffer = [0u8; 32 * 1024];
    loop {
        let n = opened.read(&mut buffer)
            .map_err(|error| format!("Could not verify {label} target bytes: {error}"))?;
        if n == 0 { break; }
        len = len.checked_add(n as u64)
            .ok_or_else(|| format!("{label} target size overflow."))?;
        hash.update(&buffer[..n]);
    }
    Ok((hash.finalize().into(), len))
}

fn private_sibling(parent: &Path, kind: &str) -> PathBuf {
    parent.join(format!(".shuvi-{kind}-{}", Uuid::new_v4().simple()))
}

fn publish_replacement(target: &Path, staged: &Path, backup: &Path) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::{ffi::OsStr, os::windows::ffi::OsStrExt, ptr};
        #[link(name = "kernel32")]
        extern "system" {
            fn ReplaceFileW(
                replaced_file_name: *const u16,
                replacement_file_name: *const u16,
                backup_file_name: *const u16,
                flags: u32,
                exclude: *mut std::ffi::c_void,
                reserved: *mut std::ffi::c_void,
            ) -> i32;
        }
        let wide = |value: &OsStr| value.encode_wide().chain(Some(0)).collect::<Vec<u16>>();
        let target_name = wide(target.as_os_str());
        let staged_name = wide(staged.as_os_str());
        let backup_name = wide(backup.as_os_str());
        let success = unsafe {
            ReplaceFileW(target_name.as_ptr(), staged_name.as_ptr(), backup_name.as_ptr(),
                0, ptr::null_mut(), ptr::null_mut())
        };
        if success == 0 {
            return Err(format!(
                "Windows failed to atomically replace file: {}. Check target and backup before retrying.",
                std::io::Error::last_os_error()
            ));
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        // The hard link retains the previous inode before rename replaces the
        // destination atomically on same-volume POSIX filesystems.
        fs::hard_link(target, backup)
            .map_err(|error| format!("Could not preserve {target:?} backup: {error}"))?;
        fs::rename(staged, target)
            .map_err(|error| format!("Could not publish staged file: {error}"))
    }
}

fn replace_impl(
    target: &Path,
    replacement: &[u8],
    expected_original: Option<&[u8]>,
    label: &str,
    fail_before_publish: bool,
) -> Result<PathBuf, String> {
    let parent = target.parent().ok_or_else(|| format!("{label} has no parent directory."))?;
    // Refuse parent-directory symlinks, including junction-like Windows links.
    // We intentionally do not traverse or auto-create any directory here.
    ensure_real_directory_ancestors(parent)?;
    let before = source_fingerprint(target, label)?;
    if let Some(expected) = expected_original {
        let expected_hash: [u8; 32] = Sha256::digest(expected).into();
        if before != (expected_hash, expected.len() as u64) {
            return Err(format!("{label} changed since inspection; refusing to overwrite."));
        }
    }
    let stage = private_sibling(parent, "stage");
    let backup = private_sibling(parent, "backup");
    let mut publication_attempted=false;
    let result = (|| {
        let mut file = OpenOptions::new().write(true).create_new(true).open(&stage)
            .map_err(|error| format!("Could not create staged replacement: {error}"))?;
        file.write_all(replacement)
            .map_err(|error| format!("Could not write staged replacement: {error}"))?;
        file.sync_all()
            .map_err(|error| format!("Could not flush staged replacement: {error}"))?;
        drop(file);
        ensure_real_directory_ancestors(parent)?;
        if source_fingerprint(target, label)? != before {
            return Err(format!("{label} changed while replacement was staged; refusing to overwrite."));
        }
        if fail_before_publish {
            return Err("Injected pre-publish failure; original file must survive.".into());
        }
        publication_attempted=true;
        publish_replacement(target, &stage, &backup)?;
        // The OS reporting a completed replacement is not sufficient evidence:
        // verify both the new bytes and recoverability of the exact old bytes.
        // Any mismatch is an *uncertain external mutation*; never auto-retry.
        let expected_new:([u8;32],u64)=(Sha256::digest(replacement).into(),replacement.len() as u64);
        let actual_new=source_fingerprint(target,label)?;
        let actual_backup=source_fingerprint(&backup,"replacement backup")?;
        if actual_new!=expected_new || actual_backup!=before {
            return Err("Published replacement or recovery backup did not match the verified bytes.".into());
        }
        Ok(backup.clone())
    })();
    // A failed OS publication may be partial. Keep staged and backup evidence
    // so the user can inspect/recover instead of destroying remaining bytes.
    if !publication_attempted || result.is_ok(){
        let _=fs::remove_file(&stage);
    }
    result.map_err(|error|{
        if publication_attempted{
            format!("{error} Replacement attempt had an uncertain outcome; inspect target {target:?}, staged {stage:?} and backup {backup:?} before retrying.")
        }else{error}
    })
}

/// Create a new file without ever exposing partially written bytes.
/// A same-directory hard link publishes an already-fsynced staging file
/// without replacing any concurrent existing target.
fn create_new_impl(target:&Path,contents:&[u8],label:&str,fail_before_publish:bool)->Result<(),String>{
    let parent=target.parent().ok_or_else(||format!("{label} path has no parent directory."))?;
    ensure_real_directory_ancestors(parent)?;
    let stage=private_sibling(parent,"create-stage");
    let mut published=false;
    let result=(||{
        let mut file=OpenOptions::new().write(true).create_new(true).open(&stage)
            .map_err(|error|format!("Could not stage new {label}: {error}"))?;
        file.write_all(contents).map_err(|error|format!("Could not write staged {label}: {error}"))?;
        file.sync_all().map_err(|error|format!("Could not flush staged {label}: {error}"))?;
        drop(file);
        ensure_real_directory_ancestors(parent)?;
        match fs::symlink_metadata(target){
            Err(error) if error.kind()==std::io::ErrorKind::NotFound=>{},
            Ok(_)=>return Err(format!("{label} already exists; refusing to overwrite new-file target.")),
            Err(error)=>return Err(format!("Cannot inspect {label} target before publication: {error}")),
        }
        if fail_before_publish{return Err("Injected new-file pre-publish failure; no target must exist.".into());}
        // Hard-link creation is atomic and refuses an existing destination.
        // Rename could silently overwrite a concurrent file on POSIX, so it
        // must NOT be used here. Both paths are on the same filesystem.
        fs::hard_link(&stage,target)
            .map_err(|error|format!("Could not publish complete new {label} atomically: {error}"))?;
        published=true;
        let expected:([u8;32],u64)=(Sha256::digest(contents).into(),contents.len() as u64);
        if source_fingerprint(target,label)?!=expected{
            return Err("Newly published file bytes differ from staged bytes.".into());
        }
        Ok(())
    })();
    // Preserve the staged, fully-flushed bytes if the observed post-publish
    // state differs. No silent retry or automatic rollback after publication.
    if !published || result.is_ok(){let _=fs::remove_file(&stage);}
    result.map_err(|error|if published{
        format!("{error} New file publication outcome is uncertain; inspect {target:?} and staged recovery {stage:?} before retrying.")
    }else{error})
}

pub(crate) fn create_new_verified(target:&Path,contents:&[u8],label:&str)->Result<(),String>{
    create_new_impl(target,contents,label,false)
}

/// Existing regular file only: no creation, no in-place truncation.
/// On success caller receives a recoverable backup path.
pub(crate) fn replace_existing(
    target: &Path,
    replacement: &[u8],
    expected_original: Option<&[u8]>,
    label: &str,
) -> Result<PathBuf, String> {
    replace_impl(target, replacement, expected_original, label, false)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> (PathBuf, PathBuf) {
        let parent = std::env::temp_dir().join(format!("shuvi-atomic-{}",Uuid::new_v4().simple()));
        fs::create_dir(&parent).expect("create test directory");
        let target = parent.join("note.txt");
        fs::write(&target,b"original content").expect("create initial content");
        (parent, target)
    }
    #[test]
    fn new_file_is_published_only_after_complete_binary_write(){
        let (dir,_) = fixture();
        let target=dir.join("new-binary.dat");
        let contents=[0_u8,255,14,10,6,0,1];
        create_new_verified(&target,&contents,"new fixture").unwrap();
        assert_eq!(fs::read(&target).unwrap(),contents.to_vec());
        assert_eq!(fs::read_dir(&dir).unwrap().count(),2,"no temporary stage after publish");
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn new_file_injected_failure_never_publishes_partial_target(){
        let (dir,_) = fixture();
        let target=dir.join("absent.txt");
        assert!(create_new_impl(&target,b"complete bytes","new fixture",true).is_err());
        assert!(!target.exists());
        assert_eq!(fs::read_dir(&dir).unwrap().count(),1,"incomplete stage must be cleaned");
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn new_file_refuses_to_overwrite_concurrent_existing_target(){
        let (dir,_) = fixture();
        let target=dir.join("already-here.txt");
        fs::write(&target,b"not replaceable").unwrap();
        assert!(create_new_verified(&target,b"unexpected bytes","new fixture").is_err());
        assert_eq!(fs::read(&target).unwrap(),b"not replaceable");
        fs::remove_dir_all(dir).unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn new_file_rejects_symlinked_ancestor(){
        use std::os::unix::fs::symlink;
        let (dir,_) = fixture();
        let real=dir.join("real");
        fs::create_dir(&real).unwrap();
        symlink(&real,dir.join("alias")).unwrap();
        assert!(create_new_verified(&dir.join("alias").join("bad.txt"),b"new data","test").is_err());
        assert!(!real.join("bad.txt").exists());
        fs::remove_dir_all(dir).unwrap();
    }
    #[cfg(windows)]
    #[test]
    fn new_file_rejects_windows_junction_ancestor(){
        use std::process::Command;
        let (dir,_) = fixture();
        let real=dir.join("real");
        fs::create_dir(&real).unwrap();
        let alias=dir.join("alias");
        let created=Command::new("cmd").args(["/C","mklink","/J"]).arg(&alias).arg(&real).output().unwrap();
        assert!(created.status.success(),"junction fixture failed: {}",String::from_utf8_lossy(&created.stderr));
        assert!(create_new_verified(&alias.join("bad.txt"),b"new data","test").is_err());
        assert!(!real.join("bad.txt").exists());
        fs::remove_dir(&alias).unwrap();
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn pre_publish_failure_preserves_existing_file() {
        let (dir,target)=fixture();
        assert!(replace_impl(&target,b"new bytes",Some(b"original content"),"test",true).is_err());
        assert_eq!(fs::read(&target).unwrap(),b"original content");
        assert_eq!(fs::read_dir(&dir).unwrap().count(),1,"staged file must be cleaned");
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn stale_expected_contents_are_rejected_without_mutation() {
        let (dir,target)=fixture();
        assert!(replace_existing(&target,b"new bytes",Some(b"outdated"),"test").is_err());
        assert_eq!(fs::read(&target).unwrap(),b"original content");
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn full_replacement_retains_recoverable_previous_bytes() {
        let (dir,target)=fixture();
        let backup=replace_existing(&target,b"new bytes",Some(b"original content"),"test").unwrap();
        assert_eq!(fs::read(&target).unwrap(),b"new bytes");
        assert_eq!(fs::read(&backup).unwrap(),b"original content");
        fs::remove_dir_all(dir).unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn intermediate_symlink_directory_is_rejected(){
        use std::os::unix::fs::symlink;
        let (dir,target)=fixture();
        let real=dir.join("real").join("nested");
        fs::create_dir_all(&real).unwrap();
        fs::copy(&target,real.join("note.txt")).unwrap();
        symlink(dir.join("real"),dir.join("alias")).unwrap();
        let nested=dir.join("alias").join("nested").join("note.txt");
        assert!(replace_existing(&nested,b"new bytes",None,"test").is_err());
        assert_eq!(fs::read(real.join("note.txt")).unwrap(),b"original content");
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn refuses_to_create_missing_target_or_overwrite_a_directory(){
        let (dir,target)=fixture();
        let missing=dir.join("absent.txt");
        assert!(replace_existing(&missing,b"new bytes",None,"test").is_err());
        assert!(!missing.exists());
        assert!(replace_existing(&dir,b"new bytes",None,"test").is_err());
        assert_eq!(fs::read(&target).unwrap(),b"original content");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn binary_exact_byte_recovery_after_success(){
        let (dir,target)=fixture();
        let before=[0_u8,1,255,13,10,42];
        let next=[10_u8,0,99,255,99];
        fs::write(&target,&before).unwrap();
        let backup=replace_existing(&target,&next,Some(&before),"test").unwrap();
        assert_eq!(fs::read(&target).unwrap(),next.to_vec());
        assert_eq!(fs::read(&backup).unwrap(),before.to_vec());
        assert_ne!(backup,target);
        assert_eq!(fs::read_dir(&dir).unwrap().count(),2);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn original_is_not_changed_on_empty_replacement_failure_injection(){
        let (dir,target)=fixture();
        assert!(replace_impl(&target,b"",Some(b"original content"),"test",true).is_err());
        assert_eq!(fs::read(&target).unwrap(),b"original content");
        assert_eq!(fs::read_dir(&dir).unwrap().count(),1);
        fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn symlink_target_is_rejected_without_overwriting_destination(){
        use std::os::unix::fs::symlink;
        let (dir,target)=fixture();
        let alias=dir.join("linked-note.txt");
        symlink(&target,&alias).unwrap();
        assert!(replace_existing(&alias,b"bad bytes",None,"test").is_err());
        assert_eq!(fs::read(&target).unwrap(),b"original content");
        fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn windows_junction_in_ancestor_is_refused(){
        // Junction creation needs no admin privileges on most Windows CI
        // environments; if this host forbids it, test Windows metadata
        // flag detection separately rather than treating junction test as pass.
        use std::process::Command;
        let (dir,target)=fixture();
        let real=dir.join("real").join("nested");
        fs::create_dir_all(&real).unwrap();
        fs::copy(&target,real.join("note.txt")).unwrap();
        let alias=dir.join("linked");
        let result=Command::new("cmd").args(["/C","mklink","/J"])
            .arg(&alias).arg(dir.join("real")).output().unwrap();
        assert!(result.status.success(),"Windows junction fixture creation failed: {}",String::from_utf8_lossy(&result.stderr));
        assert!(replace_existing(&alias.join("nested").join("note.txt"),b"bad bytes",None,"test").is_err());
        assert_eq!(fs::read(real.join("note.txt")).unwrap(),b"original content");
        fs::remove_dir(&alias).unwrap();
        fs::remove_dir_all(dir).unwrap();
    }

}