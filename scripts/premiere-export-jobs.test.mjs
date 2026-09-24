import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const desktop=readFileSync("src-tauri/src/lib.rs","utf8");
const jobs=readFileSync("src-tauri/src/premiere_export_jobs.rs","utf8");

test("export job state separates file stability from encoder completion and production gates",()=>{
  for(const tool of ["premiere_export_status","premiere_readiness_report"]){assert.ok(desktop.includes(`"${tool}"`));}
  assert.match(desktop,/job\.bridge_state="execution_status_unknown"/);
  assert.match(desktop,/encoder_completion_verified":false/);
  assert.match(desktop,/"production_ready":false/);
  assert.match(jobs,/item\.at_ms\.saturating_sub\(p\.at_ms\)>=1500/);
  assert.match(jobs,/pub encoder_completion_verified:bool/);
  assert.match(jobs,/\|\| self\.encoder_completion_verified \|\|/);
  assert.match(jobs,/const MAX_OBSERVATIONS:usize=8/);
  assert.doesNotMatch(jobs,/setInterval|std::thread::sleep|std::process::Command/);
});
