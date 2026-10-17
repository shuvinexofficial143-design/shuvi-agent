//! Read-only reconciliation of a separately approved Premiere project-save
//! receipt with independent saved-file bytes and current native caption values.
//! This is NOT a fresh-session reopen and does NOT prove captions serialized.
use serde::{Deserialize,Serialize};
use serde_json::{Value,json};
use sha2::{Digest,Sha256};
use std::{fs::{self,File},io::Read,path::Path};

use crate::premiere_project_persistence::{self,ProjectFileFingerprint};

const MAX_FILE_BYTES:u64=256*1024*1024;
const BUFFER_BYTES:usize=64*1024;

#[derive(Clone,Debug,Deserialize,Serialize)]
pub struct ProjectSnapshot {
    pub fingerprint:ProjectFileFingerprint,
    pub sha256:String,
}

/// Requires an ordinary real file. A Windows reparse point or symlink is not
/// an acceptable basis for a claim about an exact saved .prproj artifact.
pub fn snapshot(path:&str)->Result<ProjectSnapshot,String>{
    let p=Path::new(path);
    let meta=fs::symlink_metadata(p)
        .map_err(|e|format!("Project file cannot be inspected: {e}"))?;
    if !meta.is_file()||meta.file_type().is_symlink()
        ||meta.len()==0||meta.len()>MAX_FILE_BYTES {
        return Err("Saved project must be a nonempty ordinary .prproj file within 256 MiB.".into());
    }
    #[cfg(windows)] {
        use std::os::windows::fs::MetadataExt;
        if meta.file_attributes() & 0x400 != 0 {
            return Err("Saved Premiere project must not be a Windows reparse point.".into());
        }
    }
    let before=premiere_project_persistence::fingerprint(path)?;
    if before.size_bytes!=meta.len() {
        return Err("Project changed before independent SHA256 readback.".into());
    }
    let mut stream=File::open(p).map_err(|e|format!("Cannot reopen saved project bytes: {e}"))?;
    let mut digest=Sha256::new();
    let mut total=0_u64;
    let mut buffer=[0_u8;BUFFER_BYTES];
    loop {
        let n=stream.read(&mut buffer).map_err(|e|format!("Cannot read saved project: {e}"))?;
        if n==0 {break;}
        total=total.checked_add(n as u64).ok_or("Saved project length overflow.")?;
        if total>MAX_FILE_BYTES{return Err("Saved project exceeds bounded snapshot size.".into());}
        digest.update(&buffer[..n]);
    }
    let after=premiere_project_persistence::fingerprint(path)?;
    if total!=before.size_bytes||before!=after {
        return Err("Project file changed during independent SHA256 snapshot; inspect again.".into());
    }
    Ok(ProjectSnapshot{fingerprint:after,sha256:format!("{:x}",digest.finalize())})
}

/// The caller must supply the original output from the *separately approved*
/// premiere_save_project tool. A JSON receipt can be copied/forged; therefore
/// this is CORRELATION with live file and host evidence, not authenticated
/// historical attribution to the Shuvi save action.
pub fn saved_after(receipt:&Value,project_guid:&str,project_path:&str)
    ->Result<ProjectFileFingerprint,String>{
    if project_guid.is_empty()||project_path.is_empty()||!receipt.is_object() {
        return Err("Exact project GUID/path and save receipt are required.".into());
    }
    let data=serde_json::to_vec(receipt).map_err(|e|e.to_string())?;
    if data.len()>32*1024{
        return Err("Caption project-save receipt exceeds 32 KiB.".into());
    }
    let persistence=receipt.get("persistence_evidence")
        .ok_or("No independent project save-persistence receipt.")?;
    if receipt["project_guid"]!=project_guid
        ||receipt["expected_project_path"]!=project_path
        ||receipt["native_accepted"]!=true
        ||receipt["post_state_verified"]!=true
        ||receipt["verification_status"]!="verified_file_persistence"
        ||receipt["save"]["saved"]!=true
        ||receipt["save"]["projectPath"]!=project_path
        ||persistence["persistence_verified"]!=true
        ||persistence["native_accepted"]!=true
        ||persistence["same_exact_project_path"]!=true
        ||persistence["independent_file_write_observed"]!=true
        ||persistence["verification_status"]!="verified_file_persistence"
        ||persistence["edit_semantics_verified"]!=false {
        return Err("Save receipt has no verified native acceptance and independent exact-path file-persistence evidence.".into());
    }
    let before:ProjectFileFingerprint=serde_json::from_value(
        persistence.get("before").cloned().ok_or("Missing original pre-save file fingerprint.")?)
        .map_err(|e|format!("Invalid pre-save project fingerprint: {e}"))?;
    let after:ProjectFileFingerprint=serde_json::from_value(
        persistence.get("after").cloned().ok_or("Missing post-save file fingerprint.")?)
        .map_err(|e|format!("Invalid post-save project fingerprint: {e}"))?;
    if before.path!=project_path||after.path!=project_path||after.size_bytes==0
        ||before==after || !(before.size_bytes!=after.size_bytes ||
            before.fnv1a64!=after.fnv1a64 ||
            matches!((before.modified_ms,after.modified_ms),(Some(a),Some(b)) if b>a)) {
        return Err("Save receipt has no meaningful same-path on-disk change.".into());
    }
    Ok(after)
}

