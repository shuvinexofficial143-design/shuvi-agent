//! Deterministic-shape, randomized-ID read-only native Blender acceptance plans.
//! Generates declarative PlanRunner requests only: no Blender launch, Python,
//! app/window control, file writes, owner approval, or implicit execution.
use serde_json::{json,Value};
use uuid::Uuid;
use crate::blender_plan_lineage;

const MESH:&str="Shuvi41ProofMesh";
const STAGE1:&str="shuvi41-proof-stage1.blend";
const STAGE2:&str="shuvi41-proof-stage2.blend";
const RENDER:&str="shuvi41-proof-render.png";
const LOOK:&str="shuvi41-proof-material.blend";

fn binding(source:&str,source_path:Value,target_path:Value)->Value{
    json!({"source_step":source,"source_path":source_path,"target_path":target_path})
}
fn step(name:&str,operation:&str,payload:Value,bindings:Vec<Value>)->Value{
    json!({"name":name,"request":{
        "protocol_version":1,"request_id":Uuid::new_v4().to_string(),
        "command_id":Uuid::new_v4().to_string(),
        "operation":operation,"payload":payload,"timeout_ms":15_000,
    },"bindings":bindings})
}
fn transform()->Value{
    json!({"location":[0.0,0.0,0.0],"rotation_euler":[0.0,0.0,0.0],
        "scale":[1.0,1.0,1.0]})
}
fn model1(rev:&str)->Vec<Value>{
    vec![
        step("create","mesh.create",json!({
            "name":MESH,"geometry":{"vertices":[
                [-1.0,-1.0,0.0],[1.0,-1.0,0.0],[1.0,1.0,0.0],
                [-1.0,1.0,0.0],[0.0,0.0,1.2]
            ],"faces":[[3,2,1,0],[0,1,4],[1,2,4],[2,3,4],[3,0,4]]},
            "transform":transform(),"expected_scene_revision":rev,
        }),vec![]),
        step("shape","mesh.translate_vertices",json!({
            "target":{"object_id":"BOUND_FROM_CREATE","expected_name":MESH,
                "expected_revision":"BOUND_FROM_CREATE"},
            "expected_geometry_revision":"BOUND_FROM_MESH_READ",
            "indices":[4],"delta":[0.0,0.0,0.25],
        }),vec![
            binding("create",json!(["data","after","object","object_id"]),json!(["target","object_id"])),
            binding("create",json!(["data","after","object","revision"]),json!(["target","expected_revision"])),
            binding("create",json!(["data","after","geometry","geometry_revision"]),json!(["expected_geometry_revision"])),
        ]),
        step("post_edit_scene","scene.inspect",json!({}),vec![]),
        step("camera","device.create",json!({
            "name":"Shuvi41ProofCamera","kind":"CAMERA",
            "transform":{"location":[4.0,-6.0,4.0],"rotation_euler":[1.15,0.0,0.58],"scale":[1.0,1.0,1.0]},
            "settings":{"lens":50.0,"clip_start":0.1,"clip_end":100.0,"make_active":true},
            "expected_scene_revision":"BOUND_FROM_SCENE",
        }),vec![binding("post_edit_scene",json!(["data","revision"]),json!(["expected_scene_revision"]))]),
        step("post_camera_scene","scene.inspect",json!({}),vec![]),
        step("checkpoint","file.checkpoint",json!({
            "name":STAGE1,"expected_scene_revision":"BOUND_FROM_SCENE",
        }),vec![
            binding("post_camera_scene",json!(["data","revision"]),json!(["expected_scene_revision"]))
        ]),
    ]
}
fn model2(rev:&str)->Vec<Value>{
    vec![
        step("light","device.create",json!({
            "name":"Shuvi41ProofKey","kind":"POINT",
            "transform":{"location":[2.0,-3.0,5.0],"rotation_euler":[0.0,0.0,0.0],"scale":[1.0,1.0,1.0]},
            "settings":{"energy":950.0,"color":[1.0,0.94,0.85]},
            "expected_scene_revision":rev,
        }),vec![]),
        step("locate","objects.list",json!({
            "name_prefix":MESH,"object_type":"MESH","offset":0,"limit":25,
        }),vec![]),
        step("mesh_read","mesh.inspect",json!({"object_id":"BOUND_FROM_LIST"}),vec![
            binding("locate",json!(["data","items",0,"object_id"]),json!(["object_id"]))
        ]),
        step("shape_again","mesh.translate_vertices",json!({
            "target":{"object_id":"BOUND_FROM_LIST","expected_name":MESH,
                "expected_revision":"BOUND_FROM_LIST"},
            "expected_geometry_revision":"BOUND_FROM_MESH_READ",
            "indices":[4],"delta":[0.0,0.0,0.5],
        }),vec![
            binding("locate",json!(["data","items",0,"object_id"]),json!(["target","object_id"])),
            binding("locate",json!(["data","items",0,"revision"]),json!(["target","expected_revision"])),
            binding("mesh_read",json!(["data","geometry_revision"]),json!(["expected_geometry_revision"])),
        ]),
        step("post_edit_scene","scene.inspect",json!({}),vec![]),
        step("checkpoint","file.checkpoint",json!({
            "name":STAGE2,"expected_scene_revision":"BOUND_FROM_SCENE",
        }),vec![binding("post_edit_scene",json!(["data","revision"]),json!(["expected_scene_revision"]))]),
    ]
}
// Optional fixed material look on a separately SHA-verified, owner-approved
// Stage-2 source. This is not part of three-stage acceptance evidence.
fn look()->Vec<Value>{
    vec![
        step("scene","scene.inspect",json!({}),vec![]),
        step("locate","objects.list",json!({
            "name_prefix":MESH,"object_type":"MESH","offset":0,"limit":5,
            "expected_revision":"BOUND_FROM_SCENE",
        }),vec![binding("scene",json!(["data","revision"]),json!(["expected_revision"]))]),
        step("assign","material.create_assign",json!({
            "target":{"object_id":"BOUND_FROM_LIST","expected_name":MESH,
                "expected_revision":"BOUND_FROM_LIST"},
            "name":"Shuvi41ProofCopper","base_color":[0.8,0.41,0.16,1.0],
            "metallic":0.65,"roughness":0.31,
        }),vec![
            binding("locate",json!(["data","items",0,"object_id"]),json!(["target","object_id"])),
            binding("locate",json!(["data","items",0,"revision"]),json!(["target","expected_revision"])),
        ]),
        step("post_look_scene","scene.inspect",json!({}),vec![]),
        step("checkpoint","file.checkpoint",json!({
            "name":LOOK,"expected_scene_revision":"BOUND_FROM_SCENE",
        }),vec![binding("post_look_scene",json!(["data","revision"]),json!(["expected_scene_revision"]))]),
    ]
}
fn render(rev:&str)->Vec<Value>{
    vec![
        step("configure","render.configure",json!({
            "width":64,"height":64,"samples":1,"expected_scene_revision":rev,
        }),vec![]),
        step("configured_scene","scene.inspect",json!({}),vec![]),
        step("render","render.execute",json!({
            "name":RENDER,"expected_scene_revision":"BOUND_FROM_CONFIGURED_SCENE",
        }),vec![
            binding("configured_scene",json!(["data","revision"]),json!(["expected_scene_revision"]))
        ]),
    ]
}

