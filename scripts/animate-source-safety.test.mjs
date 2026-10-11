import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const lib=fs.readFileSync("src-tauri/src/lib.rs","utf8");
const animate=fs.readFileSync("src-tauri/src/animate.rs","utf8");
const checkpoint=fs.readFileSync("src-tauri/src/animate_checkpoint.rs","utf8");
const bridge=fs.readFileSync("src-tauri/src/animate_bridge.rs","utf8");
const queue=fs.readFileSync("src-tauri/src/animate_bridge_queue.rs","utf8");
const panel=fs.readFileSync("integrations/animate-cep/main.js","utf8");
const host=fs.readFileSync("integrations/animate-cep/jsx/ShuviAnimate.jsx","utf8");
const manifest=fs.readFileSync("integrations/animate-cep/CSXS/manifest.xml","utf8");
const status=fs.readFileSync("docs/ANIMATE_STATUS.md","utf8");

test("Animate 100 percent source tools are registered end to end",()=>{
  for(const name of [
    "animate_capability_report","animate_readiness_report","animate_detect","animate_launch",
    "animate_bridge_start","animate_bridge_status","animate_bridge_stop","animate_context","animate_timeline",
    "animate_library","animate_selection","animate_identity_check","animate_set_layer_property",
    "animate_verify_checkpoint","animate_plan_recovery","animate_plan_publish","animate_acceptance_summary"
  ]) assert.match(lib,new RegExp(name));
  for(const name of ["AnimatePlanRecovery","AnimatePlanPublish","AnimateAcceptanceSummary"])
    assert.match(lib,new RegExp(name));
});

test("Animate final bridge remains explicit and bounded",()=>{
  assert.match(manifest,/Host Name="FLPR"/);
  assert.match(panel,/__adobe_cep__\.evalScript/);
  assert.match(bridge,/READ_ONLY_ACTIONS: &\[&str\]/);
  assert.match(bridge,/MUTATING_ACTIONS: &\[&str\] = &\[\s*"set_layer_property",\s*\]/s);
  assert.doesNotMatch(host,/eval\s*\(\s*args\.script/);
  assert.doesNotMatch(host,/deleteLayer\s*\(/);
  assert.doesNotMatch(host,/publish\s*\(/);
  assert.doesNotMatch(host,/save\s*\(/);
});

test("Animate guarded writes remain checkpointed and independently read back",()=>{
  assert.match(animate,/pub struct LayerWriteRequest/);
  assert.match(lib,/animate_checkpoint::create/);
  assert.match(lib,/validate_layer_write_post_readback/);
  assert.match(checkpoint,/last_saved_disk_fla_only/);
  assert.match(checkpoint,/unsaved_in_memory_edits_protected/);
  assert.match(host,/retrySafe:false/);
  assert.match(lib,/automatic_retry_allowed":false/);
});

test("Animate recovery is a verified manual handoff, never automatic restore",()=>{
  assert.match(checkpoint,/pub fn plan_recovery/);
  assert.match(checkpoint,/checkpoint_verified/);
  assert.match(checkpoint,/automatic_restore":false/);
  assert.match(checkpoint,/restore_executed":false/);
  assert.match(lib,/AnimatePlanRecovery/);
});

test("Animate publish export scope is preflight planning only",()=>{
  assert.match(animate,/pub struct PublishPlanRequest/);
  assert.match(animate,/current_document_publish/);
  assert.match(animate,/overwrite_existing/);
  assert.match(animate,/publish_execution_supported":false/);
  assert.match(animate,/export_execution_supported":false/);
  assert.match(animate,/requires_real_host_acceptance_before_execution/);
  assert.match(lib,/AnimatePlanPublish/);
  assert.doesNotMatch(host,/publish\s*\(/);
});

test("Animate canonical summary declares bounded source complete without runtime promotion",()=>{
  assert.match(animate,/pub fn completion_summary/);
  assert.match(animate,/"source_milestone_percent":100/);
  assert.match(animate,/"source_scope_complete":true/);
  assert.match(animate,/"source_runtime_verified":false/);
  assert.match(animate,/"production_ready":false/);
  assert.match(lib,/AnimateAcceptanceSummary/);
  assert.match(status,/Current declared source milestone: \*\*100%\*\*/);
  assert.match(status,/Source milestone: \*\*100% complete\*\*/);
});

test("Animate final source scope explicitly refuses destructive and arbitrary capabilities",()=>{
  for(const marker of [
    "arbitrary_jsfl_execution","layer_create_delete_reorder","frame_content_mutation",
    "drawing_or_stage_content_mutation","library_or_symbol_mutation",
    "automatic_checkpoint_restore","publish_or_export_execution"
  ]) assert.match(animate,new RegExp(marker));
  assert.match(status,/arbitrary JSFL execution/);
  assert.match(status,/publish\/export execution/);
  assert.match(status,/Runtime acceptance: \*\*pending\*\*/);
});

test("Animate localhost transport remains authenticated and bounded",()=>{
  assert.match(bridge,/127\.0\.0\.1/);
  assert.match(bridge,/X-Shuvi-Token/);
  assert.match(bridge,/MAX_BODY_BYTES: usize = 256 \* 1024/);
  assert.match(queue,/pending\.len\(\) >= 32/);
  assert.match(panel,/deliveredCount>=1024/);
});
