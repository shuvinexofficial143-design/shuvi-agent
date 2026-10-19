//! Exactly-approved typed Blender plan provenance, with bounded acceptance
//! stage classification. Does not execute Blender, infer owner approval, or
//! permit a model to relabel a generic workflow as a 3-stage acceptance.
use serde_json::{json,Value};
use sha2::{Digest,Sha256};
use std::collections::HashSet;
use uuid::Uuid;

fn operation(step:&Value)->Result<&str,String>{
    step.pointer("/request/operation").and_then(Value::as_str)
        .filter(|s|!s.is_empty()&&s.len()<=64)
        .ok_or("Blender approved plan step lacks a bounded typed operation.".into())
}
fn name(step:&Value)->Result<&str,String>{
    step.get("name").and_then(Value::as_str)
        .filter(|s|!s.is_empty()&&s.len()<=64)
        .ok_or("Blender approved plan step lacks a bounded name.".into())
}
fn payload<'a>(steps:&'a [&Value],i:usize)->&'a Value{
    steps[i].pointer("/request/payload").unwrap_or(&Value::Null)
}
fn checkpoint_binding(step:&Value,source:&str)->bool{
    step.get("bindings")==Some(&json!([{
        "source_step":source,
        "source_path":["data","revision"],
        "target_path":["expected_scene_revision"]
    }]))
}
fn binds_from(step:&Value,source:&str)->bool{
    step.get("bindings").and_then(Value::as_array).is_some_and(|bindings|
        bindings.iter().any(|b|b.get("source_step").and_then(Value::as_str)==Some(source))
    )
}
fn has_binding(step:&Value,source:&str,source_path:Value,target_path:Value)->bool{
    step.get("bindings").and_then(Value::as_array).is_some_and(|items|items.iter().any(|v|v==&json!({
        "source_step":source,"source_path":source_path,"target_path":target_path
    })))
}
fn valid_stage(steps:&[&Value],ops:&[String])->&'static str{
    match ops.iter().map(String::as_str).collect::<Vec<_>>().as_slice(){
        ["mesh.create","mesh.translate_vertices","scene.inspect","device.create","scene.inspect","file.checkpoint"]=>{
            let create=payload(steps,0);let shape=payload(steps,1);
            let camera=payload(steps,3);let checkpoint=payload(steps,5);
            if create.get("name").and_then(Value::as_str)==Some("Shuvi41ProofMesh")
                && create.pointer("/geometry/vertices").and_then(Value::as_array).is_some_and(|a|a.len()==5)
                && create.pointer("/geometry/faces").and_then(Value::as_array).is_some_and(|a|a.len()==5)
                && shape.get("indices")==Some(&json!([4]))
                && shape.get("delta")==Some(&json!([0.0,0.0,0.25]))
                && shape.pointer("/target/expected_name").and_then(Value::as_str)==Some("Shuvi41ProofMesh")
                && has_binding(steps[1],"create",json!(["data","after","object","object_id"]),json!(["target","object_id"]))
                && has_binding(steps[1],"create",json!(["data","after","object","revision"]),json!(["target","expected_revision"]))
                && has_binding(steps[1],"create",json!(["data","after","geometry","geometry_revision"]),json!(["expected_geometry_revision"]))
                && name(steps[2]).ok()==Some("post_edit_scene")
                && camera.get("name").and_then(Value::as_str)==Some("Shuvi41ProofCamera")
                && camera.get("kind").and_then(Value::as_str)==Some("CAMERA")
                && camera.get("settings")==Some(&json!({"lens":50.0,"clip_start":0.1,"clip_end":100.0,"make_active":true}))
                && camera.get("transform")==Some(&json!({"location":[4.0,-6.0,4.0],"rotation_euler":[1.15,0.0,0.58],"scale":[1.0,1.0,1.0]}))
                && camera.get("expected_scene_revision").and_then(Value::as_str)==Some("BOUND_FROM_SCENE")
                && checkpoint_binding(steps[3],"post_edit_scene")
                && name(steps[4]).ok()==Some("post_camera_scene")
                && checkpoint.get("name").and_then(Value::as_str)==Some("shuvi41-proof-stage1.blend")
                && checkpoint_binding(steps[5],"post_camera_scene"){"model1"}else{"other"}
        },
        ["device.create","objects.list","mesh.inspect","mesh.translate_vertices","scene.inspect","file.checkpoint"]=>{
            let light=payload(steps,0);let locate=payload(steps,1);
            let shape=payload(steps,3);
            if light.get("name").and_then(Value::as_str)==Some("Shuvi41ProofKey")
                && light.get("kind").and_then(Value::as_str)==Some("POINT")
                && light.get("settings")==Some(&json!({"energy":950.0,"color":[1.0,0.94,0.85]}))
                && light.get("transform")==Some(&json!({"location":[2.0,-3.0,5.0],"rotation_euler":[0.0,0.0,0.0],"scale":[1.0,1.0,1.0]}))
                && light.get("expected_scene_revision").and_then(Value::as_str).is_some_and(|v|v.len()==64&&v.bytes().all(|c|c.is_ascii_hexdigit()&&!c.is_ascii_uppercase()))
                && locate.get("name_prefix").and_then(Value::as_str)==Some("Shuvi41ProofMesh")
                && locate.get("object_type").and_then(Value::as_str)==Some("MESH")
                && locate.get("offset").and_then(Value::as_u64)==Some(0)
                && shape.get("indices")==Some(&json!([4]))
                && shape.get("delta")==Some(&json!([0.0,0.0,0.5]))
                && shape.pointer("/target/expected_name").and_then(Value::as_str)==Some("Shuvi41ProofMesh")
                && payload(steps,5).get("name").and_then(Value::as_str)==Some("shuvi41-proof-stage2.blend")
                && name(steps[4]).ok()==Some("post_edit_scene")
                && checkpoint_binding(steps[5],"post_edit_scene")
                && binds_from(steps[2],"locate")
                && binds_from(steps[3],"mesh_read"){"model2"}else{"other"}
        },
        ["scene.inspect","objects.list","material.create_assign","scene.inspect","file.checkpoint"]=>{
            let locate=payload(steps,1);let assign=payload(steps,2);
            let checkpoint=payload(steps,4);
            if name(steps[0]).ok()==Some("scene")
                && name(steps[1]).ok()==Some("locate")
                && locate.get("name_prefix").and_then(Value::as_str)==Some("Shuvi41ProofMesh")
                && locate.get("object_type").and_then(Value::as_str)==Some("MESH")
                && locate.get("offset").and_then(Value::as_u64)==Some(0)
                && locate.get("limit").and_then(Value::as_u64)==Some(5)
                && locate.get("expected_revision").and_then(Value::as_str)==Some("BOUND_FROM_SCENE")
                && has_binding(steps[1],"scene",json!(["data","revision"]),json!(["expected_revision"]))
                && assign.pointer("/target/expected_name").and_then(Value::as_str)==Some("Shuvi41ProofMesh")
                && assign.get("name").and_then(Value::as_str)==Some("Shuvi41ProofCopper")
                && assign.get("base_color")==Some(&json!([0.8,0.41,0.16,1.0]))
                && assign.get("metallic")==Some(&json!(0.65))
                && assign.get("roughness")==Some(&json!(0.31))
                && has_binding(steps[2],"locate",json!(["data","items",0,"object_id"]),json!(["target","object_id"]))
                && has_binding(steps[2],"locate",json!(["data","items",0,"revision"]),json!(["target","expected_revision"]))
                && name(steps[3]).ok()==Some("post_look_scene")
                && checkpoint.get("name").and_then(Value::as_str)==Some("shuvi41-proof-material.blend")
                && checkpoint_binding(steps[4],"post_look_scene"){"look"}else{"other"}
        },
        ["objects.list","animation.insert_keyframe","animation.insert_keyframe",
         "scene.inspect","animation.set_frame","file.checkpoint"]=>{
            let locate=payload(steps,0);
            let start=payload(steps,1);
            let end=payload(steps,2);
            let frame=payload(steps,4);
            let checkpoint=payload(steps,5);
            if name(steps[0]).ok()==Some("locate")
                && locate.get("name_prefix").and_then(Value::as_str)==Some("Shuvi41ProofMesh")
                && locate.get("object_type").and_then(Value::as_str)==Some("MESH")
                && locate.get("offset").and_then(Value::as_u64)==Some(0)
                && locate.get("limit").and_then(Value::as_u64)==Some(5)
                && locate.get("expected_revision").and_then(Value::as_str)
                    .is_some_and(|v|v.len()==64&&v.bytes().all(|c|c.is_ascii_hexdigit()&&!c.is_ascii_uppercase()))
                && name(steps[1]).ok()==Some("pose_start")
                && name(steps[2]).ok()==Some("pose_end")
                && start.get("frame").and_then(Value::as_u64)==Some(1)
                && end.get("frame").and_then(Value::as_u64)==Some(24)
                && start.pointer("/target/expected_name").and_then(Value::as_str)==Some("Shuvi41ProofMesh")
                && end.pointer("/target/expected_name").and_then(Value::as_str)==Some("Shuvi41ProofMesh")
                && has_binding(steps[1],"locate",json!(["data","items",0,"object_id"]),json!(["target","object_id"]))
                && has_binding(steps[1],"locate",json!(["data","items",0,"revision"]),json!(["target","expected_revision"]))
                && has_binding(steps[2],"pose_start",json!(["data","after","object_id"]),json!(["target","object_id"]))
                && has_binding(steps[2],"pose_start",json!(["data","after","revision"]),json!(["target","expected_revision"]))
                && name(steps[3]).ok()==Some("post_keys_scene")
                && name(steps[4]).ok()==Some("choose_final_frame")
                && frame.get("frame").and_then(Value::as_u64)==Some(24)
                && has_binding(steps[4],"post_keys_scene",json!(["data","revision"]),json!(["expected_scene_revision"]))
                && checkpoint.get("name").and_then(Value::as_str)==Some("shuvi41-proof-motion.blend")
                && has_binding(steps[5],"choose_final_frame",json!(["data","after","revision"]),json!(["expected_scene_revision"]))
                {"motion"}else{"other"}
        },
        ["animation.set_frame","render.configure","scene.inspect","render.execute"]=>{
            let frame=payload(steps,0);
            let configure=payload(steps,1);
            let output=payload(steps,3);
            let candidate=match (frame.get("frame").and_then(Value::as_u64),
                                 output.get("name").and_then(Value::as_str)){
                (Some(1),Some("shuvi41-proof-motion-frame001.png"))=>"motion_frame1",
                (Some(24),Some("shuvi41-proof-motion-frame024.png"))=>"motion_frame24",
                _=>"other"
            };
            if candidate!="other"
                && name(steps[0]).ok()==Some("seek")
                && name(steps[1]).ok()==Some("configure")
                && name(steps[2]).ok()==Some("configured_scene")
                && name(steps[3]).ok()==Some("render")
                && configure.get("width").and_then(Value::as_u64)==Some(64)
                && configure.get("height").and_then(Value::as_u64)==Some(64)
                && configure.get("samples").and_then(Value::as_u64)==Some(1)
                && has_binding(steps[1],"seek",json!(["data","after","revision"]),
                    json!(["expected_scene_revision"]))
                && checkpoint_binding(steps[3],"configured_scene"){
                candidate
            }else{"other"}
        },
        ["render.configure","scene.inspect","render.execute"]=>{
            let config=payload(steps,0);
            if config.get("width").and_then(Value::as_u64)==Some(64)
                && config.get("height").and_then(Value::as_u64)==Some(64)
                && config.get("samples").and_then(Value::as_u64)==Some(1)
                && payload(steps,2).get("name").and_then(Value::as_str)==Some("shuvi41-proof-render.png")
                && name(steps[1]).ok()==Some("configured_scene")
                && checkpoint_binding(steps[2],"configured_scene"){
                "render"
            }else if config.get("width").and_then(Value::as_u64)==Some(64)
                && config.get("height").and_then(Value::as_u64)==Some(64)
                && config.get("samples").and_then(Value::as_u64)==Some(1)
                && payload(steps,2).get("name").and_then(Value::as_str)==Some("shuvi41-proof-material-render.png")
                && name(steps[1]).ok()==Some("configured_scene")
                && checkpoint_binding(steps[2],"configured_scene"){
                "look_render"
            }else{"other"}
        },
        _=>"other",
    }
}
/// Check the WHOLE plan shape against the exact plan-only native generator,
/// not just a few stage-identifying fields. Only fresh UUIDs and the initial
/// session-revision value are allowed to vary. Every step name, request field,
/// result binding, timeout, geometry, device property and destination must
/// otherwise be identical. No files, external commands or Blender launches.
fn exact_recipe_shape(plan:&Value,stage:&str)->bool{
    let revision=if stage=="look"{
        "a".repeat(64) // the look plan has no embedded initial revision
    }else if stage=="motion"{
        match plan.pointer("/steps/0/request/payload/expected_revision").and_then(Value::as_str){
            Some(s) if s.len()==64 && s.bytes().all(|c|c.is_ascii_hexdigit()&&!c.is_ascii_uppercase())=>s.to_owned(),
            _=>return false
        }
    }else{
        match plan.pointer("/steps/0/request/payload/expected_scene_revision").and_then(Value::as_str){
            Some(s) if s.len()==64 && s.bytes().all(|c|c.is_ascii_hexdigit()&&!c.is_ascii_uppercase())=>s.to_owned(),
            _=>return false
        }
    };
    let expected=match crate::blender_acceptance_recipe::expected_plan(stage,&revision){
        Some(value)=>value,
        None=>return false
    };
    let expected_steps=match expected.get("steps").and_then(Value::as_array){
        Some(v)=>v,
        None=>return false
    };
    let steps=match plan.get("steps").and_then(Value::as_array){
        Some(v) if v.len()==expected_steps.len()=>v,
        _=>return false
    };
    let mut normalized=plan.clone();
    let mut seen_ids=HashSet::new();
    for (index,step) in steps.iter().enumerate(){
        for key in ["request_id","command_id"]{
            let id=match step.pointer(&format!("/request/{key}")).and_then(Value::as_str){
                Some(v)=>v,
                None=>return false
            };
            match Uuid::parse_str(id){
                Ok(uuid) if uuid.to_string()==id && seen_ids.insert(id.to_owned())=>{},
                _=>return false,
            }
            normalized["steps"][index]["request"][key]=expected_steps[index]["request"][key].clone();
        }
    }
    normalized==expected
}