pub fn assess(
    expected_saved:&ProjectFileFingerprint,
    before:&ProjectSnapshot,
    after:&ProjectSnapshot,
    source_unchanged:bool,
    audit:&Value,
    selected_count:usize
)->Value{
    let same_saved=before.fingerprint==*expected_saved
        &&after.fingerprint==*expected_saved;
    let stable_bytes=before.sha256==after.sha256
        &&before.fingerprint==after.fingerprint;
    let native_verified=audit.get("native_current_session_caption_values_verified")
        .and_then(Value::as_bool)==Some(true)
        &&audit.get("readOnly").and_then(Value::as_bool)==Some(true)
        &&audit.get("requested_count").and_then(Value::as_u64)==Some(selected_count as u64)
        &&audit.get("verified_count").and_then(Value::as_u64)==Some(selected_count as u64);
    let corroborated=same_saved&&stable_bytes&&source_unchanged&&native_verified;
    json!({
        "schema_version":1,
        "read_only":true,
        "same_saved_project_file_fingerprint":same_saved,
        "saved_project_sha256_stable_across_host_readback":stable_bytes,
        "saved_project_sha256":before.sha256,
        "current_host_caption_values_verified":native_verified,
        "source_srt_unchanged":source_unchanged,
        "caption_count":selected_count,
        "current_host_and_project_save_evidence_consistent":corroborated,
        "project_save_receipt_source_authenticated":false,
        "project_file_write_independently_observed_in_prior_receipt":true,
        "saved_project_caption_semantics_verified":false,
        "fresh_session_reopen_verified":false,
        "visual_caption_animation_verified":false,
        "exported_mp4_verified":false,
        "automatic_retry_safe":false,
        "note":"An exact project save receipt, current file bytes and current in-memory native captions agree. This does not prove the saved .prproj serializes those captions until explicitly reopened and inspected."
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn project()->(std::path::PathBuf,ProjectSnapshot) {
        let path=std::env::temp_dir().join(format!("shuvi-caption-save-{}.prproj",uuid::Uuid::new_v4()));
        fs::write(&path,b"before-save").unwrap();
        let before=snapshot(path.to_str().unwrap()).unwrap();
        (path,before)
    }
    fn make_save(before:&ProjectSnapshot,after:&ProjectSnapshot,path:&str)->Value{
        let assessed=premiere_project_persistence::assess(
            &before.fingerprint,&after.fingerprint,true,path);
        json!({"save":{"saved":true,"projectPath":path},
            "project_guid":"P","expected_project_path":path,
            "native_accepted":true,"persistence_evidence":assessed,
            "verification_status":"verified_file_persistence",
            "post_state_verified":true,"edit_semantics_verified":false,
            "retry_safe":false})
    }
    fn native()->Value{
        json!({"native_current_session_caption_values_verified":true,
            "readOnly":true,"requested_count":2,"verified_count":2})
    }
    #[test] fn valid_save_receipt_and_stable_file_correlate_without_reopen_claim(){
        let (path,before)=project();
        fs::write(&path,b"saved-new-project").unwrap();
        let after=snapshot(path.to_str().unwrap()).unwrap();
        let receipt=make_save(&before,&after,path.to_str().unwrap());
        let saved=saved_after(&receipt,"P",path.to_str().unwrap()).unwrap();
        let current=snapshot(path.to_str().unwrap()).unwrap();
        let result=assess(&saved,&current,&current,true,&native(),2);
        assert_eq!(result["current_host_and_project_save_evidence_consistent"],true);
        assert_eq!(result["fresh_session_reopen_verified"],false);
        assert_eq!(result["saved_project_caption_semantics_verified"],false);
        fs::remove_file(path).unwrap();
    }
    #[test] fn old_or_fabricated_save_receipt_does_not_satisfy_source_binding(){
        let (path,before)=project();
        fs::write(&path,b"saved-new-project").unwrap();
        let after=snapshot(path.to_str().unwrap()).unwrap();
        let receipt=make_save(&before,&after,path.to_str().unwrap());
        assert!(saved_after(&receipt,"wrong",path.to_str().unwrap()).is_err());
        let mut forged=receipt.clone();
        forged["persistence_evidence"]["persistence_verified"]=json!(false);
        assert!(saved_after(&forged,"P",path.to_str().unwrap()).is_err());
        forged=receipt.clone();
        forged["save"]["projectPath"]=json!("C:/different.prproj");
        assert!(saved_after(&forged,"P",path.to_str().unwrap()).is_err());
        forged=receipt.clone();
        forged["persistence_evidence"]["before"]=forged["persistence_evidence"]["after"].clone();
        assert!(saved_after(&forged,"P",path.to_str().unwrap()).is_err());
        fs::write(&path,b"later rewrite").unwrap();
        let changed=snapshot(path.to_str().unwrap()).unwrap();
        let result=assess(&after.fingerprint,&changed,&changed,true,&native(),2);
        assert_eq!(result["current_host_and_project_save_evidence_consistent"],false);
        fs::remove_file(path).unwrap();
    }
    #[test] fn missing_host_or_changed_source_or_file_bytes_never_promote_evidence(){
        let (path,before)=project();
        fs::write(&path,b"saved-new-project").unwrap();
        let after=snapshot(path.to_str().unwrap()).unwrap();
        let receipt=make_save(&before,&after,path.to_str().unwrap());
        let saved=saved_after(&receipt,"P",path.to_str().unwrap()).unwrap();
        let mut native=native();
        native["verified_count"]=json!(1);
        assert_eq!(assess(&saved,&after,&after,true,&native,2)
            ["current_host_and_project_save_evidence_consistent"],false);
        assert_eq!(assess(&saved,&after,&after,false,&native(),2)
            ["current_host_and_project_save_evidence_consistent"],false);
        let mut bad=after.clone();bad.sha256="0".repeat(64);
        assert_eq!(assess(&saved,&after,&bad,true,&native(),2)
            ["current_host_and_project_save_evidence_consistent"],false);
        fs::remove_file(path).unwrap();
    }
}
