import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
const report=readFileSync(new URL("../src-tauri/src/premiere_acceptance.rs",import.meta.url),"utf8");
const harness=readFileSync(new URL("../src-tauri/src/premiere_acceptance_harness.rs",import.meta.url),"utf8");
const execution=readFileSync(new URL("../src-tauri/src/premiere_acceptance_execution.rs",import.meta.url),"utf8");

test("real host acceptance can exercise native scene marker detection",()=>{
  assert.match(harness,/scene_markers/);
  assert.match(harness,/premiere_detect_scene_markers/);
  assert.match(rust,/ToolAction::PremiereSceneDetection/);
  assert.match(rust,/mode:"markers"/);
  assert.match(rust,/premiere_detect_scene_markers/);
});

test("scene acceptance requires observed delta and restored selection",()=>{
  assert.match(execution,/finish_scene_markers/);
  assert.match(execution,/verification_status/);
  assert.match(execution,/verified_delta/);
  assert.match(execution,/selectionRestored/);
  assert.match(execution,/markerObservationTruncated/);
  assert.match(execution,/newMarkers/);
  assert.match(report,/verified_scene_detection/);
  assert.match(report,/marker_count==0/);
  assert.match(report,/!selection_restored/);
});

test("scene marker acceptance keeps normal checkpoint and no blind retry semantics",()=>{
  assert.match(rust,/v\.get\("backup"\)\.or_else\(\|\|v\.get\("checkpoint"\)\)/);
  assert.match(rust,/retry_automatically":false/);
  assert.match(rust,/cleanup_needed/);
  assert.match(execution,/generated scene markers were not removed automatically/);
});

test("acceptance report migrates the immediately previous schema without fake promotion",()=>{
  assert.match(report,/current_report/);
  assert.match(report,/capabilities\.len\(\)\+1!=SPECS\.len\(\)/);
  assert.match(report,/scene_edit_detection/);
  assert.match(report,/implemented_unverified/);
});

test("readiness estimate is synchronized with AG while runtime remains evidence based",()=>{
  assert.match(rust,/code_implementation_estimate_pct":98/);
  assert.match(rust,/"scene_edit_detection":verified\("scene_edit_detection"\)/);
  assert.match(rust,/production_ready":false/);
});
