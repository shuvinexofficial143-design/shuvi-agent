//! Persist HMAC-verified, exact-action, approved-plan worker STAGE evidence.
//! This does not prove Blender app success, OS liveness or permission to retry.
//! The launch supervisor holds the private HMAC key; only verified stage
//! transitions are admitted by this journal's production writer.
use serde::{Deserialize,Serialize};
use std::{fs,path::{Path,PathBuf},sync::Mutex};
use tauri::{AppHandle,Manager};

const MAX_BYTES:usize=1024;
static WRITE_LOCK:Mutex<()>=Mutex::new(());

#[derive(Clone,Debug,Serialize,Deserialize,PartialEq,Eq)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub(crate) struct AttestedStage {
    pub version:u32,
    pub action_id:String,
    pub approved_plan_sha256:String,
    pub sequence:u64,
    pub stage:String,
    pub observed_at_ms:u64,
}
fn rank(stage:&str)->Option<u8>{
    match stage{
        "python_active"=>Some(1),
        "blender_session_attached"=>Some(2),
        "plan_verified"=>Some(3),
        "artifact_rehashed"=>Some(4),
        _=>None,
    }
}
fn valid(v:&AttestedStage)->Result<(),String>{
    if v.version!=1 || v.sequence==0 || v.sequence>1_000_000
        ||v.observed_at_ms==0 ||rank(&v.stage).is_none()
        ||uuid::Uuid::parse_str(&v.action_id)
            .map(|u|u.to_string()!=v.action_id).unwrap_or(true)
        ||v.approved_plan_sha256.len()!=64
        ||!v.approved_plan_sha256.bytes().all(|b|
            b.is_ascii_digit()||(b'a'..=b'f').contains(&b)){
        return Err("Native signed-worker stage journal invalid.".into());
    }
    Ok(())
}
fn check(raw:&[u8])->Result<(),String>{
    if raw.len()>MAX_BYTES{return Err("Signed worker stage journal oversized.".into());}
    let value:AttestedStage=serde_json::from_slice(raw)
        .map_err(|_|"Signed worker stage journal corrupt.".to_string())?;
    valid(&value)
}
fn path(app:&AppHandle)->Result<PathBuf,String>{
    let dir=app.path().app_data_dir()
        .map_err(|_|"Worker stage journal directory unavailable.")?;
    fs::create_dir_all(&dir)
        .map_err(|_|"Cannot prepare worker stage journal directory.")?;
    Ok(dir.join("native-attested-worker-stage.json"))
}
fn read_at(file:&Path)->Result<Option<AttestedStage>,String>{
    if !file.exists(){
        if file.with_extension("json.bak").exists(){
            return Err("Worker stage journal backup without primary; owner review.".into());
        }
        return Ok(None);
    }
    let meta=fs::symlink_metadata(file)
        .map_err(|_|"Worker stage journal metadata unavailable.")?;
    if !meta.is_file()||meta.file_type().is_symlink(){
        return Err("Worker stage journal path must be a real file.".into());
    }
    let raw=crate::read_file_bytes_bounded(file,MAX_BYTES,"signed worker stage")?;
    check(&raw)?;
    serde_json::from_slice(&raw).map(Some)
        .map_err(|_|"Signed stage journal decode failed.".into())
}
fn record_at(file:&Path,next:AttestedStage)->Result<(),String>{
    let _guard=WRITE_LOCK.lock().map_err(|_|"Signed stage journal lock poisoned.")?;
    valid(&next)?;
    if let Some(previous)=read_at(file)?{
        if previous.action_id==next.action_id {
            if previous.approved_plan_sha256!=next.approved_plan_sha256
                ||next.sequence<previous.sequence
                ||rank(&next.stage)<rank(&previous.stage){
                return Err("Authenticated worker stage regressed or plan changed.".into());
            }
            if previous.sequence==next.sequence{
                if previous.stage==next.stage{return Ok(());}
                return Err("Replayed worker stage sequence changed its meaning.".into());
            }
        }
    }
    let raw=serde_json::to_vec(&next)
        .map_err(|_|"Cannot serialize signed worker stage observation.")?;
    check(&raw)?;
    crate::premiere_store::replace(file,&raw,MAX_BYTES,check)
}
/// Caller is the approved worker monitor AFTER HMAC+UUID+plan verification.
/// Independently require the exact durable Rust action to be running.
pub(crate) fn record(
    app:&AppHandle,action:&str,plan_sha256:&str,sequence:u64,stage:&str,
    now:u64
)->Result<(),String>{
    let job=crate::native_worker_job::read(app)?
        .ok_or("No authenticated Blender native action exists.")?;
    if job.action_id!=action||job.tool!="blender_run_plan"||job.phase!="running"
        ||now<job.started_at_ms{
        return Err("Signed worker stage does not belong to current native action.".into());
    }
    record_at(&path(app)?,AttestedStage{
        version:1,action_id:action.into(),approved_plan_sha256:plan_sha256.into(),
        sequence,stage:stage.into(),observed_at_ms:now
    })
}
/// Returning a persisted stage is NOT a live HMAC challenge-response. Never
/// infer that the app is still running, successful or safe to auto-retry.
pub(crate) fn read_for_job(app:&AppHandle,job:Option<&crate::native_worker_job::NativeJob>)
    ->Result<Option<AttestedStage>,String>{
    let result=read_at(&path(app)?)?;
    Ok(result.filter(|e|job.is_some_and(|j|
        j.action_id==e.action_id&&j.tool=="blender_run_plan")))
}
#[cfg(test)]
mod tests{
    use super::*;
    const A:&str="e8b36b21-1c6a-459e-9b6f-75dd5692ab81";
    const B:&str="0f2977ac-4f61-4d9c-bf74-ecf8a3ae2172";
    fn directory()->PathBuf{
        let root=std::env::temp_dir().join(format!(
            "shuvi-attested-stage-{}",uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();root
    }
    fn data(action:&str,stage:&str,seq:u64)->AttestedStage{
        AttestedStage{
            version:1,action_id:action.into(),approved_plan_sha256:"a".repeat(64),
            stage:stage.into(),sequence:seq,observed_at_ms:1000+seq
        }
    }
    #[test]
    fn durable_stage_advances_only_after_verified_worker_progress(){
        let root=directory();
        let file=root.join("attested.json");
        record_at(&file,data(A,"python_active",1)).unwrap();
        record_at(&file,data(A,"blender_session_attached",2)).unwrap();
        record_at(&file,data(A,"plan_verified",3)).unwrap();
        record_at(&file,data(A,"artifact_rehashed",4)).unwrap();
        assert_eq!(read_at(&file).unwrap().unwrap().stage,"artifact_rehashed");
        record_at(&file,data(A,"artifact_rehashed",4)).unwrap();
        assert!(record_at(&file,data(A,"python_active",5)).is_err());
        assert!(record_at(&file,data(A,"plan_verified",2)).is_err());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn corrupted_or_replayed_different_plan_never_proves_stage(){
        let root=directory();let file=root.join("attested.json");
        record_at(&file,data(A,"python_active",1)).unwrap();
        let mut forged=data(A,"plan_verified",2);
        forged.approved_plan_sha256="b".repeat(64);
        assert!(record_at(&file,forged).is_err());
        let mut replay=data(A,"artifact_rehashed",1);
        assert!(record_at(&file,replay.clone()).is_err());
        replay.action_id=B.into();
        record_at(&file,replay).unwrap();
        fs::write(&file,b"{").unwrap();
        assert!(read_at(&file).is_err());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn stage_record_cannot_imply_os_liveness_or_auto_retry(){
        let root=directory();let file=root.join("attested.json");
        let stage=data(A,"blender_session_attached",2);
        record_at(&file,stage.clone()).unwrap();
        assert_eq!(read_at(&file).unwrap(),Some(stage));
        assert!(record_at(&file,data(A,"made_up_completed",3)).is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
