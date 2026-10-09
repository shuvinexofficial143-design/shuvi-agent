//! Durable bounded snapshots. A stale temporary file is evidence to inspect, not overwrite.
use std::{fs, io::Write, path::Path, sync::Mutex};

static WRITES:Mutex<()>=Mutex::new(());

pub fn replace(path:&Path,bytes:&[u8],limit:usize,validate:impl Fn(&[u8])->Result<(),String>)->Result<(),String>{
    if bytes.len()>limit{return Err("Premiere snapshot exceeds its byte budget.".into());}
    validate(bytes)?;
    let _write=WRITES.lock().map_err(|_|"Premiere persistence lock unavailable.")?;
    let tmp=path.with_extension("json.tmp");let backup=path.with_extension("json.bak");
    let read_valid=|candidate:&Path|->Result<(),String>{
        let existing=crate::read_file_bytes_bounded(candidate,limit,"Premiere snapshot")?;
        validate(&existing)
    };
    let primary_present=path.try_exists().map_err(|e|e.to_string())?;
    let primary_valid=primary_present && read_valid(path).is_ok();
    let backup_present=backup.try_exists().map_err(|e|e.to_string())?;
    if !primary_valid && (primary_present || backup_present) {
        // Do not rotate corrupt primary bytes over the only last-good backup.
        read_valid(&backup).map_err(|_|"No valid Premiere snapshot to recover; preserve files for inspection.")?;
    }
    let mut file=fs::OpenOptions::new().write(true).create_new(true).open(&tmp)
        .map_err(|e|format!("Premiere temporary snapshot unavailable; inspect interrupted writes: {e}"))?;
    file.write_all(bytes).and_then(|_|file.flush()).and_then(|_|file.sync_all()).map_err(|e|e.to_string())?;
    drop(file);
    if primary_valid {
        if backup_present {fs::remove_file(&backup).map_err(|e|e.to_string())?;}
        fs::rename(path,&backup).map_err(|e|e.to_string())?;
    } else if primary_present {
        // The validated backup stays intact if publication fails or the process stops.
        fs::remove_file(path).map_err(|e|e.to_string())?;
    }
    fs::rename(&tmp,path).map_err(|e|format!("Premiere snapshot publication failed; recover the retained backup: {e}"))?;
    // Keep the last-good backup. Windows directory durability still needs host crash testing.
    Ok(())
}

/// Clear a snapshot and its recovery files under the SAME writer mutex as
/// replace(). A concurrent save must not resurrect or partially delete a
/// session after a clear request has been acknowledged.
pub fn clear_snapshot(path:&Path)->Result<(),String>{
    let _write=WRITES.lock().map_err(|_|"Snapshot persistence lock unavailable.")?;
    // Verify every candidate first; an invalid backup must not delete the primary.
    let mut verified=Vec::new();
    for candidate in [
        path.to_path_buf(),
        path.with_extension("json.tmp"),
        path.with_extension("json.bak")
    ]{
        match fs::symlink_metadata(&candidate){
            Err(e) if e.kind()==std::io::ErrorKind::NotFound=>continue,
            Err(e)=>return Err(format!("Cannot inspect snapshot for clear: {e}")),
            Ok(meta) if meta.is_file()&&!meta.file_type().is_symlink()=>{
                #[cfg(windows)]
                {
                    use std::os::windows::fs::MetadataExt;
                    if meta.file_attributes()&0x400!=0{
                        return Err("Refusing to clear Windows reparse snapshot.".into());
                    }
                }
                verified.push(candidate);
            }
            Ok(_)=>return Err("Refusing to clear non-regular snapshot path.".into()),
        }
    }
    for candidate in verified {
        fs::remove_file(&candidate)
            .map_err(|e|format!("Could not clear snapshot safely: {e}"))?;
    }
    Ok(())
}

