//! Bounded history of real Rust-owned native tool executions.
//! Never schedules, approves, retries or manufactures external progress.
use serde::{Deserialize,Serialize};
use std::{collections::HashSet,fs,path::{Path,PathBuf},sync::Mutex};
use tauri::{AppHandle,Manager};
const MAX_ITEMS:usize=48;
const MAX_BYTES:usize=20480;
static IO_LOCK:Mutex<()>=Mutex::new(());
#[derive(Clone,Debug,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub(crate) struct Item {
    pub action_id:String,
    pub tool:String,
    pub phase:String,
    pub started_at_ms:u64,
    pub completed_at_ms:Option<u64>,
    pub audit_success:Option<bool>,
}
#[derive(Clone,Debug,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub(crate) struct History {
    pub version:u32,
    pub items:Vec<Item>,
}
fn validate(history:&History)->Result<(),String>{
    if history.version!=1||history.items.len()>MAX_ITEMS{
        return Err("Native job history version or item budget invalid.".into());
    }
    let mut seen=HashSet::new();
    let mut started=0;
    for (i,item) in history.items.iter().enumerate(){
        if uuid::Uuid::parse_str(&item.action_id)
            .map(|id|id.to_string()!=item.action_id).unwrap_or(true)
            ||!seen.insert(item.action_id.as_str())
            ||item.tool.is_empty()||item.tool.len()>160
            ||!item.tool.bytes().all(|c|c.is_ascii_lowercase()||c.is_ascii_digit()||c==b'_')
            ||item.started_at_ms==0||item.started_at_ms<started{
            return Err("Duplicate, forged or out-of-order native action identity.".into());
        }
        started=item.started_at_ms;
        match (item.phase.as_str(),item.audit_success,item.completed_at_ms){
            ("running",None,None) if i+1==history.items.len()=>{},
            ("audit_verified",Some(_),Some(n)) if n>=item.started_at_ms=>{},
            ("owner_reviewed_unknown",None,Some(n)) if n>=item.started_at_ms=>{},
            _=>return Err("Native history has unverified completion state.".into()),
        }
    }
    Ok(())
}
fn check(raw:&[u8])->Result<(),String>{
    if raw.len()>MAX_BYTES{return Err("Native history exceeds disk budget.".into());}
    let history:History=serde_json::from_slice(raw)
        .map_err(|_|"Native history checkpoint malformed.".to_string())?;
    validate(&history)
}
fn path(app:&AppHandle)->Result<PathBuf,String>{
    let root=app.path().app_data_dir().map_err(|_|"Native history directory unavailable.".to_string())?;
    fs::create_dir_all(&root).map_err(|_|"Native history directory inaccessible.".to_string())?;
    Ok(root.join("native-worker-history.json"))
}
fn load_at(file:&Path)->Result<History,String>{
    if !file.exists(){
        if file.with_extension("json.bak").exists(){
            return Err("Orphaned native history backup: owner review required.".into());
        }
        return Ok(History{version:1,items:Vec::new()});
    }
    let bytes=crate::read_file_bytes_bounded(file,MAX_BYTES,"native job history")?;
    check(&bytes)?;
    serde_json::from_slice(&bytes).map_err(|_|"Native history unreadable.".to_string())
}
fn save_at(file:&Path,h:&History)->Result<(),String>{
    validate(h)?;
    let bytes=serde_json::to_vec(h).map_err(|_|"Cannot serialize native history.".to_string())?;
    crate::premiere_store::replace(file,&bytes,MAX_BYTES,check)
}
fn item_from_native(native:&crate::native_worker_job::NativeJob)->Result<Item,String>{
    let phase=native.phase.as_str();
    if !matches!(phase,"running"|"audit_verified"|"owner_reviewed_unknown"){
        return Err("Unknown authoritative native job phase.".into());
    }
    Ok(Item{
        action_id:native.action_id.clone(),tool:native.tool.clone(),
        phase:native.phase.clone(),started_at_ms:native.started_at_ms,
        completed_at_ms:(phase!="running").then_some(native.updated_at_ms),
        audit_success:native.audit_success,
    })
}
fn reconcile_last(h:&mut History,native:&crate::native_worker_job::NativeJob)->Result<bool,String>{
    let last=h.items.last_mut().ok_or("Native history has no action to reconcile.")?;
    if last.action_id!=native.action_id||last.tool!=native.tool
        ||last.started_at_ms!=native.started_at_ms{
        return Err("Native history disagrees with authoritative action identity.".into());
    }
    if last.phase=="running"{
        if native.phase=="running"{
            return Err("Native action outcome is unknown; no automatic resume.".into());
        }
        if !matches!(native.phase.as_str(),"audit_verified"|"owner_reviewed_unknown"){
            return Err("Unsupported final native job state.".into());
        }
        last.phase=native.phase.clone();
        last.audit_success=native.audit_success;
        last.completed_at_ms=Some(native.updated_at_ms.max(last.started_at_ms));
        return Ok(true);
    }
    if last.phase!=native.phase||last.audit_success!=native.audit_success{
        return Err("Native journal conflicts with terminal history receipt.".into());
    }
    Ok(false)
}
fn before_next_at(file:&Path,native:Option<&crate::native_worker_job::NativeJob>)->Result<(),String>{
    let _guard=IO_LOCK.lock().map_err(|_|"Native history lock poisoned.")?;
    let mut h=load_at(file)?;
    if h.items.is_empty(){return Ok(());}
    let journal=native.ok_or("Native worker journal missing while history exists.")?;
    if reconcile_last(&mut h,journal)?{save_at(file,&h)?;}
    Ok(())
}
pub(crate) fn before_next(app:&AppHandle,native:Option<&crate::native_worker_job::NativeJob>)->Result<(),String>{
    before_next_at(&path(app)?,native)
}
fn begin_at(file:&Path,native:&crate::native_worker_job::NativeJob)->Result<(),String>{
    let _guard=IO_LOCK.lock().map_err(|_|"Native history lock poisoned.")?;
    if native.phase!="running"||native.audit_success.is_some(){
        return Err("History start must match an approved running Rust action.".into());
    }
    let mut h=load_at(file)?;
    if h.items.last().is_some_and(|item|item.phase=="running"){
        return Err("Unresolved prior job prevents another native history entry.".into());
    }
    if h.items.iter().any(|item|item.action_id==native.action_id){
        return Err("Native history UUID replay refused.".into());
    }
    if h.items.len()==MAX_ITEMS{h.items.remove(0);}
    h.items.push(item_from_native(native)?);
    save_at(file,&h)
}
pub(crate) fn begin(app:&AppHandle)->Result<(),String>{
    let native=crate::native_worker_job::read(app)?
        .ok_or("Native action was not durably started.")?;
    begin_at(&path(app)?,&native)
}
fn finish_at(file:&Path,native:&crate::native_worker_job::NativeJob)->Result<(),String>{
    let _guard=IO_LOCK.lock().map_err(|_|"Native history lock poisoned.")?;
    if !matches!(native.phase.as_str(),"audit_verified"|"owner_reviewed_unknown"){
        return Err("Native history cannot finalize without a real audit/review.".into());
    }
    let mut h=load_at(file)?;
    if h.items.is_empty(){
        // Upgrade from older releases: preserve the exact terminal Rust
        // receipt, but never pretend a missing action was executed.
        h.items.push(item_from_native(native)?);
        return save_at(file,&h);
    }
    if reconcile_last(&mut h,native)?{save_at(file,&h)?;}
    Ok(())
}
pub(crate) fn finish(app:&AppHandle)->Result<(),String>{
    let native=crate::native_worker_job::read(app)?
        .ok_or("Native audit record is missing.")?;
    finish_at(&path(app)?,&native)
}
pub(crate) fn read(app:&AppHandle)->Result<History,String>{
    let _guard=IO_LOCK.lock().map_err(|_|"Native history lock poisoned.")?;
    load_at(&path(app)?)
}
#[cfg(test)]
mod tests{
    use super::*;
    const A:&str="e8b36b21-1c6a-459e-9b6f-75dd5692ab81";
    const B:&str="0f2977ac-4f61-4d9c-bf74-ecf8a3ae2172";
    fn temp()->PathBuf{std::env::temp_dir().join(format!("shuvi-native-history-{}.json",uuid::Uuid::new_v4()))}
    fn native(id:&str,phase:&str,success:Option<bool>,at:u64)->crate::native_worker_job::NativeJob{
        crate::native_worker_job::NativeJob{version:1,action_id:id.into(),tool:"blender_run_plan".into(),
            phase:phase.into(),started_at_ms:at,updated_at_ms:at+100,
            heartbeat_seq:0,audit_success:success,prior_action_ids:Vec::new()}
    }
    fn clean(p:&Path){
        let _=fs::remove_file(p);
        let _=fs::remove_file(p.with_extension("json.bak"));
    }
    #[test]
    fn two_real_actions_survive_restart_and_duplicate_uuid_fails(){
        let p=temp();
        let a=native(A,"running",None,1000);
        begin_at(&p,&a).unwrap();
        assert!(before_next_at(&p,Some(&a)).is_err());
        assert!(begin_at(&p,&native(B,"running",None,2000)).is_err());
        let audited=native(A,"audit_verified",Some(true),1000);
        before_next_at(&p,Some(&audited)).unwrap();
        assert!(begin_at(&p,&a).is_err());
        let b=native(B,"running",None,2000);
        begin_at(&p,&b).unwrap();
        finish_at(&p,&native(B,"audit_verified",Some(false),2000)).unwrap();
        let stored=load_at(&p).unwrap();
        assert_eq!(stored.items.len(),2);
        assert_eq!(stored.items[0].audit_success,Some(true));
        assert_eq!(stored.items[1].audit_success,Some(false));
        clean(&p);
    }
    #[test]
    fn unknown_owner_review_does_not_forge_success(){
        let p=temp();
        begin_at(&p,&native(A,"running",None,1000)).unwrap();
        finish_at(&p,&native(A,"owner_reviewed_unknown",None,1000)).unwrap();
        let stored=load_at(&p).unwrap();
        assert_eq!(stored.items[0].phase,"owner_reviewed_unknown");
        assert_eq!(stored.items[0].audit_success,None);
        clean(&p);
    }
    #[test]
    fn mismatched_corrupt_or_orphaned_records_fail_closed(){
        let p=temp();
        begin_at(&p,&native(A,"running",None,1000)).unwrap();
        assert!(before_next_at(&p,Some(&native(B,"audit_verified",Some(true),2000))).is_err());
        fs::write(&p,b"invalid").unwrap();
        assert!(before_next_at(&p,None).is_err());
        clean(&p);
        fs::write(p.with_extension("json.bak"),b"backup").unwrap();
        assert!(load_at(&p).is_err());
        clean(&p);
    }
    #[test]
    fn bounded_history_rotates_only_terminal_actions(){
        let p=temp();
        for i in 0..52{
            let id=uuid::Uuid::new_v4().to_string();
            let at=1000+i*1000;
            begin_at(&p,&native(&id,"running",None,at)).unwrap();
            finish_at(&p,&native(&id,"audit_verified",Some(true),at)).unwrap();
        }
        assert_eq!(load_at(&p).unwrap().items.len(),MAX_ITEMS);
        clean(&p);
    }
}
