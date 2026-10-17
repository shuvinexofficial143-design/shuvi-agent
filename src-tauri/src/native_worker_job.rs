//! Rust-owned durable observation of one approved desktop action.
//! A tick proves only the supervisor loop is alive, NEVER that the tool or
//! an external Adobe/Blender app progressed. No TTL unlock or auto retry.
use serde::{Deserialize,Serialize};
use std::{fs,path::{Path,PathBuf},sync::{Arc,Mutex,atomic::{AtomicBool,Ordering}},thread,time::Duration};
use tauri::{AppHandle,Manager};
const MAX_BYTES:usize=2048;
// Bounded replay window in addition to the globally audited action journal.
const MAX_PRIOR_ACTIONS:usize=24;
static JOB_LOCK:Mutex<()>=Mutex::new(());
const HEARTBEAT_PERIOD:Duration=Duration::from_secs(4);

#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub(crate) struct NativeJob {
    pub version:u32,
    pub action_id:String,
    pub tool:String,
    pub phase:String,
    pub started_at_ms:u64,
    pub updated_at_ms:u64,
    pub heartbeat_seq:u64,
    pub audit_success:Option<bool>,
    // Backward compatible with v1 jobs already on disk. On each new job,
    // preserve recent audited IDs; never treat a malformed list as empty.
    #[serde(default)]
    pub prior_action_ids:Vec<String>,
}
fn validate(v:&NativeJob)->Result<(),String>{
    if v.version!=1||uuid::Uuid::parse_str(&v.action_id)
       .map(|x|x.to_string()!=v.action_id).unwrap_or(true){
        return Err("Native job requires a canonical approved action UUID.".into());
    }
    if v.tool.len()==0||v.tool.len()>160||!v.tool.bytes()
       .all(|b|b.is_ascii_lowercase()||b.is_ascii_digit()||b==b'_'){
        return Err("Native job has invalid tool identity.".into());
    }
    if v.started_at_ms==0||v.updated_at_ms<v.started_at_ms
       ||(v.phase=="running"&&v.updated_at_ms>v.started_at_ms.saturating_add(86_400_000))
       ||v.heartbeat_seq>1_000_000{
        return Err("Native job heartbeat timestamps or sequence invalid.".into());
    }
    if v.prior_action_ids.len()>MAX_PRIOR_ACTIONS{
        return Err("Native job replay history exceeds its durable budget.".into());
    }
    let mut seen=std::collections::HashSet::new();
    for id in &v.prior_action_ids{
        if uuid::Uuid::parse_str(id).map(|x|x.to_string()!=*id).unwrap_or(true)
            ||id==&v.action_id||!seen.insert(id){
            return Err("Native job prior action history is malformed or duplicated.".into());
        }
    }
    match (v.phase.as_str(),v.audit_success){
        ("running",None)|("audit_verified",Some(_))|("owner_reviewed_unknown",None)=>Ok(()),
        _=>Err("Native job state is inconsistent with local audit.".into()),
    }
}
fn checked_bytes(bytes:&[u8])->Result<(),String>{
    if bytes.len()>MAX_BYTES{return Err("Native job journal too large.".into());}
    let value:NativeJob=serde_json::from_slice(bytes)
        .map_err(|_|"Native job journal malformed.".to_string())?;
    validate(&value)
}
fn journal_path(app:&AppHandle)->Result<PathBuf,String>{
    let root=app.path().app_data_dir()
        .map_err(|_|"Native job directory unavailable.".to_string())?;
    fs::create_dir_all(&root)
        .map_err(|_|"Cannot prepare native job directory.".to_string())?;
    Ok(root.join("native-worker-job.json"))
}
fn read_at(path:&Path)->Result<Option<NativeJob>,String>{
    let backup=path.with_extension("json.bak");
    if !path.exists()&&!backup.exists(){return Ok(None);}
    let parse=|p:&Path|->Result<NativeJob,String>{
        let bytes=crate::read_file_bytes_bounded(p,MAX_BYTES,"native worker job")?;
        checked_bytes(&bytes)?;
        serde_json::from_slice(&bytes).map_err(|_|"Native job unreadable.".to_string())
    };
    if path.exists(){
        // Do not silently fall back to a last-audited backup if a new
        // running-job primary was damaged in a crash. Recovery must be
        // owner-reviewed, not interpreted as a vacant execution slot.
        parse(path).map(Some)
    }else{
        Err("Native job primary missing but backup present; inspect before dispatch.".into())
    }
}
fn persist(path:&Path,record:&NativeJob)->Result<(),String>{
    validate(record)?;
    let bytes=serde_json::to_vec(record)
        .map_err(|_|"Cannot encode native job.".to_string())?;
    crate::premiere_store::replace(path,&bytes,MAX_BYTES,checked_bytes)
}
fn begin_at(path:&Path,action_id:&str,tool:&str,now:u64)->Result<NativeJob,String>{
    let _lock=JOB_LOCK.lock().map_err(|_|"Native job lock poisoned.")?;
    let mut history=Vec::new();
    if let Some(last)=read_at(path)?{
        if !matches!(last.phase.as_str(),"audit_verified"|"owner_reviewed_unknown"){
            return Err("Unresolved durable native worker job requires owner audit review before another action.".into());
        }
        if last.action_id==action_id||last.prior_action_ids.iter().any(|id|id==action_id){
            return Err("A previously audited native job UUID cannot be replayed.".into());
        }
        history=last.prior_action_ids;
        history.push(last.action_id);
        if history.len()>MAX_PRIOR_ACTIONS{
            let excess=history.len()-MAX_PRIOR_ACTIONS;
            history.drain(..excess);
        }
    }
    let job=NativeJob{version:1,action_id:action_id.into(),tool:tool.into(),
        phase:"running".into(),started_at_ms:now,updated_at_ms:now,
        heartbeat_seq:0,audit_success:None,prior_action_ids:history};
    persist(path,&job)?;
    Ok(job)
}
fn tick_at(path:&Path,id:&str,now:u64)->Result<(),String>{
    let _lock=JOB_LOCK.lock().map_err(|_|"Native job lock poisoned.")?;
    let mut record=read_at(path)?.ok_or("Native job checkpoint missing.")?;
    if record.action_id!=id||record.phase!="running"||now<=record.updated_at_ms
       ||record.heartbeat_seq>=1_000_000{
        return Err("Native job tick cannot renew another or finalized action.".into());
    }
    record.heartbeat_seq+=1;
    record.updated_at_ms=now;
    persist(path,&record)
}
fn audited_at(path:&Path,id:&str,success:bool,now:u64)->Result<(),String>{
    let _lock=JOB_LOCK.lock().map_err(|_|"Native job lock poisoned.")?;
    let mut record=read_at(path)?.ok_or("Native job checkpoint missing at audit.")?;
    if record.action_id!=id||record.phase!="running"||now<record.updated_at_ms{
        return Err("Native job finalization is stale or mismatched with its execution.".into());
    }
    record.phase="audit_verified".into();
    record.audit_success=Some(success);
    record.updated_at_ms=now;
    persist(path,&record)
}
/// Explicit post-crash reconciliation. A missing audit is never promoted to
/// success. This only closes a *known* interrupted action after the owner
/// confirms its external side effects have been inspected. Authorization,
/// cross-process exclusion and audit-receipt validation are enforced by the
/// Tauri entrypoint, NOT by this state transition.
fn reconcile_at(
    path:&Path,id:&str,tool:&str,verified_audit:Option<bool>,now:u64
)->Result<NativeJob,String>{
    let _lock=JOB_LOCK.lock().map_err(|_|"Native job lock poisoned.")?;
    let mut job=read_at(path)?.ok_or("No interrupted native worker job exists.")?;
    if job.phase!="running"||job.action_id!=id||job.tool!=tool{
        return Err("Owner review must match the exact interrupted native action and tool.".into());
    }
    if now<job.updated_at_ms{
        return Err("Owner review timestamp predates the durable native worker record.".into());
    }
    job.phase=if verified_audit.is_some(){"audit_verified".into()}
        else{"owner_reviewed_unknown".into()};
    job.audit_success=verified_audit;
    job.updated_at_ms=now;
    persist(path,&job)?;
    Ok(job)
}
pub(crate) fn reconcile(
    app:&AppHandle,id:&str,tool:&str,verified_audit:Option<bool>,now:u64
)->Result<NativeJob,String>{
    // This is called from the existing owner-confirmed Tauri reconciliation
    // under an exclusive desktop lease. Confirm the native UUID before
    // touching the associated unresolved OS-only subprocess receipt.
    let existing=read(app)?.ok_or("No durable native action for owner review.")?;
    if existing.phase!="running"||existing.action_id!=id||existing.tool!=tool{
        return Err("Owner review cannot acknowledge a different active action.".into());
    }
    crate::native_scheduler::owned_process::review_process_receipt_for_owner(app,id,tool)?;
    reconcile_at(&journal_path(app)?,id,tool,verified_audit,now)
}
pub(crate) fn begin(app:&AppHandle,id:&str,tool:&str,now:u64)->Result<(),String>{
    // Recover a prior fully audited+artifact-verified output reservation if
    // the host crashed between durable audit and normal resource release.
    // An unknown/failed external effect MUST keep its exclusive reservation.
    if let Some(prior)=read(app)?{
        if prior.phase=="audit_verified"&&prior.audit_success==Some(true){
            crate::native_scheduler::resource_lanes::release_after_verified_audit(
                app,&prior.action_id)?;
        }
    }
    begin_at(&journal_path(app)?,id,tool,now).map(|_|())
}
pub(crate) fn audit(app:&AppHandle,id:&str,success:bool,now:u64)->Result<(),String>{
    audited_at(&journal_path(app)?,id,success,now)?;
    // The audited exact UUID plus independently rehashed final certificate
    // is the sole automatic release condition. Failed actions remain held.
    if success {
        crate::native_scheduler::resource_lanes::release_after_verified_audit(app,id)?;
    }
    Ok(())
}
pub(crate) fn read(app:&AppHandle)->Result<Option<NativeJob>,String>{
    let _lock=JOB_LOCK.lock().map_err(|_|"Native job lock poisoned.")?;
    read_at(&journal_path(app)?)
}
pub(crate) fn require_resolved(app:&AppHandle)->Result<(),String>{
    // A healthy action journal cannot erase missing/unknown owned process
    // evidence, including a crash before the OS PID could be recorded.
    crate::native_scheduler::owned_process::require_process_receipt_clear(app)?;
    if read(app)?.is_some_and(|job|!matches!(job.phase.as_str(),"audit_verified"|"owner_reviewed_unknown")){
        return Err("An unfinished durable native worker job blocks all new desktop mutations until independent owner review.".into());
    }
    Ok(())
}

