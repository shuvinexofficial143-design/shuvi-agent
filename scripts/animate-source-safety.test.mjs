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

test("Animate 40 percent tools are registered end to end",()=>{
  for(const name of ["animate_capability_report","animate_readiness_report","animate_detect","animate_launch","animate_bridge_start","animate_bridge_status","animate_bridge_stop","animate_context","animate_timeline"])
    assert.match(lib,new RegExp(name));
  for(const name of ["AnimateBridgeStart","AnimateBridgeStatus","AnimateBridgeStop","AnimateContext","AnimateTimeline"])
    assert.match(lib,new RegExp(name));
});

test("Animate bridge is CEP plus JSFL and read only",()=>{
  assert.match(manifest,/Host Name="FLPR"/);
  assert.match(manifest,/Shuvi Animate Bridge/);
  assert.match(panel,/__adobe_cep__\.evalScript/);
  assert.match(panel,/shuviAnimateDispatch/);
  assert.match(host,/fl\.getDocumentDOM\(\)/);
  assert.match(bridge,/ANIMATE_BRIDGE_PORT: u16 = 17_364/);
  assert.match(bridge,/ALLOWED_ACTIONS: &\[&str\] = &\[\s*"inspect_context",\s*"inspect_timeline",\s*\]/s);
  assert.doesNotMatch(host,/addNewLayer\s*\(/);
  assert.doesNotMatch(host,/deleteLayer\s*\(/);
  assert.doesNotMatch(host,/save\s*\(/);
  assert.doesNotMatch(host,/publish\s*\(/);
});

test("Animate document and timeline inspection are bounded",()=>{
  assert.match(host,/maxLayers<1\|\|maxLayers>256/);
  assert.match(host,/Math\.min\(sourceCount,maxLayers\)/);
  assert.match(host,/documentSignature/);
  assert.match(host,/readOnly:true/);
  assert.match(animate,/pub fn validate_context_receipt/);
  assert.match(animate,/pub fn validate_timeline_receipt/);
  assert.match(animate,/layers\.len\(\)>256/);
  assert.match(lib,/json!\(\{"maxLayers":128\}\)/);
});

test("Animate localhost bridge is authenticated and bounded",()=>{
  assert.match(bridge,/127\.0\.0\.1/);
  assert.match(bridge,/X-Shuvi-Token/);
  assert.match(bridge,/MAX_BODY_BYTES: usize = 256 \* 1024/);
  assert.match(queue,/pending\.len\(\) >= 32/);
  assert.match(panel,/deliveredCount>=1024/);
});

test("Animate 40 percent milestone does not promote runtime readiness",()=>{
  assert.match(animate,/"source_milestone_percent":40/);
  assert.match(animate,/"host_transport":"cep_plus_jsfl"/);
  assert.match(animate,/"source_runtime_verified":false/);
  assert.match(animate,/"production_ready":false/);
  assert.match(status,/Current declared source milestone: \*\*40%\*\*/);
  assert.match(status,/source_runtime_verified=false/);
  assert.match(status,/production_ready=false/);
});
