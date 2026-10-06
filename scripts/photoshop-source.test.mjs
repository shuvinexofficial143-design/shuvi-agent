import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const lib=fs.readFileSync("src-tauri/src/lib.rs","utf8");
const photoshop=fs.readFileSync("src-tauri/src/photoshop.rs","utf8");
const checkpoint=fs.readFileSync("src-tauri/src/photoshop_checkpoint.rs","utf8");
const bridge=fs.readFileSync("src-tauri/src/photoshop_bridge.rs","utf8");
const queue=fs.readFileSync("src-tauri/src/photoshop_bridge_queue.rs","utf8");
const panel=fs.readFileSync("integrations/photoshop-uxp/index.js","utf8");
const manifest=JSON.parse(fs.readFileSync("integrations/photoshop-uxp/manifest.json","utf8"));
const status=fs.readFileSync("docs/PHOTOSHOP_STATUS.md","utf8");

test("Photoshop 100 percent source tools are registered end to end",()=>{
  for(const name of [
    "photoshop_capability_report","photoshop_readiness_report","photoshop_detect","photoshop_launch",
    "photoshop_bridge_start","photoshop_bridge_status","photoshop_bridge_stop","photoshop_context",
    "photoshop_layers","photoshop_set_layer_property","photoshop_set_text_layer",
    "photoshop_transform_layer","photoshop_verify_checkpoint","photoshop_set_layer_mask",
    "photoshop_save_document","photoshop_acceptance_summary"
  ]) assert.match(lib,new RegExp(name));
  for(const name of [
    "PhotoshopSetLayerProperty","PhotoshopSetTextLayer","PhotoshopTransformLayer",
    "PhotoshopVerifyCheckpoint","PhotoshopSetLayerMask","PhotoshopSaveDocument","PhotoshopAcceptanceSummary"
  ]) assert.match(lib,new RegExp(name));
});

test("Photoshop bridge final allowlist is explicit and bounded",()=>{
  assert.equal(manifest.manifestVersion,5);
  assert.equal(manifest.host.app,"PS");
  assert.equal(manifest.host.data.apiVersion,2);
  assert.deepEqual(manifest.requiredPermissions.network.domains,["http://127.0.0.1:17363"]);
  assert.match(bridge,/READ_ONLY_ACTIONS:&\[&str\]=&\["inspect_context","list_layers"\]/);
  assert.match(bridge,/MUTATING_ACTIONS:&\[&str\]=&\["set_layer_property","set_text_layer","transform_layer","set_layer_mask","save_document"\]/);
  assert.match(bridge,/ALLOWED_ACTIONS:&\[&str\]=&\["inspect_context","list_layers","set_layer_property","set_text_layer","transform_layer","set_layer_mask","save_document"\]/);
  assert.match(queue,/pending\.len\(\)>=32/);
});

test("Photoshop mask controls use documented bounded properties and modal history guard",()=>{
  assert.match(panel,/layer\.layerMaskDensity=request\.value/);
  assert.match(panel,/layer\.layerMaskFeather=request\.value/);
  assert.match(panel,/core\.executeAsModal/);
  assert.match(panel,/suspendHistory/);
  assert.match(panel,/resumeHistory\(suspension,false\)/);
  assert.match(photoshop,/pub struct MaskWriteRequest/);
  assert.match(photoshop,/layer_mask_density/);
  assert.match(photoshop,/layer_mask_feather/);
  assert.match(lib,/photoshop::validate_mask_precondition/);
  assert.match(lib,/photoshop::validate_mask_post_readback/);
});

test("Photoshop guarded save checkpoints disk state before Document.save",()=>{
  const createIndex=lib.indexOf("photoshop_checkpoint::create_before_save");
  const saveIndex=lib.indexOf('"save_document"');
  assert.ok(createIndex>=0);
  assert.ok(saveIndex>=0);
  assert.match(panel,/await doc\.save\(\)/);
  assert.match(panel,/expectedSaved/);
  assert.match(photoshop,/pub struct SaveRequest/);
  assert.match(photoshop,/expected_saved/);
  assert.match(checkpoint,/pub fn create_before_save/);
  assert.match(lib,/post_context/);
  assert.match(lib,/post_state_verified/);
});

test("Photoshop advanced writes remain checkpointed and independently read back",()=>{
  assert.match(lib,/photoshop_checkpoint::create/);
  assert.match(lib,/photoshop::validate_text_post_readback/);
  assert.match(lib,/photoshop::validate_transform_post_readback/);
  assert.match(lib,/photoshop::validate_mask_post_readback/);
  assert.match(checkpoint,/Shuvi Photoshop Backups/);
  assert.match(checkpoint,/backup_fnv1a64/);
  assert.match(checkpoint,/automatic_restore/);
  assert.match(lib,/automatic_retry_allowed/);
});

test("Photoshop canonical summary marks source scope complete without runtime claims",()=>{
  assert.match(photoshop,/pub fn completion_summary/);
  assert.match(photoshop,/"source_milestone_percent":100/);
  assert.match(photoshop,/"source_scope_complete":true/);
  assert.match(photoshop,/"source_runtime_verified":false/);
  assert.match(photoshop,/"production_ready":false/);
  assert.match(lib,/PhotoshopAcceptanceSummary/);
  assert.match(lib,/photoshop::completion_summary\(\)/);
  assert.match(status,/Current declared source milestone: \*\*100%\*\*/);
});

test("Photoshop 100 percent source scope still refuses fake destructive pixel capabilities",()=>{
  assert.match(photoshop,/"destructive_layer_mutation":"not_implemented"/);
  assert.match(photoshop,/"generative_fill":"not_implemented"/);
  assert.doesNotMatch(panel,/batchPlay\s*\(/);
  assert.doesNotMatch(panel,/\.remove\s*\(/);
  assert.doesNotMatch(panel,/\.rasterize\s*\(/);
  assert.match(status,/arbitrary pixel mutation/);
  assert.match(status,/arbitrary-path Save As\/export/);
});
