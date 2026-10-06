import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const lib=fs.readFileSync("src-tauri/src/lib.rs","utf8");
const animate=fs.readFileSync("src-tauri/src/animate.rs","utf8");
const status=fs.readFileSync("docs/ANIMATE_STATUS.md","utf8");

test("Animate 20 percent source tools are registered",()=>{
  for(const name of ["animate_capability_report","animate_readiness_report","animate_detect","animate_launch"]){
    assert.match(lib,new RegExp(name));
  }
  for(const name of ["AnimateCapabilityReport","AnimateReadinessReport","AnimateDetect","AnimateLaunch"]){
    assert.match(lib,new RegExp(name));
  }
});

test("Animate foundation uses bounded Program Files detection and exact launch identity",()=>{
  assert.match(animate,/MAX_ADOBE_ENTRIES:usize=128/);
  assert.match(animate,/ProgramFiles\(x86\)/);
  assert.match(animate,/Adobe Animate/);
  assert.match(animate,/Animate\.exe/);
  assert.match(animate,/exact_detected_executable/);
  assert.match(lib,/register_managed_process\(state,pid\)/);
});

test("Animate 20 percent milestone stays fail closed about host automation",()=>{
  assert.match(animate,/"source_milestone_percent":20/);
  assert.match(animate,/"host_transport":"not_implemented"/);
  assert.match(animate,/"source_runtime_verified":false/);
  assert.match(animate,/"production_ready":false/);
  assert.match(status,/Current declared source milestone: \*\*20%\*\*/);
  assert.match(status,/source_runtime_verified=false/);
  assert.match(status,/production_ready=false/);
});

test("Animate 20 percent source does not pretend document mutation exists",()=>{
  assert.match(animate,/"timeline_mutation":true/);
  assert.match(animate,/"drawing_mutation":true/);
  assert.match(animate,/"publish_export":true/);
  assert.doesNotMatch(lib,/AnimateSetLayer/);
  assert.doesNotMatch(lib,/AnimatePublish/);
});
