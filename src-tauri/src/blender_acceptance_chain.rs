//! Read-only structural review of three separately approved Blender receipts.
//!
//! This is an evidence-consistency and current-byte integrity review, NEVER
//! proof that a past action was genuinely user-approved or that rendered pixels
//! are beautiful. No mutation, no Blender launch, no Adobe import.
use std::path::Path;
use serde_json::{json,Value};
use uuid::Uuid;
use crate::blender_artifact_manifest;

const NAMES:[&str;3]=[
    "shuvi41-proof-stage1.blend",
    "shuvi41-proof-stage2.blend",
    "shuvi41-proof-render.png",
];

fn uuid_field(value:&Value,key:&str)->Result<String,String>{
    let raw=value.get(key).and_then(Value::as_str)
        .ok_or_else(||format!("Blender acceptance missing {key}"))?;
    let id=Uuid::parse_str(raw).map_err(|_|format!("Invalid acceptance {key} UUID"))?;
    if id.to_string()!=raw {return Err(format!("Noncanonical acceptance {key} UUID"));}
    Ok(raw.into())
}

fn proof_number(evidence:&Value,name:&str,min:u64,max:u64)->Result<u64,String>{
    evidence.get(name).and_then(Value::as_u64)
        .filter(|n|(*n>=min) && (*n<=max))
        .ok_or_else(||format!("Blender acceptance {name} outside evidence limits"))
}

