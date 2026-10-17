//! Exactly-approved typed Blender plan provenance, with bounded acceptance
//! stage classification. Does not execute Blender, infer owner approval, or
//! permit a model to relabel a generic workflow as a 3-stage acceptance.
use serde_json::{json,Value};
use sha2::{Digest,Sha256};
use std::collections::HashSet;

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
    let stage=valid_stage(&ordered,&ops);
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
#[cfg(test)]
mod tests{
    use super::*;
    fn step(n:&str,o:&str,p:Value,bindings:Value)->Value{
        json!({"name":n,"request":{"operation":o,"payload":p},"bindings":bindings})
    }
    #[test]
    fn classifies_exact_bounded_render_and_rejects_substituted_dimensions(){
        let plan=json!({"steps":[
            step("configure","render.configure",json!({"width":64,"height":64,"samples":1,"expected_scene_revision":"a".repeat(64)}),json!([])),
            step("configured_scene","scene.inspect",json!({}),json!([])),
            step("render","render.execute",json!({"name":"shuvi41-proof-render.png","expected_scene_revision":"BOUND"}),
                json!([{"source_step":"configured_scene","source_path":["data","revision"],"target_path":["expected_scene_revision"]}]))
        ],"timeout_ms":90000});
        let token=derive(&plan).unwrap();
        assert_eq!(token["acceptance_stage"],"render");
        receipt_matches(&json!({"approved_plan_lineage":token}),"render").unwrap();
        let mut fake=plan.clone();fake["steps"][0]["request"]["payload"]["width"]=json!(1024);
        let forged=derive(&fake).unwrap();
        assert_eq!(forged["acceptance_stage"],"other");
        assert!(receipt_matches(&json!({"approved_plan_lineage":forged}),"render").is_err());
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
