import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const lib=fs.readFileSync("src-tauri/src/lib.rs","utf8");
const substance=fs.readFileSync("src-tauri/src/substance_3d.rs","utf8");
const status=fs.readFileSync("docs/SUBSTANCE_3D_STATUS.md","utf8");

test("Substance 3D 40 percent source tools are registered",()=>{
  for(const name of [
    "substance_3d_capability_report",
    "substance_3d_readiness_report",
    "substance_3d_detect",
    "substance_3d_launch",
    "substance_3d_automation_catalog",
    "substance_3d_plan_automation"
  ]) assert.match(lib,new RegExp(name));
  for(const name of [
    "Substance3DCapabilityReport",
    "Substance3DReadinessReport",
    "Substance3DDetect",
    "Substance3DLaunch",
    "Substance3DAutomationCatalog",
    "Substance3DPlanAutomation"
  ]) assert.match(lib,new RegExp(name));
});

test("Substance 3D foundation is bounded to five recognized desktop apps",()=>{
  assert.match(substance,/"source_milestone_percent":40/);
  for(const app of ["painter","designer","sampler","stager","modeler"]) assert.match(substance,new RegExp('"' + app + '"'));
  assert.match(substance,/Adobe Substance 3D Painter\.exe/);
  assert.match(substance,/Adobe Substance 3D Designer\.exe/);
  assert.match(substance,/Adobe Substance 3D Sampler\.exe/);
  assert.match(substance,/Adobe Substance 3D Stager\.exe/);
  assert.match(substance,/Adobe Substance 3D Modeler\.exe/);
});

test("Substance 3D 40 percent exposes only documented planning surfaces",()=>{
  assert.match(substance,/--enable-remote-scripting/);
  assert.match(substance,/python_api_plugins/);
  assert.match(substance,/--run-script/);
  assert.match(substance,/no_authoritative_scripting_surface_verified_in_current_research/);
  assert.match(substance,/"execution_supported":false/);
  assert.match(substance,/"mutation_performed":false/);
  assert.doesNotMatch(lib,/Substance3DProjectContext/);
  assert.doesNotMatch(lib,/Substance3DMaterialWrite/);
  assert.doesNotMatch(lib,/Substance3DRenderExecute/);
});

test("Substance 3D runtime and production flags remain false",()=>{
  assert.match(substance,/"source_runtime_verified":false/);
  assert.match(substance,/"production_ready":false/);
  assert.match(status,/Current declared source milestone: \*\*40%\*\*/);
  assert.match(status,/source_runtime_verified=false/);
  assert.match(status,/production_ready=false/);
});
