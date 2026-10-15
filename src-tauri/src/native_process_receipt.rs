//! Persistent *OS-only* evidence for one Rust-owned subprocess.
//! No process exit/zero code is a verified Adobe/Blender effect or task audit.
//! A crash between intent and PID registration remains launch-uncertain.
//! The owner must reconcile an unknown record; NEVER delete or replay it.
use serde::{Deserialize,Serialize};
use std::{fs,path::{Path,PathBuf},sync::Mutex};
use tauri::{AppHandle,Manager};
static JOURNAL_LOCK:Mutex<()> = Mutex::new(());
const MAX_BYTES:usize=2048;

#[derive(Clone,Debug,Serialize,Deserialize,PartialEq,Eq)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub(super) struct ProcessReceipt {
    pub version:u32,
    pub action_id:String,
    pub tool:String,
    pub phase:String, // launch_pending, running, exited, cancelled, timed_out, owner_reviewed_unknown
    pub pid:Option<u32>,
    pub exit_code:Option<i32>,
    pub descendants_contained:bool,
    // A separate Rust app/worker audit is required; this field is never true.
    pub app_progress_verified:bool,
}
fn check_record(r:&ProcessReceipt)->Result<(),String>{
    if r.version!=1
       ||uuid::Uuid::parse_str(&r.action_id).map(|x|x.to_string()!=r.action_id).unwrap_or(true)
       ||r.tool.is_empty()||r.tool.len()>160
       ||!r.tool.bytes().all(|b|b.is_ascii_lowercase()||b.is_ascii_digit()||b==b'_')
       ||r.app_progress_verified||r.pid==Some(0){
        return Err("Native subprocess receipt identity or claimed progress is invalid.".into());
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
fn read_at(file:&Path)->Result<Option<ProcessReceipt>,String>{
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
pub(super) fn read(app:&AppHandle)->Result<Option<ProcessReceipt>,String>{
    let _lock=JOURNAL_LOCK.lock().map_err(|_|"Native process receipt lock poisoned.")?;
    read_at(&path(app)?)
}
pub(super) fn begin_at(file:&Path,id:&str,tool:&str)->Result<(),String>{
    let _lock=JOURNAL_LOCK.lock().map_err(|_|"Native process receipt lock poisoned.")?;
    let next=ProcessReceipt{version:1,action_id:id.to_string(),tool:tool.to_string(),
        phase:"launch_pending".into(),pid:None,exit_code:None,
        descendants_contained:false,app_progress_verified:false};
    check_record(&next)?;
    if let Some(prior)=read_at(file)? {
        if !matches!(prior.phase.as_str(),"exited"|"cancelled"|"timed_out"|"owner_reviewed_unknown"){
            return Err("Previous subprocess launch or process outcome is unresolved; owner review required.".into());
        }
        if prior.action_id==id{
            return Err("Native subprocess UUID cannot be launched twice.".into());
        }
    }
    write_at(file,&next)
}
pub(super) fn started_at(file:&Path,id:&str,tool:&str,pid:u32,contained:bool)->Result<(),String>{
    let _lock=JOURNAL_LOCK.lock().map_err(|_|"Native process receipt lock poisoned.")?;
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
    let mut prior=read_at(file)?.ok_or("Native subprocess receipt missing at termination.")?;
    if prior.phase!="running"||prior.action_id!=id||prior.tool!=tool
       ||!matches!(phase,"exited"|"cancelled"|"timed_out"){
        return Err("Native process terminal receipt is stale, forged or duplicate.".into());
    }
    prior.phase=phase.into();
    prior.exit_code=code;
    write_at(file,&prior)
}
/// Only a separately authorized OWNER REVIEW may call this seam. No auto-clear.
/// It records unknown effects without claiming that the application was updated.
pub(super) fn owner_review_at(file:&Path,id:&str,tool:&str)->Result<(),String>{
    let _lock=JOURNAL_LOCK.lock().map_err(|_|"Native process receipt lock poisoned.")?;
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
    fn cleanup(f:&Path){let _=fs::remove_file(f);let _=fs::remove_file(f.with_extension("json.bak"));}
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
