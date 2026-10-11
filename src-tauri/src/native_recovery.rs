//! A separate, bounded inspection-only checkpoint for the installed Native Dashboard.
 //! This is NOT a task-grant, replay queue, or replacement for Rust action audit.
use std::{fs, path::PathBuf};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

const MAX_BYTES:usize=4096;
const TWO_HOURS:u64=7_200_000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub(crate) struct NativeRecoveryRecord {
    pub version:u32,
    pub max_actions:u32,
    pub staged_actions:u32,
    pub model_requests:u32,
    pub expires_at:u64,
    pub updated_at:u64,
    pub phase:String,
    pub action_id:Option<String>,
}
fn valid(value:&NativeRecoveryRecord)->Result<(),String>{
    if value.version!=1||![8,24,48].contains(&value.max_actions){
        return Err("Unsupported native recovery version or owner budget.".into());
    }
    if value.staged_actions>value.max_actions||value.model_requests>value.max_actions+1{
        return Err("Native recovery budget counters exceed the owner limits.".into());
    }
    if !matches!(value.phase.as_str(),"model_reserved"|"awaiting_approval"|"executing"|
        "audit_verified"|"paused"|"outcome_unknown"){
        return Err("Unsupported native recovery transition.".into());
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
    if matches!(value.phase.as_str(),"awaiting_approval"|"executing"|"audit_verified")&&
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
pub(crate) fn save(app:&AppHandle,mut record:NativeRecoveryRecord)->Result<(),String>{
    record.version=1;
    record.updated_at=crate::now_ms();
    valid(&record)?;
    let bytes=serde_json::to_vec(&record).map_err(|_|"Native recovery could not be encoded.".to_string())?;
    crate::premiere_store::replace(&path(app)?,&bytes,MAX_BYTES,validate_bytes)
}
pub(crate) fn load(app:&AppHandle)->Result<Option<NativeRecoveryRecord>,String>{
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
            version:1,max_actions:8,staged_actions:1,model_requests:1,
            expires_at:7_200_001,updated_at:1,phase:"executing".into(),
            action_id:Some("action-1".into())
        }
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
