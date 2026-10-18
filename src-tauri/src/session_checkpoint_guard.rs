//! Shuvi37 native checkpoint guard: one OS-level exclusive lock per app's
//! persisted checkpoint across Desktop processes. Std File::try_lock uses
//! LockFileEx on Windows; locks are released automatically on process death.
//! This is NOT a native action permission or owner-approved task transition.
use std::{fs,fs::OpenOptions,path::Path};
pub(crate) fn exclusive<T>(checkpoint:&Path,op:impl FnOnce()->Result<T,String>)->Result<T,String>{
    let lock=checkpoint.with_extension("json.lck");
    match fs::symlink_metadata(&lock){
        Ok(m) if !m.is_file()||m.file_type().is_symlink()=>
            return Err("Native checkpoint lock target is not a regular file.".into()),
        Ok(_)=>{},
        Err(e) if e.kind()==std::io::ErrorKind::NotFound=>{},
        Err(_)=>return Err("Cannot inspect native checkpoint lock.".into())
    }
    let handle=OpenOptions::new().create(true).read(true).write(true).open(&lock)
        .map_err(|_|"Native checkpoint cross-process lock unavailable.".to_string())?;
    if handle.metadata().map_err(|_|"Native lock metadata unavailable.")?.is_file()==false{
        return Err("Native checkpoint lock is not a file.".into());
    }
    handle.try_lock().map_err(|_|"Another Shuvi process is modifying the checkpoint; retry after owner inspection.".to_string())?;
    // The handle's Drop releases the OS lock even if op returns an error.
    let result=op();
    drop(handle);
    result
}
#[cfg(test)]
mod tests{
    use super::*;
    #[test]
    fn cross_handle_checkpoint_writer_cannot_enter_until_previous_owner_exits(){
        let dir=std::env::temp_dir().join(format!("shuvi-cas-{}",uuid::Uuid::new_v4()));
        fs::create_dir(&dir).unwrap();
        let target=dir.join("session-checkpoint.json");
        exclusive(&target,||{
            assert!(exclusive(&target,||Ok(())).is_err());
            Ok(())
        }).unwrap();
        exclusive(&target,||Ok(())).unwrap();
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn operation_failure_releases_os_lock_including_error_paths(){
        let dir=std::env::temp_dir().join(format!("shuvi-cas-{}",uuid::Uuid::new_v4()));
        fs::create_dir(&dir).unwrap();
        let target=dir.join("session-checkpoint.json");
        let outcome:Result<(),String>=exclusive(&target,||Err("refused revision".into()));
        assert!(outcome.is_err());
        exclusive(&target,||Ok(())).unwrap();
        fs::remove_dir_all(dir).unwrap();
    }
}
