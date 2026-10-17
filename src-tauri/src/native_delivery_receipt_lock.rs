//! OS-exclusive last native delivery receipt protection across Shuvi instances.
//! Used ONLY by internal trusted Rust finalization/readback; no GUI action.
use std::{fs::{self,File,OpenOptions},path::Path};
pub(super) struct DeliveryReceiptOsLock(File);
impl DeliveryReceiptOsLock{
    pub(super) fn take(receipt:&Path)->Result<Self,String>{
        let lock=receipt.with_extension("json.oslock");
        match fs::symlink_metadata(&lock){
            Ok(meta) if meta.is_file()&&!meta.file_type().is_symlink()=>{
                #[cfg(windows)]
                {
                    use std::os::windows::fs::MetadataExt;
                    if meta.file_attributes()&0x400!=0{
                        return Err("Delivery lock may not be a Windows reparse point.".into());
                    }
                }
            },
            Ok(_)=>return Err("Delivery lock must be an ordinary file.".into()),
            Err(e) if e.kind()==std::io::ErrorKind::NotFound=>{},
            Err(_)=>return Err("Delivery lock metadata cannot be inspected.".into()),
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::{MetadataExt,OpenOptionsExt};
            const OPEN_REPARSE_POINT:u32=0x0020_0000;
            let file=OpenOptions::new().read(true).write(true).create(true)
                .share_mode(0).custom_flags(OPEN_REPARSE_POINT)
                .open(&lock)
                .map_err(|_|"Another Shuvi instance owns final delivery verification.".to_string())?;
            let meta=file.metadata().map_err(|_|"Delivery lock handle inaccessible.")?;
            if !meta.is_file()||meta.file_attributes()&0x400!=0{
                return Err("Delivery lock handle points to redirected data.".into());
            }
            return Ok(Self(file));
        }
        #[cfg(unix)]
        {
            use std::os::fd::AsRawFd;
            unsafe extern "C"{fn flock(fd:i32,operation:i32)->i32;}
            let file=OpenOptions::new().read(true).write(true).create(true)
                .open(&lock)
                .map_err(|_|"Cannot open final delivery lock.".to_string())?;
            if unsafe{flock(file.as_raw_fd(),2|4)}!=0{
                return Err("Another Shuvi instance owns final delivery verification.".into());
            }
            return Ok(Self(file));
        }
        #[cfg(not(any(unix,windows)))]
        {
            Err("OS-exclusive final delivery synchronization unavailable.".into())
        }
    }
}
#[cfg(test)]
mod tests{
    use super::*;
    fn dir()->std::path::PathBuf{
        let root=std::env::temp_dir().join(format!("shuvi-last-delivery-{}",uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();root
    }
    #[test]
    fn independently_held_kernel_receipt_lock_denies_second_instance(){
        let root=dir();let path=root.join("delivery.json");
        let one=DeliveryReceiptOsLock::take(&path).unwrap();
        assert!(DeliveryReceiptOsLock::take(&path).is_err());
        drop(one);
        assert!(DeliveryReceiptOsLock::take(&path).is_ok());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn forged_directory_at_receipt_lock_path_is_not_silently_bypassed(){
        let root=dir();let path=root.join("delivery.json");
        let fake=path.with_extension("json.oslock");
        fs::create_dir(&fake).unwrap();
        assert!(DeliveryReceiptOsLock::take(&path).is_err());
        fs::remove_dir(fake).unwrap();
        assert!(DeliveryReceiptOsLock::take(&path).is_ok());
        fs::remove_dir_all(root).unwrap();
    }
}
