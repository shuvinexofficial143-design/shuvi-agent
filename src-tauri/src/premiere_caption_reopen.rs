//! Reconcile a separately approved Premiere project open with saved file and
//! independent current-host caption readback. NO implicit open/save/write.
//! A caller-provided open receipt can show an explicit host open, not a new
//! Premiere process/session: avoid conflating them.
use crate::{premiere_caption_save_binding::ProjectSnapshot,premiere_project_persistence::ProjectFileFingerprint};
use serde_json::{json,Value};

pub fn validate_open_receipt(
    receipt:&Value,
    expected_project_guid:&str,
    expected_path:&str,
    saved:&ProjectFileFingerprint,
    disk:&ProjectSnapshot,
)->Result<(),String>{
    if expected_project_guid.is_empty()||expected_path.is_empty() {
        return Err("Exact saved project GUID and path are required.".into());
    }
    if serde_json::to_vec(receipt).map_err(|e|e.to_string())?.len()>32*1024 {
        return Err("Premiere project-open receipt exceeds 32 KiB.".into());
    }
    let host=receipt.get("host").ok_or("Missing explicit approved Premiere open host receipt.")?;
    let proof=receipt.get("project_evidence").ok_or("Missing independent project-open evidence.")?;
    if receipt["post_state_verified"]!=true
        ||host["operation"]!="open"
        ||host["hostAccepted"]!=true
        ||host["projectIdentityVerified"]!=true
        ||host["uncertain"]!=false
        ||host["projectGuid"]!=expected_project_guid
        ||host["activeGuid"]!=expected_project_guid
        ||host["projectPath"]!=expected_path
        ||host["activePath"]!=expected_path
        ||proof["operation"]!="open"
        ||proof["host_identity_verified"]!=true
        ||proof["project_verified"]!=true
        ||proof["disk_unchanged_during_open"]!=true
        ||proof["edit_semantics_verified"]!=false
    {
        return Err("Approved Premiere open did not independently establish the exact saved project identity.".into());
    }
    let reported:ProjectFileFingerprint=serde_json::from_value(
        proof.get("disk_fingerprint").cloned()
            .ok_or("Missing native project-open independently observed disk fingerprint.")?)
        .map_err(|e|format!("Invalid native open disk fingerprint: {e}"))?;
    if reported!=*saved||reported!=disk.fingerprint||reported.path!=expected_path {
        return Err("Opened .prproj disk fingerprint differs from the saved project artifact.".into());
    }
    Ok(())
}

pub fn assess(
    before:&ProjectSnapshot,
    after:&ProjectSnapshot,
    selected_source_unchanged:bool,
    audit:&Value,
    requested_count:usize,
    context_before:&Value,
    context_after:&Value,
    expected_guid:&str,
    expected_sequence_guid:&str,
    expected_path:&str,
)->Value{
    let disk_same=before==after;
    let context_same=[context_before,context_after].iter().all(|ctx|{
        ctx.get("projectGuid").and_then(Value::as_str)==Some(expected_guid)
            &&ctx.get("projectPath").and_then(Value::as_str)==Some(expected_path)
            &&ctx.pointer("/activeSequence/guid").and_then(Value::as_str)==Some(expected_sequence_guid)
    });
    let native= audit.get("readOnly").and_then(Value::as_bool)==Some(true)
        &&audit.get("native_current_session_caption_values_verified").and_then(Value::as_bool)==Some(true)
        &&audit.get("requested_count").and_then(Value::as_u64)==Some(requested_count as u64)
        &&audit.get("verified_count").and_then(Value::as_u64)==Some(requested_count as u64);
    let correlated=disk_same&&context_same&&native&&selected_source_unchanged;
    json!({
        "schema_version":1,
        "read_only":true,
        "explicit_project_open_receipt_verified":true,
        "saved_project_sha256_unchanged_through_post_open_audit":disk_same,
        "saved_project_sha256":before.sha256,
        "project_sequence_context_stable":context_same,
        "selected_caption_source_unchanged":selected_source_unchanged,
        "all_post_open_caption_fields_and_timing_verified":native,
        "requested_captions":requested_count,
        "post_approved_open_saved_caption_evidence_consistent":correlated,
        "separate_open_action_approved_by_this_verifier":false,
        "fresh_application_session_proven":false,
        "fresh_session_reopen_verified":false,
        "durable_caption_semantics_across_new_process_proven":false,
        "visual_motion_graphics_verified":false,
        "exported_mp4_verified":false,
        "retry_automatically":false,
        "note":"Separate native Project.open was acknowledged and all exact saved-file/current-native caption values matched. Open may reuse the running host or project; no cross-process freshness or rendered visual proof."
    })
}

