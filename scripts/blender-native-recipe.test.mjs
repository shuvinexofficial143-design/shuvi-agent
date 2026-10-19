import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";

const base=new URL("../",import.meta.url);
const root=fileURLToPath(base);
const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const rust=read("src-tauri/src/blender_acceptance_recipe.rs");
const lib=read("src-tauri/src/lib.rs");
const lineage=read("src-tauri/src/blender_plan_lineage.rs");
const pythonPath=fileURLToPath(new URL("../integrations/blender-worker/shuvi_blender_acceptance.py",import.meta.url));

test("read-only acceptance recipe is surfaced through native typed tool action without granting execution",()=>{
  assert.match(lib,/mod blender_acceptance_recipe;/);
  assert.match(lib,/BlenderBuildAcceptanceRecipe \{ stage:String, expected_scene_revision:String \}/);
  assert.match(lib,/"blender_build_acceptance_recipe" => \{/);
  assert.match(lib,/ToolAction::BlenderBuildAcceptanceRecipe \{stage,expected_scene_revision\} => \{/);
  assert.match(lib,/blender_acceptance_recipe::build\(&stage,&expected_scene_revision\)\?/);
  assert.match(lib,/RiskLevel::Low\)/);
  assert.match(rust,/pub\(crate\) fn build\(stage:&str,revision:&str\)/);
  assert.match(rust,/blender_plan_lineage::derive\(&plan\)\?/);
  assert.match(rust,/"requires_separate_native_owner_approval":true/);
  assert.match(rust,/"action_approved":false/);
  assert.match(rust,/"blender_launch_performed":false/);
  assert.match(rust,/"plan_executed":false/);
  assert.match(rust,/"real_blender_runtime_verified":false/);
});

test("native recipe is fixed, typed, bounded and never invokes a process or reads user files",()=>{
  assert.doesNotMatch(rust,/Command::new|std::process|std::fs|subprocess|bpy|eval\(/);
  assert.match(rust,/Uuid::new_v4\(\)/);
  assert.ok(rust.includes('Some(json!({"timeout_ms":90_000,"steps":steps}))'));
  assert.ok(rust.includes("let plan=expected_plan(stage,revision)"));
  assert.ok(rust.includes('"requires_new_session_loading_verified_stage2":stage=="render" || stage=="look" || stage=="motion"'));
  assert.ok(rust.includes('"requires_new_session_loading_verified_motion":stage=="motion_frame1" || stage=="motion_frame24"'));
  assert.match(rust,/if serde_json::to_vec\(&plan\).*\.len\(\)>65536/);
  for(const operation of [
    "mesh.create","mesh.inspect","mesh.translate_vertices","objects.list","device.create","material.create_assign",
    "scene.inspect","file.checkpoint","render.configure","render.execute",
    "animation.insert_keyframe","animation.set_frame",
  ])assert.ok(rust.includes('"'+operation+'"'),operation);
  assert.match(lineage,/fn valid_stage\(/);
  assert.match(rust,/preview.get\("acceptance_stage"\).*!=Some\(stage\)/);
});

test("native Rust tests explicitly cover stage shape, dynamic UUIDs, stale revision and bindings",()=>{
  for(const name of [
    "three_native_recipes_match_approved_stage_lineage_without_execution",
    "fresh_action_and_request_ids_never_repeat_within_or_across_plans",
    "result_bindings_reference_prior_steps_with_valid_destinations",
    "invalid_or_stale_shaped_revision_and_unrecognized_stages_denied",
    "acceptance_modeling_plan_contains_expected_mesh_edit_and_stage_files",
  ])assert.ok(rust.includes("fn "+name+"("),name);
});

const candidates=[["python3"],["python"],["py","-3"]];
const python=candidates.find(parts=>{
  const [exe,...args]=parts;
  return spawnSync(exe,[...args,"-c","import ast"],{timeout:5000}).status===0;
});
test("independent Python plan-only recipe provides the same expected upstream operation sequence",{
  skip:python?false:"Python interpreter not installed on runner",
},()=>{
  const expected={
    model1:["mesh.create","mesh.translate_vertices","scene.inspect","device.create","scene.inspect","file.checkpoint"],
    model2:["device.create","objects.list","mesh.inspect","mesh.translate_vertices","scene.inspect","file.checkpoint"],
    render:["render.configure","scene.inspect","render.execute"],
    look:["scene.inspect","objects.list","material.create_assign","scene.inspect","file.checkpoint"],
    look_render:["render.configure","scene.inspect","render.execute"],
    motion:["objects.list","animation.insert_keyframe","animation.insert_keyframe",
      "scene.inspect","animation.set_frame","file.checkpoint"],
    motion_frame1:["animation.set_frame","render.configure","scene.inspect","render.execute"],
    motion_frame24:["animation.set_frame","render.configure","scene.inspect","render.execute"],
  };
  const [exe,...args]=python;
  for(const [stage,steps] of Object.entries(expected)){
    const call=spawnSync(exe,[...args,"-B",pythonPath,"--stage",stage,
      "--scene-revision","a".repeat(64)],{
      cwd:root,encoding:"utf8",timeout:10000
    });
    assert.equal(call.status,0,call.stderr);
    const value=JSON.parse(call.stdout);
    assert.equal(value.mode,"PLAN_ONLY_NO_BLENDER_LAUNCH");
    assert.deepEqual(value.plan.steps.map(x=>x.request.operation),steps);
    assert.equal(value.plan.steps.length,["render","look_render"].includes(stage)?3:
      ["motion_frame1","motion_frame24"].includes(stage)?4:stage==="look"?5:6);
    assert.equal(value.requires_separate_native_owner_approval,true);
    assert.equal(value.render_action_approval_required,
      ["render","look_render","motion_frame1","motion_frame24"].includes(stage));
    if(stage==="look" || stage==="motion"){
      assert.equal(value.supplementary_not_three_stage_acceptance,true);
      assert.equal(value.requires_new_session_loading_verified_stage2,true);
    }
    if(stage==="look_render"){
      assert.equal(value.supplementary_not_three_stage_acceptance,true);
      assert.equal(value.requires_new_session_loading_verified_material,true);
      assert.equal(value.requires_new_session_loading_verified_stage2,false);
      assert.equal(value.output_file,"shuvi41-proof-material-render.png");
    }
    if(["motion_frame1","motion_frame24"].includes(stage)){
      assert.equal(value.requires_new_session_loading_verified_motion,true);
      assert.equal(value.supplementary_not_three_stage_acceptance,true);
      assert.equal(value.requires_new_session_loading_verified_stage2,false);
      assert.equal(value.output_file,stage==="motion_frame1"
        ?"shuvi41-proof-motion-frame001.png":"shuvi41-proof-motion-frame024.png");
      assert.equal(value.plan.steps[0].request.payload.frame,stage==="motion_frame1"?1:24);
    }
    if(stage==="motion"){
      assert.equal(value.output_file,"shuvi41-proof-motion.blend");
      assert.equal(value.plan.steps[2].request.payload.frame,24);
      assert.equal(value.plan.steps[2].request.payload.transform.location[2],1.5);
    }
  }
});
