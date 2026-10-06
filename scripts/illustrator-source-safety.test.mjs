import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const lib=fs.readFileSync("src-tauri/src/lib.rs","utf8");
const illustrator=fs.readFileSync("src-tauri/src/illustrator.rs","utf8");
const bridge=fs.readFileSync("src-tauri/src/illustrator_bridge.rs","utf8");
const queue=fs.readFileSync("src-tauri/src/illustrator_bridge_queue.rs","utf8");
const panel=fs.readFileSync("integrations/illustrator-cep/main.js","utf8");
const host=fs.readFileSync("integrations/illustrator-cep/jsx/ShuviIllustrator.jsx","utf8");
const manifest=fs.readFileSync("integrations/illustrator-cep/CSXS/manifest.xml","utf8");
const status=fs.readFileSync("docs/ILLUSTRATOR_STATUS.md","utf8");

test("Illustrator 60 percent tools are registered end to end",()=>{
  for(const name of [
    "illustrator_capability_report","illustrator_readiness_report","illustrator_detect","illustrator_launch",
    "illustrator_bridge_start","illustrator_bridge_status","illustrator_bridge_stop",
    "illustrator_context","illustrator_artboards","illustrator_layers","illustrator_page_items",
    "illustrator_selection","illustrator_identity_check"
  ]) assert.match(lib,new RegExp(name));
  for(const name of ["IllustratorLayers","IllustratorPageItems","IllustratorSelection","IllustratorIdentityCheck"])
    assert.match(lib,new RegExp(name));
});

test("Illustrator bridge remains authenticated and mutation-free",()=>{
  assert.match(manifest,/Host Name="ILST"/);
  assert.match(panel,/__adobe_cep__\.evalScript/);
  for(const action of ["inspect_context","inspect_artboards","inspect_layers","inspect_page_items","inspect_selection","verify_identity"]){
    assert.match(bridge,new RegExp('"'+action+'"'));
    assert.match(panel,new RegExp('"'+action+'"'));
    assert.match(host,new RegExp('"'+action+'"'));
  }
  assert.match(bridge,/MUTATING_ACTIONS: &\[&str\] = &\[\]/);
  for(const mutation of [/remove\s*\(/,/move\s*\(/,/save\s*\(/,/exportFile\s*\(/,/resize\s*\(/])
    assert.doesNotMatch(host,mutation);
});

test("Illustrator layer inspection is bounded and signature-bearing",()=>{
  assert.match(host,/doc\.layers/);
  assert.match(host,/maxLayers<1\|\|maxLayers>256/);
  assert.match(host,/Math\.min\(sourceCount,maxLayers\)/);
  assert.match(host,/layerSignature/);
  assert.match(host,/nestedLayerCount/);
  assert.match(host,/pageItemCount/);
  assert.match(illustrator,/pub fn validate_layer_receipt/);
  assert.match(illustrator,/layers\.len\(\)>256/);
  assert.match(lib,/json!\(\{"maxLayers":128\}\)/);
});

test("Illustrator page-item inspection is bounded and observational",()=>{
  assert.match(host,/doc\.pageItems/);
  assert.match(host,/maxItems<1\|\|maxItems>256/);
  assert.match(host,/geometricBounds/);
  assert.match(host,/itemSignature/);
  assert.match(illustrator,/pub fn validate_page_item_receipt/);
  assert.match(illustrator,/items\.len\(\)>256/);
  assert.match(lib,/json!\(\{"maxItems":256\}\)/);
});

test("Illustrator selection inspection is bounded and never claims stable IDs",()=>{
  assert.match(host,/doc\.selection/);
  assert.match(host,/maxItems<1\|\|maxItems>64/);
  assert.match(host,/selectionSignature/);
  assert.match(host,/selectionSignatureScope:"observational_snapshot_not_stable_object_id"/);
  assert.match(illustrator,/pub fn validate_selection_receipt/);
  assert.match(illustrator,/items\.len\(\)>64/);
});

test("Illustrator fresh identity recheck cannot authorize mutation",()=>{
  assert.match(host,/function shuviIllustratorVerifyIdentity/);
  assert.match(host,/context\.documentSignature!=expected/);
  assert.match(host,/mutationAuthorized:false/);
  assert.match(illustrator,/pub fn validate_identity_receipt/);
  assert.match(illustrator,/mutationAuthorized/);
  assert.match(lib,/expected_document_signature/);
});

test("Illustrator transport stays token authenticated and bounded",()=>{
  assert.match(bridge,/127\.0\.0\.1/);
  assert.match(bridge,/X-Shuvi-Token/);
  assert.match(bridge,/MAX_BODY_BYTES: usize = 256 \* 1024/);
  assert.match(queue,/pending\.len\(\) >= 32/);
  assert.match(panel,/deliveredCount>=1024/);
});

test("Illustrator 60 percent milestone does not promote runtime or mutation readiness",()=>{
  assert.match(illustrator,/"source_milestone_percent":60/);
  assert.match(illustrator,/"source_coding_status":"read_only_target_inspection_complete"/);
  assert.match(illustrator,/"source_runtime_verified":false/);
  assert.match(illustrator,/"production_ready":false/);
  assert.match(status,/Current declared source milestone: \*\*60%\*\*/);
  assert.match(status,/mutationAuthorized=false/);
  assert.match(status,/source_runtime_verified=false/);
  assert.match(status,/production_ready=false/);
  assert.doesNotMatch(lib,/IllustratorSetLayer/);
  assert.doesNotMatch(lib,/IllustratorExport/);
});
