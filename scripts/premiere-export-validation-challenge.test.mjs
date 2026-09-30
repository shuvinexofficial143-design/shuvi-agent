import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
const jobs=readFileSync(new URL("../src-tauri/src/premiere_export_jobs.rs",import.meta.url),"utf8");

test("export status exposes a challenge bound to the latest observed file state",()=>{
  const last=rust.lastIndexOf("ToolAction::PremiereExportStatus");
  const end=rust.indexOf("ToolAction::PremiereReadinessReport",last);
  const arm=rust.slice(last,end);
  assert.match(arm,/job\.observe_once\(\)/);
  assert.match(arm,/job\.media_validation_challenge\(\)\.ok\(\)/);
  assert.match(arm,/"media_validation_challenge"/);
  assert.match(arm,/"stale_project_or_sequence"/);
});

test("media challenge binds job output size and modified time before any parser receipt",()=>{
  assert.match(jobs,/pub fn media_validation_challenge/);
  assert.match(jobs,/"job_id":self\.job_id/);
  assert.match(jobs,/"output":self\.output/);
  assert.match(jobs,/"observed_size_bytes":item\.size_bytes/);
  assert.match(jobs,/"observed_modified_ms":item\.modified_ms/);
  assert.match(jobs,/Media validation requires a non-empty observed output file/);
});
