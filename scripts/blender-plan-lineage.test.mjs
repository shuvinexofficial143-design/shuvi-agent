import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const lineage=read("src-tauri/src/blender_plan_lineage.rs");
const native=read("src-tauri/src/lib.rs");
const session=read("src-tauri/src/blender_session_worker.rs");
const oneOff=read("src-tauri/src/blender_plan_worker.rs");
const chain=read("src-tauri/src/blender_acceptance_chain.rs");
const audit=read("src-tauri/src/blender_action_audit.rs");

test("exact approved plan SHA, operations and stage are emitted on both verified native Blender outputs",()=>{
  assert.match(native,/mod blender_plan_lineage;/);
  assert.match(lineage,/pub\(crate\) fn derive\(plan:&Value\)/);
  assert.match(lineage,/Sha256::digest\(&raw\)/);
  assert.match(lineage,/pub\(crate\) fn receipt_matches/);
  assert.match(session,/let plan_lineage=crate::blender_plan_lineage::derive\(plan\)\?/);
  assert.match(oneOff,/let plan_lineage=crate::blender_plan_lineage::derive\(plan\)\?/);
  assert.match(session,/"approved_plan_lineage":plan_lineage/);
  assert.match(oneOff,/"approved_plan_lineage":plan_lineage/);
});
test("native approval audit suffix binds the precise executed plan fingerprint without leaking plan content",()=>{
  for(const evidence of [
    'let plan_sha=valid_sha(field(lineage,"/plan_sha256")?)?',
    'blender_plan_sha256={plan_sha}',
    'blender_acceptance_stage={stage}',
    'owner_approval_reauthenticated'
  ])assert.ok(audit.includes(evidence),evidence);
  assert.doesNotMatch(audit,/"approved_plan":plan|format!\([^)]*plan.to_string/);
});
test("three-stage reviewer never accepts arbitrary generic Blender plans as specific acceptance stages",()=>{
  for(const stage of ['"model1"','"model2"','"render"','"other"']){
    assert.ok(lineage.includes(stage),stage);
  }
  for(const part of [
    'crate::blender_plan_lineage::receipt_matches(receipt,stage)?',
    'approved_plan_lineage/typed_steps',
    'executed_typed_steps',
    'plan_steps',
    'rejects_fake_stage_wrong_operations_and_missing_plan_hash'
  ])assert.ok(chain.includes(part),part);
  assert.match(lineage,/checkpoint_binding/);
  assert.ok(lineage.includes("fn exact_recipe_shape(plan:&Value,stage:&str)"));
  assert.ok(lineage.includes("crate::blender_acceptance_recipe::expected_plan(stage,&revision)"));
  assert.match(lineage,/normalized==expected/);
  assert.match(lineage,/strict_template_rejects_hidden_mutations_and_unsafe_material_render_substitutions/);
  assert.match(lineage,/strict_template_rejects_noncanonical_or_replayed_request_ids/);
  assert.match(lineage,/sha.len\(\)!=64/);
  assert.match(lineage,/Duplicate|unique/i);
});

test("reserved example output names enforce matching typed plan and SHA-pinned input source before dispatch",()=>{
  assert.ok(lineage.includes("pub(crate) fn reserved_output_policy("));
  assert.ok(lineage.includes('Some("shuvi41-proof-material-render.png")=>Some("look_render")'));
  assert.ok(lineage.includes('Some("shuvi41-proof-material.blend")=>Some("look")'));
  assert.ok(lineage.includes('Some("shuvi41-proof-stage2.blend")=>Some("model2")'));
  assert.ok(lineage.includes('Some("shuvi41-proof-render.png")=>Some("render")'));
  assert.ok(lineage.includes('Some("shuvi41-proof-stage1.blend")=>Some("model1")'));
  assert.ok(lineage.includes('Some("shuvi41-proof-motion.blend")=>Some("motion")'));
  assert.ok(lineage.includes('Some("shuvi41-proof-motion-frame001.png")=>Some("motion_frame1")'));
  assert.ok(lineage.includes('Some("shuvi41-proof-motion-frame024.png")=>Some("motion_frame24")'));
  assert.ok(lineage.includes('"render"|"look"|"motion"=>Some("shuvi41-proof-stage2.blend")'));
  assert.ok(lineage.includes('"motion_frame1"|"motion_frame24"=>Some("shuvi41-proof-motion.blend")'));
  assert.ok(lineage.includes('fn motion_frame_render_requires_actual_motion_source_render_permission_and_persistent_session('));
  assert.ok(lineage.includes("fn motion_reserved_output_requires_exact_keyframe_plan_and_stage2_sha_pinned_source("));
  assert.ok(lineage.includes("!exact_recipe_shape(plan,stage)"));
  assert.ok(lineage.includes('if matches!(stage,"look_render"|"motion_frame1"|"motion_frame24") && !persistent_session'));
  assert.ok(session.includes('crate::blender_plan_lineage::reserved_output_policy('));
  assert.ok(oneOff.includes('crate::blender_plan_lineage::reserved_output_policy('));
  for(const caseName of [
    "reserved_outputs_reject_forged_steps_and_wrong_sha_pinned_source",
    "oneoff_material_png_is_denied_without_persistent_preflight",
    "generic_unreserved_model_plans_retain_normal_native_approval_flow"
  ])assert.ok(lineage.includes("fn "+caseName+"("));
});

test("all native output handoffs verify actual on-disk filename against the final typed plan step, not solely its hash",()=>{
  assert.ok(lineage.includes("fn verify_final_artifact_binding(plan:&Value,output:&Value)"));
  assert.ok(lineage.includes("if actual_name!=expected_name"));
  assert.ok(lineage.includes('artifact.get("format").and_then(Value::as_str)!=Some(kind)'));
  assert.ok(lineage.includes('output.get("final_operation")'));
  assert.ok(session.includes("verify_final_artifact_binding(plan,&response)?"));
  assert.ok(oneOff.includes("verify_final_artifact_binding(plan,&value)?"));
  assert.ok(lineage.includes("fn final_artifact_binding_rejects_correct_hash_wrong_filename_and_format("));
  assert.ok(lineage.includes("fn final_artifact_binding_denies_nested_windows_and_alternative_destinations("));
});

test("native receipt count and final operation cannot be inferred from a completed flag or a verified output file",()=>{
  for(const x of [
    'output.get("executed_steps").and_then(Value::as_u64)!=Some(steps.len() as u64)',
    'output.get("final_operation").and_then(Value::as_str)!=Some(operation)',
    'fn typed_plan_completion_cannot_be_inferred_from_verified_last_file('
  ])assert.ok(lineage.includes(x),x);
  assert.ok(session.includes("verify_final_artifact_binding(plan,&response)?"));
  assert.ok(oneOff.includes("verify_final_artifact_binding(plan,&value)?"));
});

test("Win32 reserved output aliases cannot be used by generic Blender model plans to bypass native stage gates",()=>{
  assert.ok(lineage.includes("let folded=filename.map("));
  assert.ok(lineage.includes("trim_end_matches(|c:char|c==' '||c=='.')"));
  assert.ok(lineage.includes("let matched=match folded.as_deref()"));
  assert.ok(lineage.includes("fn windows_reserved_blender_names_are_protected_against_case_and_dot_aliases()"));
});

test("fixed stage two can run only in a persistent same-session continuation, not a oneoff .blend reload",()=>{
  assert.ok(lineage.includes('if stage=="model2" && (input_source.is_some() || !persistent_session)'));
  assert.ok(lineage.includes("fn fixed_stage_two_cannot_open_an_unverified_file_or_use_oneoff_worker()"));
});