pub(crate) fn derive(plan:&Value)->Result<Value,String>{
    let steps=plan.get("steps").and_then(Value::as_array)
        .filter(|s|!s.is_empty()&&s.len()<=6)
        .ok_or("Blender provenance needs 1..6 approved typed steps.")?;
    let raw=serde_json::to_vec(plan).map_err(|_|"Invalid Blender approved plan JSON.")?;
    if raw.len()>65536{return Err("Blender plan provenance exceeds 64 KiB.".into());}
    let mut step_names=HashSet::new();
    let mut ops=Vec::with_capacity(steps.len());
    for step in steps{
        let label=name(step)?;
        if !step_names.insert(label){return Err("Blender plan step names must be unique.".into());}
        ops.push(operation(step)?.to_owned());
    }
    let ordered=steps.iter().collect::<Vec<_>>();
    let suggested=valid_stage(&ordered,&ops);
    let stage=if suggested!="other" && exact_recipe_shape(plan,suggested){suggested}else{"other"};
    Ok(json!({
        "schema_version":1,
        "plan_sha256":format!("{:x}",Sha256::digest(&raw)),
        "operations":ops,
        "acceptance_stage":stage,
        "typed_steps":steps.len(),
        "owner_approval_reauthenticated":false,
        "runtime_execution_proven_by_this_digest":false,
    }))
}
pub(crate) fn receipt_matches(receipt:&Value,stage:&str)->Result<(),String>{
    let lineage=receipt.get("approved_plan_lineage")
        .ok_or("Blender acceptance has no native plan provenance.")?;
    if lineage.get("schema_version").and_then(Value::as_u64)!=Some(1)
        ||lineage.get("acceptance_stage").and_then(Value::as_str)!=Some(stage)
        ||lineage.get("typed_steps").and_then(Value::as_u64)!=Some(
            if stage=="render"{3}else{6}
        ) {
        return Err("Blender acceptance stage is not the approved typed plan recipe.".into());
    }
    let sha=lineage.get("plan_sha256").and_then(Value::as_str)
        .ok_or("Blender accepted plan has no hash.")?;
    if sha.len()!=64 || !sha.bytes().all(|c|c.is_ascii_hexdigit()&&!c.is_ascii_uppercase()){
        return Err("Blender acceptance approved plan SHA-256 invalid.".into());
    }
    if lineage.get("owner_approval_reauthenticated").and_then(Value::as_bool)!=Some(false)
        ||lineage.get("runtime_execution_proven_by_this_digest").and_then(Value::as_bool)!=Some(false){
        return Err("Blender plan digest must not imply independent approval or execution.".into());
    }
    let expected:Vec<&str>=match stage{
        "model1"=>vec!["mesh.create","mesh.translate_vertices","scene.inspect","device.create","scene.inspect","file.checkpoint"],
        "model2"=>vec!["device.create","objects.list","mesh.inspect","mesh.translate_vertices","scene.inspect","file.checkpoint"],
        "render"=>vec!["render.configure","scene.inspect","render.execute"],
        _=>return Err("Unexpected acceptance stage.".into())
    };
    let actual=lineage.get("operations").and_then(Value::as_array)
        .ok_or("Blender plan operation sequence missing.")?;
    if actual.len()!=expected.len() || actual.iter().zip(expected.iter()).any(
        |(actual,want)|actual.as_str()!=Some(*want)
    ){
        return Err("Blender native plan operation sequence differs from acceptance stage.".into());
    }
    Ok(())
}
/// Compare the actual artifact name and output type to the *last approved
/// typed step*, not merely to the output folder or SHA-256 file bytes. A
/// correctly hashed but wrong-named artifact must never reach the handoff.
/// This is a pure contract check; it does not access a file or run Blender.
pub(crate) fn verify_final_artifact_binding(plan:&Value,output:&Value)->Result<(),String>{
    let steps=plan.get("steps").and_then(Value::as_array)
        .filter(|steps|!steps.is_empty() && steps.len()<=6)
        .ok_or("Approved Blender plan has no bounded final step.")?;
    let final_step=steps.last().ok_or("Approved Blender plan is empty.")?;
    // The last verified artifact cannot stand in for earlier unexecuted steps.
    // Native delivery binds the worker's total and final operation to the
    // approved typed plan, regardless of a success flag from the worker.
    if output.get("executed_steps").and_then(Value::as_u64)!=Some(steps.len() as u64) {
        return Err("Blender worker step transcript is incomplete or disagrees with approved plan.".into());
    }
    let operation=final_step.pointer("/request/operation").and_then(Value::as_str)
        .ok_or("Approved Blender final operation missing.")?;
    let kind=match operation{
        "file.checkpoint"=>"BLEND",
        "render.execute"=>"PNG",
        _=>return Err("Approved Blender plan does not end in a supported output.".into()),
    };
    let expected_name=final_step.pointer("/request/payload/name").and_then(Value::as_str)
        .filter(|name|!name.is_empty() && name.len()<=128)
        .ok_or("Approved Blender output filename missing or oversized.")?;
    if std::path::Path::new(expected_name).file_name().and_then(|s|s.to_str())!=Some(expected_name)
        ||(expected_name.contains('/') || expected_name.contains('\\'))
        ||!expected_name.to_ascii_lowercase().ends_with(if kind=="BLEND"{".blend"}else{".png"}){
        return Err("Approved Blender output filename must be a plain typed filename.".into());
    }
    let artifact=output.get("artifact").ok_or("Blender artifact missing from worker output.")?;
    let actual_name=artifact.get("path").and_then(Value::as_str)
        .and_then(|name|std::path::Path::new(name).file_name()).and_then(|s|s.to_str())
        .ok_or("Verified Blender output has no filename.")?;
    if actual_name!=expected_name || artifact.get("format").and_then(Value::as_str)!=Some(kind) {
        return Err("Verified Blender artifact differs from the approved final step's exact filename or format.".into());
    }
    if output.get("final_operation").and_then(Value::as_str)!=Some(operation){
        return Err("Blender worker final operation is absent or differs from approved typed plan.".into());
    }
    Ok(())
}

