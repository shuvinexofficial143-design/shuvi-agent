import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const lib=fs.readFileSync("src-tauri/src/lib.rs","utf8");
const photoshop=fs.readFileSync("src-tauri/src/photoshop.rs","utf8");
const status=fs.readFileSync("docs/PHOTOSHOP_STATUS.md","utf8");

test("Photoshop 20 percent foundation is registered end to end",()=>{
  assert.match(lib,/mod photoshop;/);
  assert.match(lib,/photoshop_capability_report/);
  assert.match(lib,/photoshop_readiness_report/);
  assert.match(lib,/photoshop_detect/);
  assert.match(lib,/photoshop_launch/);
  assert.match(lib,/PhotoshopCapabilityReport/);
  assert.match(lib,/PhotoshopReadinessReport/);
  assert.match(lib,/PhotoshopDetect/);
  assert.match(lib,/PhotoshopLaunch/);
});

test("Photoshop launch is limited to a freshly detected exact executable",()=>{
  assert.match(photoshop,/pub fn exact_detected_executable/);
  assert.match(photoshop,/Photoshop\.exe/);
  assert.match(photoshop,/freshly detected Program Files candidates/);
  assert.match(lib,/photoshop::detect_installs\(\)\?/);
  assert.match(lib,/photoshop::exact_detected_executable\(&detection,&photoshop_exe\)\?/);
  assert.doesNotMatch(lib,/PhotoshopLaunch \{[^}]*args:/);
});

test("Photoshop 20 percent milestone does not claim editing or runtime acceptance",()=>{
  assert.match(photoshop,/"milestone_percent":40/);
  assert.match(photoshop,/"pixel_or_layer_mutation":"not_implemented"/);
  assert.match(photoshop,/"host_bridge_available":false/);
  assert.match(photoshop,/"source_runtime_verified":false/);
  assert.match(photoshop,/"production_ready":false/);
  assert.match(status,/Current declared source milestone: \*\*40%\*\*/);
  assert.match(status,/UXP host-observation path/);
});


test("Photoshop 40 percent bridge remains read-only and bounded",()=>{
  const bridge=fs.readFileSync("src-tauri/src/photoshop_bridge.rs","utf8");
  const queue=fs.readFileSync("src-tauri/src/photoshop_bridge_queue.rs","utf8");
  const manifest=JSON.parse(fs.readFileSync("integrations/photoshop-uxp/manifest.json","utf8"));
  const panel=fs.readFileSync("integrations/photoshop-uxp/index.js","utf8");

  assert.deepEqual(manifest.host,{app:"PS",minVersion:"23.3.0"});
  assert.deepEqual(manifest.requiredPermissions.network.domains,["http://127.0.0.1:17363"]);
  assert.match(bridge,/ALLOWED_ACTIONS:&\[&str\]=&\["inspect_context","list_layers"\]/);
  assert.match(bridge,/PHOTOSHOP_BRIDGE_PORT:u16=17_363/);
  assert.match(queue,/pending\.len\(\)>=32/);
  assert.match(panel,/MAX_LAYERS=256/);
  assert.match(panel,/MAX_DEPTH=8/);
  assert.doesNotMatch(panel,/batchPlay\s*\(/);
  assert.doesNotMatch(panel,/executeAsModal\s*\(/);
});

test("Photoshop 40 percent routes validate host receipts in Rust",()=>{
  const rust=fs.readFileSync("src-tauri/src/lib.rs","utf8");
  const photoshop=fs.readFileSync("src-tauri/src/photoshop.rs","utf8");
  assert.match(rust,/PhotoshopBridgeStart/);
  assert.match(rust,/PhotoshopContext/);
  assert.match(rust,/PhotoshopLayers/);
  assert.match(rust,/photoshop::validate_context_receipt\(&raw\)/);
  assert.match(rust,/photoshop::validate_layer_inventory\(&raw\)/);
  assert.match(photoshop,/pub fn validate_context_receipt/);
  assert.match(photoshop,/pub fn validate_layer_inventory/);
  assert.match(photoshop,/"target_percent":60/);
  assert.match(photoshop,/"pixel_or_layer_mutation":"not_implemented"/);
});
