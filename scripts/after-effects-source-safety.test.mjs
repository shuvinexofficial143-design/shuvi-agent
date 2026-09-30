import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const rust=readFileSync(new URL("../src-tauri/src/after_effects.rs",import.meta.url),"utf8");
const transport=readFileSync(new URL("../src-tauri/src/after_effects_transport.rs",import.meta.url),"utf8");
const jsx=readFileSync(new URL("../integrations/after-effects-extendscript/shuvi-ae.jsx",import.meta.url),"utf8");
const lib=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");

test("After Effects source never claims runtime verification",()=>{
  assert.match(rust,/"source_runtime_verified":false/);
  assert.match(rust,/"runtime_verified":"not_verified"/);
  assert.match(rust,/"native_motion_tracker_control":"unsupported_documented_surface"/);
  assert.match(lib,/"runtime_verified":false/);
});

test("AE mutations require exact saved project identity",()=>{
  assert.match(jsx,/Mutating After Effects action requires exact expected_project_file/);
  assert.match(jsx,/Active After Effects project file changed; mutation refused/);
  assert.match(transport,/expected_project_file:Option<String>/);
  assert.match(transport,/validate_project_path/);
});

test("AE targeting uses persistent item and layer IDs plus property matchName guards",()=>{
  assert.match(jsx,/project\.itemByID\(compId\)/);
  assert.match(jsx,/layer\.id === layerId/);
  assert.match(jsx,/next\.matchName !== matchName/);
  assert.match(jsx,/next\.propertyIndex !== segment\.property_index/);
});

test("hand tracking is external grounded samples applied through verified keyframe readback",()=>{
  assert.match(rust,/HandTrackPlan/);
  assert.match(rust,/native_tracker_result_claimed":false/);
  assert.match(jsx,/p\.setValuesAtTimes\(times, values\)/);
  assert.match(jsx,/p\.valueAtTime\(times\[i\], true\)/);
  assert.match(jsx,/verified_keyframe_readback/);
});

test("effect and render queue creation require observable deltas",()=>{
  assert.match(jsx,/afterCount === beforeCount \+ 1/);
  assert.match(jsx,/readback\.matchName === matchName/);
  assert.match(jsx,/after === before \+ 1/);
  assert.match(jsx,/render_completion_verified: false/);
});

test("transport binds request identity and rejects blind runtime trust",()=>{
  assert.match(transport,/request\.request_id!==expectedRequestId/);
  assert.match(transport,/Malformed After Effects receipt JSON/);
  assert.match(transport,/runtime_verified:false/);
  assert.match(transport,/afterfx_arguments:vec!\["-r"/);
});
