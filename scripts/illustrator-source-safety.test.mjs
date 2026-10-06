import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const lib=fs.readFileSync("src-tauri/src/lib.rs","utf8");
const illustrator=fs.readFileSync("src-tauri/src/illustrator.rs","utf8");
const status=fs.readFileSync("docs/ILLUSTRATOR_STATUS.md","utf8");

test("Illustrator 20 percent source tools are registered",()=>{
  for(const name of ["illustrator_capability_report","illustrator_readiness_report","illustrator_detect","illustrator_launch"])
    assert.match(lib,new RegExp(name));
  for(const name of ["IllustratorCapabilityReport","IllustratorReadinessReport","IllustratorDetect","IllustratorLaunch"])
    assert.match(lib,new RegExp(name));
});

test("Illustrator desktop detection is bounded and exact",()=>{
  assert.match(illustrator,/MAX_ADOBE_ENTRIES:usize=128/);
  assert.match(illustrator,/Adobe Illustrator/);
  assert.match(illustrator,/Support Files/);
  assert.match(illustrator,/Illustrator\.exe/);
  assert.match(illustrator,/exact_detected_executable/);
  assert.match(lib,/register_managed_process\(state,pid\)/);
});

test("Illustrator future transport is declared but not faked",()=>{
  assert.match(illustrator,/"source_milestone_percent":20/);
  assert.match(illustrator,/"kind":"cep_plus_extendscript"/);
  assert.match(illustrator,/"illustrator_cep_host_id":"ILST"/);
  assert.match(illustrator,/"implemented":false/);
  assert.match(illustrator,/"host_transport":"not_implemented"/);
  assert.match(status,/Current declared source milestone: \*\*20%\*\*/);
});

test("Illustrator 20 percent milestone exposes no document mutation",()=>{
  assert.doesNotMatch(lib,/IllustratorSetLayer/);
  assert.doesNotMatch(lib,/IllustratorExport/);
  assert.doesNotMatch(lib,/IllustratorSave/);
  assert.match(illustrator,/"source_runtime_verified":false/);
  assert.match(illustrator,/"production_ready":false/);
  assert.match(status,/source_runtime_verified=false/);
  assert.match(status,/production_ready=false/);
});
