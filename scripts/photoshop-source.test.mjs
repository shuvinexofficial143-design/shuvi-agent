import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const lib=fs.readFileSync("src-tauri/src/lib.rs","utf8");
const photoshop=fs.readFileSync("src-tauri/src/photoshop.rs","utf8");
const bridge=fs.readFileSync("src-tauri/src/photoshop_bridge.rs","utf8");
const queue=fs.readFileSync("src-tauri/src/photoshop_bridge_queue.rs","utf8");
const panel=fs.readFileSync("integrations/photoshop-uxp/index.js","utf8");
const manifest=JSON.parse(fs.readFileSync("integrations/photoshop-uxp/manifest.json","utf8"));
const status=fs.readFileSync("docs/PHOTOSHOP_STATUS.md","utf8");

test("Photoshop foundation and guarded bridge are registered end to end",()=>{
  for(const name of [
    "photoshop_capability_report","photoshop_readiness_report","photoshop_detect","photoshop_launch",
    "photoshop_bridge_start","photoshop_bridge_status","photoshop_bridge_stop","photoshop_context",
    "photoshop_layers","photoshop_set_layer_property"
  ]) assert.match(lib,new RegExp(name));
  for(const name of [
    "PhotoshopCapabilityReport","PhotoshopReadinessReport","PhotoshopDetect","PhotoshopLaunch",
    "PhotoshopBridgeStart","PhotoshopBridgeStatus","PhotoshopBridgeStop","PhotoshopContext",
    "PhotoshopLayers","PhotoshopSetLayerProperty"
  ]) assert.match(lib,new RegExp(name));
});

test("Photoshop launch stays limited to a freshly detected exact executable",()=>{
  assert.match(photoshop,/pub fn exact_detected_executable/);
  assert.match(photoshop,/Photoshop\.exe/);
  assert.match(photoshop,/freshly detected Program Files candidates/);
  assert.match(lib,/photoshop::exact_detected_executable\(&detection,&photoshop_exe\)\?/);
  assert.doesNotMatch(lib,/PhotoshopLaunch \{[^}]*args:/);
});

test("Photoshop UXP bridge uses manifest v5 api v2 and localhost only",()=>{
  assert.equal(manifest.manifestVersion,5);
  assert.equal(manifest.host.app,"PS");
  assert.equal(manifest.host.data.apiVersion,2);
  assert.deepEqual(manifest.requiredPermissions.network.domains,["http://127.0.0.1:17363"]);
  assert.match(bridge,/PHOTOSHOP_BRIDGE_PORT:u16=17_363/);
  assert.match(queue,/pending\.len\(\)>=32/);
});

test("Photoshop 60 percent mutation allowlist is tiny and destructive actions remain absent",()=>{
  assert.match(bridge,/READ_ONLY_ACTIONS:&\[&str\]=&\["inspect_context","list_layers"\]/);
  assert.match(bridge,/MUTATING_ACTIONS:&\[&str\]=&\["set_layer_property"\]/);
  assert.match(panel,/\["rename","visible","opacity"\]/);
  assert.match(panel,/core\.executeAsModal/);
  assert.match(panel,/suspendHistory/);
  assert.match(panel,/resumeHistory\(suspension,false\)/);
  for(const forbidden of ["delete_layer","merge_layers","rasterize_layer","flatten","batch_play"]){
    assert.doesNotMatch(bridge,new RegExp('\"'+forbidden+'\"'));
  }
  assert.doesNotMatch(panel,/batchPlay\s*\(/);
});

test("Photoshop guarded writes require fresh identity and independent post-write readback",()=>{
  assert.match(photoshop,/pub struct LayerWriteRequest/);
  assert.match(photoshop,/validate_write_precondition/);
  assert.match(photoshop,/validate_write_receipt/);
  assert.match(photoshop,/validate_post_write_readback/);
  assert.match(lib,/photoshop::validate_write_precondition\(&request,&context,&inventory\)/);
  assert.match(lib,/request\.bridge_arguments\(\)\?/);
  assert.match(lib,/photoshop::validate_write_receipt\(&request,&raw_receipt\)/);
  assert.match(lib,/photoshop::validate_post_write_readback\(&request,&post_inventory\)/);
  assert.match(lib,/automatic_retry_allowed/);
});

test("Photoshop 60 percent milestone remains source-only",()=>{
  assert.match(photoshop,/"milestone_percent":60/);
  assert.match(photoshop,/"destructive_layer_mutation":"not_implemented"/);
  assert.match(photoshop,/"target_percent":80/);
  assert.match(photoshop,/"source_runtime_verified":false/);
  assert.match(photoshop,/"production_ready":false/);
  assert.match(status,/Current declared source milestone: \*\*60%\*\*/);
});
