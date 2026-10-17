//! A separate, bounded inspection-only checkpoint for the installed Native Dashboard.
 //! This is NOT a task-grant, replay queue, or replacement for Rust action audit.
use std::{fs, path::{Path,PathBuf},sync::Mutex};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

const MAX_BYTES:usize=4096;
const TWO_HOURS:u64=7_200_000;
const MAX_SAFE_REVISION:u64=9_007_199_254_740_991;
static RECOVERY_LOCK:Mutex<()>=Mutex::new(());

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub(crate) struct NativeRecoveryRecord {
    pub version:u32,
    // v1 snapshots have no identity and remain read-only historical evidence.
    // Every new save must be v2 and bind its exact independent task UUID.
    #[serde(default,skip_serializing_if="Option::is_none")]
    pub task_id:Option<String>,
    // Historical v2 records may lack an ordinal: inspect, never extend them.
    #[serde(default,skip_serializing_if="Option::is_none")]
    pub revision:Option<u64>,
    pub max_actions:u32,
    pub staged_actions:u32,
    pub model_requests:u32,
    pub expires_at:u64,
    pub updated_at:u64,
    pub phase:String,
    pub action_id:Option<String>,
}
fn valid(value:&NativeRecoveryRecord)->Result<(),String>{
    if ![1,2].contains(&value.version)||![8,24,48].contains(&value.max_actions){
        return Err("Unsupported native recovery version or owner budget.".into());
    }
    match (value.version,value.task_id.as_deref()) {
        (1,None)=>{},
        (2,Some(id)) if uuid::Uuid::parse_str(id)
            .map(|uuid|uuid.to_string()==id).unwrap_or(false)=>{},
        _=>return Err("Native recovery checkpoint lacks a valid task identity.".into())
    }
    match (value.version,value.revision){
        (1,None)=>{},
        (2,None)=>{}, // Historical v2 remains read-only.
        (2,Some(n)) if (1..=MAX_SAFE_REVISION).contains(&n)=>{},
        _=>return Err("Invalid native recovery checkpoint revision.".into())
    }
    if value.staged_actions>value.max_actions||value.model_requests>value.max_actions+1{
        return Err("Native recovery budget counters exceed the owner limits.".into());
    }
    if !matches!(value.phase.as_str(),"model_reserved"|"awaiting_approval"|"executing"|
        "audit_verified"|"native_denied"|"paused"|"outcome_unknown"){
        return Err("Unsupported native recovery transition.".into());
    }
    if value.phase=="native_denied"&&
       (value.version!=2||value.revision.is_none()){
        return Err("Native denial requires revisioned v2 inspection evidence.".into());
    }
    if value.updated_at==0||value.expires_at==0||
       value.expires_at>value.updated_at.saturating_add(TWO_HOURS)||
       value.expires_at.saturating_add(TWO_HOURS)<value.updated_at{
        return Err("Invalid native recovery task deadline.".into());
    }
    if let Some(id)=&value.action_id{
        if id.is_empty()||id.len()>128||
           !id.bytes().all(|b|b.is_ascii_alphanumeric()||b=='-' as u8||b=='_' as u8){
            return Err("Invalid native recovery action identifier.".into());
        }
    }
    if matches!(value.phase.as_str(),"awaiting_approval"|"executing"|"audit_verified"|"native_denied")&&
       (value.action_id.is_none()||value.staged_actions==0){
        return Err("Native recovery action phase has no staged identity.".into());
    }
    Ok(())
}
fn validate_bytes(bytes:&[u8])->Result<(),String>{
    if bytes.len()>MAX_BYTES{return Err("Native recovery snapshot is oversized.".into());}
    let state:NativeRecoveryRecord=serde_json::from_slice(bytes)
        .map_err(|_|"Native recovery snapshot JSON is malformed.".to_string())?;
    valid(&state)
}
fn path(app:&AppHandle)->Result<PathBuf,String>{
    let dir=app.path().app_data_dir().map_err(|_|"Native recovery directory unavailable.".to_string())?;
    fs::create_dir_all(&dir).map_err(|_|"Native recovery directory could not be created.".to_string())?;
    Ok(dir.join("native-recovery.json"))
}
// An old/late IPC call cannot overwrite a newer task or an already
// durably published step. This check and the atomic file replacement run
// under the same recovery lock, including against owner clear.
fn validate_advance(old:Option<&NativeRecoveryRecord>,next:&NativeRecoveryRecord)->Result<(),String>{
    let revision=next.revision.ok_or("New recovery checkpoint requires an ordinal.")?;
    match old {
        None if revision==1&&next.phase=="model_reserved"&&next.model_requests==1&&
            next.staged_actions==0&&next.action_id.is_none()=>Ok(()),
        None=>Err("First recovery checkpoint must reserve a single model request without an action.".into()),
        Some(previous)=>{
            if previous.version!=2||previous.task_id!=next.task_id{
                return Err("Prior recovery task identity requires owner acknowledgement.".into());
            }
            let previous_revision=previous.revision.ok_or("Older recovery checkpoint has no replay-safe revision.")?;
            if previous_revision.checked_add(1)!=Some(revision){
                return Err("Stale, skipped or duplicate recovery revision refused.".into());
            }
            if next.max_actions!=previous.max_actions||next.expires_at!=previous.expires_at||
               next.model_requests<previous.model_requests||next.staged_actions<previous.staged_actions{
                return Err("Native recovery task budget or counters regressed.".into());
            }
            // A possibly dispatched action cannot become a harmless paused
            // state; the audit has to be verified, or the outcome stays unknown.
            if next.phase=="paused"&&
               matches!(previous.phase.as_str(),"executing"|"outcome_unknown"){
                return Err("In-flight Windows execution cannot be downgraded to paused.".into());
            }
            // An old provider reservation cannot be made again from an
            // awaiting, executing or unknown checkpoint without review.
            if next.phase=="model_reserved"&&
               !matches!(previous.phase.as_str(),"paused"|"audit_verified"){
                return Err("Unresolved native action cannot reserve a new paid request.".into());
            }
            // A new revision alone cannot authorize a second execution of
            // an old approved action or forge an audit success.
            if next.phase=="executing"&&
               (previous.phase!="awaiting_approval"||previous.action_id!=next.action_id||
                previous.staged_actions!=next.staged_actions){
                return Err("Native execution must follow exactly its approved action.".into());
            }
            if next.phase=="audit_verified"&&
               (previous.phase!="executing"||previous.action_id!=next.action_id||
                previous.staged_actions!=next.staged_actions){
                return Err("Native audit verification must follow that action's execution.".into());
            }
            // A native_denied checkpoint is inspection-only. In particular,
            // it never grants a fresh model reservation or action execution.
            if next.phase=="native_denied"&&
               (previous.phase!="executing"||previous.action_id!=next.action_id||
                next.action_id.is_none()||previous.staged_actions!=next.staged_actions||
                previous.model_requests!=next.model_requests){
                return Err("Native denial must match the exact in-flight prepared action.".into());
            }
            if next.phase=="awaiting_approval"&&
               (!matches!(previous.phase.as_str(),"model_reserved"|"outcome_unknown")||
                next.staged_actions!=previous.staged_actions.saturating_add(1)||
                previous.action_id==next.action_id){
                return Err("Native approval must stage one NEW bounded action.".into());
            }
            if next.phase=="model_reserved"&&next.model_requests!=previous.model_requests.saturating_add(1){
                return Err("Native model reservation cannot reuse an old paid request.".into());
            }
            Ok(())
        }
    }
}
fn store_record(file:&Path,mut record:NativeRecoveryRecord,now:u64)->Result<(),String>{
    if record.version!=2||record.revision.is_none(){
        return Err("New native recovery writes require a task-bound revisioned v2 record.".into());
    }
    record.updated_at=now;
    valid(&record)?;
    // A backup without a primary means an interrupted disk publication,
    // not permission to treat the drive as an empty task.
    let previous=if file.exists(){
        let bytes=crate::read_file_bytes_bounded(file,MAX_BYTES,"native recovery journal")?;
        validate_bytes(&bytes)?;
        Some(serde_json::from_slice::<NativeRecoveryRecord>(&bytes)
            .map_err(|_|"Native recovery primary is unreadable.".to_string())?)
    }else if file.with_extension("json.bak").exists(){
        return Err("Orphaned native recovery backup requires owner review.".into());
    }else{None};
    validate_advance(previous.as_ref(),&record)?;
    let bytes=serde_json::to_vec(&record).map_err(|_|"Native recovery could not be encoded.".to_string())?;
    crate::premiere_store::replace(file,&bytes,MAX_BYTES,validate_bytes)
}
pub(crate) fn save(app:&AppHandle,record:NativeRecoveryRecord)->Result<(),String>{
    let _guard=RECOVERY_LOCK.lock().map_err(|_|"Native recovery lock unavailable.")?;
    store_record(&path(app)?,record,crate::now_ms())
}
pub(crate) fn load(app:&AppHandle)->Result<Option<NativeRecoveryRecord>,String>{
    let _guard=RECOVERY_LOCK.lock().map_err(|_|"Native recovery lock unavailable.")?;
    let file=path(app)?;
    let backup=file.with_extension("json.bak");
    if !file.exists()&&!backup.exists(){return Ok(None);}
    let parse=|candidate:&std::path::Path|->Result<NativeRecoveryRecord,String>{
        let bytes=crate::read_file_bytes_bounded(candidate,MAX_BYTES,"native recovery journal")?;
        validate_bytes(&bytes)?;
        serde_json::from_slice(&bytes).map_err(|_|"Native recovery read failed.".to_string())
    };
    let record=if file.exists(){
        parse(&file).or_else(|primary_error|if backup.exists(){parse(&backup)}else{Err(primary_error)})?
    }else{parse(&backup)?};
    Ok(Some(record))
}
pub(crate) fn clear(app:&AppHandle)->Result<(),String>{
    let _guard=RECOVERY_LOCK.lock().map_err(|_|"Native recovery lock unavailable.")?;
    crate::premiere_store::clear_snapshot(&path(app)?)
}