/// Check the three on-disk artifacts and receipts. Caller-supplied JSON is NOT
/// cryptographic or database-backed proof that an action occurred.
pub(crate) fn review(reports:&Value,approved_root:&Path)->Result<Value,String>{
    let items=reports.as_array().filter(|x|x.len()==3)
        .ok_or("Blender acceptance expects EXACTLY three stage receipts.")?;
    let mut sessions=Vec::with_capacity(3);
    let mut actions=Vec::with_capacity(3);
    let mut paths:Vec<String>=Vec::with_capacity(3);
    let mut hashes:Vec<String>=Vec::with_capacity(3);
    let mut fingerprints=Vec::with_capacity(2);
    let mut topology_fingerprints=Vec::with_capacity(2);
    let mut mesh_counts=Vec::with_capacity(2);
    for (index,receipt) in items.iter().enumerate(){
        if receipt.get("status").and_then(Value::as_str)!=Some("verified")
            ||receipt.get("full_plan_completed").and_then(Value::as_bool)!=Some(true)
            ||receipt.get("same_blender_session").and_then(Value::as_bool)!=Some(true){
            return Err("Blender acceptance stage lacks a complete persistent-session result.".into());
        }
        let stage=["model1","model2","render"][index];
        crate::blender_plan_lineage::receipt_matches(receipt,stage)?;
        let declared_steps=receipt.get("plan_steps").and_then(Value::as_u64);
        let lineage_steps=receipt.pointer("/approved_plan_lineage/typed_steps").and_then(Value::as_u64);
        let reported_steps=receipt.pointer("/artifact_manifest/evidence/executed_typed_steps").and_then(Value::as_u64);
        if declared_steps!=lineage_steps || declared_steps!=reported_steps {
            return Err("Blender stage plan-step count does not match native artifact lineage.".into());
        }
        let session=uuid_field(receipt,"session_id")?;
        let action=uuid_field(receipt,"source_action_id")?;
        let manifest=receipt.get("artifact_manifest")
            .ok_or("Blender acceptance stage lacks immutable native lineage manifest.")?;
        if manifest.get("source_session_id").and_then(Value::as_str)!=Some(session.as_str())
            ||manifest.get("source_action_id").and_then(Value::as_str)!=Some(action.as_str()){
            return Err("Blender acceptance receipt does not match its native lineage manifest.".into());
        }
        // Recheck CURRENT artifact bytes, typed metadata and path containment;
        // the supplied receipt is not trusted as current file evidence.
        let rechecked=blender_artifact_manifest::reverify(manifest,approved_root)?;
        if rechecked.get("current_file_integrity_verified").and_then(Value::as_bool)!=Some(true){
            return Err("Blender stage artifact current file integrity was not verified.".into());
        }
        let artifact=manifest.get("artifact").ok_or("Blender stage artifact missing.")?;
        let path=artifact.get("absolute_path").and_then(Value::as_str)
            .ok_or("Blender stage canonical output path missing.")?;
        let file_name=Path::new(path).file_name().and_then(|v|v.to_str())
            .ok_or("Blender stage filename invalid.")?;
        if file_name!=NAMES[index]{
            return Err("Blender acceptance stage filename or ordering differs.".into());
        }
        let hash=artifact.get("sha256").and_then(Value::as_str)
            .ok_or("Blender stage file SHA-256 missing.")?;
        let kind=artifact.get("format").and_then(Value::as_str).unwrap_or("");
        if (index<2 && kind!="BLEND") || (index==2 && kind!="PNG") {
            return Err("Blender acceptance stage file format mismatch.".into());
        }
        if index==2 {
            // The authenticated broker already had to confirm Blender loaded
            // this canonical file and that its bytes matched the source SHA
            // both before and after opening. This reviewer additionally
            // ties those result claims to the CURRENT stage2 manifest bytes.
            // The receipts remain caller-supplied: historic audit origin is
            // explicitly NOT re-authenticated by this read-only review.
            let input=receipt.get("input_checkpoint")
                .ok_or("Render stage lacks the authenticated Blender input-checkpoint receipt.")?;
            if input.get("path").and_then(Value::as_str)!=Some(paths[1].as_str())
                ||input.get("sha256").and_then(Value::as_str)!=Some(hashes[1].as_str())
                ||input.get("bytes")!=items[1].pointer("/artifact_manifest/artifact/bytes")
                ||input.get("verified_loaded_file_path").and_then(Value::as_bool)!=Some(true)
                ||input.get("loaded_file_hash_checked").and_then(Value::as_bool)!=Some(true){
                return Err("Render source does not match the verified stage2 checkpoint identity.".into());
            }
        }
        if index<2 {
            let evidence=manifest.get("evidence").ok_or("Blender stage reopen evidence missing.")?;
            if evidence.get("independent_read_only_reopen").and_then(Value::as_bool)!=Some(true)
                ||evidence.get("mesh_geometry_verified").and_then(Value::as_bool)!=Some(true) {
                return Err("Blender stage has no independently verified mesh topology.".into());
            }
            // A structurally valid .blend is NOT proof that the fixed
            // acceptance camera was active or its light survived Stage-2.
            // The underlying claims come from independently matched writer
            // and reopened scene/objects snapshots. This reviewer still
            // does NOT reauthenticate historical owner approval.
            if evidence.get("active_camera_name").and_then(Value::as_str)!=Some("Shuvi41ProofCamera")
                || evidence.get("proof_camera_verified").and_then(Value::as_bool)!=Some(true)
                || (index==1 && evidence.get("proof_key_light_verified").and_then(Value::as_bool)!=Some(true)){
                return Err("Blender proof checkpoint lacks verified active camera or Stage-2 key light.".into());
            }
            let count=proof_number(evidence,"mesh_count",1,64)?;
            let vertices=proof_number(evidence,"total_vertices",5,8192)?;
            let faces=proof_number(evidence,"total_faces",5,8192)?;
            let fingerprint=evidence.get("scene_fingerprint").and_then(Value::as_str)
                .filter(|x|x.len()==64 && x.bytes().all(|c|c.is_ascii_hexdigit()))
                .ok_or("Blender stage scene fingerprint missing.")?;
            fingerprints.push(fingerprint.to_string());
            let topology=evidence.get("mesh_fingerprint").and_then(Value::as_str)
                .filter(|x|x.len()==64 && x.bytes().all(|c|c.is_ascii_hexdigit()))
                .ok_or("Blender stage has no exact independent mesh topology fingerprint.")?;
            topology_fingerprints.push(topology.to_string());
            mesh_counts.push(json!({"meshes":count,"vertices":vertices,"faces":faces}));
        }else{
            let image=artifact.get("image").ok_or("Blender render metadata missing.")?;
            if image.get("width").and_then(Value::as_u64)!=Some(64)
                ||image.get("height").and_then(Value::as_u64)!=Some(64)
                ||image.get("bit_depth").and_then(Value::as_u64)!=Some(8)
                ||image.get("color_mode").and_then(Value::as_str)!=Some("RGBA"){
                return Err("Blender acceptance render is not exactly 64x64 RGBA8.".into());
            }
        }
        sessions.push(session);
        actions.push(action);
        paths.push(path.to_owned());
        hashes.push(hash.to_owned());
    }
    if sessions[0]!=sessions[1] || sessions[2]==sessions[1] {
        return Err("Blender acceptance requires first two steps in one owned session and render in another.".into());
    }
    if actions[0]==actions[1] || actions[1]==actions[2] || actions[0]==actions[2]{
        return Err("Blender acceptance stages must each have distinct approved action UUIDs.".into());
    }
    if paths[0]==paths[1] || hashes[0]==hashes[1]{
        return Err("Blender acceptance requires different saved stage1/stage2 checkpoints.".into());
    }
    if fingerprints[0]==fingerprints[1] || topology_fingerprints[0]==topology_fingerprints[1]{
        return Err("Blender acceptance found no independently observable modeled scene change.".into());
    }
    Ok(json!({
        "status":"receipt_chain_consistent",
        "schema_version":1,
        "stage_files":[
            {"stage":"model1","sha256":hashes[0],"path":paths[0],"geometry":mesh_counts[0]},
            {"stage":"model2","sha256":hashes[1],"path":paths[1],"geometry":mesh_counts[1]},
            {"stage":"render","sha256":hashes[2],"path":paths[2],"size":[64,64]},
        ],
        "structural_stage_order_verified":true,
        "current_file_sha256_rechecked":true,
        "first_two_same_session":true,
        "render_uses_different_session":true,
        "mesh_change_observed_in_supplied_reopen_evidence":true,
        "active_camera_and_stage2_key_light_claims_consistent":true,
        "historical_owner_approval_reauthenticated":false,
        "render_source_stage2_binding_proven":false,
        "render_source_stage2_binding_consistent":true,
        "live_blender_runtime_verified_by_this_review":false,
        "visual_quality_verified":false,
        "import_performed":false,
        "requires_original_audit_lookup_and_host_acceptance":true,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use sha2::{Digest,Sha256};
    struct Workspace(std::path::PathBuf);
    impl Workspace{
        fn new()->Self{
            let p=std::env::temp_dir().join(format!("shuvi41-chain-{}",Uuid::new_v4()));
            fs::create_dir(&p).unwrap();Self(p)
        }
        fn write(&self,name:&str,bytes:&[u8])->Value{
            let path=self.0.join(name);fs::write(&path,bytes).unwrap();
            json!({"path":path.to_str().unwrap(),"bytes":bytes.len(),"sha256":format!("{:x}",Sha256::digest(bytes)),
                "format":if name.ends_with(".blend"){"BLEND"}else{"PNG"}})
        }
    }
    impl Drop for Workspace{fn drop(&mut self){let _=fs::remove_dir_all(&self.0);}}
    const S1:&str="f3933170-cc01-4c20-8079-b4dbd72b93ad";
    const S3:&str="ab38e07c-0a49-446d-a292-592165600dab";
    const A1:&str="e5f8c84b-e405-4339-b6fd-e8ca80c457aa";
    const A2:&str="7f27d8bd-0c46-4f2b-a8c8-d9fe0895b113";
    const A3:&str="96dd4f7f-6b02-4913-8599-37be6766fc13";

    fn blend_receipt(work:&Workspace,which:usize,action:&str,session:&str)->Value{
        let mut bytes=b"BLENDER-v430".to_vec();
        bytes.extend_from_slice(&vec![which as u8;60]);
        let name=NAMES[which];
        let artifact=work.write(name,&bytes);
        let evidence=json!({
            "status":"verified","complete":true,"authenticated_blender_plan":true,
            "destructive_allowed":false,"executed_steps":6,
            "artifact":artifact,
            "checkpoint_reopen":{"verified":true,"read_only":true,
                "fingerprint":if which==0{"a".repeat(64)}else{"b".repeat(64)},
                "object_count":if which==0{2}else{3},
                "active_camera_name":"Shuvi41ProofCamera",
                "proof_camera_verified":true,
                "proof_key_light_verified":which==1,
                "mesh_geometry_verified":true,
                "mesh_fingerprint":if which==0{"c".repeat(64)}else{"d".repeat(64)},
                "mesh_count":1,
                "total_vertices":5,"total_faces":5}
        });
        let manifest=crate::blender_artifact_manifest::build(&evidence,&work.0,action,Some(session)).unwrap();
        let stage=if which==0{"model1"}else{"model2"};
        let operations=if which==0{
            vec!["mesh.create","mesh.translate_vertices","scene.inspect","device.create","scene.inspect","file.checkpoint"]
        }else{
            vec!["device.create","objects.list","mesh.inspect","mesh.translate_vertices","scene.inspect","file.checkpoint"]
        };
        json!({"status":"verified","full_plan_completed":true,"same_blender_session":true,
            "session_id":session,"source_action_id":action,"artifact_manifest":manifest,
            "plan_steps":6,
            "approved_plan_lineage":{"schema_version":1,"plan_sha256":"3".repeat(64),
                "operations":operations,"typed_steps":6,"acceptance_stage":stage,
                "owner_approval_reauthenticated":false,
                "runtime_execution_proven_by_this_digest":false}})
    }

    fn valid_png()->Vec<u8>{
        // Legitimate 64x64 uncompressed-deflate transparent RGBA PNG.
        fn adler(data:&[u8])->u32{
            let mut a=1u32;let mut b=0u32;
            for x in data{a=(a+*x as u32)%65521;b=(b+a)%65521;}
            (b<<16)|a
        }
        fn crc32(data:&[u8])->u32{
            let mut c=0xffffffffu32;
            for x in data{
                c^=*x as u32;
                for _ in 0..8{c=if c&1!=0 {(c>>1)^0xedb88320}else{c>>1};}
            }
            !c
        }
        fn chunk(out:&mut Vec<u8>,name:&[u8;4],data:&[u8]){
            out.extend_from_slice(&(data.len() as u32).to_be_bytes());
            out.extend_from_slice(name);out.extend_from_slice(data);
            let mut crcdata=name.to_vec();crcdata.extend_from_slice(data);
            out.extend_from_slice(&crc32(&crcdata).to_be_bytes());
        }
        let raw=vec![0u8;64*(1+64*4)];
        let len=raw.len() as u16;
        let mut zlib=vec![0x78,0x01,0x01];
        zlib.extend_from_slice(&len.to_le_bytes());
        zlib.extend_from_slice(&(!len).to_le_bytes());
        zlib.extend_from_slice(&raw);
        zlib.extend_from_slice(&adler(&raw).to_be_bytes());
        let mut png=b"\x89PNG\r\n\x1a\n".to_vec();
        chunk(&mut png,b"IHDR",&[0,0,0,64,0,0,0,64,8,6,0,0,0]);
        chunk(&mut png,b"IDAT",&zlib);
        chunk(&mut png,b"IEND",&[]);
        png
    }
    fn render_receipt(work:&Workspace,action:&str,session:&str)->Value{
        let mut artifact=work.write(NAMES[2],&valid_png());
        artifact["width"]=json!(64);artifact["height"]=json!(64);
        artifact["color_mode"]=json!("RGBA");artifact["bit_depth"]=json!(8);
        let evidence=json!({"status":"verified","complete":true,
            "authenticated_blender_plan":true,"destructive_allowed":false,
            "executed_steps":3,"artifact":artifact,"checkpoint_reopen":null});
        let manifest=crate::blender_artifact_manifest::build(&evidence,&work.0,action,Some(session)).unwrap();
        json!({"status":"verified","full_plan_completed":true,"same_blender_session":true,
            "session_id":session,"source_action_id":action,"artifact_manifest":manifest,
            "plan_steps":3,
            "approved_plan_lineage":{"schema_version":1,"plan_sha256":"4".repeat(64),
                "operations":["render.configure","scene.inspect","render.execute"],
                "typed_steps":3,"acceptance_stage":"render",
                "owner_approval_reauthenticated":false,
                "runtime_execution_proven_by_this_digest":false}})
    }
    fn fixtures(work:&Workspace)->Value{
        let first=blend_receipt(work,0,A1,S1);
        let second=blend_receipt(work,1,A2,S1);
        let mut render=render_receipt(work,A3,S3);
        render["input_checkpoint"]=json!({
            "path":second["artifact_manifest"]["artifact"]["absolute_path"],
            "sha256":second["artifact_manifest"]["artifact"]["sha256"],
            "bytes":second["artifact_manifest"]["artifact"]["bytes"],
            "verified_loaded_file_path":true,"loaded_file_hash_checked":true,
        });
        json!([first,second,render])
    }

    #[test]
    fn matching_three_receipts_review_current_bytes_without_overclaim(){
        let workspace=Workspace::new();
        let value=review(&fixtures(&workspace),&workspace.0).unwrap();
        assert_eq!(value["status"],"receipt_chain_consistent");
        assert_eq!(value["first_two_same_session"],true);
        assert_eq!(value["active_camera_and_stage2_key_light_claims_consistent"],true);
        assert_eq!(value["render_uses_different_session"],true);
        assert_eq!(value["render_source_stage2_binding_proven"],false);
        assert_eq!(value["render_source_stage2_binding_consistent"],true);
        assert_eq!(value["historical_owner_approval_reauthenticated"],false);
        assert_eq!(value["live_blender_runtime_verified_by_this_review"],false);
        assert_eq!(value["import_performed"],false);
    }

    #[test]
    fn rejects_substituted_render_input_path_sha_size_or_missing_load_proof(){
        let workspace=Workspace::new();let good=fixtures(&workspace);
        let mut wrong_path=good.clone();
        wrong_path[2]["input_checkpoint"]["path"]=
            wrong_path[0]["artifact_manifest"]["artifact"]["absolute_path"].clone();
        assert!(review(&wrong_path,&workspace.0).is_err());
        let mut wrong_hash=good.clone();
        wrong_hash[2]["input_checkpoint"]["sha256"]=json!("0".repeat(64));
        assert!(review(&wrong_hash,&workspace.0).is_err());
        let mut wrong_size=good.clone();
        wrong_size[2]["input_checkpoint"]["bytes"]=json!(1);
        assert!(review(&wrong_size,&workspace.0).is_err());
        let mut missing=good.clone();
        missing[2].as_object_mut().unwrap().remove("input_checkpoint");
        assert!(review(&missing,&workspace.0).is_err());
        let mut no_proof=good.clone();
        no_proof[2]["input_checkpoint"]["verified_loaded_file_path"]=json!(false);
        assert!(review(&no_proof,&workspace.0).is_err());
    }

    #[test]
    fn rejects_fake_stage_wrong_operations_and_missing_plan_hash(){
        let workspace=Workspace::new();let good=fixtures(&workspace);
        let mut fake=good.clone();
        fake[1]["approved_plan_lineage"]["acceptance_stage"]=json!("render");
        assert!(review(&fake,&workspace.0).is_err());
        let mut op=good.clone();
        op[1]["approved_plan_lineage"]["operations"][2]=json!("unsafe.python.run");
        assert!(review(&op,&workspace.0).is_err());
        let mut digest=good.clone();
        digest[2]["approved_plan_lineage"]["plan_sha256"]=json!("not a hash");
        assert!(review(&digest,&workspace.0).is_err());
        let mut steps=good.clone();
        steps[1]["plan_steps"]=json!(3);
        assert!(review(&steps,&workspace.0).is_err());
    }
    #[test]
    fn rejects_replayed_action_ids_and_session_substitution(){
        let workspace=Workspace::new();let receipt=fixtures(&workspace);
        let mut bad=receipt.clone();
        bad[1]["source_action_id"]=bad[0]["source_action_id"].clone();
        assert!(review(&bad,&workspace.0).is_err());
        let mut wrong=receipt.clone();
        wrong[2]["session_id"]=json!(S1);
        wrong[2]["artifact_manifest"]["source_session_id"]=json!(S1);
        assert!(review(&wrong,&workspace.0).is_err());
    }

    #[test]
    fn rejects_unchanged_geometry_missing_proof_and_tampered_bytes(){
        let workspace=Workspace::new();let receipt=fixtures(&workspace);
        let mut same=receipt.clone();
        same[1]["artifact_manifest"]["evidence"]["mesh_fingerprint"]=
            same[0]["artifact_manifest"]["evidence"]["mesh_fingerprint"].clone();
        assert!(review(&same,&workspace.0).is_err());
        let mut same=receipt.clone();
        same[1]["artifact_manifest"]["evidence"]["scene_fingerprint"]=
            same[0]["artifact_manifest"]["evidence"]["scene_fingerprint"].clone();
        assert!(review(&same,&workspace.0).is_err());
        let mut bad=receipt.clone();
        bad[1]["artifact_manifest"]["evidence"]["mesh_geometry_verified"]=json!(false);
        assert!(review(&bad,&workspace.0).is_err());
        fs::write(workspace.0.join(NAMES[2]),b"not an actual PNG").unwrap();
        assert!(review(&receipt,&workspace.0).is_err());
    }


    #[test]
    fn rejects_missing_camera_inactive_camera_and_missing_stage2_lighting(){
        let work=Workspace::new();let good=fixtures(&work);
        let mut no_camera=good.clone();
        no_camera[0]["artifact_manifest"]["evidence"]["proof_camera_verified"]=json!(false);
        assert!(review(&no_camera,&work.0).is_err());
        let mut inactive=good.clone();
        inactive[1]["artifact_manifest"]["evidence"]["active_camera_name"]=json!("OtherCamera");
        assert!(review(&inactive,&work.0).is_err());
        let mut dark=good.clone();
        dark[1]["artifact_manifest"]["evidence"]["proof_key_light_verified"]=json!(false);
        assert!(review(&dark,&work.0).is_err());
        let mut no_evidence=good.clone();
        no_evidence[1]["artifact_manifest"]["evidence"].as_object_mut().unwrap()
            .remove("proof_key_light_verified");
        assert!(review(&no_evidence,&work.0).is_err());
    }
    #[test]
    fn rejects_swapped_stages_or_out_of_root_receipts(){
        let work=Workspace::new();let outside=Workspace::new();
        let mut wrong=fixtures(&work);
        wrong.as_array_mut().unwrap().swap(0,1);
        assert!(review(&wrong,&work.0).is_err());
        let correct=fixtures(&work);
        assert!(review(&correct,&outside.0).is_err());
    }
}
