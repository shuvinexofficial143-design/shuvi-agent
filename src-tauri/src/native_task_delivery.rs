//! Final delivery proof for an already-audited, already-closed native DAG.
//! Not an executable queue, AI approval, or proof of creative quality.
//! Keeps the *last* accepted task receipt even when the chat checkpoint clears.
use serde::{Deserialize,Serialize};
use sha2::{Digest,Sha256};
use std::{collections::HashSet,fs,io::Read,path::{Path,PathBuf},sync::Mutex};
use tauri::{AppHandle,Manager};

const MAX_BYTES:usize=32_768;
const MAX_STEPS:usize=48;
const MAX_ARTIFACT_BYTES:u64=512*1024*1024;
static IO:Mutex<()>=Mutex::new(());

#[derive(Debug,Clone,Serialize,Deserialize,PartialEq,Eq)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub(crate) struct DeliveryArtifact {
    pub kind:String,
    pub path:String,
    pub sha256:String,
    pub bytes:u64,
}
#[derive(Debug,Clone,Serialize,Deserialize,PartialEq,Eq)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub(crate) struct DeliveryStep {
    pub step_id:String,
    pub tool:String,
    pub action_id:String,
    pub artifact:Option<DeliveryArtifact>,
}
#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub(crate) struct DeliveryReceipt {
    pub version:u32,
    pub objective:String,
    pub revision:u32,
    pub recorded_at_ms:u64,
    pub steps:Vec<DeliveryStep>,
}
fn valid_uuid(s:&str)->bool {
    uuid::Uuid::parse_str(s).map(|id|id.to_string()==s).unwrap_or(false)
}
fn check_structure(v:&DeliveryReceipt)->Result<(),String>{
    if v.version!=1||v.objective.trim().is_empty()||v.objective.len()>500
        ||v.revision==0||v.revision>MAX_STEPS as u32
        ||v.recorded_at_ms==0||v.steps.is_empty()||v.steps.len()>MAX_STEPS{
        return Err("Delivery receipt task bounds are invalid.".into());
    }
    let mut ids=HashSet::new();let mut actions=HashSet::new();
    for step in &v.steps {
        if step.step_id.is_empty()||step.step_id.len()>48
            ||!step.step_id.bytes().all(|c|c.is_ascii_alphanumeric()||c==b'_'||c==b'-')
            ||step.tool.is_empty()||step.tool.len()>160
            ||!step.tool.bytes().all(|c|c.is_ascii_lowercase()||c.is_ascii_digit()||c==b'_')
            ||!valid_uuid(&step.action_id)
            ||!ids.insert(step.step_id.as_str())||!actions.insert(step.action_id.as_str()){
            return Err("Delivery receipt has duplicate or invalid native job identity.".into());
        }
        if let Some(artifact)=&step.artifact {
            if !matches!(step.tool.as_str(),
                    "blender_run_plan"|"motion_graphics_accept_final_remotion"|
                    "motion_graphics_plan_premiere_insertion")
                ||artifact.bytes==0||artifact.bytes>MAX_ARTIFACT_BYTES
                ||artifact.path.len()>4096||artifact.path.chars().any(char::is_control)
                ||artifact.sha256.len()!=64
                ||!artifact.sha256.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b)) {
                return Err("Delivery artifact identity exceeds native bounds.".into());
            }
            let expected_kind=match step.tool.as_str(){
                "blender_run_plan"=>"blender_artifact",
                "motion_graphics_accept_final_remotion"=>"accepted_remotion",
                _=>"premiere_insertion_plan"
            };
            if artifact.kind!=expected_kind {
                return Err("Delivery artifact kind does not match audited tool.".into());
            }
        } else if matches!(step.tool.as_str(),
            "blender_run_plan"|"motion_graphics_accept_final_remotion"|
            "motion_graphics_plan_premiere_insertion") {
            return Err("A native render/model action cannot be delivered without its file receipt.".into());
        }
    }
    Ok(())
}
fn check_bytes(raw:&[u8])->Result<(),String>{
    if raw.len()>MAX_BYTES{return Err("Native task delivery exceeds file budget.".into());}
    let v:DeliveryReceipt=serde_json::from_slice(raw)
        .map_err(|_|"Native delivery file malformed.".to_string())?;
    check_structure(&v)
}
fn path(app:&AppHandle)->Result<PathBuf,String>{
    let root=app.path().app_data_dir().map_err(|_|"Native delivery storage unavailable.".to_string())?;
    fs::create_dir_all(&root).map_err(|_|"Native delivery directory inaccessible.".to_string())?;
    Ok(root.join("native-task-delivery.json"))
}
fn file_hash(path:&Path,limit:u64)->Result<(u64,String),String>{
    let meta=fs::symlink_metadata(path)
        .map_err(|_|"The declared output file does not exist.".to_string())?;
    if !meta.is_file()||meta.file_type().is_symlink()||meta.len()==0||meta.len()>limit{
        return Err("The output is not a supported regular file within size limits.".into());
    }
    let mut f=fs::File::open(path)
        .map_err(|_|"The declared output is not readable.".to_string())?;
    let mut buf=[0u8;64*1024];let mut bytes=0u64;let mut hash=Sha256::new();
    loop {
        let n=f.read(&mut buf).map_err(|_|"Output file hash read failed.".to_string())?;
        if n==0{break;}
        bytes=bytes.checked_add(n as u64).ok_or("Output length overflow.")?;
        if bytes>limit{return Err("Output exceeds hash size limit.".into());}
        hash.update(&buf[..n]);
    }
    if bytes!=meta.len(){return Err("Output changed while reading; delivery aborted.".into());}
    Ok((bytes,format!("{:x}",hash.finalize())))
}
fn check_artifact(a:&DeliveryArtifact,tool:&str)->Result<(),String>{
    let p=Path::new(&a.path);
    if !p.is_absolute(){return Err("Native delivery needs an absolute output file path.".into());}
    let ext=p.extension().and_then(|v|v.to_str()).unwrap_or("").to_ascii_lowercase();
    match tool {
        "blender_run_plan" if !matches!(ext.as_str(),"png"|"blend")=>
            return Err("Blender delivery output must be a .blend or .png.".into()),
        "motion_graphics_accept_final_remotion" if !matches!(ext.as_str(),"mp4"|"mov"|"webm")=>
            return Err("Accepted Remotion output must be a video.".into()),
        "motion_graphics_plan_premiere_insertion" if !matches!(ext.as_str(),"mp4"|"mov"|"webm")=>
            return Err("Premiere insertion output must be the accepted video path.".into()),
        _=>{}
    }
    let (size,hash)=file_hash(p,MAX_ARTIFACT_BYTES)?;
    if size!=a.bytes||hash!=a.sha256{
        return Err("Output bytes/SHA-256 changed; native delivery cannot be accepted.".into());
    }
    Ok(())
}
fn verify<F>(schedule:&crate::native_scheduler::Schedule,steps:&[DeliveryStep],
    mut audit:F)->Result<(),String>
