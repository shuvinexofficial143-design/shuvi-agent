//! Fail-closed native execution ownership for Shuvi desktop commands.
//! A09: intra-process atomic ownership PLUS Windows user-session shared
//! file-handle exclusion, so two Shuvi application instances cannot drive
//! the same desktop concurrently. No browser-side worker constant is trusted.
use std::sync::atomic::{AtomicBool,Ordering};

#[cfg(windows)]
use std::{fs::{self,File,OpenOptions},path::PathBuf,os::windows::fs::OpenOptionsExt};

// FILE_FLAG_OPEN_REPARSE_POINT: opening a lock must never follow a swapped
// final-component Windows symlink. Verify the opened handle again afterward.
#[cfg(windows)]
const OPEN_REPARSE_POINT:u32=0x0020_0000;

pub(crate) struct NativeExecutionLease<'a>{
    active:&'a AtomicBool,
    #[cfg(windows)]
    cross_process:Option<File>,
}
impl Drop for NativeExecutionLease<'_>{
    fn drop(&mut self){
        // Windows release must happen BEFORE the in-process slot is released.
        // Otherwise a new caller can acquire the atomic lock while the old
        // operating-system file handle still rejects exclusive ownership.
        #[cfg(windows)]
        { drop(self.cross_process.take()); }
        self.active.store(false,Ordering::Release);
    }
}

#[cfg(windows)]
fn windows_lease_path()->Result<PathBuf,String>{
    let local=std::env::var_os("LOCALAPPDATA")
        .filter(|value|!value.is_empty())
        .ok_or_else(||"Windows local user profile is unavailable; desktop execution is blocked.".to_string())?;
    let local=PathBuf::from(local);
    // A09: a redirected LOCALAPPDATA must not become the global desktop
    // execution coordination directory. Validate it before creating Shuvi.
    let local_meta=fs::symlink_metadata(&local)
        .map_err(|error|format!("Could not inspect Windows desktop lease parent: {error}"))?;
    if !local_meta.is_dir()||is_windows_reparse_point(&local_meta){
        return Err("Windows desktop lease parent cannot be a symlink or junction.".into());
    }
    let folder=local.join("Shuvi");
    fs::create_dir_all(&folder)
        .map_err(|error|format!("Could not prepare Windows desktop lease folder: {error}"))?;
    let folder_meta=fs::symlink_metadata(&folder)
        .map_err(|error|format!("Could not inspect Windows desktop lease folder: {error}"))?;
    if !folder_meta.is_dir()||is_windows_reparse_point(&folder_meta){
        return Err("Windows Shuvi lease folder cannot be a symlink or junction.".into());
    }
    Ok(folder.join("native-desktop-action-v1.lock"))
}
#[cfg(windows)]
fn is_windows_reparse_point(meta:&fs::Metadata)->bool{
    use std::os::windows::fs::MetadataExt;
    meta.is_symlink()||meta.file_attributes() & 0x400 !=0
}
#[cfg(windows)]
fn validate_windows_lock_entry(path:&std::path::Path)->Result<(),String>{
    match fs::symlink_metadata(path){
        Ok(meta) if meta.is_file()&&!is_windows_reparse_point(&meta)=>Ok(()),
        Ok(_)=>Err("Shuvi desktop lease path is not a regular unlinked file.".into()),
        Err(error) if error.kind()==std::io::ErrorKind::NotFound=>Ok(()),
        Err(error)=>Err(format!("Cannot inspect Shuvi desktop lease path: {error}")),
    }
}
#[cfg(windows)]
fn claim_windows_desktop_lease()->Result<File,String>{
    let path=windows_lease_path()?;
    validate_windows_lock_entry(&path)?;
    // Windows share_mode(0) requests exclusive sharing. Unlike a Win32
    // mutex, the ownership is tied to File and can safely survive an async
    // Rust future moving to a different executor thread.
    let file=OpenOptions::new()
        .read(true).write(true).create(true).share_mode(0)
        .custom_flags(OPEN_REPARSE_POINT)
        .open(&path).map_err(|error|format!(
            "Another Shuvi instance may already own Windows desktop control, or the lease is inaccessible: {error}"
        ))?;
    let meta=file.metadata().map_err(|error|format!("Could not verify Shuvi desktop lease: {error}"))?;
    if !meta.is_file()||is_windows_reparse_point(&meta){
        return Err("Shuvi desktop lease verification failed.".into());
    }
    Ok(file)
}

