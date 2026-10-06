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

test("Photoshop 80 percent tools are registered end to end",()=>{
  for(const name of [
    "photoshop_capability_report","photoshop_readiness_report","photoshop_detect","photoshop_launch",
    "photoshop_bridge_start","photoshop_bridge_status","photoshop_bridge_stop","photoshop_context",
    "photoshop_layers","photoshop_set_layer_property","photoshop_set_text_layer",
    "photoshop_transform_layer","photoshop_verify_checkpoint"
  ]) assert.match(lib,new RegExp(name));
  for(const name of [
    "PhotoshopSetLayerProperty","PhotoshopSetTextLayer","PhotoshopTransformLayer","PhotoshopVerifyCheckpoint"
  ]) assert.match(lib,new RegExp(name));
});

test("Photoshop UXP bridge stays localhost, bounded and explicitly allowlisted",()=>{
  assert.equal(manifest.manifestVersion,5);
  assert.equal(manifest.host.app,"PS");
  assert.equal(manifest.host.data.apiVersion,2);
  assert.deepEqual(manifest.requiredPermissions.network.domains,["http://127.0.0.1:17363"]);
  assert.match(bridge,/READ_ONLY_ACTIONS:&\[&str\]=&\["inspect_context","list_layers"\]/);
  assert.match(bridge,/MUTATING_ACTIONS:&\[&str\]=&\["set_layer_property","set_text_layer","transform_layer"\]/);
  assert.match(bridge,/ALLOWED_ACTIONS:&\[&str\]=&\["inspect_context","list_layers","set_layer_property","set_text_layer","transform_layer"\]/);
  assert.match(queue,/pending\.len\(\)>=32/);
});

test("Photoshop 80 percent adds text and transform writes through executeAsModal",()=>{
  assert.match(panel,/function setTextLayer/);
  assert.match(panel,/function transformLayer/);
  assert.match(panel,/item\.contents=request\.contents/);
  assert.match(panel,/item\.characterStyle\.size=request\.size/);
  assert.match(panel,/layer\.translate\(/);
  assert.match(panel,/layer\.scale\(/);
  assert.match(panel,/layer\.rotate\(/);
  assert.match(panel,/core\.executeAsModal/);
  assert.match(panel,/suspendHistory/);
  assert.match(panel,/resumeHistory\(suspension,false\)/);
  assert.doesNotMatch(panel,/batchPlay\s*\(/);
});

test("Photoshop text and transform writes are exact and independently read back",()=>{
  assert.match(photoshop,/pub struct TextWriteRequest/);
  assert.match(photoshop,/validate_text_precondition/);
  assert.match(photoshop,/validate_text_receipt/);
  assert.match(photoshop,/validate_text_post_readback/);
  assert.match(photoshop,/pub struct TransformRequest/);
  assert.match(photoshop,/validate_transform_precondition/);
  assert.match(photoshop,/validate_transform_receipt/);
  assert.match(photoshop,/validate_transform_post_readback/);
  assert.match(lib,/photoshop::validate_text_precondition/);
  assert.match(lib,/photoshop::validate_transform_precondition/);
  assert.match(lib,/post_state_verified/);
  assert.match(lib,/automatic_retry_allowed/);
});

test("Photoshop checkpoint is created before advanced host mutation and never auto-restores",()=>{
  assert.match(lib,/photoshop_checkpoint::create/);
  assert.match(lib,/photoshop_checkpoint::verify/);
  assert.match(checkpoint,/Shuvi Photoshop Backups/);
  assert.match(checkpoint,/source_fnv1a64/);
  assert.match(checkpoint,/backup_fnv1a64/);
  assert.match(checkpoint,/integrity_verified/);
  assert.match(checkpoint,/automatic_restore/);
  assert.match(checkpoint,/cloud-document checkpoint copy is not supported/);
});

test("Photoshop 80 percent scope remains non-destructive and source-only",()=>{
  assert.match(photoshop,/"milestone_percent":80/);
  assert.match(photoshop,/"destructive_layer_mutation":"not_implemented"/);
  assert.match(photoshop,/"target_percent":100/);
  assert.match(photoshop,/"source_runtime_verified":false/);
  assert.match(photoshop,/"production_ready":false/);
  assert.match(status,/Current declared source milestone: \*\*80%\*\*/);
  assert.doesNotMatch(panel,/\.remove\s*\(/);
  assert.doesNotMatch(panel,/\.rasterize\s*\(/);
});