/// RAII host-supervisor heartbeat: the OS thread ticks the Rust process
/// even if external Adobe is hung. On drop it does NOT mark success or free
/// the native execution lease. Completion requires a separate durable audit.
pub(crate) struct SupervisorPulse{
    alive:Arc<AtomicBool>,
    thread:Option<thread::JoinHandle<()>>,
}
impl SupervisorPulse{
    pub(crate) fn start(app:AppHandle,id:String)->Self{
        let alive=Arc::new(AtomicBool::new(true));
        let flag=Arc::clone(&alive);
        let thread=thread::spawn(move||{
            while flag.load(Ordering::Acquire){
                thread::park_timeout(HEARTBEAT_PERIOD);
                if !flag.load(Ordering::Acquire){break;}
                let Ok(path)=journal_path(&app) else{break};
                if tick_at(&path,&id,crate::now_ms()).is_err(){break;}
            }
        });
        Self{alive,thread:Some(thread)}
    }
}
impl Drop for SupervisorPulse{
    fn drop(&mut self){
        self.alive.store(false,Ordering::Release);
        if let Some(t)=self.thread.take(){
            t.thread().unpark();
            let _=t.join();
        }
    }
}
#[cfg(test)]
mod tests{
    use super::*;
    fn file()->PathBuf{
        let p=std::env::temp_dir().join(format!("shuvi-job-{}.json",uuid::Uuid::new_v4()));
        p
    }
    const A:&str="e8b36b21-1c6a-459e-9b6f-75dd5692ab81";
    const B:&str="0f2977ac-4f61-4d9c-bf74-ecf8a3ae2172";
    #[test]
    fn durable_start_supervisor_tick_and_audit_are_bound_to_exact_action(){
        let p=file();
        begin_at(&p,A,"premiere_insert_media",1000).unwrap();
        assert_eq!(read_at(&p).unwrap().unwrap().heartbeat_seq,0);
        assert!(begin_at(&p,B,"read_file",1100).is_err());
        assert!(tick_at(&p,B,1200).is_err());
        tick_at(&p,A,2000).unwrap();
        assert_eq!(read_at(&p).unwrap().unwrap().heartbeat_seq,1);
        assert!(audited_at(&p,B,true,3000).is_err());
        audited_at(&p,A,false,3000).unwrap();
        assert_eq!(read_at(&p).unwrap().unwrap().audit_success,Some(false));
        assert!(tick_at(&p,A,4000).is_err());
        assert!(begin_at(&p,A,"premiere_insert_media",4100).is_err());
        begin_at(&p,B,"read_file",4500).unwrap();
        // The first UUID remains blocked even after a different audited job.
        audited_at(&p,B,true,4800).unwrap();
        assert!(begin_at(&p,A,"read_file",5000).unwrap_err().contains("cannot be replayed"));
        assert_eq!(read_at(&p).unwrap().unwrap().prior_action_ids,vec![A.to_string()]);
        fs::remove_file(p).unwrap();
    }
    #[test]
    fn restart_during_running_job_is_never_an_automatic_retry(){
        let p=file();
        begin_at(&p,A,"blender_run_plan",1000).unwrap();
        drop(read_at(&p).unwrap());
        assert!(begin_at(&p,B,"read_file",5000).unwrap_err().contains("owner audit review"));
        assert_eq!(read_at(&p).unwrap().unwrap().phase,"running");
        fs::remove_file(p).unwrap();
    }
    #[test]
    fn bounded_durable_replay_window_keeps_recent_audited_ids_after_rotation(){
        let p=file();
        let mut ids=Vec::new();
        for i in 0..30u64{
            let id=uuid::Uuid::new_v4().to_string();
            let at=1_000+i*1_000;
            begin_at(&p,&id,"read_file",at).unwrap();
            audited_at(&p,&id,true,at+100).unwrap();
            ids.push(id);
        }
        let last=read_at(&p).unwrap().unwrap();
        assert_eq!(last.prior_action_ids.len(),MAX_PRIOR_ACTIONS);
        assert_eq!(last.prior_action_ids.first(),Some(&ids[5]));
        assert_eq!(last.prior_action_ids.last(),Some(&ids[28]));
        assert!(begin_at(&p,&ids[23],"read_file",33_000).unwrap_err().contains("cannot be replayed"));
        // This protection is intentionally bounded; don't claim an
        // infinite action-history database from a 2 KiB journal.
        fs::remove_file(&p).unwrap();
        let backup=p.with_extension("json.bak");
        if backup.exists(){fs::remove_file(backup).unwrap();}
    }
    #[test]
    fn malformed_history_is_not_treated_as_empty_on_restart(){
        let p=file();
        begin_at(&p,A,"read_file",1000).unwrap();
        audited_at(&p,A,true,1200).unwrap();
        let mut bad=read_at(&p).unwrap().unwrap();
        bad.prior_action_ids.push(A.to_string());
        fs::write(&p,serde_json::to_vec(&bad).unwrap()).unwrap();
        assert!(begin_at(&p,B,"read_file",1300).unwrap_err().contains("malformed"));
        fs::remove_file(p).unwrap();
    }
    #[test]
    fn legacy_job_without_history_remains_readable_and_preserves_first_uuid(){
        let p=file();
        begin_at(&p,A,"read_file",1000).unwrap();
        audited_at(&p,A,true,1200).unwrap();
        let mut value=serde_json::to_value(read_at(&p).unwrap().unwrap()).unwrap();
        value.as_object_mut().unwrap().remove("priorActionIds");
        fs::write(&p,serde_json::to_vec(&value).unwrap()).unwrap();
        assert!(read_at(&p).unwrap().unwrap().prior_action_ids.is_empty());
        begin_at(&p,B,"premiere_context",1300).unwrap();
        assert_eq!(read_at(&p).unwrap().unwrap().prior_action_ids,vec![A.to_string()]);
        fs::remove_file(p).unwrap();
    }
    #[test]
    fn owner_review_unknown_preserves_uncertainty_and_blocks_exact_uuid_replay(){
        let p=file();
        begin_at(&p,A,"blender_run_plan",1000).unwrap();
        assert!(begin_at(&p,B,"read_file",2000).is_err());
        assert!(reconcile_at(&p,B,"blender_run_plan",None,3000).is_err());
        assert!(reconcile_at(&p,A,"premiere_insert_media",None,3000).is_err());
        assert_eq!(read_at(&p).unwrap().unwrap().phase,"running");
        let reviewed=reconcile_at(&p,A,"blender_run_plan",None,90_000_000).unwrap();
        assert_eq!(reviewed.phase,"owner_reviewed_unknown");
        assert_eq!(reviewed.audit_success,None);
        assert!(audited_at(&p,A,true,90_000_100).is_err());
        assert!(reconcile_at(&p,A,"blender_run_plan",Some(true),90_000_200).is_err());
        assert!(begin_at(&p,A,"read_file",90_000_300).is_err());
        begin_at(&p,B,"read_file",90_000_400).unwrap();
        assert_eq!(read_at(&p).unwrap().unwrap().prior_action_ids,vec![A.to_string()]);
        audited_at(&p,B,true,90_000_500).unwrap();
        assert!(begin_at(&p,A,"read_file",90_000_600).is_err());
        fs::remove_file(&p).unwrap();
    }
    #[test]
    fn owner_review_may_restore_only_an_externally_verified_rust_audit(){
        let p=file();
        begin_at(&p,A,"premiere_insert_media",1000).unwrap();
        let confirmed=reconcile_at(&p,A,"premiere_insert_media",Some(false),2000).unwrap();
        assert_eq!(confirmed.phase,"audit_verified");
        assert_eq!(confirmed.audit_success,Some(false));
        begin_at(&p,B,"read_file",3000).unwrap();
        audited_at(&p,B,true,3100).unwrap();
        fs::remove_file(&p).unwrap();
    }
    #[test]
    fn malformed_owner_review_state_still_fails_closed(){
        let p=file();
        begin_at(&p,A,"read_file",1000).unwrap();
        let mut value=read_at(&p).unwrap().unwrap();
        value.phase="owner_reviewed_unknown".into();
        value.audit_success=Some(true); // No result can be invented by a manual review.
        fs::write(&p,serde_json::to_vec(&value).unwrap()).unwrap();
        assert!(begin_at(&p,B,"read_file",2000).is_err());
        fs::remove_file(&p).unwrap();
    }
    #[test]
    fn poisoned_or_orphaned_job_journal_fails_closed(){
        let p=file();
        fs::write(&p,b"not-json").unwrap();
        assert!(begin_at(&p,A,"read_file",1000).is_err());
        fs::remove_file(&p).unwrap();
        let backup=p.with_extension("json.bak");
        fs::write(&backup,b"backup").unwrap();
        assert!(begin_at(&p,A,"read_file",1000).is_err());
        fs::remove_file(backup).unwrap();
    }
    #[test]
    fn malformed_ids_and_bogus_heartbeat_or_fake_audit_fail(){
        let p=file();
        assert!(begin_at(&p,"fake","read_file",1000).is_err());
        begin_at(&p,A,"read_file",1000).unwrap();
        assert!(tick_at(&p,A,1000).is_err());
        assert!(audited_at(&p,A,true,999).is_err());
        audited_at(&p,A,true,1300).unwrap();
        assert!(audited_at(&p,A,true,1400).is_err());
        fs::remove_file(p).unwrap();
    }
}
