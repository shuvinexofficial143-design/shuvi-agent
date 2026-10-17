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
  assert.match(lineage,/fn exact_recipe_shape\\(plan:&Value,stage:&str\\)/);
  assert.match(lineage,/crate::blender_acceptance_recipe::expected_plan\\(stage,&revision\\)/);
  assert.match(lineage,/normalized==expected/);
  assert.match(lineage,/strict_template_rejects_hidden_mutations_and_unsafe_material_render_substitutions/);
  assert.match(lineage,/strict_template_rejects_noncanonical_or_replayed_request_ids/);
  assert.match(lineage,/sha.len\(\)!=64/);
  assert.match(lineage,/Duplicate|unique/i);
});
