import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const lib=fs.readFileSync("src-tauri/src/lib.rs","utf8");
const animate=fs.readFileSync("src-tauri/src/animate.rs","utf8");
const bridge=fs.readFileSync("src-tauri/src/animate_bridge.rs","utf8");
const queue=fs.readFileSync("src-tauri/src/animate_bridge_queue.rs","utf8");
const panel=fs.readFileSync("integrations/animate-cep/main.js","utf8");
const host=fs.readFileSync("integrations/animate-cep/jsx/ShuviAnimate.jsx","utf8");
const manifest=fs.readFileSync("integrations/animate-cep/CSXS/manifest.xml","utf8");
const status=fs.readFileSync("docs/ANIMATE_STATUS.md","utf8");

test("Animate 60 percent tools are registered end to end",()=>{
  for(const name of ["animate_capability_report","animate_readiness_report","animate_detect","animate_launch","animate_bridge_start","animate_bridge_status","animate_bridge_stop","animate_context","animate_timeline","animate_library","animate_selection","animate_identity_check"])
    assert.match(lib,new RegExp(name));
  for(const name of ["AnimateLibrary","AnimateSelection","AnimateIdentityCheck"])
    assert.match(lib,new RegExp(name));
});

test("Animate bridge stays CEP plus JSFL and read only",()=>{
  assert.match(manifest,/Host Name="FLPR"/);
  assert.match(panel,/__adobe_cep__\.evalScript/);
  assert.match(host,/fl\.getDocumentDOM\(\)/);
  assert.match(bridge,/ANIMATE_BRIDGE_PORT: u16 = 17_364/);
  for(const action of ["inspect_context","inspect_timeline","inspect_library","inspect_selection","verify_identity"])
    assert.match(bridge,new RegExp('"'+action+'"'));
  for(const mutation of [/addNewLayer\s*\(/,/deleteLayer\s*\(/,/addItemToDocument\s*\(/,/setElementProperty\s*\(/,/save\s*\(/,/publish\s*\(/])
    assert.doesNotMatch(host,mutation);
});

test("Animate library and symbol metadata inspection is bounded",()=>{
  assert.match(host,/doc\.library/);
  assert.match(host,/library\.items/);
  assert.match(host,/maxItems<1\|\|maxItems>256/);
  assert.match(host,/Math\.min\(sourceCount,maxItems\)/);
  assert.match(host,/linkageClassName/);
  assert.match(host,/symbolType/);
  assert.match(host,/librarySnapshotScope:"bounded_observational_not_content_fingerprint"/);
  assert.match(animate,/pub fn validate_library_receipt/);
  assert.match(animate,/items\.len\(\)>256/);
});

test("Animate selected stage-element inspection is bounded and not fake stable identity",()=>{
  assert.match(host,/doc\.selection/);
  assert.match(host,/maxElements<1\|\|maxElements>64/);
  assert.match(host,/libraryItemName/);
  assert.match(host,/selectionSignature/);
  assert.match(host,/selectionSignatureScope:"observational_snapshot_not_stable_object_id"/);
  assert.match(animate,/pub fn validate_selection_receipt/);
  assert.match(animate,/elements\.len\(\)>64/);
});

test("Animate fresh identity guard never authorizes mutation",()=>{
  assert.match(host,/function shuviAnimateVerifyIdentity/);
  assert.match(host,/context\.documentSignature!=expectedDocument/);
  assert.match(host,/context\.timelineSignature!=expectedTimeline/);
  assert.match(host,/mutationAuthorized:false/);
  assert.match(lib,/expected_document_signature/);
  assert.match(lib,/expected_timeline_signature/);
  assert.match(animate,/pub fn validate_identity_receipt/);
  assert.match(animate,/mutationAuthorized/);
});

test("Animate localhost bridge remains authenticated and bounded",()=>{
  assert.match(bridge,/127\.0\.0\.1/);
  assert.match(bridge,/X-Shuvi-Token/);
  assert.match(bridge,/MAX_BODY_BYTES: usize = 256 \* 1024/);
  assert.match(queue,/pending\.len\(\) >= 32/);
  assert.match(panel,/deliveredCount>=1024/);
});

test("Animate 60 percent milestone does not promote runtime readiness",()=>{
  assert.match(animate,/"source_milestone_percent":60/);
  assert.match(animate,/"host_transport":"cep_plus_jsfl"/);
  assert.match(animate,/"source_runtime_verified":false/);
  assert.match(animate,/"production_ready":false/);
  assert.match(status,/Current declared source milestone: \*\*60%\*\*/);
  assert.match(status,/source_runtime_verified=false/);
  assert.match(status,/production_ready=false/);
});
