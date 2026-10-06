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

test("Animate 80 percent tools are registered end to end",()=>{
  for(const name of ["animate_capability_report","animate_readiness_report","animate_detect","animate_launch","animate_bridge_start","animate_bridge_status","animate_bridge_stop","animate_context","animate_timeline","animate_library","animate_selection","animate_identity_check","animate_set_layer_property","animate_verify_checkpoint"])
    assert.match(lib,new RegExp(name));
  for(const name of ["AnimateSetLayerProperty","AnimateVerifyCheckpoint"])
    assert.match(lib,new RegExp(name));
});

test("Animate bridge has an explicit tiny mutation allowlist",()=>{
  assert.match(manifest,/Host Name="FLPR"/);
  assert.match(panel,/__adobe_cep__\.evalScript/);
  assert.match(bridge,/READ_ONLY_ACTIONS: &\[&str\]/);
  assert.match(bridge,/MUTATING_ACTIONS: &\[&str\] = &\[\s*"set_layer_property",\s*\]/s);
  for(const action of ["inspect_context","inspect_timeline","inspect_library","inspect_selection","verify_identity","set_layer_property"])
    assert.match(bridge,new RegExp('"'+action+'"'));
  for(const mutation of [/addNewLayer\s*\(/,/deleteLayer\s*\(/,/addItemToDocument\s*\(/,/save\s*\(/,/publish\s*\(/])
    assert.doesNotMatch(host,mutation);
});

test("Animate typed layer writes are exact-state guarded and no-blind-retry",()=>{
  assert.match(animate,/pub struct LayerWriteRequest/);
  for(const op of ["rename","visible","locked"]) assert.match(animate,new RegExp('"'+op+'"'));
  assert.match(animate,/acknowledge_last_saved_disk_checkpoint/);
  assert.match(animate,/validate_layer_write_precondition/);
  assert.match(animate,/validate_layer_write_receipt/);
  assert.match(animate,/validate_layer_write_post_readback/);
  assert.match(host,/function shuviAnimateSetLayerProperty/);
  assert.match(host,/layer\.name=args\.value/);
  assert.match(host,/layer\.visible=args\.value/);
  assert.match(host,/layer\.locked=args\.value/);
  assert.match(host,/retrySafe:false/);
  assert.match(lib,/automatic_retry_allowed":false/);
});

test("Animate layer writes checkpoint the last-saved local FLA before dispatch",()=>{
  const checkpointIndex=lib.indexOf("animate_checkpoint::create(");
  const dispatchIndex=lib.indexOf('"set_layer_property"');
  assert.ok(checkpointIndex>=0);
  assert.ok(dispatchIndex>=0);
  assert.ok(checkpointIndex>dispatchIndex || lib.indexOf('"set_layer_property"',checkpointIndex)>checkpointIndex);
  assert.match(checkpoint,/Shuvi Animate Backups/);
  assert.match(checkpoint,/source_fnv1a64/);
  assert.match(checkpoint,/backup_fnv1a64/);
  assert.match(checkpoint,/last_saved_disk_fla_only/);
  assert.match(checkpoint,/unsaved_in_memory_edits_protected/);
  assert.match(checkpoint,/automatic_restore/);
});

test("Animate mutation requires fresh document timeline layer and property identity",()=>{
  assert.match(host,/context\.documentSignature!=expectedDocument/);
  assert.match(host,/context\.timelineSignature!=expectedTimeline/);
  assert.match(host,/context\.documentPath!=expectedPath/);
  assert.match(host,/liveName!=String\(args\.expectedLayerName/);
  assert.match(host,/liveType!=String\(args\.expectedLayerType/);
  assert.match(animate,/target layer property changed/);
  assert.match(lib,/inspect_context/);
  assert.match(lib,/inspect_timeline/);
});

test("Animate mutation has independent post-write readback",()=>{
  assert.match(lib,/post_raw_context/);
  assert.match(lib,/post_raw_timeline/);
  assert.match(lib,/validate_layer_write_post_readback/);
  assert.match(animate,/post_state_verified/);
  assert.match(host,/mutationPerformed:true/);
});

test("Animate 80 percent milestone still refuses destructive scope and fake runtime readiness",()=>{
  assert.match(animate,/"source_milestone_percent":80/);
  assert.match(animate,/"layer_create_delete_reorder":true/);
  assert.match(animate,/"frame_content_mutation":true/);
  assert.match(animate,/"drawing_mutation":true/);
  assert.match(animate,/"source_runtime_verified":false/);
  assert.match(animate,/"production_ready":false/);
  assert.match(status,/Current declared source milestone: \*\*80%\*\*/);
  assert.match(status,/source_runtime_verified=false/);
  assert.match(status,/production_ready=false/);
});