/// Native fail-closed dispatch policy for the reserved workflow output file
/// names. The matched output *must* come from the exact typed recipe, not an
/// unrelated plan whose last step writes an identical filename. The one-off
/// Python adapter has no material preflight; material PNGs therefore require
/// the persistent broker. No disk or Blender launch happens here.
pub(crate) fn reserved_output_policy(
    plan:&Value,lineage:&Value,input_source:Option<&str>,
    allow_render:bool,persistent_session:bool
)->Result<(),String>{
    let steps=plan.get("steps").and_then(Value::as_array)
        .ok_or("Blender plan must contain typed steps.")?;
    let mut role=None;
    for step in steps{
        let operation=step.pointer("/request/operation").and_then(Value::as_str);
        if !matches!(operation,Some("file.checkpoint"|"render.execute")){continue;}
        let filename=step.pointer("/request/payload/name").and_then(Value::as_str);
        // Win32 filenames are case-insensitive and may alias a final dot
        // or space. Never let a generic plan bypass fixed stage policies
        // simply by spelling the reserved basename differently.
        let folded=filename.map(|name|{
            name.trim_end_matches(|c:char|c==' '||c=='.').to_ascii_lowercase()
        });
        let matched=match folded.as_deref(){
            Some("shuvi41-proof-stage1.blend")=>Some("model1"),
            Some("shuvi41-proof-stage2.blend")=>Some("model2"),
            Some("shuvi41-proof-render.png")=>Some("render"),
            Some("shuvi41-proof-material.blend")=>Some("look"),
            Some("shuvi41-proof-material-render.png")=>Some("look_render"),
            Some("shuvi41-proof-motion.blend")=>Some("motion"),
            Some("shuvi41-proof-motion-frame001.png")=>Some("motion_frame1"),
            Some("shuvi41-proof-motion-frame024.png")=>Some("motion_frame24"),
            _=>None
        };
        if let Some(expected)=matched {
            if role.is_some(){return Err("Blender reserved output appears multiple times.".into());}
            role=Some(expected);
        }
    }
    let stage=match role{Some(v)=>v,None=>return Ok(())};
    if lineage.get("acceptance_stage").and_then(Value::as_str)!=Some(stage)
        || !exact_recipe_shape(plan,stage){
        return Err("Blender reserved artifact requires the unchanged typed native recipe.".into());
    }
    // Stage 1 creates a fresh scene. Stage 2 must remain in the same
    // native-owned persistent session as a previously VERIFIED Stage 1;
    // it must never load an arbitrary similarly named external checkpoint.
    if stage=="model1" && input_source.is_some(){
        return Err("Fixed first Blender stage requires a clean owner-approved session.".into());
    }
    if stage=="model2" && (input_source.is_some() || !persistent_session){
        return Err("Fixed second Blender stage requires verified Stage 1 in the same persistent session.".into());
    }
    let source_name=match stage{
        "render"|"look"|"motion"=>Some("shuvi41-proof-stage2.blend"),
        "motion_frame1"|"motion_frame24"=>Some("shuvi41-proof-motion.blend"),
        "look_render"=>Some("shuvi41-proof-material.blend"),
        _=>None
    };
    if let Some(expected)=source_name {
        if input_source.and_then(|p|std::path::Path::new(p).file_name())
            .and_then(|name|name.to_str())!=Some(expected){
            return Err("Blender reserved stage requires the exact expected SHA-pinned input checkpoint.".into());
        }
    }
    if matches!(stage,"render"|"look_render"|"motion_frame1"|"motion_frame24") && !allow_render {
        return Err("Blender reserved PNG stage requires explicit render approval.".into());
    }
    if matches!(stage,"look_render"|"motion_frame1"|"motion_frame24") && !persistent_session {
        return Err("Blender material PNG requires the persistent broker's independent scene/material preflight.".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests{
    use super::*;
    fn step(n:&str,o:&str,p:Value,bindings:Value)->Value{
        json!({"name":n,"request":{"operation":o,"payload":p},"bindings":bindings})
    }
    #[test]
    fn classifies_exact_bounded_render_and_rejects_substituted_dimensions(){
        let plan=crate::blender_acceptance_recipe::expected_plan("render",&"a".repeat(64)).unwrap();
        let token=derive(&plan).unwrap();
        assert_eq!(token["acceptance_stage"],"render");
        receipt_matches(&json!({"approved_plan_lineage":token}),"render").unwrap();
        let mut fake=plan.clone();fake["steps"][0]["request"]["payload"]["width"]=json!(1024);
        let forged=derive(&fake).unwrap();
        assert_eq!(forged["acceptance_stage"],"other");
        assert!(receipt_matches(&json!({"approved_plan_lineage":forged}),"render").is_err());
    }
    #[test]
    fn motion_reserved_output_requires_exact_keyframe_plan_and_stage2_sha_pinned_source(){
        let rev="c".repeat(64);
        let plan=crate::blender_acceptance_recipe::expected_plan("motion",&rev).unwrap();
        let lineage=derive(&plan).unwrap();
        assert_eq!(lineage["acceptance_stage"],"motion");
        reserved_output_policy(&plan,&lineage,Some("/proofs/shuvi41-proof-stage2.blend"),
            false,true).unwrap();
        assert!(reserved_output_policy(&plan,&lineage,None,false,true).is_err());
        assert!(reserved_output_policy(&plan,&lineage,Some("/proofs/different.blend"),false,true).is_err());
        let mut altered=plan.clone();
        altered["steps"][2]["request"]["payload"]["frame"]=json!(99);
        assert_eq!(derive(&altered).unwrap()["acceptance_stage"],"other");
        assert!(reserved_output_policy(&altered,&derive(&altered).unwrap(),
            Some("/proofs/shuvi41-proof-stage2.blend"),false,true).is_err());
        let mut aliased=plan.clone();
        aliased["steps"][5]["request"]["payload"]["name"]=json!("shuvi41-proof-motion.blend.");
        assert!(reserved_output_policy(&aliased,&derive(&aliased).unwrap(),
            Some("/proofs/shuvi41-proof-stage2.blend"),false,true).is_err());
    }
    #[test]
    fn motion_frame_render_requires_actual_motion_source_render_permission_and_persistent_session(){
        let rev="c".repeat(64);
        for (stage,frame,file) in [
            ("motion_frame1",1,"shuvi41-proof-motion-frame001.png"),
            ("motion_frame24",24,"shuvi41-proof-motion-frame024.png"),
        ]{
            let plan=crate::blender_acceptance_recipe::expected_plan(stage,&rev).unwrap();
            let lineage=derive(&plan).unwrap();
            assert_eq!(lineage["acceptance_stage"],stage);
            reserved_output_policy(&plan,&lineage,
                Some("/approved/shuvi41-proof-motion.blend"),true,true).unwrap();
            for source in [
                None,Some("/approved/shuvi41-proof-stage2.blend"),
                Some("/approved/wrong-motion.blend")
            ]{
                assert!(reserved_output_policy(&plan,&lineage,source,true,true).is_err());
            }
            assert!(reserved_output_policy(&plan,&lineage,
                Some("/approved/shuvi41-proof-motion.blend"),false,true).is_err());
            assert!(reserved_output_policy(&plan,&lineage,
                Some("/approved/shuvi41-proof-motion.blend"),true,false).is_err());
            assert_eq!(plan["steps"][0]["request"]["payload"]["frame"],frame);
            assert_eq!(plan["steps"][3]["request"]["payload"]["name"],file);
            for (step,field,evil) in [
                (0,"frame",json!(42)),(1,"samples",json!(8)),
                (3,"name",json!("regular.png"))
            ]{
                let mut changed=plan.clone();
                changed["steps"][step]["request"]["payload"][field]=evil;
                assert_eq!(derive(&changed).unwrap()["acceptance_stage"],"other");
            }
            for alias in [
                file.to_ascii_uppercase(),
                format!("{file}."),
                format!("{file} ")
            ]{
                let mut changed=plan.clone();
                changed["steps"][3]["request"]["payload"]["name"]=json!(alias);
                let token=derive(&changed).unwrap();
                assert!(reserved_output_policy(&changed,&token,
                    Some("/approved/shuvi41-proof-motion.blend"),true,true).is_err());
            }
        }
    }
    #[test]
    fn strict_template_rejects_hidden_mutations_and_unsafe_material_render_substitutions(){
        let revision="b".repeat(64);
        for stage in ["model1","model2","render","look","look_render","motion","motion_frame1","motion_frame24"]{
            let original=crate::blender_acceptance_recipe::expected_plan(stage,&revision).unwrap();
            assert_eq!(derive(&original).unwrap()["acceptance_stage"],stage);
            let mut altered=original.clone();
            // A stealthy additional payload field was previously ignored by
            // the permissive stage classifier.
            altered["steps"][0]["request"]["payload"]["dangerous_extra"]=json!("unexpected");
            assert_eq!(derive(&altered).unwrap()["acceptance_stage"],"other");
            let mut appended=original.clone();
            appended["steps"][0]["bindings"].as_array_mut().unwrap().push(json!({
                "source_step":"forged","source_path":["data","revision"],
                "target_path":["expected_scene_revision"]
            }));
            assert_eq!(derive(&appended).unwrap()["acceptance_stage"],"other");
            let mut changed_timeout=original.clone();
            changed_timeout["steps"][0]["request"]["timeout_ms"]=json!(90000);
            assert_eq!(derive(&changed_timeout).unwrap()["acceptance_stage"],"other");
            let mut wrong_plan_budget=original.clone();
            wrong_plan_budget["timeout_ms"]=json!(180000);
            assert_eq!(derive(&wrong_plan_budget).unwrap()["acceptance_stage"],"other");
        }
        let mut create=crate::blender_acceptance_recipe::expected_plan("model1",&revision).unwrap();
        create["steps"][0]["request"]["payload"]["geometry"]["vertices"][4][2]=json!(99.0);
        assert_eq!(derive(&create).unwrap()["acceptance_stage"],"other");
        let mut look=crate::blender_acceptance_recipe::expected_plan("look",&revision).unwrap();
        look["steps"][2]["request"]["payload"]["target"]["object_id"]=json!("spoofed-target");
        assert_eq!(derive(&look).unwrap()["acceptance_stage"],"other");
        let mut render=crate::blender_acceptance_recipe::expected_plan("look_render",&revision).unwrap();
        render["steps"][0]["request"]["payload"]["expected_scene_revision"]=json!("0".repeat(64));
        // Fresh revisions can legitimately vary; the classifier must not
        // claim owner approval or verified input source merely from this.
        assert_eq!(derive(&render).unwrap()["acceptance_stage"],"look_render");
    }

    #[test]
    fn strict_template_rejects_noncanonical_or_replayed_request_ids(){
        let revision="c".repeat(64);
        let original=crate::blender_acceptance_recipe::expected_plan("model2",&revision).unwrap();
        let mut duplicate=original.clone();
        duplicate["steps"][1]["request"]["request_id"]=original["steps"][0]["request"]["request_id"].clone();
        assert_eq!(derive(&duplicate).unwrap()["acceptance_stage"],"other");
        let mut mismatched=original.clone();
        mismatched["steps"][1]["request"]["command_id"]=json!("not-a-uuid");
        assert_eq!(derive(&mismatched).unwrap()["acceptance_stage"],"other");
        let mut renamed=original.clone();
        renamed["steps"][1]["name"]=json!("renamed");
        assert_eq!(derive(&renamed).unwrap()["acceptance_stage"],"other");
    }

    #[test]
    fn approved_camera_light_stage_needs_exact_devices_bindings_and_shape(){
        for stage in ["model1","model2"]{
            let plan=crate::blender_acceptance_recipe::build(stage,&"a".repeat(64)).unwrap()["plan"].clone();
            assert_eq!(derive(&plan).unwrap()["acceptance_stage"],stage);
            receipt_matches(&json!({"approved_plan_lineage":derive(&plan).unwrap()}),stage).unwrap();
            let mut bad=plan.clone();
            let device_index=if stage=="model1"{3}else{0};
            bad["steps"][device_index]["request"]["payload"]["settings"]=json!({});
            assert_eq!(derive(&bad).unwrap()["acceptance_stage"],"other");
            let mut bad_shape=plan.clone();
            let shape_index=if stage=="model1"{1}else{3};
            bad_shape["steps"][shape_index]["request"]["payload"]["delta"]=json!([1,0,0]);
            assert_eq!(derive(&bad_shape).unwrap()["acceptance_stage"],"other");
        }
        let mut no_camera_binding=crate::blender_acceptance_recipe::build("model1",&"a".repeat(64)).unwrap()["plan"].clone();
        no_camera_binding["steps"][3]["bindings"]=json!([]);
        assert_eq!(derive(&no_camera_binding).unwrap()["acceptance_stage"],"other");
    }
    #[test]
    fn look_lineage_rejects_unsafe_material_or_missing_fresh_revision_binding(){
        let native=crate::blender_acceptance_recipe::build("look",&"b".repeat(64)).unwrap();
        let plan=native["plan"].clone();
        assert_eq!(derive(&plan).unwrap()["acceptance_stage"],"look");
        let mut forged=plan.clone();
        forged["steps"][2]["request"]["payload"]["metallic"]=json!(0.0);
        assert_eq!(derive(&forged).unwrap()["acceptance_stage"],"other");
        let mut missing=plan.clone();
        missing["steps"][1]["bindings"]=json!([]);
        assert_eq!(derive(&missing).unwrap()["acceptance_stage"],"other");
        let mut stale=plan.clone();
        stale["steps"][4]["bindings"]=json!([]);
        assert_eq!(derive(&stale).unwrap()["acceptance_stage"],"other");
        assert!(receipt_matches(&json!({"approved_plan_lineage":derive(&plan).unwrap()}),"model2").is_err());
    }
    #[test]
    fn look_render_exact_output_is_distinct_and_fail_closed_on_substitution(){
        let native=crate::blender_acceptance_recipe::build("look_render",&"a".repeat(64)).unwrap();
        let plan=native["plan"].clone();
        assert_eq!(derive(&plan).unwrap()["acceptance_stage"],"look_render");
        let mut forged=plan.clone();
        forged["steps"][2]["request"]["payload"]["name"]=json!("arbitrary.png");
        assert_eq!(derive(&forged).unwrap()["acceptance_stage"],"other");
        let mut wrong=plan.clone();
        wrong["steps"][0]["request"]["payload"]["samples"]=json!(256);
        assert_eq!(derive(&wrong).unwrap()["acceptance_stage"],"other");
        assert!(receipt_matches(&json!({"approved_plan_lineage":derive(&plan).unwrap()}),"render").is_err());
    }
    #[test]
    fn windows_reserved_blender_names_are_protected_against_case_and_dot_aliases(){
        let revision="a".repeat(64);
        for (stage,filename) in [
            ("model1","SHUVI41-PROOF-STAGE1.BLEND"),
            ("model2","Shuvi41-Proof-Stage2.BlEnD"),
            ("render","SHUVI41-PROOF-RENDER.PNG"),
            ("look","SHUVI41-PROOF-MATERIAL.BLEND"),
            ("look_render","SHUVI41-PROOF-MATERIAL-RENDER.PNG"),
            ("model1","shuvi41-proof-stage1.blend."),
            ("model2","shuvi41-proof-stage2.blend  "),
            ("motion_frame1","SHUVI41-PROOF-MOTION-FRAME001.PNG"),
            ("motion_frame24","shuvi41-proof-motion-frame024.png.")
        ] {
            let mut plan=crate::blender_acceptance_recipe::expected_plan(stage,&revision).unwrap();
            let last=plan["steps"].as_array().unwrap().len()-1;
            plan["steps"][last]["request"]["payload"]["name"]=json!(filename);
            let lineage=derive(&plan).unwrap();
            assert_eq!(lineage["acceptance_stage"],"other","{filename}");
            let source=if stage=="look_render"{Some("/approved/shuvi41-proof-material.blend")}
                else{Some("/approved/shuvi41-proof-stage2.blend")};
            assert!(reserved_output_policy(&plan,&lineage,source,true,true).is_err(),
                    "reserved basename escaped native policy: {filename}");
        }
        let generic=json!({"steps":[step("checkpoint","file.checkpoint",
            json!({"name":"ordinary.blend"}),json!([]))]});
        assert!(reserved_output_policy(&generic,&json!({"acceptance_stage":"other"}),
            None,false,false).is_ok());
    }
    #[test]
    fn final_artifact_binding_rejects_correct_hash_wrong_filename_and_format(){
        let revision="d".repeat(64);
        for stage in ["model1","model2","render","look","look_render","motion","motion_frame1","motion_frame24"]{
            let plan=crate::blender_acceptance_recipe::expected_plan(stage,&revision).unwrap();
            let last=plan["steps"].as_array().unwrap().last().unwrap();
            let operation=last["request"]["operation"].as_str().unwrap();
            let output_name=last["request"]["payload"]["name"].as_str().unwrap();
            let kind=if operation=="render.execute"{"PNG"}else{"BLEND"};
            let good=json!({"artifact":{"path":format!("/approved/outputs/{output_name}"),"format":kind},
                            "final_operation":operation,"executed_steps":plan["steps"].as_array().unwrap().len()});
            verify_final_artifact_binding(&plan,&good).unwrap();
            let swapped_name=json!({"artifact":{"path":"/approved/outputs/unrelated.png","format":kind},
                                    "final_operation":operation,"executed_steps":plan["steps"].as_array().unwrap().len()});
            assert!(verify_final_artifact_binding(&plan,&swapped_name).is_err());
            let wrong_format=json!({"artifact":{"path":format!("/approved/outputs/{output_name}"),
                                                 "format":if kind=="PNG"{"BLEND"}else{"PNG"}},
                                    "final_operation":operation,"executed_steps":plan["steps"].as_array().unwrap().len()});
            assert!(verify_final_artifact_binding(&plan,&wrong_format).is_err());
            let wrong_operation=json!({"artifact":{"path":format!("/approved/outputs/{output_name}"),"format":kind},
                                       "final_operation":"unapproved.operation","executed_steps":plan["steps"].as_array().unwrap().len()});
            assert!(verify_final_artifact_binding(&plan,&wrong_operation).is_err());
            let bare=json!({"artifact":{"path":output_name,"format":kind},
                             "executed_steps":plan["steps"].as_array().unwrap().len(),
                             "final_operation":operation});
            verify_final_artifact_binding(&plan,&bare).unwrap();
            let mut missing_steps=bare.clone();
            missing_steps.as_object_mut().unwrap().remove("executed_steps");
            assert!(verify_final_artifact_binding(&plan,&missing_steps).is_err());
            let mut incomplete=bare.clone();
            incomplete["executed_steps"]=json!(1);
            assert!(verify_final_artifact_binding(&plan,&incomplete).is_err());
            let mut too_many=bare.clone();
            too_many["executed_steps"]=json!(99);
            assert!(verify_final_artifact_binding(&plan,&too_many).is_err());
            let mut missing_final=bare.clone();
            missing_final.as_object_mut().unwrap().remove("final_operation");
            assert!(verify_final_artifact_binding(&plan,&missing_final).is_err());
        }
    }
    #[test]
    fn typed_plan_completion_cannot_be_inferred_from_verified_last_file(){
        let plan=crate::blender_acceptance_recipe::expected_plan("look",&"a".repeat(64)).unwrap();
        let last=plan["steps"].as_array().unwrap().last().unwrap();
        let file=last["request"]["payload"]["name"].as_str().unwrap();
        let correct=plan["steps"].as_array().unwrap().len();
        let mut output=json!({"artifact":{"path":format!("/workspace/{file}"),"format":"BLEND"},
            "executed_steps":correct,"final_operation":"file.checkpoint"});
        verify_final_artifact_binding(&plan,&output).unwrap();
        for count in [0,1,3,7,100]{
            output["executed_steps"]=json!(count);
            assert!(verify_final_artifact_binding(&plan,&output).is_err());
        }
        output["executed_steps"]=json!(correct);
        output["final_operation"]=Value::Null;
        assert!(verify_final_artifact_binding(&plan,&output).is_err());
    }

    #[test]
    fn final_artifact_binding_denies_nested_windows_and_alternative_destinations(){
        let mut p=crate::blender_acceptance_recipe::expected_plan("render",&"c".repeat(64)).unwrap();
        let mut output=json!({"artifact":{"path":"/approved/outputs/shuvi41-proof-render.png","format":"PNG"},
            "executed_steps":3,"final_operation":"render.execute"});
        for forged in ["nested/shuvi41-proof-render.png","nested\\\\shuvi41-proof-render.png","wrong.blend",""]{
            p["steps"][2]["request"]["payload"]["name"]=json!(forged);
            assert!(verify_final_artifact_binding(&p,&output).is_err());
        }
        p["steps"][2]["request"]["payload"]["name"]=json!("shuvi41-proof-render.png");
        output["artifact"]["path"]=json!("/approved/outputs/shuvi41-proof-stage2.blend");
        assert!(verify_final_artifact_binding(&p,&output).is_err());
    }

    #[test]
    fn reserved_outputs_reject_forged_steps_and_wrong_sha_pinned_source(){
        let rev="c".repeat(64);
        let sources=[
            ("model1",None,false),
            ("model2",None,false),
            ("render",Some("/approved/shuvi41-proof-stage2.blend"),true),
            ("look",Some("/approved/shuvi41-proof-stage2.blend"),false),
            ("look_render",Some("/approved/shuvi41-proof-material.blend"),true),
            ("motion",Some("/approved/shuvi41-proof-stage2.blend"),false),
            ("motion_frame1",Some("/approved/shuvi41-proof-motion.blend"),true),
            ("motion_frame24",Some("/approved/shuvi41-proof-motion.blend"),true),
        ];
        for (stage,source,render) in sources {
            let plan=crate::blender_acceptance_recipe::expected_plan(stage,&rev).unwrap();
            let lineage=derive(&plan).unwrap();
            reserved_output_policy(&plan,&lineage,source,render,true).unwrap();
            let wrong_source=if stage=="look_render"{
                Some("/approved/shuvi41-proof-stage2.blend")
            }else{Some("/approved/shuvi41-proof-material.blend")};
            if matches!(stage,"look"|"render"|"look_render"|"motion"|"motion_frame1"|"motion_frame24") {
                assert!(reserved_output_policy(&plan,&lineage,wrong_source,render,true).is_err());
                assert!(reserved_output_policy(&plan,&lineage,None,render,true).is_err());
            }
            if render{
                assert!(reserved_output_policy(&plan,&lineage,source,false,true).is_err());
            }
            let mut forged=plan.clone();
            let last=forged["steps"].as_array().unwrap().len()-1;
            forged["steps"][0]["request"]["payload"]["unsafe_extra"]=json!(true);
            assert!(reserved_output_policy(&forged,&derive(&forged).unwrap(),source,render,true).is_err());
            let mut changed=plan.clone();
            changed["steps"][last]["request"]["payload"]["name"]=json!("arbitrary.png");
            // The unreserved ordinary output cannot impersonate this reserved name.
            assert_ne!(derive(&changed).unwrap()["acceptance_stage"],stage);
        }
    }
    #[test]
    fn fixed_stage_two_cannot_open_an_unverified_file_or_use_oneoff_worker(){
        let rev="f".repeat(64);
        let stage1=crate::blender_acceptance_recipe::expected_plan("model1",&rev).unwrap();
        let stage2=crate::blender_acceptance_recipe::expected_plan("model2",&rev).unwrap();
        let l1=derive(&stage1).unwrap();
        let l2=derive(&stage2).unwrap();
        reserved_output_policy(&stage1,&l1,None,false,true).unwrap();
        assert!(reserved_output_policy(&stage1,&l1,
            Some("/approved/shuvi41-proof-stage1.blend"),false,true).is_err());
        reserved_output_policy(&stage2,&l2,None,false,true).unwrap();
        assert!(reserved_output_policy(&stage2,&l2,None,false,false).is_err());
        for source in [
            Some("/approved/shuvi41-proof-stage1.blend"),
            Some("/approved/shuvi41-proof-stage2.blend"),
            Some("/approved/unrelated.blend")
        ]{
            assert!(reserved_output_policy(&stage2,&l2,source,false,true).is_err());
        }
    }
    #[test]
    fn oneoff_material_png_is_denied_without_persistent_preflight(){
        let plan=crate::blender_acceptance_recipe::expected_plan("look_render",&"d".repeat(64)).unwrap();
        let token=derive(&plan).unwrap();
        let source=Some("/approved/shuvi41-proof-material.blend");
        assert!(reserved_output_policy(&plan,&token,source,true,false).is_err());
        reserved_output_policy(&plan,&token,source,true,true).unwrap();
    }
    #[test]
    fn generic_unreserved_model_plans_retain_normal_native_approval_flow(){
        let plan=json!({"steps":[step("inspect","scene.inspect",json!({}),json!([]))]});
        let token=derive(&plan).unwrap();
        assert_eq!(token["acceptance_stage"],"other");
        reserved_output_policy(&plan,&token,None,false,false).unwrap();
        reserved_output_policy(&plan,&token,None,false,true).unwrap();
    }
    #[test]
    fn duplicate_steps_malformed_receipts_and_zero_steps_denied(){
        assert!(derive(&json!({"steps":[]})).is_err());
        let plan=json!({"steps":[
            step("duplicate","scene.inspect",json!({}),json!([])),
            step("duplicate","scene.inspect",json!({}),json!([]))
        ]});
        assert!(derive(&plan).is_err());
        assert!(receipt_matches(&json!({"approved_plan_lineage":{"acceptance_stage":"model1"}}),"model1").is_err());
    }
}
