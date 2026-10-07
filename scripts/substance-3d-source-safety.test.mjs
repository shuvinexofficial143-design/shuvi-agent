import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const lib=fs.readFileSync("src-tauri/src/lib.rs","utf8");
const substance=fs.readFileSync("src-tauri/src/substance_3d.rs","utf8");
const status=fs.readFileSync("docs/SUBSTANCE_3D_STATUS.md","utf8");

test("Substance 3D 20 percent source tools are registered",()=>{
  for(const name of [
    "substance_3d_capability_report",
    "substance_3d_readiness_report",
    "substance_3d_detect",
    "substance_3d_launch"
  ]) assert.match(lib,new RegExp(name));
  for(const name of [
    "Substance3DCapabilityReport",
    "Substance3DReadinessReport",
    "Substance3DDetect",
    "Substance3DLaunch"
  ]) assert.match(lib,new RegExp(name));
});

test("Substance 3D foundation is bounded to five recognized desktop apps",()=>{
  assert.match(substance,/"source_milestone_percent":20/);
  for(const app of ["painter","designer","sampler","stager","modeler"]) assert.match(substance,new RegExp('"' + app + '"'));
  assert.match(substance,/Adobe Substance 3D Painter\.exe/);
  assert.match(substance,/Adobe Substance 3D Designer\.exe/);
  assert.match(substance,/Adobe Substance 3D Sampler\.exe/);
  assert.match(substance,/Adobe Substance 3D Stager\.exe/);
  assert.match(substance,/Adobe Substance 3D Modeler\.exe/);
});

test("Substance 3D 20 percent does not invent project automation or host transport",()=>{
  assert.match(substance,/"host_transport":"not_implemented"/);
  assert.match(substance,/"future_host_transport":"research_required"/);
  assert.match(substance,/"project_automation_ready":false/);
  assert.doesNotMatch(lib,/Substance3DProjectContext/);
  assert.doesNotMatch(lib,/Substance3DMaterialWrite/);
  assert.doesNotMatch(lib,/Substance3DRenderExecute/);
});

test("Substance 3D runtime and production flags remain false",()=>{
  assert.match(substance,/"source_runtime_verified":false/);
  assert.match(substance,/"production_ready":false/);
  assert.match(status,/Current declared source milestone: \*\*20%\*\*/);
  assert.match(status,/source_runtime_verified=false/);
  assert.match(status,/production_ready=false/);
});
