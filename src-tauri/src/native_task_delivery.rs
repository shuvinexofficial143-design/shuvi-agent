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
    // Additive v1 field; absent for older final deliveries and non-Blender
    // tools. New supervised Blender plans bind these bytes to their input.
    #[serde(default,skip_serializing_if="Option::is_none")]
    pub approved_plan_sha256:Option<String>,
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
            if let Some(digest)=artifact.approved_plan_sha256.as_deref(){
                if step.tool!="blender_run_plan"||digest.len()!=64
                    ||!digest.bytes().all(|b|
                        b.is_ascii_digit()||(b'a'..=b'f').contains(&b)){
                    return Err("Delivery approved-plan fingerprint invalid or belongs to a non-Blender tool.".into());
                }
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
/// Bounded background workers for independently readable, already-audited
/// output files. These do NOT execute a model tool, start a process, mutate
/// the desktop, or claim task success. At most TWO Rust threads read file
/// hashes in one batch, each capped by MAX_ARTIFACT_BYTES and 64 KiB RAM buffer.
/// Multiple receipts referring to one physical file are checked serially.
fn verify_artifacts_bounded<F>(steps:&[DeliveryStep],verifier:F)->Result<(),String>
where F:Fn(&DeliveryArtifact,&str)->Result<(),String>+Sync{
    let mut artifacts=Vec::new();
    for step in steps{
        if let Some(artifact)=step.artifact.as_ref(){
            artifacts.push((artifact,step.tool.as_str()));
        }
    }
    let mut remaining=artifacts.as_slice();
    while !remaining.is_empty(){
        if remaining.len()==1{
            verifier(remaining[0].0,remaining[0].1)?;
            break;
        }
        let first=remaining[0];
        let second=remaining[1];
        // Canonicalize before parallel read admission. Missing file, folder
        // or other invalid path fails closed in check_artifact.
        let first_path=fs::canonicalize(&first.0.path)
            .map_err(|_|"First independent output path unavailable.".to_string())?;
        let second_path=fs::canonicalize(&second.0.path)
            .map_err(|_|"Second independent output path unavailable.".to_string())?;
        if first_path==second_path{
            verifier(first.0,first.1)?;
            verifier(second.0,second.1)?;
        }else{
            std::thread::scope(|scope|{
                let left=scope.spawn(||verifier(first.0,first.1));
                let right=scope.spawn(||verifier(second.0,second.1));
                // ALWAYS join both, even if one detects tampering, so no
                // verification thread outlives the audit or delivery lock.
                let a=left.join()
                    .map_err(|_|"First bounded verification worker panicked.".to_string());
                let b=right.join()
                    .map_err(|_|"Second bounded verification worker panicked.".to_string());
                a??;b??;
                Ok::<(),String>(())
            })?;
        }
        remaining=&remaining[2..];
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
    // Only after all exact UUID/tool audit receipts match, verify independently
    // readable artifacts with a strictly bounded read-only Rust worker pool.
    verify_artifacts_bounded(steps,check_artifact)?;
    Ok(())
}
fn write_at(path:&Path,receipt:&DeliveryReceipt)->Result<(),String>{
    check_structure(receipt)?;
    let raw=serde_json::to_vec(receipt)
        .map_err(|_|"Could not encode native task delivery.".to_string())?;
    crate::premiere_store::replace(path,&raw,MAX_BYTES,check_bytes)
}
// The trusted Rust worker certificate is the default source of truth for
// Blender artifact delivery, not an AI/UI-proposed file path or stale cache.
// Caller still must pass exact ordered DAG step IDs and action UUIDs; the
// scheduler + successful action audits are independently rechecked below.
fn fill_missing_blender_artifacts<F>(steps:&mut [DeliveryStep],mut get:F)
    ->Result<(),String>
where F:FnMut(&str)->Result<DeliveryArtifact,String>{
    for step in steps{
        if step.tool=="blender_run_plan"&&step.artifact.is_none(){
            let cert=get(&step.action_id)?;
            if cert.kind!="blender_artifact"{
                return Err("Blender worker certificate kind does not match native tool.".into());
            }
            step.artifact=Some(cert);
        }
    }
    Ok(())
}
// Hydrate ONLY the new optional full-plan fingerprint, never overwrite a
// claimed artifact path, bytes, or file hash. Exact trusted worker UUID and
// artifact identity must agree before adding any provenance data.
fn fill_blender_plan_provenance<F>(steps:&mut [DeliveryStep],mut get:F)
    ->Result<(),String>
where F:FnMut(&str)->Result<DeliveryArtifact,String>{
    for step in steps{
        if step.tool!="blender_run_plan"{continue;}
        let claimed=step.artifact.as_mut()
            .ok_or("Blender final delivery cannot omit its verified artifact.")?;
        let cert=get(&step.action_id)?;
        if cert.kind!="blender_artifact"||claimed.path!=cert.path
            ||claimed.sha256!=cert.sha256||claimed.bytes!=cert.bytes{
            return Err("Blender final delivery cannot inherit plan provenance from another output.".into());
        }
        if claimed.approved_plan_sha256.is_some()
            &&claimed.approved_plan_sha256!=cert.approved_plan_sha256{
            return Err("Delivered Blender plan fingerprint differs from exact worker certificate.".into());
        }
        if claimed.approved_plan_sha256.is_none(){
            claimed.approved_plan_sha256=cert.approved_plan_sha256;
        }
    }
    Ok(())
}
fn verify_blender_certificates(app:&AppHandle,steps:&[DeliveryStep])
    ->Result<(),String>{
    for step in steps {
        if step.tool=="blender_run_plan"{
            let a=step.artifact.as_ref()
                .ok_or("Blender delivery artifact is missing.")?;
            crate::native_blender_action_artifact::require_exact(
                app,&step.action_id,&a.path,&a.sha256,a.bytes)?;
            if let Some(digest)=a.approved_plan_sha256.as_deref(){
                let cert=crate::native_blender_action_artifact::read_verified(app,&step.action_id)?;
                if cert.plan_sha256.as_deref()!=Some(digest){
                    return Err("Stored task delivery plan digest differs from exact worker certificate.".into());
                }
            }
        }
    }
    Ok(())
}
pub(crate) fn finalize(app:&AppHandle,steps:Vec<DeliveryStep>)->Result<DeliveryReceipt,String>{
    let _io=IO.lock().map_err(|_|"Native task delivery lock poisoned.")?;
    let schedule=crate::native_scheduler::read(app)?
        .ok_or("No durable Rust scheduler exists for the final task.")?;
    let mut steps=steps;
    // Auto-fill only the approved Blender tool's missing delivery artifact
    // from the worker's exact UUID-bound, rehashed on-disk certificate.
    // Explicitly supplied artifact claims are checked against it later.
    fill_missing_blender_artifacts(&mut steps,|id|{
        let cert=crate::native_blender_action_artifact::read_verified(app,id)?;
        Ok(DeliveryArtifact{kind:"blender_artifact".into(),
            path:cert.path,sha256:cert.sha256,bytes:cert.bytes,
            approved_plan_sha256:cert.plan_sha256})
    })?;
    // Explicit paths/hashes are never replaced, but the approved-plan
    // provenance is filled from exact UUID evidence when it is available.
    fill_blender_plan_provenance(&mut steps,|id|{
        let cert=crate::native_blender_action_artifact::read_verified(app,id)?;
        Ok(DeliveryArtifact{kind:"blender_artifact".into(),
            path:cert.path,sha256:cert.sha256,bytes:cert.bytes,
            approved_plan_sha256:cert.plan_sha256})
    })?;
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
    // An externally existing .blend plus an arbitrary matching hash is not
    // evidence that the exact scheduled worker produced it.
    verify_blender_certificates(app,&receipt.steps)?;
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
    // A historical task is not verified solely because its final JSON
    // receipt is intact. Recheck exact worker provenance on every read.
    verify_blender_certificates(app,&stored.steps)?;
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
    fn independent_artifacts_use_two_bounded_read_only_verification_threads(){
        use std::sync::atomic::{AtomicUsize,Ordering};
        let root=std::env::temp_dir().join(format!("shuvi-parallel-hash-{}",uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let a=root.join("one.blend");let b=root.join("two.blend");
        fs::write(&a,b"BLENDER first certificate").unwrap();
        fs::write(&b,b"BLENDER second certificate").unwrap();
        let a_hash=file_hash(&a,MAX_ARTIFACT_BYTES).unwrap();
        let b_hash=file_hash(&b,MAX_ARTIFACT_BYTES).unwrap();
        let make=|path:&Path,record:(u64,String)|DeliveryArtifact{
            kind:"blender_artifact".into(),path:path.to_str().unwrap().into(),
            bytes:record.0,sha256:record.1,approved_plan_sha256:None
        };
        let steps=vec![
            DeliveryStep{step_id:"one".into(),tool:"blender_run_plan".into(),
                action_id:"e8b36b21-1c6a-459e-9b6f-75dd5692ab81".into(),
                artifact:Some(make(&a,a_hash))},
            DeliveryStep{step_id:"two".into(),tool:"blender_run_plan".into(),
                action_id:"0f2977ac-4f61-4d9c-bf74-ecf8a3ae2172".into(),
                artifact:Some(make(&b,b_hash))},
        ];
        let started=AtomicUsize::new(0);
        let concurrent=AtomicUsize::new(0);
        verify_artifacts_bounded(&steps,|artifact,tool|{
            started.fetch_add(1,Ordering::SeqCst);
            concurrent.fetch_add(1,Ordering::SeqCst);
            // Both children can begin only if the verifier actually runs
            // independent tasks concurrently, not just claims a second lane.
            for _ in 0..2000{
                if started.load(Ordering::SeqCst)==2{break;}
                std::thread::yield_now();
            }
            let result=check_artifact(artifact,tool);
            concurrent.fetch_sub(1,Ordering::SeqCst);
            result
        }).unwrap();
        assert_eq!(started.load(Ordering::SeqCst),2);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn aliased_output_is_not_read_in_parallel_and_tamper_fails_closed(){
        use std::sync::atomic::{AtomicUsize,Ordering};
        let root=std::env::temp_dir().join(format!("shuvi-aliased-hash-{}",uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let file=root.join("same.blend");
        fs::write(&file,b"BLENDER stable").unwrap();
        let (bytes,hash)=file_hash(&file,MAX_ARTIFACT_BYTES).unwrap();
        let make=||DeliveryStep{step_id:"same".into(),tool:"blender_run_plan".into(),
            action_id:"e8b36b21-1c6a-459e-9b6f-75dd5692ab81".into(),
            artifact:Some(DeliveryArtifact{
                kind:"blender_artifact".into(),path:file.to_str().unwrap().into(),
                sha256:hash.clone(),bytes,approved_plan_sha256:None})};
        let calls=AtomicUsize::new(0);
        verify_artifacts_bounded(&[make(),make()],|a,tool|{
            assert_eq!(calls.fetch_add(1,Ordering::SeqCst),0_usize.max(
                calls.load(Ordering::SeqCst).saturating_sub(1)));
            check_artifact(a,tool)
        }).unwrap();
        assert_eq!(calls.load(Ordering::SeqCst),2);
        fs::write(&file,b"BLENDER tampered").unwrap();
        assert!(verify_artifacts_bounded(&[make()],check_artifact).is_err());
        fs::remove_dir_all(root).unwrap();
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
            sha256:hash,bytes:size,approved_plan_sha256:None};
        check_artifact(&claim,"blender_run_plan").unwrap();
        fs::write(&p,b"changed-artifact").unwrap();
        assert!(check_artifact(&claim,"blender_run_plan").is_err());
        let _=fs::remove_file(p);
    }
    #[test]
    fn missing_blender_delivery_artifact_is_filled_from_exact_verified_uuid(){
        let mut steps=vec![claim("model","blender_run_plan",A),
            claim("inspect","read_file",B)];
        let artifact=DeliveryArtifact{kind:"blender_artifact".into(),
            path:"C:\\\\artifacts\\\\model.blend".into(),
            sha256:"a".repeat(64),bytes:1234,
             approved_plan_sha256:None};
        let mut looked_up=0usize;
        fill_missing_blender_artifacts(&mut steps,|id|{
            assert_eq!(id,A);
            looked_up+=1;
            Ok(artifact.clone())
        }).unwrap();
        assert_eq!(looked_up,1);
        assert_eq!(steps[0].artifact,Some(artifact));
        assert!(steps[1].artifact.is_none());
    }
    #[test]
    fn missing_or_wrong_worker_certificate_never_autofills_delivery(){
        let mut steps=vec![claim("model","blender_run_plan",A)];
        assert!(fill_missing_blender_artifacts(&mut steps,|_|Err(
            "Missing certificate".into())).is_err());
        assert!(steps[0].artifact.is_none());
        assert!(fill_missing_blender_artifacts(&mut steps,|_|Ok(
            DeliveryArtifact{kind:"untrusted".into(),path:"x".into(),
                sha256:"0".repeat(64),bytes:1,approved_plan_sha256:None})).is_err());
        assert!(steps[0].artifact.is_none());
    }
    #[test]
    fn exact_provenance_autofills_without_replacing_user_supplied_artifact_fields(){
        let mut steps=vec![claim("model","blender_run_plan",A)];
        let artifact=DeliveryArtifact{kind:"blender_artifact".into(),
            path:"C:\\approved\\scene.blend".into(),sha256:"a".repeat(64),
            bytes:400,approved_plan_sha256:None};
        let verified=DeliveryArtifact{approved_plan_sha256:Some("b".repeat(64)),
            ..artifact.clone()};
        steps[0].artifact=Some(artifact.clone());
        fill_blender_plan_provenance(&mut steps,|id|{
            assert_eq!(id,A);
            Ok(verified.clone())
        }).unwrap();
        assert_eq!(steps[0].artifact.as_ref().unwrap().path,artifact.path);
        assert_eq!(steps[0].artifact.as_ref().unwrap().sha256,artifact.sha256);
        assert_eq!(steps[0].artifact.as_ref().unwrap().bytes,artifact.bytes);
        assert_eq!(steps[0].artifact.as_ref().unwrap().approved_plan_sha256,
            Some("b".repeat(64)));
        check_structure(&DeliveryReceipt{version:1,objective:"model".into(),
            revision:1,recorded_at_ms:1,steps}).unwrap();
    }
    #[test]
    fn foreign_output_or_wrong_plan_digest_never_gains_verified_provenance(){
        let expected=DeliveryArtifact{kind:"blender_artifact".into(),
            path:"C:\\approved\\scene.blend".into(),sha256:"a".repeat(64),
            bytes:400,approved_plan_sha256:Some("b".repeat(64))};
        let mut steps=vec![claim("model","blender_run_plan",A)];
        steps[0].artifact=Some(DeliveryArtifact{
            approved_plan_sha256:Some("c".repeat(64)),..expected.clone()});
        assert!(fill_blender_plan_provenance(&mut steps,|_|Ok(expected.clone())).is_err());
        steps[0].artifact=Some(DeliveryArtifact{
            approved_plan_sha256:None,path:"C:\\foreign\\scene.blend".into(),..expected.clone()});
        assert!(fill_blender_plan_provenance(&mut steps,|_|Ok(expected.clone())).is_err());
        let mut non_blender=claim("make","read_file",B);
        non_blender.artifact=Some(DeliveryArtifact{kind:"blender_artifact".into(),
            path:"C:\\approved\\scene.blend".into(),sha256:"a".repeat(64),
            bytes:1,approved_plan_sha256:Some("b".repeat(64))});
        assert!(check_structure(&DeliveryReceipt{version:1,objective:"test".into(),
            revision:1,recorded_at_ms:1,steps:vec![non_blender]}).is_err());
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
