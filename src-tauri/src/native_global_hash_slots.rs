//! Two read-only 64 KiB SHA streaming threads across ALL Shuvi processes.
//! Kernel-backed per-user slots only; no subprocess, app command or approval.
use std::{fs::{self,File,OpenOptions},path::Path};

pub(super) struct HashSlot(File);
const SLOTS:usize=2;

impl HashSlot{
    fn verify_dir(dir:&Path)->Result<(),String>{
        let meta=fs::symlink_metadata(dir)
            .map_err(|_|"Global background worker directory unavailable.".to_string())?;
        if !meta.is_dir()||meta.file_type().is_symlink(){
            return Err("Global hash worker directory redirected.".into());
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            if meta.file_attributes()&0x400!=0{
                return Err("Global worker directory is a reparse point.".into());
            }
        }
        Ok(())
    }
    fn attempt(path:&Path)->Result<Option<File>,String>{
        match fs::symlink_metadata(path){
            Ok(meta) if meta.is_file()&&!meta.file_type().is_symlink()=>{
                #[cfg(windows)]
                {
                    use std::os::windows::fs::MetadataExt;
                    if meta.file_attributes()&0x400!=0{
                        return Err("Global hash slot is a reparse point.".into());
                    }
                }
            }
            Ok(_)=>return Err("Global hash slot is not an ordinary file.".into()),
            Err(e) if e.kind()==std::io::ErrorKind::NotFound=>{},
            Err(_)=>return Err("Global hash slot metadata inaccessible.".into()),
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::{MetadataExt,OpenOptionsExt};
            const OPEN_REPARSE_POINT:u32=0x0020_0000;
            let opened=OpenOptions::new().read(true).write(true).create(true)
                .share_mode(0).custom_flags(OPEN_REPARSE_POINT).open(path);
            let file=match opened{Ok(f)=>f,Err(_)=>return Ok(None)};
            let meta=file.metadata().map_err(|_|"Global hash slot handle unavailable.")?;
            if !meta.is_file()||meta.file_attributes()&0x400!=0{
                return Err("Global hash slot opened redirected content.".into());
            }
            return Ok(Some(file));
        }
        #[cfg(unix)]
        {
            use std::os::fd::AsRawFd;
            unsafe extern "C"{fn flock(fd:i32,operation:i32)->i32;}
            let file=OpenOptions::new().read(true).write(true).create(true)
                .open(path).map_err(|_|"Cannot open global hash slot.".to_string())?;
            let meta=fs::symlink_metadata(path)
                .map_err(|_|"Global hash slot path disappeared.".to_string())?;
            if !meta.is_file()||meta.file_type().is_symlink(){
                return Err("Global hash slot was redirected.".into());
            }
            if unsafe{flock(file.as_raw_fd(),2|4)}!=0{return Ok(None);}
            return Ok(Some(file));
        }
        #[cfg(not(any(windows,unix)))]
        {
            Err("Global SHA worker slots are unsupported on this OS.".into())
        }
    }
    pub(super) fn take(dir:&Path)->Result<Self,String>{
        Self::verify_dir(dir)?;
        for i in 0..SLOTS{
            let path=dir.join(format!("native-background-hash-slot-{i}.oslock"));
            if let Some(file)=Self::attempt(&path)?{return Ok(Self(file));}
        }
        Err("Both read-only background hash slots busy; no delivery receipt committed.".into())
    }
}
#[cfg(test)]
mod tests{
    use super::*;
    fn directory()->std::path::PathBuf{
        let p=std::env::temp_dir().join(format!("shuvi-global-hash-{}",uuid::Uuid::new_v4()));
        fs::create_dir_all(&p).unwrap();p
    }
    #[test]
    fn real_kernel_handles_reject_a_third_hash_worker_and_recover_after_drop(){
        let d=directory();
        let first=HashSlot::take(&d).unwrap();
        let second=HashSlot::take(&d).unwrap();
        assert!(HashSlot::take(&d).is_err());
        drop(first);
        let recovered=HashSlot::take(&d).unwrap();
        assert!(HashSlot::take(&d).is_err());
        drop(recovered);drop(second);
        assert!(HashSlot::take(&d).is_ok());
        fs::remove_dir_all(d).unwrap();
    }
    #[test]
    fn forged_lock_directory_fails_closed_instead_of_using_unrestricted_slot(){
        let d=directory();
        let target=d.join("native-background-hash-slot-0.oslock");
        fs::create_dir(&target).unwrap();
        assert!(HashSlot::take(&d).is_err());
        fs::remove_dir(&target).unwrap();
        assert!(HashSlot::take(&d).is_ok());
        fs::remove_dir_all(d).unwrap();
    }
    #[test]
    fn concurrent_threads_respect_two_global_worker_slots(){
        use std::sync::{Arc,Barrier};
        let d=directory();let barrier=Arc::new(Barrier::new(3));
        std::thread::scope(|scope|{
            let handles=(0..2).map(|_|{
                let sync=Arc::clone(&barrier);let dir=&d;
                scope.spawn(move||{
                    let _slot=HashSlot::take(dir).unwrap();
                    sync.wait();sync.wait();
                })
            }).collect::<Vec<_>>();
            barrier.wait();
            assert!(HashSlot::take(&d).is_err());
            barrier.wait();
            for handle in handles{handle.join().unwrap();}
        });
        assert!(HashSlot::take(&d).is_ok());
        fs::remove_dir_all(d).unwrap();
    }
}