/// A plan-only preview: all UUIDs are fresh on each call, and callers must
/// explicitly request a distinct owner-approved BlenderSessionPlan action.
/// This never opens a session or asserts prior native action authorization.
pub(crate) fn build(stage:&str,revision:&str)->Result<Value,String>{
    if revision.len()!=64 ||
        !revision.bytes().all(|c|c.is_ascii_hexdigit() && !c.is_ascii_uppercase()){
        return Err("Native Blender recipe needs a fresh lowercase scene revision from session inspect.".into());
    }
    let (steps,output,requires_render)=match stage{
        "model1"=>(model1(revision),STAGE1,false),
        "model2"=>(model2(revision),STAGE2,false),
        "render"=>(render(revision),RENDER,true),
        "look"=>(look(),LOOK,false),
        _=>return Err("Native Blender recipe only accepts model1, model2, look or render.".into()),
    };
    let plan=json!({"timeout_ms":90_000,"steps":steps});
    if serde_json::to_vec(&plan).map_err(|_|"Cannot serialize typed Blender recipe.")?.len()>65536{
        return Err("Blender recipe exceeds native 64 KiB plan input bound.".into());
    }
    // Derive the exact digest and stage classification from the SAME native
    // module used for approved execution. Refuse to emit a mislabeled plan.
    let preview=blender_plan_lineage::derive(&plan)?;
    if preview.get("acceptance_stage").and_then(Value::as_str)!=Some(stage){
        return Err("Generated Blender recipe failed native acceptance-stage classification.".into());
    }
    Ok(json!({
        "mode":"PLAN_ONLY_NO_BLENDER_LAUNCH",
        "schema_version":1,
        "stage":stage,
        "expected_scene_revision":revision,
        "output_file":output,
        "plan":plan,
        "plan_preview_lineage":preview,
        "render_action_approval_required":requires_render,
        "must_use_current_session_inspect_revision":true,
        "requires_separate_native_owner_approval":true,
        "requires_new_session_loading_verified_stage2":requires_render || stage=="look",
        "supplementary_not_three_stage_acceptance":stage=="look",
        "action_approved":false,
        "blender_launch_performed":false,
        "plan_executed":false,
        "output_artifact_created":false,
        "real_blender_runtime_verified":false,
    }))
}

