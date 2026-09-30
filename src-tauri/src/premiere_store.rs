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

#[cfg(test)]mod tests{
    use super::*;
    fn valid(bytes:&[u8])->Result<(),String>{
        let value:serde_json::Value=serde_json::from_slice(bytes).map_err(|e|e.to_string())?;
        if !value.is_object(){return Err("Object required".into());}Ok(())
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