#[tauri::command]
pub(crate) fn save_native_recovery(record:NativeRecoveryRecord,app:AppHandle)->Result<(),String>{
    save(&app,record)
}
#[tauri::command]
pub(crate) fn load_native_recovery(app:AppHandle)->Result<Option<NativeRecoveryRecord>,String>{
    load(&app)
}
#[tauri::command]
pub(crate) fn clear_native_recovery(app:AppHandle)->Result<(),String>{
    clear(&app)
}

#[cfg(test)]
mod tests{
    use super::*;
    fn state()->NativeRecoveryRecord{
        NativeRecoveryRecord{
            version:2,task_id:Some("0f2977ac-4f61-4d9c-bf74-ecf8a3ae2172".into()),
            revision:Some(1),max_actions:8,staged_actions:1,model_requests:1,
            expires_at:7_200_001,updated_at:1,phase:"executing".into(),
            action_id:Some("action-1".into())
        }
    }
    #[test]
    fn native_denial_is_ordered_owner_review_evidence_not_new_execution_permission() {
        let executing=state();
        let denied=NativeRecoveryRecord{
            revision:Some(2),phase:"native_denied".into(),..executing.clone()
        };
        assert!(valid(&denied).is_ok());
        assert!(validate_advance(Some(&executing),&denied).is_ok());
        assert!(validate_advance(Some(&NativeRecoveryRecord{
            phase:"awaiting_approval".into(),..executing.clone()
        }),&denied).is_err());
        assert!(validate_advance(Some(&executing),&NativeRecoveryRecord{
            action_id:Some("foreign-action".into()),..denied.clone()
        }).is_err());
        assert!(validate_advance(Some(&executing),&NativeRecoveryRecord{
            model_requests:2,..denied.clone()
        }).is_err());
        assert!(validate_advance(Some(&denied),&NativeRecoveryRecord{
            revision:Some(3),phase:"model_reserved".into(),
            model_requests:2,..denied.clone()
        }).is_err());
        assert!(validate_advance(Some(&denied),&NativeRecoveryRecord{
            revision:Some(3),phase:"executing".into(),..denied.clone()
        }).is_err());
        assert!(valid(&NativeRecoveryRecord{
            revision:None,..denied.clone()
        }).is_err());
        assert!(valid(&NativeRecoveryRecord{
            action_id:None,..denied
        }).is_err());
    }
    #[test]
    fn rejects_overbudget_or_uncorrelated_action_phases(){
        let s=state();
        assert!(valid(&s).is_ok());
        assert!(valid(&NativeRecoveryRecord{max_actions:7,..s.clone()}).is_err());
        assert!(valid(&NativeRecoveryRecord{model_requests:10,..s.clone()}).is_err());
        assert!(valid(&NativeRecoveryRecord{staged_actions:9,..s.clone()}).is_err());
        assert!(valid(&NativeRecoveryRecord{action_id:None,..s.clone()}).is_err());
        assert!(valid(&NativeRecoveryRecord{action_id:Some("bad<id>".into()),..s}).is_err());
    }
    #[test]
    fn legacy_v1_is_inspectable_but_cannot_be_saved_as_a_new_task(){
        let old=NativeRecoveryRecord{version:1,task_id:None,revision:None,..state()};
        assert!(valid(&old).is_ok());
        let raw=serde_json::to_vec(&old).unwrap();
        validate_bytes(&raw).unwrap();
        assert!(serde_json::from_slice::<NativeRecoveryRecord>(&raw).unwrap().task_id.is_none());
        // Old evidence can be loaded, but cannot be used as new execution authority.
        let missing=NativeRecoveryRecord{task_id:None,..state()};
        assert!(valid(&missing).is_err());
        assert!(valid(&NativeRecoveryRecord{version:1,..state()}).is_err());
        assert!(valid(&NativeRecoveryRecord{task_id:Some("not-a-uuid".into()),..state()}).is_err());
    }
    #[test]
    fn rejects_duplicate_skipped_regressed_and_cross_task_recovery(){
        let first=state();
        assert!(validate_advance(None,&first).is_err(),"initial execution without a reservation is invalid");
        assert!(validate_advance(Some(&first),&first).is_err());
        assert!(validate_advance(None,&NativeRecoveryRecord{revision:Some(2),..first.clone()}).is_err());
        let next=NativeRecoveryRecord{revision:Some(2),phase:"audit_verified".into(),..first.clone()};
        assert!(validate_advance(Some(&first),&next).is_ok());
        assert!(validate_advance(Some(&next),&first).is_err());
        assert!(validate_advance(Some(&first),&NativeRecoveryRecord{
            revision:Some(3),..next.clone()}).is_err());
        assert!(validate_advance(Some(&first),&NativeRecoveryRecord{
            revision:Some(2),task_id:Some("e8b36b21-1c6a-459e-9b6f-75dd5692ab81".into()),..next.clone()}).is_err());
        assert!(validate_advance(Some(&first),&NativeRecoveryRecord{
            revision:Some(2),model_requests:0,..next.clone()}).is_err());
        assert!(validate_advance(Some(&first),&NativeRecoveryRecord{
            revision:Some(2),expires_at:7_100_000,..next.clone()}).is_err());
        assert!(validate_advance(Some(&NativeRecoveryRecord{revision:None,..first.clone()}),&next).is_err());
    }
    #[test]
    fn action_event_order_is_correlated_and_never_replays_old_approval(){
        let executed=state();
        let approved=NativeRecoveryRecord{revision:Some(1),phase:"awaiting_approval".into(),..executed.clone()};
        let attempt=NativeRecoveryRecord{revision:Some(2),..executed.clone()};
        assert!(validate_advance(Some(&approved),&attempt).is_ok());
        assert!(validate_advance(Some(&executed),&NativeRecoveryRecord{revision:Some(2),..executed.clone()}).is_err());
        assert!(validate_advance(Some(&approved),&NativeRecoveryRecord{
            revision:Some(2),action_id:Some("other-action".into()),..executed.clone()}).is_err());
        let audited=NativeRecoveryRecord{revision:Some(2),phase:"audit_verified".into(),..executed.clone()};
        assert!(validate_advance(Some(&executed),&audited).is_ok());
        assert!(validate_advance(Some(&approved),&audited).is_err());
        let read=NativeRecoveryRecord{revision:Some(2),phase:"awaiting_approval".into(),
            action_id:Some("new-inspection".into()),staged_actions:2,..executed.clone()};
        assert!(validate_advance(Some(&executed),&read).is_err(),
            "A new approval may not bypass the last action's unverified execution");
        let uncertain=NativeRecoveryRecord{phase:"outcome_unknown".into(),..executed.clone()};
        assert!(validate_advance(Some(&uncertain),&read).is_ok(),
            "An audited read-only recovery may be staged after marking the failed result unknown");
        assert!(validate_advance(Some(&executed),&NativeRecoveryRecord{
            revision:Some(2),staged_actions:1,..read}).is_err());
        assert!(validate_advance(Some(&executed),&NativeRecoveryRecord{
            revision:Some(2),phase:"model_reserved".into(),..executed.clone()}).is_err());
    }
    #[test]
    fn cannot_downgrade_inflight_execution_or_reserve_again_from_unknown(){
        let base=state();
        assert!(validate_advance(None,&base).is_err(),"first checkpoint must be model_reserved");
        let reserved=NativeRecoveryRecord{
            phase:"model_reserved".into(),action_id:None,staged_actions:0,..base.clone()};
        assert!(validate_advance(None,&reserved).is_ok());
        let inflight=NativeRecoveryRecord{revision:Some(2),..base.clone()};
        let paused=NativeRecoveryRecord{
            revision:Some(2),phase:"paused".into(),..base.clone()};
        assert!(validate_advance(Some(&base),&paused).is_err());
        let uncertain=NativeRecoveryRecord{
            revision:Some(2),phase:"outcome_unknown".into(),..base.clone()};
        let paid_again=NativeRecoveryRecord{
            revision:Some(3),phase:"model_reserved".into(),model_requests:2,..base.clone()};
        assert!(validate_advance(Some(&uncertain),&paid_again).is_err());
        assert!(validate_advance(Some(&uncertain),&NativeRecoveryRecord{
            phase:"paused".into(),revision:Some(3),..base.clone()}).is_err());

        assert!(validate_advance(Some(&base),&inflight).is_err());
    }
    #[test]
    fn refuses_overwriting_orphaned_or_stale_checkpoint_on_disk(){
        let folder=std::env::temp_dir().join(format!("shuvi-revision-check-{}",uuid::Uuid::new_v4()));
        fs::create_dir(&folder).unwrap();
        let file=folder.join("native-recovery.json");
        let one=NativeRecoveryRecord{
            phase:"model_reserved".into(),staged_actions:0,action_id:None,..state()};
        store_record(&file,one.clone(),1).unwrap();
        assert!(store_record(&file,one.clone(),2).is_err());
        let two=NativeRecoveryRecord{revision:Some(2),phase:"awaiting_approval".into(),
            staged_actions:1,action_id:Some("action-1".into()),..one.clone()};
        store_record(&file,two.clone(),2).unwrap();
        assert!(store_record(&file,NativeRecoveryRecord{revision:Some(3),task_id:Some(
            "e8b36b21-1c6a-459e-9b6f-75dd5692ab81".into()),..one.clone()},3).is_err());
        assert!(store_record(&file,one,3).is_err());
        fs::remove_file(&file).unwrap();
        assert!(store_record(&file,NativeRecoveryRecord{revision:Some(3),..two},3).is_err());
        fs::remove_dir_all(folder).unwrap();
    }
    #[test]
    fn snapshot_remains_atomic_and_recovers_last_valid_backup(){
        let folder=std::env::temp_dir().join(format!("shuvi-native-recovery-{}",uuid::Uuid::new_v4()));
        fs::create_dir(&folder).unwrap();
        let file=folder.join("native-recovery.json");
        let first=serde_json::to_vec(&state()).unwrap();
        crate::premiere_store::replace(&file,&first,MAX_BYTES,validate_bytes).unwrap();
        let later=NativeRecoveryRecord{phase:"audit_verified".into(),..state()};
        let second=serde_json::to_vec(&later).unwrap();
        crate::premiere_store::replace(&file,&second,MAX_BYTES,validate_bytes).unwrap();
        assert_eq!(fs::read(&file).unwrap(),second);
        assert_eq!(fs::read(file.with_extension("json.bak")).unwrap(),first);
        fs::remove_dir_all(folder).unwrap();
    }
}