#[cfg(test)]
mod tests{
    use super::*;
    use std::collections::HashSet;
    #[test]
    fn three_native_recipes_match_approved_stage_lineage_without_execution(){
        for (stage,count,last,render) in [
            ("model1",6,"file.checkpoint",false),
            ("model2",6,"file.checkpoint",false),
            ("render",3,"render.execute",true),
            ("look",5,"file.checkpoint",false),
        ]{
            let r=build(stage,&"a".repeat(64)).unwrap();
            assert_eq!(r["mode"],"PLAN_ONLY_NO_BLENDER_LAUNCH");
            assert_eq!(r["plan"]["steps"].as_array().unwrap().len(),count);
            assert_eq!(r["plan"]["steps"][count-1]["request"]["operation"],last);
            assert_eq!(r["plan_preview_lineage"]["acceptance_stage"],stage);
            assert_eq!(r["render_action_approval_required"],render);
            assert_eq!(r["action_approved"],false);
            assert_eq!(r["plan_executed"],false);
            assert_eq!(r["real_blender_runtime_verified"],false);
            assert_eq!(r["requires_separate_native_owner_approval"],true);
            assert_eq!(r["requires_new_session_loading_verified_stage2"],render || stage=="look");
            assert_eq!(r["supplementary_not_three_stage_acceptance"],stage=="look");
        }
    }
    #[test]
    fn fresh_action_and_request_ids_never_repeat_within_or_across_plans(){
        let mut ids=HashSet::new();
        for _ in 0..3{
            for stage in ["model1","model2","render","look"]{
                let recipe=build(stage,&"b".repeat(64)).unwrap();
                for step in recipe["plan"]["steps"].as_array().unwrap(){
                    for key in ["request_id","command_id"]{
                        let id=step["request"][key].as_str().unwrap();
                        assert_eq!(Uuid::parse_str(id).unwrap().to_string(),id);
                        assert!(ids.insert(id.to_string()),"duplicate request or command ID");
                    }
                }
            }
        }
    }
    #[test]
    fn result_bindings_reference_prior_steps_with_valid_destinations(){
        for stage in ["model1","model2","render","look"]{
            let recipe=build(stage,&"c".repeat(64)).unwrap();
            let mut seen=HashSet::new();
            for step in recipe["plan"]["steps"].as_array().unwrap(){
                for binding in step["bindings"].as_array().unwrap(){
                    let source=binding["source_step"].as_str().unwrap();
                    assert!(seen.contains(source),"binding must reference an already executed step");
                    assert!(binding["source_path"].as_array().is_some());
                    let mut target=&step["request"]["payload"];
                    for part in binding["target_path"].as_array().unwrap(){
                        if let Some(i)=part.as_u64(){target=&target[i as usize];}
                        else{target=&target[part.as_str().unwrap()];}
                    }
                    assert!(target.as_str().is_some_and(|s|s.starts_with("BOUND_")));
                }
                seen.insert(step["name"].as_str().unwrap());
            }
        }
    }
    #[test]
    fn invalid_or_stale_shaped_revision_and_unrecognized_stages_denied(){
        let bad_revisions=vec![
            String::new(),"a".to_string(),"g".repeat(64),"A".repeat(64),
        ];
        for revision in bad_revisions{
            assert!(build("model1",&revision).is_err());
        }
        assert!(build("arbitrary.python.run",&"f".repeat(64)).is_err());
    }
    #[test]
    fn supplemental_look_has_cas_mesh_identity_and_unique_output(){
        let recipe=build("look",&"a".repeat(64)).unwrap();
        let steps=&recipe["plan"]["steps"];
        assert_eq!(steps.as_array().unwrap().len(),5);
        assert_eq!(recipe["plan_preview_lineage"]["acceptance_stage"],"look");
        assert_eq!(steps[1]["request"]["payload"]["expected_revision"],"BOUND_FROM_SCENE");
        assert_eq!(steps[2]["request"]["payload"]["name"],"Shuvi41ProofCopper");
        assert_eq!(steps[2]["request"]["payload"]["base_color"],json!([0.8,0.41,0.16,1.0]));
        assert_eq!(steps[2]["request"]["payload"]["metallic"],0.65);
        assert_eq!(steps[2]["request"]["payload"]["roughness"],0.31);
        assert_eq!(steps[4]["bindings"][0]["source_step"],"post_look_scene");
        assert_eq!(recipe["output_file"],LOOK);
        assert_eq!(recipe["requires_new_session_loading_verified_stage2"],true);
        assert_eq!(recipe["render_action_approval_required"],false);
        assert_eq!(recipe["action_approved"],false);
        assert!(crate::blender_plan_lineage::receipt_matches(
            &json!({"approved_plan_lineage":recipe["plan_preview_lineage"]}),"look").is_err());
    }
    #[test]
    fn acceptance_modeling_plan_contains_expected_mesh_edit_and_stage_files(){
        let first=build("model1",&"d".repeat(64)).unwrap();
        assert_eq!(first["plan"]["steps"][0]["request"]["payload"]["geometry"]["vertices"].as_array().unwrap().len(),5);
        assert_eq!(first["plan"]["steps"][1]["request"]["payload"]["delta"],json!([0.0,0.0,0.25]));
        let second=build("model2",&"d".repeat(64)).unwrap();
        assert_eq!(second["plan"]["steps"][3]["request"]["payload"]["delta"],json!([0.0,0.0,0.5]));
        assert_eq!(second["output_file"],STAGE2);
        assert_eq!(first["plan"]["steps"][3]["request"]["operation"],"device.create");
        assert_eq!(first["plan"]["steps"][3]["request"]["payload"]["settings"]["make_active"],true);
        assert_eq!(second["plan"]["steps"][0]["request"]["payload"]["kind"],"POINT");
        assert_eq!(second["plan"]["steps"][0]["request"]["payload"]["settings"]["energy"],950.0);
        assert_eq!(first["plan"]["steps"][5]["bindings"][0]["source_step"],"post_camera_scene");
        let png=build("render",&"d".repeat(64)).unwrap();
        assert_eq!(png["plan"]["steps"][0]["request"]["payload"]["width"],64);
        assert_eq!(png["output_file"],RENDER);
    }
}
