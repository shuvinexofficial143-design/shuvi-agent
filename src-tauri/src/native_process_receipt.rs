//! Persistent *OS-only* evidence for one Rust-owned subprocess.
//! No process exit/zero code is a verified Adobe/Blender effect or task audit.
//! A crash between intent and PID registration remains launch-uncertain.
//! The owner must reconcile an unknown record; NEVER delete or replay it.
use serde::{Deserialize,Serialize};
use std::{collections::HashSet,fs,fs::OpenOptions,path::{Path,PathBuf},sync::Mutex};
use tauri::{AppHandle,Manager};
static JOURNAL_LOCK:Mutex<()> = Mutex::new(());
const MAX_BYTES:usize=4096;
const MAX_HISTORY:usize=48;

// Keep launch_pending, PID publication, owner Stop and terminal receipt
// in one OS-serialized durable state machine across separate Shuvi instances.
// This is NOT the retained Windows Job Object nor Blender audit evidence.
struct CrossProcessReceiptLock(fs::File);
impl CrossProcessReceiptLock {
    fn take(path:&Path)->Result<Self,String>{
        let lock=path.with_extension("json.oslock");
        match fs::symlink_metadata(&lock){
            Ok(meta) if meta.is_file()&&!meta.file_type().is_symlink()=>{
                #[cfg(windows)]
                {
                    use std::os::windows::fs::MetadataExt;
                    if meta.file_attributes()&0x400!=0{
                        return Err("Owned process receipt OS lock is a reparse point.".into());
                    }
                }
            },
            Ok(_)=>return Err("Owned process receipt lock must be a regular file.".into()),
            Err(e) if e.kind()==std::io::ErrorKind::NotFound=>{},
            Err(_)=>return Err("Owned process receipt lock inaccessible.".into()),
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt;
            const OPEN_REPARSE_POINT:u32=0x0020_0000;
            let handle=OpenOptions::new().read(true).write(true).create(true)
                .share_mode(0).custom_flags(OPEN_REPARSE_POINT)
                .open(&lock)
                .map_err(|_|"Another Shuvi process owns the subprocess receipt.".to_string())?;
            let meta=handle.metadata()
                .map_err(|_|"Cannot inspect held subprocess receipt OS lock.")?;
            if !meta.is_file()||meta.file_attributes()&0x400!=0{
                return Err("Subprocess receipt OS lock resolved to a reparse point.".into());
            }
            return Ok(Self(handle));
        }
        #[cfg(unix)]
        {
            use std::os::fd::AsRawFd;
            unsafe extern "C"{fn flock(fd:i32,operation:i32)->i32;}
            let handle=OpenOptions::new().read(true).write(true).create(true)
                .open(&lock)
                .map_err(|_|"Cannot open subprocess receipt OS lock.".to_string())?;
            if unsafe{flock(handle.as_raw_fd(),2|4)}!=0{
                return Err("Another Shuvi process owns the subprocess receipt.".into());
            }
            return Ok(Self(handle));
        }
        #[cfg(not(any(windows,unix)))]
        {
            Err("Cross-process subprocess receipt locking is unavailable.".into())
        }
    }
}


