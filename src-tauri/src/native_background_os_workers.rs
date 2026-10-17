//! Isolated OS-backed read-only process lane (not the desktop GUI lane).
//! IMPORTANT: This is an internal worker primitive, NOT yet an authorized
//! scheduler dispatch route. Never feed executable/args from an AI request.
//! An actual adapter must enforce approved typed action + output/resource
//! authorization and supply the existing combined host-RAM watchdog.
#![cfg(windows)]
use std::{
    ffi::OsString,
    fs::{self,File,OpenOptions},
    io::Write,
    os::windows::fs::{MetadataExt,OpenOptionsExt},
    path::{Path,PathBuf},
    time::{Duration,Instant},
};
use serde::{Serialize,Deserialize};
#[path = "native_windows_job.rs"]
mod contained;
use contained::OwnedChild;

const MAX_BACKGROUND_WORKERS:usize=2;
const READ_ONLY_JOB_CAP:u64=512*1024*1024;
const MAX_RUNTIME:Duration=Duration::from_secs(600);
const OPEN_REPARSE_POINT:u32=0x0020_0000;
const MAX_RECEIPT_BYTES:usize=1024;

#[derive(Serialize,Deserialize,Clone,Debug)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
struct Receipt{
    version:u32,
    action_id:String,
    class:String,
    phase:String,
    pid:Option<u32>,
    exit_code:Option<i32>,
    app_verified:bool,
}
fn valid_uuid(id:&str)->bool{
    uuid::Uuid::parse_str(id).map(|u|u.to_string()==id).unwrap_or(false)
}
fn valid_receipt(record:&Receipt)->Result<(),String>{
    if record.version!=1||!valid_uuid(&record.action_id)
        ||record.class!="read_only_native_verifier"||record.app_verified
        ||!matches!((record.phase.as_str(),record.pid,record.exit_code),
            ("launch_pending",None,None)
            |("os_running",Some(1..),None)
            |("os_exited_unverified",Some(1..),Some(_))
            |("os_cancelled_unverified",Some(1..),Some(_))
            |("os_timed_out_unverified",Some(1..),Some(_))){
        return Err("Malformed or forged read-only OS worker receipt.".into());
    }
    Ok(())
}
fn encoded(record:&Receipt)->Result<Vec<u8>,String>{
    valid_receipt(record)?;
    let bytes=serde_json::to_vec(record).map_err(|_|"Cannot encode background receipt.")?;
    if bytes.len()>MAX_RECEIPT_BYTES{return Err("Background receipt too large.".into());}
    Ok(bytes)
}
fn regular_root(dir:&Path)->Result<(),String>{
    let meta=fs::symlink_metadata(dir).map_err(|_|"Read-only worker root unavailable.")?;
    if !meta.is_dir()||meta.file_type().is_symlink()
        ||meta.file_attributes()&0x400!=0{
        return Err("Read-only worker root may not be redirected.".into());
    }
    Ok(())
}
fn receipt_path(dir:&Path,id:&str)->PathBuf{
    dir.join(format!("native-bg-readonly-{id}.json"))
}
/// A launch intent is irreversible without an explicit future owner-review
/// path. No TTL unlock, overwrite, or same-UUID automatic retry.
fn create_intent(path:&Path,id:&str)->Result<(),String>{
    let receipt=Receipt{
        version:1,action_id:id.into(),class:"read_only_native_verifier".into(),
        phase:"launch_pending".into(),pid:None,exit_code:None,app_verified:false,
    };
    let bytes=encoded(&receipt)?;
    let mut file=OpenOptions::new().write(true).create_new(true)
        .custom_flags(OPEN_REPARSE_POINT).open(path)
        .map_err(|_|"Read-only action UUID already launched or receipt path unsafe.")?;
    file.write_all(&bytes).and_then(|_|file.sync_all())
        .map_err(|_|"Cannot durably persist read-only launch intent.".to_string())
}
fn publish(path:&Path,receipt:&Receipt)->Result<(),String>{
    let bytes=encoded(receipt)?;
    // The original receipt is required; an interrupted/corrupt publication
    // is never interpreted as an empty slot or verified application success.
    let previous=fs::read(path).map_err(|_|"Background receipt disappeared.")?;
    let old:Receipt=serde_json::from_slice(&previous)
        .map_err(|_|"Interrupted background receipt requires owner review.")?;
    valid_receipt(&old)?;
    if old.action_id!=receipt.action_id||old.class!=receipt.class
        ||!matches!((old.phase.as_str(),receipt.phase.as_str()),
            ("launch_pending","os_running")
            |("os_running","os_exited_unverified")
            |("os_running","os_cancelled_unverified")
            |("os_running","os_timed_out_unverified")){
        return Err("Background receipt transition is not monotonic.".into());
    }
    crate::premiere_store::replace(path,&bytes,MAX_RECEIPT_BYTES,|raw|{
        let r:Receipt=serde_json::from_slice(raw)
            .map_err(|_|"Background receipt serialization invalid.".to_string())?;
        valid_receipt(&r)
    })
}
struct Slot(File);
impl Slot{
    fn take(dir:&Path)->Result<Self,String>{
        regular_root(dir)?;
        for i in 0..MAX_BACKGROUND_WORKERS{
            let path=dir.join(format!("native-bg-os-slot-{i}.oslock"));
            match fs::symlink_metadata(&path){
                Ok(meta) if meta.is_file()&&!meta.file_type().is_symlink()
                    && meta.file_attributes()&0x400==0=>{},
                Ok(_)=>return Err("Background slot is redirected or not a file.".into()),
                Err(e) if e.kind()==std::io::ErrorKind::NotFound=>{},
                Err(_)=>return Err("Background slot cannot be inspected.".into()),
            }
            let opened=OpenOptions::new().read(true).write(true).create(true)
                .share_mode(0).custom_flags(OPEN_REPARSE_POINT).open(&path);
            let file=match opened{Ok(f)=>f,Err(_)=>continue};
            let meta=file.metadata().map_err(|_|"Background slot handle unavailable.")?;
            if !meta.is_file()||meta.file_attributes()&0x400!=0{
                return Err("Background slot resolved to unsafe target.".into());
            }
            return Ok(Self(file));
        }
        Err("Both owned background OS process slots are busy.".into())
    }
}
/// Every live object holds one kernel-backed cross-instance worker slot and
/// one Windows Job Object; it is never allowed to release the slot merely
/// because the launcher parent exited while descendants remain alive.
pub(super) struct BackgroundOwned{
    _slot:Slot,
    child:OwnedChild,
    id:String,
    receipt:Receipt,
    path:PathBuf,
    start:Instant,
    terminal:bool,
}
/// Trusted backend-only launch seam. Production approval/typed tool binding
/// is intentionally not connected: there is no new Tauri IPC or model launch.
#[allow(dead_code)]
pub(super) fn spawn_internal_readonly(
    root:&Path,id:&str,exe:&Path,args:&[OsString],cwd:&Path
)->Result<BackgroundOwned,String>{
    if !valid_uuid(id)||!exe.is_absolute()||!cwd.is_absolute()
        ||args.len()>16||args.iter().any(|a|a.is_empty()||a.len()>1024){
        return Err("Background verification process has invalid bounded identity.".into());
    }
    regular_root(root)?;
    let exe_meta=fs::symlink_metadata(exe)
        .map_err(|_|"Internal background executable cannot be inspected.")?;
    let cwd_meta=fs::symlink_metadata(cwd)
        .map_err(|_|"Internal background cwd cannot be inspected.")?;
    if !exe_meta.is_file()||exe_meta.file_type().is_symlink()
        ||exe_meta.file_attributes()&0x400!=0
        ||!cwd_meta.is_dir()||cwd_meta.file_type().is_symlink()
        ||cwd_meta.file_attributes()&0x400!=0{
        return Err("Internal background program or cwd redirected.".into());
    }
    let _slot=Slot::take(root)?;
    let path=receipt_path(root,id);
    create_intent(&path,id)?;
    let child=OwnedChild::spawn_capped(exe,args,cwd,READ_ONLY_JOB_CAP)?;
    let receipt=Receipt{
        version:1,action_id:id.into(),class:"read_only_native_verifier".into(),
        phase:"os_running".into(),pid:Some(child.id()),exit_code:None,
        app_verified:false,
    };
    publish(&path,&receipt)?;
    Ok(BackgroundOwned{_slot,child,id:id.into(),receipt,path,
        start:Instant::now(),terminal:false})
}
#[allow(dead_code)]
impl BackgroundOwned{
    fn finish(&mut self,phase:&str,code:i32)->Result<(),String>{
        if self.terminal||self.child.active_processes()?!=0{
            return Err("Background process tree is not terminal.".into());
        }
        let mut record=self.receipt.clone();
        record.phase=phase.into();
        record.exit_code=Some(code);
        publish(&self.path,&record)?;
        self.receipt=record;
        self.terminal=true;
        Ok(())
    }
    /// Host memory sampling must come from existing Shuvi-wide RAM guard.
    /// The callback returning unknown is a stop condition, never a bypass.
    fn wait_with_host_guard<F>(&mut self,mut over_hard_limit:F)->Result<i32,String>
        where F:FnMut()->Result<bool,String>{
        loop{
            if self.terminal{return Err("Read-only worker already finished.".into());}
            match over_hard_limit(){
                Ok(false)=>{},
                Ok(true)=>{self.cancel_exact(&self.id.clone())?;
                    return Err("Host RAM ceiling exceeded; read-only process terminated.".into());},
                Err(_)=>{self.cancel_exact(&self.id.clone())?;
                    return Err("Host RAM could not be verified; worker terminated.".into());}
            }
            let exited=self.child.try_wait()?;
            if let Some(code)=exited{
                if self.child.active_processes()?==0{
                    self.finish("os_exited_unverified",code)?;
                    return Ok(code);
                }
            }
            if self.start.elapsed()>=MAX_RUNTIME{
                let code=self.child.terminate_tree()?.ok_or("Background root exit unknown.")?;
                self.finish("os_timed_out_unverified",code)?;
                return Err("Read-only OS worker timed out; application result unverified.".into());
            }
            std::thread::sleep(Duration::from_millis(50));
        }
    }
    fn cancel_exact(&mut self,id:&str)->Result<(),String>{
        if id!=self.id||self.terminal{
            return Err("Cannot cancel a foreign or terminal background OS worker.".into());
        }
        let code=self.child.terminate_tree()?.ok_or("Background stop exit unavailable.")?;
        self.finish("os_cancelled_unverified",code)
    }
}
impl Drop for BackgroundOwned{
    fn drop(&mut self){
        // A dropped live worker is never a successful audit. Job Object
        // KILL_ON_JOB_CLOSE still contains descendants if explicit stop fails.
        if !self.terminal{
            if let Ok(Some(code))=self.child.terminate_tree(){
                let _=self.finish("os_cancelled_unverified",code);
            }
        }
    }
}
#[cfg(test)]
mod tests{
    use super::*;
    use std::thread;
    const A:&str="e8b36b21-1c6a-459e-9b6f-75dd5692ab81";
    const B:&str="0f2977ac-4f61-4d9c-bf74-ecf8a3ae2172";
    const C:&str="3ac5c21a-8407-4ed7-b4b7-f51ba437a491";
    fn root()->PathBuf{
        let d=std::env::temp_dir().join(format!("shuvi-bg-os-{}",uuid::Uuid::new_v4()));
        fs::create_dir_all(&d).unwrap();d
    }
    fn launch(dir:&Path,id:&str)->BackgroundOwned{
        let exe=std::env::current_exe().unwrap();
        spawn_internal_readonly(dir,id,&exe,&[
            "--ignored".into(),"--exact".into(),
            "native_scheduler::background_os_workers::tests::fixture_sleep".into(),
        ],&std::env::temp_dir()).unwrap()
    }
    #[test]
    #[ignore="internal Windows read-only OS worker fixture"]
    fn fixture_sleep(){thread::sleep(Duration::from_secs(4));}
    #[test]
    fn two_real_independent_background_pids_and_third_denied(){
        let dir=root();
        let mut one=launch(&dir,A);
        let mut two=launch(&dir,B);
        assert_ne!(one.child.id(),two.child.id());
        assert!(one.child.active_processes().unwrap()>0);
        assert!(two.child.active_processes().unwrap()>0);
        assert!(spawn_internal_readonly(&dir,C,&std::env::current_exe().unwrap(),
            &[],&std::env::temp_dir()).is_err());
        assert!(!receipt_path(&dir,C).exists());
        assert!(two.cancel_exact(A).is_err());
        one.cancel_exact(A).unwrap();
        two.cancel_exact(B).unwrap();
        let first:Receipt=serde_json::from_slice(&fs::read(receipt_path(&dir,A)).unwrap()).unwrap();
        assert_eq!(first.phase,"os_cancelled_unverified");
        assert!(!first.app_verified);
        drop(one);drop(two); // release BOTH kernel slots before the replay check
        assert!(launch_again_denied(&dir,A));
        // A different UUID may still acquire a freed slot after terminal Stop.
        let mut fresh=launch(&dir,C);
        fresh.cancel_exact(C).unwrap();
        drop(fresh);
        fs::remove_dir_all(dir).unwrap();
    }
    fn launch_again_denied(root:&Path,id:&str)->bool{
        let exe=std::env::current_exe().unwrap();
        spawn_internal_readonly(root,id,&exe,&[],&std::env::temp_dir()).is_err()
    }
    #[test]
    fn unknown_launch_intent_survives_restart_and_never_reuses_uuid(){
        let d=root();
        let path=receipt_path(&d,A);
        create_intent(&path,A).unwrap();
        assert!(launch_again_denied(&d,A));
        let rec:Receipt=serde_json::from_slice(&fs::read(path).unwrap()).unwrap();
        assert_eq!(rec.phase,"launch_pending");
        assert!(!rec.app_verified);
        fs::remove_dir_all(d).unwrap();
    }
    #[test]
    fn forged_slot_and_redirected_root_fail_closed(){
        let d=root();
        fs::create_dir(d.join("native-bg-os-slot-0.oslock")).unwrap();
        assert!(Slot::take(&d).is_err());
        let _=fs::remove_dir_all(d);
    }
    #[test]
    fn host_ram_uncertainty_terminates_exact_worker_and_is_never_success(){
        let d=root();
        let mut owned=launch(&d,A);
        let e=owned.wait_with_host_guard(||Err("probe unavailable".into())).unwrap_err();
        assert!(e.contains("could not be verified"));
        assert!(owned.terminal);
        assert!(owned.child.active_processes().unwrap()==0);
        let rec:Receipt=serde_json::from_slice(&fs::read(receipt_path(&d,A)).unwrap()).unwrap();
        assert_eq!(rec.phase,"os_cancelled_unverified");
        drop(owned);
        fs::remove_dir_all(d).unwrap();
    }
}