where F:FnMut(&str)->Result<crate::AuditEntry,String>{
    if schedule.jobs.is_empty()||schedule.jobs.len()!=steps.len()||steps.len()>MAX_STEPS
        ||schedule.jobs.iter().any(|j|j.phase!="audited"){
        return Err("Native scheduler has unverified or unfinished steps.".into());
    }
    // Index/order binding: never accept a subset, a different graph,
    // another task's action ID, or an unrelated successful native audit.
    let mut receipts=Vec::with_capacity(steps.len());
    for (expected,step) in schedule.jobs.iter().zip(steps){
        if expected.step_id!=step.step_id||expected.tool!=step.tool
            ||expected.action_id.as_deref()!=Some(step.action_id.as_str()){
            return Err("Delivery step does not match the native scheduler action UUID/tool.".into());
        }
        let entry=audit(&step.action_id)?;
        if entry.action_id.as_deref()!=Some(step.action_id.as_str())
            ||entry.tool!=step.tool||entry.event!="executed"||!entry.success{
            return Err("Native action has no matching successful executed audit receipt.".into());
        }
        receipts.push(entry);
    }
    // Only after all action receipts match, re-read every external artifact.
    for step in steps{
        if let Some(a)=&step.artifact{check_artifact(a,&step.tool)?;}
    }
    Ok(())
}
fn write_at(path:&Path,receipt:&DeliveryReceipt)->Result<(),String>{
    check_structure(receipt)?;
    let raw=serde_json::to_vec(receipt)
        .map_err(|_|"Could not encode native task delivery.".to_string())?;
    crate::premiere_store::replace(path,&raw,MAX_BYTES,check_bytes)
}
pub(crate) fn finalize(app:&AppHandle,steps:Vec<DeliveryStep>)->Result<DeliveryReceipt,String>{
    let _io=IO.lock().map_err(|_|"Native task delivery lock poisoned.")?;
    let schedule=crate::native_scheduler::read(app)?
        .ok_or("No durable Rust scheduler exists for the final task.")?;
    let mut steps=steps;
    // Remotion acceptance receipts carry the SHA-256 but not always file
    // length. Rust computes that length, rather than trusting UI guesses.
    for step in &mut steps {
        if let Some(a)=step.artifact.as_mut(){
            if a.bytes==0 {
                a.bytes=file_hash(Path::new(&a.path),MAX_ARTIFACT_BYTES)?.0;
            }
        }
    }
    let receipt=DeliveryReceipt{
        version:1,objective:schedule.objective.clone(),revision:schedule.revision,
        recorded_at_ms:crate::now_ms(),steps
    };
    check_structure(&receipt)?;
    verify(&schedule,&receipt.steps,|id|
        crate::read_action_audit_receipt(app,id)?
            .ok_or("Delivery requires an exact Rust action audit.".to_string()))?;
    // A model/UI-supplied hash of any existing .blend is insufficient.
    // The exact supervised Blender action must have independently recorded
    // its authenticated, rehashed output before this final task receipt.
    for step in &receipt.steps {
        if step.tool=="blender_run_plan" {
            let artifact=step.artifact.as_ref()
                .ok_or("Blender delivery artifact is missing.")?;
            crate::native_blender_action_artifact::require_exact(
                app,&step.action_id,&artifact.path,&artifact.sha256,artifact.bytes)?;
        }
    }
    write_at(&path(app)?,&receipt)?;
    Ok(receipt)
}
pub(crate) fn read(app:&AppHandle)->Result<Option<DeliveryReceipt>,String>{
    let _io=IO.lock().map_err(|_|"Native task delivery lock poisoned.")?;
    let path=path(app)?;
    if !path.exists(){
        if path.with_extension("json.bak").exists()||path.with_extension("json.tmp").exists(){
            return Err("Interrupted delivery receipt publication needs owner inspection.".into());
        }
        return Ok(None);
    }
    let raw=crate::read_file_bytes_bounded(&path,MAX_BYTES,"native task delivery")?;
    check_bytes(&raw)?;
    let stored:DeliveryReceipt=serde_json::from_slice(&raw)
        .map_err(|_|"Native task delivery could not be decoded.".to_string())?;
    // Re-check stored audit identities and external files on every owner
    // inspection. The scheduler may now belong to a DIFFERENT task;
    // historical receipts must not be relabeled as the new task.
    for step in &stored.steps {
        let entry=crate::read_action_audit_receipt(app,&step.action_id)?
            .ok_or("Last delivery audit could not be read.".to_string())?;
        if entry.action_id.as_deref()!=Some(step.action_id.as_str())
            ||entry.tool!=step.tool||entry.event!="executed"||!entry.success{
            return Err("Last delivery no longer has the matching Rust audit.".into());
        }
        if let Some(a)=step.artifact.as_ref(){check_artifact(a,&step.tool)?;}
    }
    Ok(Some(stored))
}
#[cfg(test)]
mod tests{
    use super::*;
    const A:&str="e8b36b21-1c6a-459e-9b6f-75dd5692ab81";
    const B:&str="0f2977ac-4f61-4d9c-bf74-ecf8a3ae2172";
    fn mock(entries:Vec<(&str,&str,&str)>)->crate::native_scheduler::Schedule{
        crate::native_scheduler::Schedule{version:1,objective:"Build".into(),revision:1,
            jobs:entries.into_iter().map(|(step,tool,id)|crate::native_scheduler::Job{
                step_id:step.into(),tool:tool.into(),depends_on:Vec::new(),
                phase:"audited".into(),action_id:Some(id.into())
            }).collect()}
    }
    fn claim(step:&str,tool:&str,id:&str)->DeliveryStep{
        DeliveryStep{step_id:step.into(),tool:tool.into(),action_id:id.into(),artifact:None}
    }
    fn audit(step:&str,tool:&str)->crate::AuditEntry{
        crate::AuditEntry{timestamp_ms:1,event:"executed".into(),tool:tool.into(),
            detail:step.into(),success:true,action_id:Some(step.into())}
    }
    #[test]
    fn exact_multi_worker_audit_receipts_can_be_finalized(){
        let s=mock(vec![("inspect","read_file",A),("verify","git_status",B)]);
        let jobs=vec![claim("inspect","read_file",A),claim("verify","git_status",B)];
        verify(&s,&jobs,|id|Ok(audit(id,if id==A{"read_file"}else{"git_status"}))).unwrap();
        let swapped=vec![jobs[1].clone(),jobs[0].clone()];
        assert!(verify(&s,&swapped,|id|Ok(audit(id,"read_file"))).is_err());
    }
    #[test]
    fn failed_or_foreign_audit_cannot_deliver_task(){
        let s=mock(vec![("inspect","read_file",A)]);
        let jobs=vec![claim("inspect","read_file",A)];
        assert!(verify(&s,&jobs,|_|Ok(audit(B,"read_file"))).is_err());
        assert!(verify(&s,&jobs,|_|{let mut a=audit(A,"read_file");a.success=false;Ok(a)}).is_err());
        let mut failed=s.clone();failed.jobs[0].phase="failed".into();
        assert!(verify(&failed,&jobs,|_|Ok(audit(A,"read_file"))).is_err());
    }
    #[test]
    fn real_file_hash_is_required_and_detects_changes(){
        let p=std::env::temp_dir().join(format!("shuvi-delivery-{}.blend",uuid::Uuid::new_v4()));
        fs::write(&p,b"native-artifact").unwrap();
        let (size,hash)=file_hash(&p,MAX_ARTIFACT_BYTES).unwrap();
        let claim=DeliveryArtifact{kind:"blender_artifact".into(),path:p.to_string_lossy().into_owned(),
            sha256:hash,bytes:size};
        check_artifact(&claim,"blender_run_plan").unwrap();
        fs::write(&p,b"changed-artifact").unwrap();
        assert!(check_artifact(&claim,"blender_run_plan").is_err());
        let _=fs::remove_file(p);
    }
    #[test]
    fn duplicate_identity_and_missing_artifact_are_rejected(){
        let a=claim("first","read_file",A);
        let b=claim("second","git_status",A);
        let forged=DeliveryReceipt{version:1,objective:"Build".into(),revision:1,
            recorded_at_ms:1,steps:vec![a,b]};
        assert!(check_structure(&forged).is_err());
        let missing=DeliveryReceipt{steps:vec![claim("model","blender_run_plan",A)],..forged};
        assert!(check_structure(&missing).is_err());
    }
}