#[derive(Clone,Debug,Serialize,Deserialize,PartialEq,Eq)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub(crate) struct ProcessReceipt {
    pub version:u32,
    pub action_id:String,
    pub tool:String,
    pub phase:String, // launch_pending, running, exited, cancelled, timed_out, owner_reviewed_unknown
    pub pid:Option<u32>,
    pub exit_code:Option<i32>,
    pub descendants_contained:bool,
    // A separate Rust app/worker audit is required; this field is never true.
    pub app_progress_verified:bool,
    // Durable owner Stop intent; neither OS termination nor app audit proof.
    #[serde(default)]
    pub cancel_requested:bool,
    // Backwards compatible with older v1 files, never trusted as an audit.
    #[serde(default)]
    pub previous_action_ids:Vec<String>,
}
fn check_record(r:&ProcessReceipt)->Result<(),String>{
    if r.version!=1
       ||uuid::Uuid::parse_str(&r.action_id).map(|x|x.to_string()!=r.action_id).unwrap_or(true)
       ||r.tool.is_empty()||r.tool.len()>160
       ||!r.tool.bytes().all(|b|b.is_ascii_lowercase()||b.is_ascii_digit()||b==b'_')
       ||r.app_progress_verified||r.pid==Some(0)
       ||(r.phase=="exited"&&r.cancel_requested){
        return Err("Native subprocess receipt identity or claimed progress is invalid.".into());
    }
    if r.previous_action_ids.len()>MAX_HISTORY{
        return Err("Owned process history exceeds bounded replay budget.".into());
    }
    let mut distinct=HashSet::new();
    for previous in &r.previous_action_ids {
        if uuid::Uuid::parse_str(previous)
            .map(|x|x.to_string()!=*previous).unwrap_or(true)
            ||previous==&r.action_id||!distinct.insert(previous.as_str()){
            return Err("Owned process replay history is invalid or duplicated.".into());
        }
    }
    match (r.phase.as_str(),r.pid,r.exit_code,r.descendants_contained){
        ("launch_pending",None,None,false)=>Ok(()),
        ("running",Some(pid),None,_) if pid>0=>Ok(()),
        ("exited"|"cancelled"|"timed_out",Some(pid),_,_) if pid>0=>Ok(()),
        ("owner_reviewed_unknown",_,None,_)=>Ok(()),
        _=>Err("Native subprocess receipt has forged transition or process identity.".into())
    }
}
fn check_bytes(raw:&[u8])->Result<(),String>{
    if raw.len()>MAX_BYTES{return Err("Native process receipt exceeds durable budget.".into());}
    let receipt:ProcessReceipt=serde_json::from_slice(raw)
        .map_err(|_|"Native process receipt is malformed.".to_string())?;
    check_record(&receipt)
}
pub(super) fn read_at(file:&Path)->Result<Option<ProcessReceipt>,String>{
    if !file.exists(){
        if file.with_extension("json.bak").exists(){
            return Err("Native process receipt is missing but backup exists; owner review required.".into());
        }
        return Ok(None);
    }
    let bytes=crate::read_file_bytes_bounded(file,MAX_BYTES,"native process receipt")?;
    check_bytes(&bytes)?;
    serde_json::from_slice(&bytes).map(Some)
        .map_err(|_|"Native process receipt cannot be decoded.".into())
}
fn write_at(file:&Path,receipt:&ProcessReceipt)->Result<(),String>{
    check_record(receipt)?;
    let bytes=serde_json::to_vec(receipt)
        .map_err(|_|"Native process receipt cannot be encoded.".to_string())?;
    if file.exists(){
        crate::premiere_store::replace(file,&bytes,MAX_BYTES,check_bytes)
    }else{
        crate::atomic_file::create_new_verified(file,&bytes,"native subprocess receipt")
    }
}
pub(super) fn path(app:&AppHandle)->Result<PathBuf,String>{
    let root=app.path().app_data_dir()
        .map_err(|_|"Native subprocess data directory unavailable.".to_string())?;
    fs::create_dir_all(&root).map_err(|_|"Native subprocess data directory inaccessible.".to_string())?;
    Ok(root.join("native-worker-process.json"))
}
fn read_locked_at(file:&Path)->Result<Option<ProcessReceipt>,String>{
    let _lock=JOURNAL_LOCK.lock().map_err(|_|"Native process receipt lock poisoned.")?;
    let _os=CrossProcessReceiptLock::take(file)?;
    read_at(file)
}
pub(crate) fn read(app:&AppHandle)->Result<Option<ProcessReceipt>,String>{
    read_locked_at(&path(app)?)
}
pub(super) fn begin_at(file:&Path,id:&str,tool:&str)->Result<(),String>{
    let _lock=JOURNAL_LOCK.lock().map_err(|_|"Native process receipt lock poisoned.")?;
    let _os=CrossProcessReceiptLock::take(file)?;
    let mut next=ProcessReceipt{version:1,action_id:id.to_string(),tool:tool.to_string(),
        phase:"launch_pending".into(),pid:None,exit_code:None,
        descendants_contained:false,app_progress_verified:false,
        cancel_requested:false,previous_action_ids:Vec::new()};
    if let Some(prior)=read_at(file)? {
        if !matches!(prior.phase.as_str(),"exited"|"cancelled"|"timed_out"|"owner_reviewed_unknown"){
            return Err("Previous subprocess launch or process outcome is unresolved; owner review required.".into());
        }
        if prior.action_id==id || prior.previous_action_ids.iter().any(|old|old==id){
            return Err("Native subprocess UUID cannot be relaunched from durable history.".into());
        }
        next.previous_action_ids=prior.previous_action_ids;
        next.previous_action_ids.push(prior.action_id);
        if next.previous_action_ids.len()>MAX_HISTORY{
            next.previous_action_ids.remove(0);
        }
    }
    check_record(&next)?;
    write_at(file,&next)
}
pub(super) fn started_at(file:&Path,id:&str,tool:&str,pid:u32,contained:bool)->Result<(),String>{
    let _lock=JOURNAL_LOCK.lock().map_err(|_|"Native process receipt lock poisoned.")?;
    let _os=CrossProcessReceiptLock::take(file)?;
    let mut prior=read_at(file)?.ok_or("Native subprocess launch intent missing.")?;
    if prior.phase!="launch_pending"||prior.pid.is_some()
       ||prior.action_id!=id||prior.tool!=tool||pid==0 {
        return Err("Subprocess PID registration conflicts with durable launch intent.".into());
    }
    prior.phase="running".into();
    prior.pid=Some(pid);
    prior.descendants_contained=contained;
    write_at(file,&prior)
}
pub(super) fn finish_at(file:&Path,id:&str,tool:&str,phase:&str,code:Option<i32>)->Result<(),String>{
    let _lock=JOURNAL_LOCK.lock().map_err(|_|"Native process receipt lock poisoned.")?;
    let _os=CrossProcessReceiptLock::take(file)?;
    let mut prior=read_at(file)?.ok_or("Native subprocess receipt missing at termination.")?;
    if prior.phase!="running"||prior.action_id!=id||prior.tool!=tool
       ||!matches!(phase,"exited"|"cancelled"|"timed_out"){
        return Err("Native process terminal receipt is stale, forged or duplicate.".into());
    }
    prior.phase=phase.into();
    prior.exit_code=code;
    write_at(file,&prior)
}
/// Persist exact in-process owner Stop before reporting acknowledgement.
/// Does not claim a Windows process stopped, nor any Blender output succeeded.
pub(super) fn mark_cancel_requested_at(file:&Path,id:&str)->Result<(),String>{
    let _lock=JOURNAL_LOCK.lock()
        .map_err(|_|"Native process stop-intent journal lock poisoned.")?;
    let _os=CrossProcessReceiptLock::take(file)?;
    let mut current=read_at(file)?.ok_or("Owned process receipt missing at owner Stop.")?;
    if current.action_id!=id
       ||!matches!(current.phase.as_str(),"launch_pending"|"running"){
        return Err("Owner Stop requires the exact unresolved process action UUID.".into());
    }
    if current.cancel_requested{return Ok(());}
    current.cancel_requested=true;
    write_at(file,&current)
}
/// Only a separately authorized OWNER REVIEW may call this seam. No auto-clear.
/// It records unknown effects without claiming that the application was updated.
pub(super) fn owner_review_at(file:&Path,id:&str,tool:&str)->Result<(),String>{
    let _lock=JOURNAL_LOCK.lock().map_err(|_|"Native process receipt lock poisoned.")?;
    let _os=CrossProcessReceiptLock::take(file)?;
    let mut prior=read_at(file)?.ok_or("No native subprocess receipt for owner review.")?;
    if prior.action_id!=id||prior.tool!=tool
       ||!matches!(prior.phase.as_str(),"launch_pending"|"running"){
        return Err("Owner subprocess review must match the unresolved action UUID and tool.".into());
    }
    prior.phase="owner_reviewed_unknown".into();
    prior.exit_code=None;
    write_at(file,&prior)
}
#[cfg(test)]
mod tests {
    use super::*;
    fn file()->PathBuf {
        std::env::temp_dir().join(format!("shuvi-native-process-test-{}.json",uuid::Uuid::new_v4()))
    }
    const A:&str="e8b36b21-1c6a-459e-9b6f-75dd5692ab81";
    const B:&str="0f2977ac-4f61-4d9c-bf74-ecf8a3ae2172";
    fn cleanup(f:&Path){
        let _=fs::remove_file(f);
        let _=fs::remove_file(f.with_extension("json.bak"));
        let _=fs::remove_file(f.with_extension("json.oslock"));
    }
    #[test]
    fn subprocess_receipt_os_lock_blocks_stop_pid_and_terminal_publication(){
        let f=file();
        let foreign=CrossProcessReceiptLock::take(&f).unwrap();
        assert!(begin_at(&f,A,"blender_run_plan").is_err());
        assert!(read_locked_at(&f).is_err());
        drop(foreign);
        begin_at(&f,A,"blender_run_plan").unwrap();
        let foreign=CrossProcessReceiptLock::take(&f).unwrap();
        assert!(started_at(&f,A,"blender_run_plan",123,true).is_err());
        assert!(mark_cancel_requested_at(&f,A).is_err());
        assert!(owner_review_at(&f,A,"blender_run_plan").is_err());
        drop(foreign);
        started_at(&f,A,"blender_run_plan",123,true).unwrap();
        let foreign=CrossProcessReceiptLock::take(&f).unwrap();
        assert!(finish_at(&f,A,"blender_run_plan","exited",Some(0)).is_err());
        drop(foreign);
        mark_cancel_requested_at(&f,A).unwrap();
        assert!(finish_at(&f,A,"blender_run_plan","exited",Some(0)).is_err());
        finish_at(&f,A,"blender_run_plan","cancelled",Some(0)).unwrap();
        assert_eq!(read_locked_at(&f).unwrap().unwrap().phase,"cancelled");
        cleanup(&f);
    }
    #[test]
    fn stop_vs_terminal_race_cannot_erase_acknowledged_owner_stop(){
        use std::sync::{Arc,Barrier};
        let f=file();begin_at(&f,A,"blender_run_plan").unwrap();
        started_at(&f,A,"blender_run_plan",123,true).unwrap();
        let gate=Arc::new(Barrier::new(3));
        let left=f.clone();let right=f.clone();
        let first=Arc::clone(&gate);let second=Arc::clone(&gate);
        std::thread::scope(|scope|{
            let stop=scope.spawn(move||{first.wait();mark_cancel_requested_at(&left,A)});
            let terminal=scope.spawn(move||{second.wait();
                finish_at(&right,A,"blender_run_plan","exited",Some(0))
            });
            gate.wait();
            let stop_result=stop.join().unwrap();
            let terminal_result=terminal.join().unwrap();
            // If owner Stop was confirmed first, exit=0 cannot overwrite it.
            if stop_result.is_ok(){assert!(terminal_result.is_err());}
        });
        let current=read_locked_at(&f).unwrap().unwrap();
        if current.cancel_requested{
            assert_eq!(current.phase,"running");
            assert!(finish_at(&f,A,"blender_run_plan","exited",Some(0)).is_err());
            finish_at(&f,A,"blender_run_plan","cancelled",Some(0)).unwrap();
        }else{
            assert_eq!(current.phase,"exited");
            assert!(!current.cancel_requested);
        }
        cleanup(&f);
    }
    #[test]
    fn fake_receipt_lock_directory_cannot_authorize_launch(){
        let f=file();
        let os=f.with_extension("json.oslock");
        fs::create_dir(&os).unwrap();
        assert!(begin_at(&f,A,"blender_run_plan").is_err());
        assert!(!f.exists());
        fs::remove_dir(os).unwrap();
    }
    #[test]
    fn durable_launch_intent_blocks_crash_replay_and_mismatched_pid(){
        let f=file();
        begin_at(&f,A,"blender_run_plan").unwrap();
        assert_eq!(read_at(&f).unwrap().unwrap().phase,"launch_pending");
        assert!(begin_at(&f,B,"blender_run_plan").is_err());
        assert!(started_at(&f,B,"blender_run_plan",100,true).is_err());
        assert!(started_at(&f,A,"blender_run_plan",0,true).is_err());
        started_at(&f,A,"blender_run_plan",111,true).unwrap();
        assert_eq!(read_at(&f).unwrap().unwrap().pid,Some(111));
        assert!(started_at(&f,A,"blender_run_plan",112,true).is_err());
        assert!(begin_at(&f,B,"blender_run_plan").is_err());
        cleanup(&f);
    }
    #[test]
    fn process_exit_does_not_fabricate_verified_application_success(){
        let f=file();
        begin_at(&f,A,"blender_run_plan").unwrap();
        started_at(&f,A,"blender_run_plan",111,true).unwrap();
        finish_at(&f,A,"blender_run_plan","exited",Some(0)).unwrap();
        let recorded=read_at(&f).unwrap().unwrap();
        assert_eq!(recorded.phase,"exited");
        assert_eq!(recorded.exit_code,Some(0));
        assert!(!recorded.app_progress_verified);
        assert!(finish_at(&f,A,"blender_run_plan","exited",Some(0)).is_err());
        assert!(begin_at(&f,A,"blender_run_plan").is_err());
        begin_at(&f,B,"premiere_insert_media").unwrap();
        cleanup(&f);
    }
    #[test]
    fn recovery_requires_exact_owner_review_and_never_claims_success(){
        let f=file();
        begin_at(&f,A,"blender_run_plan").unwrap();
        assert!(owner_review_at(&f,B,"blender_run_plan").is_err());
        assert!(owner_review_at(&f,A,"premiere_insert_media").is_err());
        owner_review_at(&f,A,"blender_run_plan").unwrap();
        assert!(owner_review_at(&f,A,"blender_run_plan").is_err());
        let r=read_at(&f).unwrap().unwrap();
        assert_eq!(r.phase,"owner_reviewed_unknown");
        assert!(!r.app_progress_verified);
        begin_at(&f,B,"blender_run_plan").unwrap();
        cleanup(&f);
    }
    #[test]
    fn prior_uuid_remains_blocked_after_successful_other_action_and_restart(){
        let f=file();
        begin_at(&f,A,"blender_run_plan").unwrap();
        started_at(&f,A,"blender_run_plan",111,true).unwrap();
        finish_at(&f,A,"blender_run_plan","exited",Some(0)).unwrap();
        begin_at(&f,B,"blender_run_plan").unwrap();
        started_at(&f,B,"blender_run_plan",222,true).unwrap();
        finish_at(&f,B,"blender_run_plan","exited",Some(0)).unwrap();
        let recovered=read_at(&f).unwrap().unwrap();
        assert_eq!(recovered.previous_action_ids,vec![A.to_string()]);
        assert!(begin_at(&f,A,"blender_run_plan").is_err());
        assert_eq!(read_at(&f).unwrap().unwrap().action_id,B);
        cleanup(&f);
    }
    #[test]
    fn older_v1_receipt_without_history_deserializes_and_rejects_invalid_replays(){
        let f=file();
        let legacy=serde_json::json!({"version":1,"actionId":A,
            "tool":"blender_run_plan","phase":"exited","pid":211,
            "exitCode":0,"descendantsContained":true,"appProgressVerified":false});
        fs::write(&f,serde_json::to_vec(&legacy).unwrap()).unwrap();
        assert_eq!(read_at(&f).unwrap().unwrap().previous_action_ids.len(),0);
        begin_at(&f,B,"blender_run_plan").unwrap();
        let mut corrupted=read_at(&f).unwrap().unwrap();
        corrupted.previous_action_ids.push(A.into());
        assert!(check_record(&corrupted).is_err());
        cleanup(&f);
    }
    #[test]
    fn owner_cancel_persists_through_restart_and_prevents_forged_clean_exit(){
        let f=file();
        begin_at(&f,A,"blender_run_plan").unwrap();
        assert!(mark_cancel_requested_at(&f,B).is_err());
        mark_cancel_requested_at(&f,A).unwrap();
        assert!(read_at(&f).unwrap().unwrap().cancel_requested);
        started_at(&f,A,"blender_run_plan",444,true).unwrap();
        assert!(read_at(&f).unwrap().unwrap().cancel_requested);
        assert!(finish_at(&f,A,"blender_run_plan","exited",Some(0)).is_err());
        finish_at(&f,A,"blender_run_plan","cancelled",Some(0)).unwrap();
        assert_eq!(read_at(&f).unwrap().unwrap().phase,"cancelled");
        cleanup(&f);
    }
    #[test]
    fn corrupt_primary_and_orphan_backup_are_not_unlocked(){
        let f=file();begin_at(&f,A,"blender_run_plan").unwrap();
        fs::write(&f,b"{").unwrap();
        assert!(begin_at(&f,B,"blender_run_plan").is_err());
        fs::write(f.with_extension("json.bak"),b"{}").unwrap();
        fs::remove_file(&f).unwrap();
        assert!(begin_at(&f,B,"blender_run_plan").is_err());
        cleanup(&f);
    }
}
