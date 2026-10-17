//! Typed, read-only handoff contract for team-38 scheduler / team-40 Adobe.
//! The manifest certifies native receipt verification, NOT an Adobe import,
//! visual quality, project compatibility or autonomous execution approval.
use std::path::Path;
use serde_json::{json,Value};
use uuid::Uuid;

use crate::blender_plan_worker::verify_output;

/// Verify the ON-DISK bytes inside the approved root and build a bounded,
/// action-lineage-bound typed manifest. No files or applications are changed.
pub(crate) fn build(
    output:&Value,output_root:&Path,action_id:&str,session_id:Option<&str>
)->Result<Value,String>{
    let action=Uuid::parse_str(action_id)
        .map_err(|_|"Blender handoff needs the native approved action UUID.")?;
    if action.to_string()!=action_id.to_ascii_lowercase(){
        return Err("Blender action UUID must be in canonical hyphenated form.".into());
    }
    let session=match session_id{
        Some(id)=>{
            let parsed=Uuid::parse_str(id)
                .map_err(|_|"Blender handoff session UUID is invalid.")?;
            if parsed.to_string()!=id.to_ascii_lowercase(){
                return Err("Blender handoff session UUID must be canonical.".into());
            }
            Some(parsed.to_string())
        },
        None=>None,
    };
    if output.get("authenticated_blender_plan").and_then(Value::as_bool)!=Some(true)
        || output.get("status").and_then(Value::as_str)!=Some("verified")
        || output.get("complete").and_then(Value::as_bool)!=Some(true)
        || output.get("destructive_allowed").and_then(Value::as_bool)!=Some(false) {
        return Err("Blender handoff requires authenticated complete non-destructive evidence.".into());
    }
    let steps=output.get("executed_steps").and_then(Value::as_u64)
        .filter(|n|(1..=6).contains(n))
        .ok_or("Blender handoff plan count invalid.")?;
    // Independently hash the real file and recheck the saved Blender reopen
    // receipt or PNG structure metadata before emitting anything consumable.
    verify_output(output,output_root)?;
    let artifact=output.get("artifact").ok_or("Blender artifact receipt missing.")?;
    let name=artifact.get("path").and_then(Value::as_str)
        .ok_or("Blender artifact has no exact absolute path.")?;
    let original=Path::new(name);
    if !original.is_absolute() ||
        std::fs::symlink_metadata(original)
            .map_err(|_|"Blender output file is missing.")?
            .file_type().is_symlink() {
        return Err("Blender output must not be a symbolic-link path.".into());
    }
    let canonical=original.canonicalize().map_err(|_|"Blender output path cannot be canonicalized.")?;
    let path=canonical.to_str().ok_or("Blender output path is not valid Unicode.")?;
    let kind=artifact.get("format").and_then(Value::as_str)
        .ok_or("Blender output format missing.")?;
    let saved=kind=="BLEND";
    let rendered=kind=="PNG";
    if !saved && !rendered{return Err("Unsupported Blender output kind.".into());}
    let proof=output.get("checkpoint_reopen");
    if saved && proof.and_then(|p|p.get("verified")).and_then(Value::as_bool)!=Some(true){
        return Err("Saved scene has no verified independent reopen proof.".into());
    }
    if rendered && proof.is_some_and(|v|!v.is_null()){
        return Err("A PNG may not carry unrelated scene-reopen evidence.".into());
    }
    let visual_size=if rendered {
        json!({"width":artifact["width"],"height":artifact["height"],
            "color_mode":"RGBA","bit_depth":8})
    }else{Value::Null};
    Ok(json!({
        "schema_version":1,
        "producer":"shuvi41.blender",
        "status":"verified",
        "source_action_id":action.to_string(),
        "source_session_id":session,
        "artifact":{
            "absolute_path":path,
            "bytes":artifact["bytes"],
            "sha256":artifact["sha256"],
            "format":kind,
            "image":visual_size,
        },
        "evidence":{
            "native_file_sha256_readback":true,
            "independent_read_only_reopen":saved,
            "scene_fingerprint":if saved {proof.unwrap()["fingerprint"].clone()}else{Value::Null},
            "object_count":if saved {proof.unwrap()["object_count"].clone()}else{Value::Null},
            "mesh_geometry_verified":saved,
            "active_camera_name":if saved {proof.unwrap()["active_camera_name"].clone()}else{Value::Null},
            "proof_camera_verified":if saved {proof.unwrap()["proof_camera_verified"].clone()}else{Value::Null},
            "proof_key_light_verified":if saved {proof.unwrap()["proof_key_light_verified"].clone()}else{Value::Null},
            "mesh_fingerprint":if saved {proof.unwrap()["mesh_fingerprint"].clone()}else{Value::Null},
            "mesh_count":if saved {proof.unwrap()["mesh_count"].clone()}else{Value::Null},
            "total_vertices":if saved {proof.unwrap()["total_vertices"].clone()}else{Value::Null},
            "total_faces":if saved {proof.unwrap()["total_faces"].clone()}else{Value::Null},
            "executed_typed_steps":steps,
            "destructive_allowed":false,
        },
        "handoff":{
            "requires_new_action_approval":true,
            "import_performed":false,
            "target_application":Value::Null,
            "host_live_acceptance_proven":false,
            "visual_quality_verified":false,
        }
    }))
}