#[cfg(test)]mod tests{
    use super::*;
    fn valid(bytes:&[u8])->Result<(),String>{
        let value:serde_json::Value=serde_json::from_slice(bytes).map_err(|e|e.to_string())?;
        if !value.is_object(){return Err("Object required".into());}Ok(())
    }
    #[test] fn clears_primary_temp_and_backup_idempotently(){
        let dir=std::env::temp_dir().join(format!("shuvi-snapshot-clear-{}",uuid::Uuid::new_v4()));
        fs::create_dir(&dir).unwrap();
        let path=dir.join("checkpoint.json");
        fs::write(&path,b"state").unwrap();
        fs::write(path.with_extension("json.tmp"),b"interrupted").unwrap();
        fs::write(path.with_extension("json.bak"),b"backup").unwrap();
        clear_snapshot(&path).unwrap();
        assert!(!path.exists());
        assert!(!path.with_extension("json.tmp").exists());
        assert!(!path.with_extension("json.bak").exists());
        clear_snapshot(&path).unwrap();
        fs::remove_dir_all(dir).unwrap();
    }
    #[test] fn bad_later_backup_never_deletes_valid_primary_or_temp(){
        let dir=std::env::temp_dir().join(format!("shuvi-clear-safety-{}",uuid::Uuid::new_v4()));
        fs::create_dir(&dir).unwrap();
        let file=dir.join("session.json");
        let temp=file.with_extension("json.tmp");
        let backup=file.with_extension("json.bak");
        fs::write(&file,b"keep-primary").unwrap();
        fs::write(&temp,b"keep-interrupted").unwrap();
        fs::create_dir(&backup).unwrap();
        assert!(clear_snapshot(&file).is_err());
        assert_eq!(fs::read(&file).unwrap(),b"keep-primary");
        assert_eq!(fs::read(&temp).unwrap(),b"keep-interrupted");
        fs::remove_dir_all(dir).unwrap();
    }
    #[test] fn refuses_to_delete_directory_named_as_checkpoint(){
        let dir=std::env::temp_dir().join(format!("shuvi-snapshot-clear-{}",uuid::Uuid::new_v4()));
        fs::create_dir(&dir).unwrap();
        let path=dir.join("checkpoint.json");
        fs::create_dir(&path).unwrap();
        assert!(clear_snapshot(&path).is_err());
        assert!(path.is_dir());
        fs::remove_dir_all(dir).unwrap();
    }
    #[cfg(unix)]
    #[test] fn refuses_to_delete_symlink_as_checkpoint(){
        use std::os::unix::fs::symlink;
        let dir=std::env::temp_dir().join(format!("shuvi-snapshot-clear-{}",uuid::Uuid::new_v4()));
        fs::create_dir(&dir).unwrap();
        let original=dir.join("protected.txt");
        fs::write(&original,b"protected").unwrap();
        let link=dir.join("checkpoint.json");
        symlink(&original,&link).unwrap();
        assert!(clear_snapshot(&link).is_err());
        assert_eq!(fs::read(&original).unwrap(),b"protected");
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]fn preserves_valid_backup_when_primary_is_corrupt_and_refuses_stale_tmp(){
        let dir=std::env::temp_dir().join(format!("shuvi-store-{}",uuid::Uuid::new_v4()));fs::create_dir_all(&dir).unwrap();
        let path=dir.join("state.json");let backup=path.with_extension("json.bak");let tmp=path.with_extension("json.tmp");
        replace(&path,b"{\"v\":1}",64,valid).unwrap();
        replace(&path,b"{\"v\":2}",64,valid).unwrap();
        assert_eq!(fs::read(&backup).unwrap(),b"{\"v\":1}");
        fs::write(&path,b"bad").unwrap();
        replace(&path,b"{\"v\":3}",64,valid).unwrap();
        assert_eq!(fs::read(&backup).unwrap(),b"{\"v\":1}");
        fs::write(&tmp,b"interrupted").unwrap();
        assert!(replace(&path,b"{}",64,valid).is_err());
        assert_eq!(fs::read(&tmp).unwrap(),b"interrupted");
        fs::remove_file(&tmp).unwrap();fs::write(&path,b"bad").unwrap();fs::write(&backup,b"bad").unwrap();
        assert!(replace(&path,b"{}",64,valid).is_err());
        assert!(!tmp.exists());
        fs::remove_file(path).unwrap();fs::remove_file(backup).unwrap();fs::remove_dir(dir).unwrap();
    }
}
