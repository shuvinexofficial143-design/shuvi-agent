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

test("Illustrator 40 percent tools are registered end to end",()=>{
  for(const name of [
    "illustrator_capability_report","illustrator_readiness_report","illustrator_detect","illustrator_launch",
    "illustrator_bridge_start","illustrator_bridge_status","illustrator_bridge_stop","illustrator_context","illustrator_artboards"
  ]) assert.match(lib,new RegExp(name));
  for(const name of ["IllustratorBridgeStart","IllustratorBridgeStatus","IllustratorBridgeStop","IllustratorContext","IllustratorArtboards"])
    assert.match(lib,new RegExp(name));
});

test("Illustrator bridge is authenticated CEP plus ExtendScript and read only",()=>{
  assert.match(manifest,/Host Name="ILST"/);
  assert.match(panel,/__adobe_cep__\.evalScript/);
  assert.match(panel,/shuviIllustratorDispatch/);
  assert.match(host,/app\.activeDocument/);
  assert.match(bridge,/ILLUSTRATOR_BRIDGE_PORT: u16 = 17_365/);
  assert.match(bridge,/READ_ONLY_ACTIONS: &\[&str\] = &\[\s*"inspect_context",\s*"inspect_artboards",\s*\]/s);
  assert.match(bridge,/MUTATING_ACTIONS: &\[&str\] = &\[\]/);
  for(const mutation of [/remove\s*\(/,/move\s*\(/,/save\s*\(/,/exportFile\s*\(/])
    assert.doesNotMatch(host,mutation);
});

test("Illustrator document and artboard inspection are bounded",()=>{
  assert.match(host,/app\.documents/);
  assert.match(host,/doc\.artboards/);
  assert.match(host,/getActiveArtboardIndex/);
  assert.match(host,/maxArtboards<1\|\|maxArtboards>256/);
  assert.match(host,/Math\.min\(sourceCount,maxArtboards\)/);
  assert.match(host,/documentSignatureScope:"observational_read_only_not_persistent_id"/);
  assert.match(illustrator,/pub fn validate_context_receipt/);
  assert.match(illustrator,/pub fn validate_artboard_receipt/);
  assert.match(illustrator,/artboards\.len\(\)>256/);
  assert.match(lib,/json!\(\{"maxArtboards":128\}\)/);
});

test("Illustrator localhost bridge is token authenticated and bounded",()=>{
  assert.match(bridge,/127\.0\.0\.1/);
  assert.match(bridge,/X-Shuvi-Token/);
  assert.match(bridge,/MAX_BODY_BYTES: usize = 256 \* 1024/);
  assert.match(queue,/pending\.len\(\) >= 32/);
  assert.match(panel,/deliveredCount>=1024/);
});

test("Illustrator 40 percent milestone does not promote mutation or runtime readiness",()=>{
  assert.match(illustrator,/"source_milestone_percent":40/);
  assert.match(illustrator,/"host_transport":"cep_plus_extendscript"/);
  assert.match(illustrator,/"implemented":true/);
  assert.match(illustrator,/"source_runtime_verified":false/);
  assert.match(illustrator,/"production_ready":false/);
  assert.match(status,/Current declared source milestone: \*\*40%\*\*/);
  assert.match(status,/source_runtime_verified=false/);
  assert.match(status,/production_ready=false/);
  assert.doesNotMatch(lib,/IllustratorSetLayer/);
  assert.doesNotMatch(lib,/IllustratorExport/);
});