/// Read-only downstream receipt check. Only verifies the file bytes as they
/// exist NOW; prior action approval, Blender reopen and visual quality are
/// historical claims and cannot be re-authenticated from JSON alone.
/// This never imports an asset or authorizes another mutation.
pub(crate) fn reverify(manifest:&Value,approved_root:&Path)->Result<Value,String>{
    if manifest.get("schema_version").and_then(Value::as_u64)!=Some(1)
        ||manifest.get("producer").and_then(Value::as_str)!=Some("shuvi41.blender")
        ||manifest.get("status").and_then(Value::as_str)!=Some("verified")
        ||manifest.pointer("/handoff/requires_new_action_approval").and_then(Value::as_bool)!=Some(true)
        ||manifest.pointer("/handoff/import_performed").and_then(Value::as_bool)!=Some(false) {
        return Err("Blender handoff manifest schema or permission boundaries differ.".into());
    }
    let action_id=manifest.get("source_action_id").and_then(Value::as_str)
        .ok_or("Blender handoff source action missing.")?;
    let parsed=Uuid::parse_str(action_id).map_err(|_|"Invalid Blender source action UUID.")?;
    if parsed.to_string()!=action_id {return Err("Noncanonical Blender source action UUID.".into());}
    if let Some(session_id)=manifest.get("source_session_id").filter(|v|!v.is_null()){
        let name=session_id.as_str().ok_or("Malformed Blender source session UUID.")?;
        if Uuid::parse_str(name).map_err(|_|"Invalid Blender source session UUID.")?.to_string()!=name{
            return Err("Noncanonical Blender session UUID.".into());
        }
    }
    let artifact=manifest.get("artifact").ok_or("Blender handoff artifact missing.")?;
    let file=artifact.get("absolute_path").and_then(Value::as_str)
        .ok_or("Blender handoff has no absolute file path.")?;
    if !Path::new(file).is_absolute(){return Err("Blender handoff path is not absolute.".into());}
    let hash=artifact.get("sha256").and_then(Value::as_str)
        .ok_or("Blender handoff SHA-256 missing.")?;
    if hash.len()!=64 || !hash.bytes().all(|x|x.is_ascii_hexdigit() && !x.is_ascii_uppercase()){
        return Err("Malformed Blender handoff SHA-256.".into());
    }
    let len=artifact.get("bytes").and_then(Value::as_u64)
        .filter(|n|*n>=12 && *n<=128*1024*1024)
        .ok_or("Blender handoff size outside bounds.")?;
    let kind=artifact.get("format").and_then(Value::as_str)
        .ok_or("Blender handoff format missing.")?;
    let file_meta=std::fs::symlink_metadata(file)
        .map_err(|_|"Blender handoff output is missing.")?;
    if file_meta.file_type().is_symlink() || !file_meta.file_type().is_file(){
        return Err("Blender handoff cannot use a symbolic link or non-file.".into());
    }
    let mut receipt=json!({"artifact":{"path":file,"bytes":len,
        "sha256":hash,"format":kind}});
    let kind_label=match kind{
        "BLEND"=>{
            let evidence=manifest.get("evidence").ok_or("Blender proof missing.")?;
            if evidence.get("independent_read_only_reopen").and_then(Value::as_bool)!=Some(true){
                return Err("Blender source reopen evidence missing.".into());
            }
            receipt["checkpoint_reopen"]=json!({
                "verified":true,"read_only":true,
                "fingerprint":evidence["scene_fingerprint"],
                "object_count":evidence["object_count"],
                "mesh_geometry_verified":evidence["mesh_geometry_verified"],
                "active_camera_name":evidence["active_camera_name"],
                "proof_camera_verified":evidence["proof_camera_verified"],
                "proof_key_light_verified":evidence["proof_key_light_verified"],
                "mesh_fingerprint":evidence["mesh_fingerprint"],
                "mesh_count":evidence["mesh_count"],
                "total_vertices":evidence["total_vertices"],
                "total_faces":evidence["total_faces"]});
            "BLEND"
        },
        "PNG"=>{
            let image=artifact.get("image").ok_or("PNG image metadata missing.")?;
            for field in ["width","height","bit_depth","color_mode"]{
                if image.get(field).is_none(){return Err("PNG metadata incomplete.".into());}
            }
            for field in ["width","height","bit_depth","color_mode"]{
                receipt["artifact"][field]=image[field].clone();
            }
            "PNG"
        },
        _=>return Err("Unsupported Blender handoff artifact format.".into())
    };
    // This native readback re-hashes the actual current file and checks it
    // remains confined within an explicitly selected existing root.
    verify_output(&receipt,approved_root)?;
    Ok(json!({
        "status":"file_bytes_reverified",
        "source_action_id":action_id,
        "artifact_format":kind_label,
        "absolute_path":file,
        "bytes":len,
        "sha256":hash,
        "current_file_integrity_verified":true,
        "source_action_approval_reverified":false,
        "original_blender_reopen_reexecuted":false,
        "import_performed":false,
        "requires_new_action_approval":true
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs,io::Write};
    use sha2::{Digest,Sha256};
    struct Fixture(std::path::PathBuf);
    impl Fixture {
        fn new()->Self{
            let path=std::env::temp_dir().join(format!("shuvi41-artifact-{}",Uuid::new_v4()));
            fs::create_dir(&path).expect("disposable fixture folder");
            Self(path)
        }
        fn save(&self,extension:&str)->(String,u64,String){
            let name=self.0.join(format!("sample.{extension}"));
            let bytes=b"BLENDER-v430safe-fixture";
            let mut handle=fs::File::create(&name).unwrap();
            handle.write_all(bytes).unwrap();
            (name.to_str().unwrap().to_owned(),bytes.len() as u64,format!("{:x}",Sha256::digest(bytes)))
        }
    }
    impl Drop for Fixture {fn drop(&mut self){let _=fs::remove_dir_all(&self.0);}}
    fn proof(path:&str,size:u64,digest:&str)->Value{
        json!({
            "status":"verified","complete":true,"authenticated_blender_plan":true,
            "destructive_allowed":false,"executed_steps":2,
            "artifact":{"path":path,"bytes":size,"sha256":digest,"format":"BLEND"},
            "checkpoint_reopen":{"verified":true,"read_only":true,"fingerprint":"a".repeat(64),
                "object_count":2,"mesh_geometry_verified":true,
                "mesh_fingerprint":"c".repeat(64),
                "mesh_count":1,"total_vertices":3,"total_faces":1}
        })
    }
    const ACTION:&str="e5f8c84b-e405-4339-b6fd-e8ca80c457aa";
    const SESSION:&str="7f27d8bd-0c46-4f2b-a8c8-d9fe0895b113";

    #[test]
    fn authentic_handoff_contains_verified_provenance_but_no_import_claim(){
        let f=Fixture::new();
        let (path,size,sha)=f.save("blend");
        let data=build(&proof(&path,size,&sha),&f.0,ACTION,Some(SESSION)).unwrap();
        assert_eq!(data["schema_version"],1);
        assert_eq!(data["source_action_id"],ACTION);
        assert_eq!(data["source_session_id"],SESSION);
        assert_eq!(data["artifact"]["sha256"],sha);
        assert_eq!(data["evidence"]["independent_read_only_reopen"],true);
        assert_eq!(data["handoff"]["import_performed"],false);
        assert_eq!(data["handoff"]["host_live_acceptance_proven"],false);
        assert_eq!(data["handoff"]["requires_new_action_approval"],true);
    }
    #[test]
    fn tampering_on_disk_or_outside_approved_root_is_denied(){
        let f=Fixture::new();let elsewhere=Fixture::new();
        let (path,size,sha)=f.save("blend");
        assert!(build(&proof(&path,size,&sha),&elsewhere.0,ACTION,None).is_err());
        fs::write(&path,b"BLENDER-v430tampered-data!").unwrap();
        assert!(build(&proof(&path,size,&sha),&f.0,ACTION,None).is_err());
    }
    #[test]
    fn invalid_lineage_and_missing_reopen_evidence_are_denied(){
        let f=Fixture::new();let (path,size,sha)=f.save("blend");
        let good=proof(&path,size,&sha);
        assert!(build(&good,&f.0,"forged-id",None).is_err());
        assert!(build(&good,&f.0,ACTION,Some("stale")).is_err());
        let mut bad=good.clone();bad.as_object_mut().unwrap().remove("checkpoint_reopen");
        assert!(build(&bad,&f.0,ACTION,None).is_err());
    }

    #[test]
    fn downstream_rechecks_actual_bytes_but_never_promotes_prior_approval(){
        let f=Fixture::new();let (path,size,sha)=f.save("blend");
        let source=build(&proof(&path,size,&sha),&f.0,ACTION,Some(SESSION)).unwrap();
        let check=reverify(&source,&f.0).unwrap();
        assert_eq!(check["status"],"file_bytes_reverified");
        assert_eq!(check["current_file_integrity_verified"],true);
        assert_eq!(check["source_action_approval_reverified"],false);
        assert_eq!(check["original_blender_reopen_reexecuted"],false);
        assert_eq!(check["import_performed"],false);
    }
    #[test]
    fn downstream_rejects_changed_bytes_wrong_root_and_forged_lineage(){
        let f=Fixture::new();let other=Fixture::new();
        let (path,size,sha)=f.save("blend");
        let source=build(&proof(&path,size,&sha),&f.0,ACTION,None).unwrap();
        assert!(reverify(&source,&other.0).is_err());
        let mut forged=source.clone();
        forged["source_action_id"]=json!("untracked");
        assert!(reverify(&forged,&f.0).is_err());
        let mut forged_permission=source.clone();
        forged_permission["handoff"]["import_performed"]=json!(true);
        assert!(reverify(&forged_permission,&f.0).is_err());
        fs::write(&path,b"BLENDER-v430tampered-manifest").unwrap();
        assert!(reverify(&source,&f.0).is_err());
    }
    #[test]
    fn incomplete_or_untrusted_worker_cannot_claim_handoff(){
        let f=Fixture::new();let (path,size,sha)=f.save("blend");
        let mut bad=proof(&path,size,&sha);
        bad["complete"]=json!(false);
        assert!(build(&bad,&f.0,ACTION,None).is_err());
        bad["complete"]=json!(true);
        bad["authenticated_blender_plan"]=json!(false);
        assert!(build(&bad,&f.0,ACTION,None).is_err());
    }
}