pub(crate) fn claim_single_execution<'a>(active:&'a AtomicBool)->Result<NativeExecutionLease<'a>,String>{
    active.compare_exchange(false,true,Ordering::AcqRel,Ordering::Acquire)
        .map_err(|_|"Another Shuvi native action owns the execution slot. Wait for it to finish or stop safely; do not run competing desktop actions.".to_string())?;
    #[cfg(windows)]
    {
        match claim_windows_desktop_lease(){
            Ok(file)=>Ok(NativeExecutionLease{active,cross_process:Some(file)}),
            Err(error)=>{
                // Failure to acquire OS-wide ownership MUST release local slot.
                active.store(false,Ordering::Release);
                Err(error)
            }
        }
    }
    #[cfg(not(windows))]
    {
        Ok(NativeExecutionLease{active})
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    // These native tests share Shuvi's real per-user Windows lease. One test
    // must not race another test's intentionally exclusive OS lock fixture.
    #[cfg(windows)]
    static WINDOWS_TEST_LEASE_MUTEX:std::sync::Mutex<()>=std::sync::Mutex::new(());
    #[test]
    fn only_one_execution_can_own_desktop_at_a_time() {
        #[cfg(windows)]
        let _serial_windows_fixture=WINDOWS_TEST_LEASE_MUTEX.lock().expect("Windows lease fixture lock");
        let active=AtomicBool::new(false);
        let first=claim_single_execution(&active).expect("first action");
        assert!(claim_single_execution(&active).is_err());
        drop(first);
        let second=claim_single_execution(&active).expect("lease released after complete");
        assert!(active.load(Ordering::Acquire));
        drop(second);
        assert!(!active.load(Ordering::Acquire));
    }
    #[test]
    fn guard_releases_slot_after_unwinding() {
        #[cfg(windows)]
        let _serial_windows_fixture=WINDOWS_TEST_LEASE_MUTEX.lock().expect("Windows lease fixture lock");
        let active=AtomicBool::new(false);
        let outcome=std::panic::catch_unwind(||{
            let _lease=claim_single_execution(&active).unwrap();
            panic!("simulate native action panic");
        });
        assert!(outcome.is_err());
        assert!(claim_single_execution(&active).is_ok());
    }
    #[test]
    fn two_real_threads_cannot_both_edit_desktop_at_once(){
        #[cfg(windows)]
        let _serial_windows_fixture=WINDOWS_TEST_LEASE_MUTEX.lock().expect("Windows lease fixture lock");
        use std::sync::{Arc,Barrier};
        let lock=Arc::new(AtomicBool::new(false));
        let started=Arc::new(Barrier::new(2));
        let release=Arc::new(Barrier::new(2));
        let held=Arc::clone(&lock);
        let ready=Arc::clone(&started);
        let finish=Arc::clone(&release);
        let worker=std::thread::spawn(move||{
            let _lease=claim_single_execution(&held).expect("worker owns desktop");
            ready.wait();
            finish.wait();
        });
        started.wait();
        assert!(claim_single_execution(&lock).is_err(),"second action must fail closed");
        release.wait();
        worker.join().unwrap();
        assert!(claim_single_execution(&lock).is_ok(),"lease released after worker");
    }
    #[cfg(windows)]
    #[test]
    fn two_independent_shuvi_instances_cannot_acquire_windows_desktop_simultaneously(){
        #[cfg(windows)]
        let _serial_windows_fixture=WINDOWS_TEST_LEASE_MUTEX.lock().expect("Windows lease fixture lock");
        // Separate atomics emulate two independent Tauri application states.
        // Exclusive Windows File handles cover both even across processes.
        let instance_a=AtomicBool::new(false);
        let instance_b=AtomicBool::new(false);
        let owned=claim_single_execution(&instance_a).expect("first instance obtains OS lease");
        assert!(claim_single_execution(&instance_b).is_err(),"second instance must fail closed");
        assert!(!instance_b.load(Ordering::Acquire),"a failed Windows OS lease cannot leave local state locked");
        drop(owned);
        let again=claim_single_execution(&instance_b).expect("OS lease released after owner dropped");
        drop(again);
    }
    #[cfg(windows)]
    #[test]
    fn rejects_windows_lease_lock_directory_without_creating_or_overwriting_any_file(){
        let path=std::env::temp_dir().join(format!(
            "shuvi-a09-lease-boundary-{}",uuid::Uuid::new_v4()
        ));
        fs::create_dir(&path).expect("isolated fake lock directory");
        assert!(validate_windows_lock_entry(&path).is_err(),
            "a directory must never be treated as a lock file");
        fs::remove_dir(&path).expect("remove fake lock directory");
        assert!(validate_windows_lock_entry(&path).is_ok(),
            "a missing future lock file is a valid creation candidate");
        fs::write(&path,b"existing test lock").expect("regular lock fixture");
        assert!(validate_windows_lock_entry(&path).is_ok(),
            "a regular existing lock file remains eligible");
        fs::remove_file(&path).expect("remove lock fixture");
    }
    #[cfg(windows)]
    #[test]
    fn a_denied_cross_process_claim_cannot_poison_existing_instance(){
        #[cfg(windows)]
        let _serial_windows_fixture=WINDOWS_TEST_LEASE_MUTEX.lock().expect("Windows lease fixture lock");
        let a=AtomicBool::new(false);
        let b=AtomicBool::new(false);
        let lease=claim_single_execution(&a).unwrap();
        for _ in 0..4{
            assert!(claim_single_execution(&b).is_err());
            assert!(!b.load(Ordering::Acquire));
        }
        assert!(a.load(Ordering::Acquire));
        drop(lease);
        assert!(claim_single_execution(&b).is_ok());
    }

}