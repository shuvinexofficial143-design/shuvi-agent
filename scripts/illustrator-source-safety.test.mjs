import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const lib=fs.readFileSync("src-tauri/src/lib.rs","utf8");
const illustrator=fs.readFileSync("src-tauri/src/illustrator.rs","utf8");
const checkpoint=fs.readFileSync("src-tauri/src/illustrator_checkpoint.rs","utf8");
const bridge=fs.readFileSync("src-tauri/src/illustrator_bridge.rs","utf8");
const queue=fs.readFileSync("src-tauri/src/illustrator_bridge_queue.rs","utf8");
const panel=fs.readFileSync("integrations/illustrator-cep/main.js","utf8");
const host=fs.readFileSync("integrations/illustrator-cep/jsx/ShuviIllustrator.jsx","utf8");
const manifest=fs.readFileSync("integrations/illustrator-cep/CSXS/manifest.xml","utf8");
const status=fs.readFileSync("docs/ILLUSTRATOR_STATUS.md","utf8");

test("Illustrator 100 percent source tools are registered",()=>{
  for(const name of [
    "illustrator_capability_report","illustrator_readiness_report","illustrator_detect","illustrator_launch",
    "illustrator_bridge_start","illustrator_bridge_status","illustrator_bridge_stop","illustrator_context",
    "illustrator_artboards","illustrator_layers","illustrator_page_items","illustrator_selection",
    "illustrator_identity_check","illustrator_set_layer_property","illustrator_verify_checkpoint",
    "illustrator_plan_recovery","illustrator_plan_export","illustrator_acceptance_summary"
  ]) assert.match(lib,new RegExp(name));
  for(const name of ["IllustratorPlanRecovery","IllustratorPlanExport","IllustratorAcceptanceSummary"])
    assert.match(lib,new RegExp(name));
});

test("Illustrator final bridge stays bounded and non-arbitrary",()=>{
  assert.match(manifest,/Host Name="ILST"/);
  assert.match(panel,/__adobe_cep__\.evalScript/);
  assert.match(bridge,/MUTATING_ACTIONS: &\[&str\] = &\[\s*"set_layer_property",\s*\]/s);
  assert.doesNotMatch(host,/eval\s*\(\s*args\.script/);
  assert.doesNotMatch(host,/exportFile\s*\(/);
  assert.doesNotMatch(host,/save\s*\(/);
  assert.doesNotMatch(host,/remove\s*\(/);
});

test("Illustrator guarded writes remain checkpointed and independently read back",()=>{
  assert.match(illustrator,/pub struct LayerWriteRequest/);
  assert.match(lib,/illustrator_checkpoint::create/);
  assert.match(lib,/validate_layer_write_post_readback/);
  assert.match(checkpoint,/last_saved_disk_ai_only/);
  assert.match(checkpoint,/unsaved_in_memory_edits_protected/);
  assert.match(host,/retrySafe:false/);
  assert.match(lib,/automatic_retry_allowed":false/);
});

test("Illustrator recovery is verified manual handoff only",()=>{
  assert.match(checkpoint,/pub fn plan_recovery/);
  assert.match(checkpoint,/checkpoint_verified/);
  assert.match(checkpoint,/automatic_restore":false/);
  assert.match(checkpoint,/restore_executed":false/);
  assert.match(lib,/IllustratorPlanRecovery/);
});

test("Illustrator export scope is preflight planning only",()=>{
  assert.match(illustrator,/pub struct ExportPlanRequest/);
  assert.match(illustrator,/current_document_export/);
  assert.match(illustrator,/overwrite_existing/);
  assert.match(illustrator,/export_execution_supported":false/);
  assert.match(illustrator,/requires_real_host_acceptance_before_execution/);
  assert.match(lib,/IllustratorPlanExport/);
  assert.doesNotMatch(host,/exportFile\s*\(/);
});

test("Illustrator canonical summary declares bounded source complete without runtime promotion",()=>{
  assert.match(illustrator,/pub fn completion_summary/);
  assert.match(illustrator,/"source_milestone_percent":100/);
  assert.match(illustrator,/"source_scope_complete":true/);
  assert.match(illustrator,/"source_runtime_verified":false/);
  assert.match(illustrator,/"production_ready":false/);
  assert.match(lib,/IllustratorAcceptanceSummary/);
  assert.match(status,/Current declared source milestone: \*\*100%\*\*/);
  assert.match(status,/Source milestone: \*\*100% complete\*\*/);
});

test("Illustrator final source scope explicitly refuses broader destructive capabilities",()=>{
  for(const marker of [
    "arbitrary_extendscript_execution","layer_create_delete_reorder","page_item_mutation",
    "path_text_appearance_mutation","automatic_checkpoint_restore","export_execution"
  ]) assert.match(illustrator,new RegExp(marker));
  assert.match(status,/arbitrary ExtendScript execution/);
  assert.match(status,/export execution/);
  assert.match(status,/Runtime acceptance: \*\*pending\*\*/);
});

test("Illustrator localhost transport remains authenticated and bounded",()=>{
  assert.match(bridge,/127\.0\.0\.1/);
  assert.match(bridge,/X-Shuvi-Token/);
  assert.match(bridge,/MAX_BODY_BYTES: usize = 256 \* 1024/);
  assert.match(queue,/pending\.len\(\) >= 32/);
  assert.match(panel,/deliveredCount>=1024/);
});
