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
                "object_count":2}
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
