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
  assert.match(photoshop,/"milestone_percent":20/);
  assert.match(photoshop,/"pixel_or_layer_mutation":"not_implemented"/);
  assert.match(photoshop,/"host_bridge_available":false/);
  assert.match(photoshop,/"source_runtime_verified":false/);
  assert.match(photoshop,/"production_ready":false/);
  assert.match(status,/Current declared source milestone: \*\*20%\*\*/);
  assert.match(status,/UXP plugin\/bridge transport/);
});