#[cfg(test)]mod tests{
    use super::*;
    use crate::premiere_caption_save_binding;
    use std::fs;

    fn source()->(std::path::PathBuf,ProjectSnapshot){
        let path=std::env::temp_dir().join(format!("shuvi-open-caption-{}.prproj",uuid::Uuid::new_v4()));
        fs::write(&path,b"saved Adobe project fixture").unwrap();
        let snapshot=premiere_caption_save_binding::snapshot(path.to_str().unwrap()).unwrap();
        (path,snapshot)
    }
    fn receipt(path:&str,fingerprint:&ProjectFileFingerprint)->Value{
        json!({"host":{"operation":"open","hostAccepted":true,"projectIdentityVerified":true,
            "uncertain":false,"projectGuid":"P","activeGuid":"P",
            "projectPath":path,"activePath":path},
            "project_evidence":{"operation":"open","host_identity_verified":true,
                "project_verified":true,"disk_unchanged_during_open":true,
                "disk_fingerprint":fingerprint,"edit_semantics_verified":false},
            "post_state_verified":true,"retry_safe":false})
    }
    fn context(path:&str)->Value{
        json!({"projectGuid":"P","projectPath":path,"activeSequence":{"guid":"S"}})
    }
    fn audit()->Value{
        json!({"readOnly":true,"native_current_session_caption_values_verified":true,
            "requested_count":2,"verified_count":2})
    }
    #[test]fn separately_approved_open_and_exact_post_open_caption_evidence_correlates(){
        let (path,disk)=source();
        let p=path.to_str().unwrap();
        validate_open_receipt(&receipt(p,&disk.fingerprint),"P",p,&disk.fingerprint,&disk).unwrap();
        let result=assess(&disk,&disk,true,&audit(),2,&context(p),&context(p),"P","S",p);
        assert_eq!(result["post_approved_open_saved_caption_evidence_consistent"],true);
        assert_eq!(result["fresh_session_reopen_verified"],false);
        assert_eq!(result["durable_caption_semantics_across_new_process_proven"],false);
        fs::remove_file(path).unwrap();
    }
    #[test]fn stale_saved_bytes_or_forged_open_receipts_are_rejected(){
        let (path,disk)=source();let p=path.to_str().unwrap();
        let mut r=receipt(p,&disk.fingerprint);
        for pointer in ["/host/projectIdentityVerified","/host/hostAccepted",
            "/project_evidence/project_verified","/project_evidence/disk_unchanged_during_open"]{
            let original=r.pointer(pointer).unwrap().clone();
            *r.pointer_mut(pointer).unwrap()=json!(false);
            assert!(validate_open_receipt(&r,"P",p,&disk.fingerprint,&disk).is_err(),"{pointer}");
            *r.pointer_mut(pointer).unwrap()=original;
        }
        r["host"]["activeGuid"]=json!("different");
        assert!(validate_open_receipt(&r,"P",p,&disk.fingerprint,&disk).is_err());
        r=receipt(p,&disk.fingerprint);
        r["host"]["operation"]=json!("create");
        assert!(validate_open_receipt(&r,"P",p,&disk.fingerprint,&disk).is_err());
        r=receipt(p,&disk.fingerprint);
        fs::write(&path,b"after-open rewrite").unwrap();
        let changed=premiere_caption_save_binding::snapshot(p).unwrap();
        assert!(validate_open_receipt(&r,"P",p,&disk.fingerprint,&changed).is_err());
        fs::remove_file(path).unwrap();
    }
    #[test]fn changed_native_caption_or_active_sequence_cannot_claim_reopened_consistency(){
        let (path,disk)=source();let p=path.to_str().unwrap();
        let mut ctx=context(p);
        ctx["activeSequence"]["guid"]=json!("wrong");
        assert_eq!(assess(&disk,&disk,true,&audit(),2,&context(p),&ctx,"P","S",p)
            ["post_approved_open_saved_caption_evidence_consistent"],false);
        let mut edited=audit();edited["verified_count"]=json!(1);
        assert_eq!(assess(&disk,&disk,true,&edited,2,&context(p),&context(p),"P","S",p)
            ["post_approved_open_saved_caption_evidence_consistent"],false);
        assert_eq!(assess(&disk,&disk,false,&audit(),2,&context(p),&context(p),"P","S",p)
            ["post_approved_open_saved_caption_evidence_consistent"],false);
        fs::remove_file(path).unwrap();
    }
}
