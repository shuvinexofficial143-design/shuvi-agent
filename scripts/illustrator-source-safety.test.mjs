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

test("Illustrator 80 percent source tools are registered",()=>{
  for(const name of [
    "illustrator_capability_report","illustrator_readiness_report","illustrator_detect","illustrator_launch",
    "illustrator_bridge_start","illustrator_bridge_status","illustrator_bridge_stop","illustrator_context",
    "illustrator_artboards","illustrator_layers","illustrator_page_items","illustrator_selection",
    "illustrator_identity_check","illustrator_set_layer_property","illustrator_verify_checkpoint"
  ]) assert.match(lib,new RegExp(name));
  for(const name of ["IllustratorSetLayerProperty","IllustratorVerifyCheckpoint"])
    assert.match(lib,new RegExp(name));
});

test("Illustrator bridge has one explicit typed mutation action",()=>{
  assert.match(manifest,/Host Name="ILST"/);
  assert.match(panel,/__adobe_cep__\.evalScript/);
  assert.match(bridge,/MUTATING_ACTIONS: &\[&str\] = &\[\s*"set_layer_property",\s*\]/s);
  assert.match(bridge,/"set_layer_property"/);
  for(const mutation of [/remove\s*\(/,/move\s*\(/,/save\s*\(/,/exportFile\s*\(/,/resize\s*\(/])
    assert.doesNotMatch(host,mutation);
});

test("Illustrator typed layer writes are limited to rename visibility and locked",()=>{
  assert.match(illustrator,/pub struct LayerWriteRequest/);
  for(const op of ["rename","visible","locked"]) assert.match(illustrator,new RegExp('"'+op+'"'));
  assert.match(host,/layer\.name=args\.value/);
  assert.match(host,/layer\.visible=args\.value/);
  assert.match(host,/layer\.locked=args\.value/);
  assert.match(host,/retrySafe:false/);
  assert.match(lib,/automatic_retry_allowed":false/);
  assert.doesNotMatch(host,/layer\.remove\s*\(/);
});

test("Illustrator guarded write requires exact fresh saved document and layer state",()=>{
  assert.match(illustrator,/validate_layer_write_precondition/);
  assert.match(illustrator,/context\.get\("saved"\).*Some\(true\)/s);
  assert.match(illustrator,/expected_layer_signature/);
  assert.match(host,/context\.saved!==true/);
  assert.match(host,/beforeRow\.layerSignature!=expectedLayerSignature/);
  assert.match(host,/context\.documentSignature!=expectedDocument/);
  assert.match(host,/context\.documentPath!=expectedPath/);
});

test("Illustrator checkpoint protects only the last-saved local AI file",()=>{
  assert.match(checkpoint,/Shuvi Illustrator Backups/);
  assert.match(checkpoint,/source_fnv1a64/);
  assert.match(checkpoint,/backup_fnv1a64/);
  assert.match(checkpoint,/last_saved_disk_ai_only/);
  assert.match(checkpoint,/unsaved_in_memory_edits_protected/);
  assert.match(checkpoint,/automatic_restore/);
  assert.match(lib,/illustrator_checkpoint::create/);
  assert.match(lib,/IllustratorVerifyCheckpoint/);
});

test("Illustrator mutation has receipt validation and independent post-write readback",()=>{
  assert.match(illustrator,/validate_layer_write_receipt/);
  assert.match(illustrator,/validate_layer_write_post_readback/);
  assert.match(lib,/post_raw_context/);
  assert.match(lib,/post_raw_layers/);
  assert.match(host,/mutationPerformed:true/);
});

test("Illustrator transport remains bounded and authenticated",()=>{
  assert.match(bridge,/127\.0\.0\.1/);
  assert.match(bridge,/X-Shuvi-Token/);
  assert.match(bridge,/MAX_BODY_BYTES: usize = 256 \* 1024/);
  assert.match(queue,/pending\.len\(\) >= 32/);
  assert.match(panel,/deliveredCount>=1024/);
});

test("Illustrator 80 percent milestone refuses broader mutation and runtime claims",()=>{
  assert.match(illustrator,/"source_milestone_percent":80/);
  assert.match(illustrator,/"guarded_layer_property_writes":\["rename","visible","locked"\]/);
  assert.match(illustrator,/"layer_create_delete_reorder":true/);
  assert.match(illustrator,/"page_item_mutation":true/);
  assert.match(illustrator,/"source_runtime_verified":false/);
  assert.match(illustrator,/"production_ready":false/);
  assert.match(status,/Current declared source milestone: \*\*80%\*\*/);
  assert.match(status,/source_runtime_verified=false/);
  assert.match(status,/production_ready=false/);
});
