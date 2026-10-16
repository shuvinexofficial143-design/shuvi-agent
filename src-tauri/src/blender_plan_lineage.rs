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
fn valid_stage(steps:&[&Value],ops:&[String])->&'static str{
    match ops.iter().map(String::as_str).collect::<Vec<_>>().as_slice(){
        ["mesh.create","mesh.inspect","mesh.translate_vertices","scene.inspect","file.checkpoint"]=>{
            let create=payload(steps,0);
            let shape=payload(steps,2);
            let checkpoint=payload(steps,4);
            if create.get("name").and_then(Value::as_str)==Some("Shuvi41ProofMesh")
                && create.pointer("/geometry/vertices").and_then(Value::as_array).is_some_and(|a|a.len()==5)
                && create.pointer("/geometry/faces").and_then(Value::as_array).is_some_and(|a|a.len()==5)
                && shape.get("indices")==Some(&json!([4]))
                && shape.get("delta")==Some(&json!([0.0,0.0,0.25]))
                && shape.pointer("/target/expected_name").and_then(Value::as_str)==Some("Shuvi41ProofMesh")
                && checkpoint.get("name").and_then(Value::as_str)==Some("shuvi41-proof-stage1.blend")
                && name(steps[3]).ok()==Some("post_edit_scene")
                && checkpoint_binding(steps[4],"post_edit_scene")
                && binds_from(steps[1],"create")
                && binds_from(steps[2],"mesh_read"){
                "model1"
            }else{"other"}
        },
        ["objects.list","mesh.inspect","mesh.translate_vertices","scene.inspect","file.checkpoint"]=>{
            let locate=payload(steps,0);
            let shape=payload(steps,2);
            if locate.get("name_prefix").and_then(Value::as_str)==Some("Shuvi41ProofMesh")
                && locate.get("object_type").and_then(Value::as_str)==Some("MESH")
                && locate.get("offset").and_then(Value::as_u64)==Some(0)
                && shape.get("indices")==Some(&json!([4]))
                && shape.get("delta")==Some(&json!([0.0,0.0,0.5]))
                && shape.pointer("/target/expected_name").and_then(Value::as_str)==Some("Shuvi41ProofMesh")
                && payload(steps,4).get("name").and_then(Value::as_str)==Some("shuvi41-proof-stage2.blend")
                && name(steps[3]).ok()==Some("post_edit_scene")
                && checkpoint_binding(steps[4],"post_edit_scene")
                && binds_from(steps[1],"locate")
                && binds_from(steps[2],"mesh_read"){
                "model2"
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
            if stage=="render"{3}else{5}
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
        "model1"=>vec!["mesh.create","mesh.inspect","mesh.translate_vertices","scene.inspect","file.checkpoint"],
        "model2"=>vec!["objects.list","mesh.inspect","mesh.translate_vertices","scene.inspect","file.checkpoint"],
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
    fn model1_and_model2_are_recognized_only_with_safe_named_mesh_and_revision_bindings(){
        let checkpoint=json!([{"source_step":"post_edit_scene",
            "source_path":["data","revision"],"target_path":["expected_scene_revision"]}]);
        let mesh_source=json!([{"source_step":"create",
            "source_path":["data","after","object","object_id"],"target_path":["object_id"]}]);
        let locate_source=json!([{"source_step":"locate",
            "source_path":["data","items",0,"object_id"],"target_path":["object_id"]}]);
        let geometry=json!({"vertices":[[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1]],
            "faces":[[0,1,2,3],[0,1,4],[1,2,4],[2,3,4],[3,0,4]]});
        let m1=json!({"steps":[
            step("create","mesh.create",json!({"name":"Shuvi41ProofMesh","geometry":geometry}),json!([])),
            step("mesh_read","mesh.inspect",json!({"object_id":"BOUND"}),mesh_source),
            step("shape","mesh.translate_vertices",json!({"target":{"expected_name":"Shuvi41ProofMesh"},
                "indices":[4],"delta":[0.0,0.0,0.25]}),json!([{"source_step":"mesh_read"}])),
            step("post_edit_scene","scene.inspect",json!({}),json!([])),
            step("checkpoint","file.checkpoint",json!({"name":"shuvi41-proof-stage1.blend"}),checkpoint)
        ]});
        assert_eq!(derive(&m1).unwrap()["acceptance_stage"],"model1");
        let mut altered=m1.clone();
        altered["steps"][2]["request"]["payload"]["delta"]=json!([5,0,0]);
        assert_eq!(derive(&altered).unwrap()["acceptance_stage"],"other");
        let m2=json!({"steps":[
            step("locate","objects.list",json!({"name_prefix":"Shuvi41ProofMesh",
                "object_type":"MESH","offset":0}),json!([])),
            step("mesh_read","mesh.inspect",json!({"object_id":"BOUND"}),locate_source),
            step("shape_again","mesh.translate_vertices",json!({"target":{"expected_name":"Shuvi41ProofMesh"},
                "indices":[4],"delta":[0.0,0.0,0.5]}),json!([{"source_step":"mesh_read"}])),
            step("post_edit_scene","scene.inspect",json!({}),json!([])),
            step("checkpoint","file.checkpoint",json!({"name":"shuvi41-proof-stage2.blend"}),checkpoint)
        ]});
        assert_eq!(derive(&m2).unwrap()["acceptance_stage"],"model2");
        let mut switched=m2.clone();
        switched["steps"][4]["request"]["payload"]["name"]=json!("different-output.blend");
        assert_eq!(derive(&switched).unwrap()["acceptance_stage"],"other");
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
